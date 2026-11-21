// REST API v1 router.
// Plan 02 Phase 1.
//
// Mounts /api/external/v1/* in server.js. Phase 1 wires:
//   GET  /health         — public, no auth, returns service + version
//   GET  /me             — auth required, returns token + owner info (smoke route)
//
// Phase 3 will auto-wire operation routes from the registry (one route per
// operation with `transports.rest = { method, path }`).

import { readFileSync, statSync, createReadStream } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import express from 'express';

import { restAuthMiddleware } from './auth.js';
import { restErrorHandler } from './errors.js';
import { MCP_PROTOCOL_VERSION } from '../shared/errors.js';
import { verifyMediaToken } from '../utils/media-link.js';
import { buildOpenApiSpec, renderScalarExplorer } from './openapi.js';
import { mountOperationRoutes } from './operation-routes.js';
import '../mcp/tools/index.js'; // side-effect: register all operations

export function buildExternalRouter({ supabase, userbotService }) {
  const router = express.Router();

  // --- Public health check --------------------------------------------------
  // release читается из backend/.release-version (пишет deploy-pull.sh, волна 4.3)
  const releaseFile = () => {
    try {
      return readFileSync(join(process.cwd(), '.release-version'), 'utf8').trim();
    } catch {
      return 'dev';
    }
  };
  router.get('/health', (_req, res) => {
    res.json({
      service: 'bullgram-external-api',
      version: 'v1',
      release: releaseFile(),
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

  // --- Signed media links (public, expiring) --------------------------------
  // Issued by bullgram_userbot_media_save. Path lives inside the internal
  // media store; token = HMAC(ENCRYPTION_KEY) + expiry. No brapi_ needed —
  // this is the byte path for MCP (brmcp_) agents.
  const MEDIA_MIME_BY_EXT = {
    '.pdf': 'application/pdf',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.mp4': 'video/mp4',
    '.mp3': 'audio/mpeg',
    '.oga': 'audio/ogg',
    '.ogg': 'audio/ogg',
    '.zip': 'application/zip',
    '.epub': 'application/epub+zip',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.txt': 'text/plain; charset=utf-8'
  };
  router.get('/media/:token', (req, res) => {
    const verified = verifyMediaToken(req.params.token);
    if (!verified.ok) {
      const status = verified.reason === 'expired' ? 410 : (verified.reason === 'bad_signature' ? 403 : 400);
      return res.status(status).json({ error: { code: status, message: `Media link ${verified.reason}.` } });
    }
    const root = resolve(join(process.cwd(), 'uploads-internal', 'chat-media'));
    const target = resolve(root, verified.relPath);
    if (!target.startsWith(root + '/') || verified.relPath.includes('..')) {
      return res.status(400).json({ error: { code: 400, message: 'Media link points outside the media store.' } });
    }
    let stat;
    try {
      stat = statSync(target);
    } catch {
      // TTL sweep may have already removed it.
      return res.status(410).json({ error: { code: 410, message: 'Media file is gone from the store (TTL).' } });
    }
    if (!stat.isFile()) {
      return res.status(404).json({ error: { code: 404, message: 'Media file not found.' } });
    }
    const ext = extname(target).toLowerCase();
    res.setHeader('Content-Type', verified.mime || MEDIA_MIME_BY_EXT[ext] || 'application/octet-stream');
    res.setHeader('Content-Length', String(stat.size));
    res.setHeader('Cache-Control', 'private, max-age=300');
    createReadStream(target).pipe(res);
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
