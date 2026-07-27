// REST API v1 router.
// Plan 02 Phase 1.
//
// Mounts /api/external/v1/* in server.js. Phase 1 wires:
//   GET  /health         — public, no auth, returns service + version
//   GET  /me             — auth required, returns token + owner info (smoke route)
//
// Phase 3 will auto-wire operation routes from the registry (one route per
// operation with `transports.rest = { method, path }`).

import express from 'express';

import { restAuthMiddleware } from './auth.js';
import { restErrorHandler } from './errors.js';
import { MCP_PROTOCOL_VERSION } from '../shared/errors.js';
import { buildOpenApiSpec, renderScalarExplorer } from './openapi.js';
import { mountOperationRoutes } from './operation-routes.js';
import '../mcp/tools/index.js'; // side-effect: register all operations

export function buildExternalRouter({ supabase, userbotService }) {
  const router = express.Router();

  // --- Public health check --------------------------------------------------
  router.get('/health', (_req, res) => {
    res.json({
      service: 'bullgram-external-api',
      version: 'v1',
      mcp_protocol: MCP_PROTOCOL_VERSION,
      time: new Date().toISOString()
    });
  });

  // --- OpenAPI spec + Scalar explorer --------------------------------------
  router.get('/openapi.json', (req, res) => {
    const baseURL = `${req.protocol}://${req.get('host')}/api/external/v1`;
    res.json(buildOpenApiSpec({ baseURL }));
  });

  router.get('/docs', (_req, res) => {
    res.type('html').send(renderScalarExplorer());
  });

  // --- Authenticated smoke route -------------------------------------------
  // Useful for verifying a token works before hitting real operations.
  router.get('/me', restAuthMiddleware(supabase), (req, res) => {
    res.json({
      auth_kind: req.auth.kind,
      owner_id: req.user.id,
      token: {
        id: req.token?.id || null,
        purpose: req.token?.purpose || null,
        scopes: Array.isArray(req.token?.scopes) ? req.token.scopes : []
      },
      tier: req.profile?.product_tier || null
    });
  });

  // Phase 3: mount REST routes for every operation with transports.rest.
  mountOperationRoutes(router, { supabase, userbotService });

  router.use(restErrorHandler);
  return router;
}
