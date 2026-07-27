// Plan 01 Phase 3: thin JSON-RPC shim over shared/dispatch.js.
// All tool logic lives in backend/mcp/tools/<domain>/<name>.js and registers itself
// in shared/operations.js at import time. This file only handles:
//   - token management (GET/POST /tokens, /tokens/:id/revoke, /tokens/test)
//   - JSON-RPC envelope (initialize, ping, notifications/initialized, tools/list, tools/call)

import express from 'express';
import { authenticateUser } from '../middlewares/auth.middleware.js';
import { authenticateAgentOrUserToken } from '../utils/agent-mcp-auth.js';
import {
  createIntegrationToken,
  listIntegrationTokens,
  revokeIntegrationToken
} from '../services/integration-tokens.service.js';
import { buildAgentInfraPayload } from '../utils/agent-tools.js';

import '../mcp/tools/index.js'; // side-effect: registers all tool handlers

import { dispatchOperation, mapMcpErrorToHttp } from '../shared/dispatch.js';
import { getFilteredToolDefinitions } from '../shared/utils.js';
import {
  MCP_PROTOCOL_VERSION,
  MCPError,
  ERROR_CODES,
  makeJsonRpcResult,
  makeJsonRpcError
} from '../shared/errors.js';
import { listOperations } from '../shared/operations.js';

const SERVER_INFO = { name: 'bullrun-mcp', version: '0.2.0' };

function extractRequestIp(req) {
  return req?.ip || req?.headers?.['x-forwarded-for'] || '';
}

function attachAuthToReq(req, auth) {
  req.auth = auth;
  req.user = auth.user;
  req.profile = auth.profile;
  req.token = auth.integrationToken || null;
}

export default function agentMcpRoutes(supabase, userbotService) {
  const router = express.Router();

  router.get('/tokens', authenticateUser, async (req, res) => {
    try {
      const tokens = await listIntegrationTokens(supabase, { ownerId: req.user.id, purpose: 'mcp' });
      res.json({ tokens });
    } catch (error) {
      res.status(500).json({ error: error.message || 'Не удалось загрузить MCP токены.' });
    }
  });

  router.post('/tokens', authenticateUser, async (req, res) => {
    try {
      const label = String(req.body?.label || '').trim() || 'Bullgram MCP';
      const { token, record } = await createIntegrationToken(supabase, {
        ownerId: req.user.id,
        label,
        purpose: 'mcp'
      });
      res.json({ token, record });
    } catch (error) {
      res.status(500).json({ error: error.message || 'Не удалось создать MCP токен.' });
    }
  });

  router.post('/tokens/:id/revoke', authenticateUser, async (req, res) => {
    try {
      await revokeIntegrationToken(supabase, {
        ownerId: req.user.id,
        tokenId: req.params.id,
        reason: String(req.body?.reason || '').trim() || 'revoked_by_user'
      });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message || 'Не удалось отозвать MCP токен.' });
    }
  });

  router.post('/tokens/test', authenticateUser, async (req, res) => {
    try {
      const providedToken = String(req.body?.token || '').trim();
      if (!providedToken) {
        return res.status(400).json({ error: 'Передай token для проверки.' });
      }
      const auth = await authenticateAgentOrUserToken({
        supabase,
        authorizationHeader: `Bearer ${providedToken}`,
        requestIp: extractRequestIp(req)
      });
      const summary = await buildAgentInfraPayload({
        supabase,
        user: auth.user,
        profile: auth.profile
      });
      res.json({
        success: true,
        kind: auth.kind,
        profile_role: auth.profile?.role || null,
        product_tier: summary.summary?.product_tier || null,
        proxy_total: summary.summary?.proxy_total || 0,
        userbot_total: summary.summary?.userbot_total || 0
      });
    } catch (error) {
      res.status(400).json({ error: error.message || 'Проверка MCP токена не прошла.' });
    }
  });

  router.post('/', async (req, res) => {
    const rpc = req.body || {};
    const id = rpc.id ?? null;

    let auth;
    try {
      auth = await authenticateAgentOrUserToken({
        supabase,
        authorizationHeader: req.headers.authorization,
        requestIp: extractRequestIp(req)
      });
      attachAuthToReq(req, auth);
    } catch (error) {
      return res.status(401).json(makeJsonRpcError(id, ERROR_CODES.INTEGRATION_TOKEN_REQUIRED, error.message || 'Unauthorized'));
    }

    if (rpc.jsonrpc !== '2.0') {
      return res.status(400).json(makeJsonRpcError(id, ERROR_CODES.INVALID_REQUEST, 'Invalid Request: jsonrpc must be "2.0"'));
    }

    try {
      switch (rpc.method) {
        case 'initialize':
          return res.json(makeJsonRpcResult(id, {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: { tools: { listChanged: false } },
            serverInfo: SERVER_INFO
          }));

        case 'notifications/initialized':
          // MCP spec: notifications receive no response. 204 is the cleanest.
          return res.status(204).end();

        case 'ping':
          return res.json(makeJsonRpcResult(id, {}));

        case 'tools/list':
          return res.json(makeJsonRpcResult(id, {
            tools: getFilteredToolDefinitions(req.token?.scopes)
          }));

        case 'tools/call': {
          const operationName = rpc.params?.name;
          const args = rpc.params?.arguments || {};
          try {
            const { result } = await dispatchOperation({
              supabase,
              req,
              operationName,
              args,
              userbotService,
              source: 'mcp'
            });
            return res.json(makeJsonRpcResult(id, {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
              structuredContent: result
            }));
          } catch (error) {
            const rpcErr = error instanceof MCPError ? error : new MCPError(ERROR_CODES.INTERNAL, error.message || 'Internal error', {});
            const httpStatus = mapMcpErrorToHttp(rpcErr.code);
            return res.status(httpStatus).json(makeJsonRpcError(id, rpcErr.code, rpcErr.message, rpcErr.data || null));
          }
        }

        default:
          return res.status(404).json(makeJsonRpcError(id, ERROR_CODES.METHOD_NOT_FOUND, `Method not found: ${rpc.method}`));
      }
    } catch (error) {
      return res.status(500).json(makeJsonRpcError(id, ERROR_CODES.INTERNAL, error.message || 'Internal error'));
    }
  });

  // Helpful for debugging: list all registered operations
  router.get('/_debug/operations', authenticateUser, (req, res) => {
    res.json({
      operations: listOperations().map((op) => ({
        name: op.name,
        title: op.title,
        requiredScopes: op.requiredScopes,
        requiresIntegrationToken: op.requiresIntegrationToken,
        rateLimitClass: op.rateLimitClass,
        transports: op.transports
      }))
    });
  });

  return router;
}
