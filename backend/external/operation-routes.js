// Auto-wires Express routes for every operation with `transports.rest`.
// Plan 02 Phase 3.
//
// For each operation, registers {method} {path} on the supplied router.
// Path syntax is OpenAPI-style ({name}); we convert to Express (:name).
//
// Argument construction:
//   - Path params: pulled from req.params
//   - GET/DELETE: query params pulled from req.query
//   - POST/PUT/PATCH: body fields pulled from req.body
// Path params override query/body — never the other way around.
//
// The dispatcher's scope/allowlist/rate-limit/audit checks all run; we just
// marshal args and translate the result into a JSON response.

import express from 'express';

import { dispatchOperation } from '../shared/dispatch.js';
import { listRestOperations } from '../shared/operations.js';
import { MCPError, ERROR_CODES, mapMcpErrorToHttp } from '../shared/errors.js';
import { restAuthMiddleware } from './auth.js';
import { restErrorHandler, buildErrorEnvelope } from './errors.js';

function openApiPathToExpress(path) {
  return path.replace(/\{([^}]+)\}/g, ':$1');
}

function coerceParam(schema, value) {
  if (value === undefined) return undefined;
  if (!schema) return value;
  if (schema.type === 'integer') {
    const n = Number(value);
    return Number.isFinite(n) ? Math.floor(n) : value;
  }
  if (schema.type === 'boolean') {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  }
  return value;
}

function buildArgsFromRequest(operation, req) {
  const inputSchema = operation.inputSchema || { type: 'object', properties: {} };
  const props = inputSchema.properties || {};
  const pathParamNames = extractPathParamNames(operation.transports.rest.path);
  const method = operation.transports.rest.method.toUpperCase();
  const isQuerySource = method === 'GET' || method === 'DELETE';

  const args = {};

  // Path params (highest priority)
  for (const name of pathParamNames) {
    if (req.params?.[name] !== undefined) {
      args[name] = coerceParam(props[name], req.params[name]);
    }
  }

  // Remaining params from query or body
  for (const name of Object.keys(props)) {
    if (pathParamNames.includes(name)) continue;
    const source = isQuerySource ? req.query : req.body;
    if (source && source[name] !== undefined) {
      args[name] = coerceParam(props[name], source[name]);
    }
  }

  return args;
}

function extractPathParamNames(path) {
  const names = [];
  const re = /\{([^}]+)\}/g;
  let m;
  while ((m = re.exec(path)) !== null) names.push(m[1]);
  return names;
}

export function mountOperationRoutes(parentRouter, { supabase, userbotService }) {
  const opsRouter = express.Router();
  // Auth applies to every operation route.
  opsRouter.use(restAuthMiddleware(supabase));

  const restOps = listRestOperations();
  for (const op of restOps) {
    const { method, path } = op.transports.rest;
    const expressPath = openApiPathToExpress(path);
    const lowerMethod = method.toLowerCase();
    if (typeof opsRouter[lowerMethod] !== 'function') {
      console.warn(`[external] unsupported method ${method} for ${op.name}, skipping`);
      continue;
    }
    opsRouter[lowerMethod](expressPath, async (req, res, next) => {
      try {
        const args = buildArgsFromRequest(op, req);
        const { result } = await dispatchOperation({
          supabase,
          req,
          operationName: op.name,
          args,
          userbotService,
          source: 'rest'
        });
        res.json(result);
      } catch (e) {
        if (e instanceof MCPError) {
          const env = buildErrorEnvelope(e);
          return res.status(mapMcpErrorToHttp(e.code)).json(env);
        }
        next(e);
      }
    });
  }

  parentRouter.use(opsRouter);
  return opsRouter;
}
