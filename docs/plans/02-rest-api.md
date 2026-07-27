# Plan 02 — Bullgram External REST API

> **Revision 2** — applied audit findings: shared dispatcher (from Plan 01), removed `?fields=` and `filter=` params, switched to OpenAPI 3.0.3, switched from JSDoc to zod schemas, abstract `RateLimiter` interface, added `/health` and `request_id` middleware, fixed `auditId` closure capture, clarified SDK scope, verified Scalar API.

## Goals

Expose the **same operations** that the MCP server offers (see `01-mcp.md`), through a **conventional REST API** at `/api/external/v1/*`, optimized for n8n, Zapier, scripts, SDKs, and any HTTP client.

### Functional goals

- Resource-oriented URLs (`GET /api/external/v1/userbots/:id/dialogs/:chatId/messages`)
- Standard HTTP semantics (GET = read, POST = write)
- Cursor pagination via `?cursor=...&limit=...`
- OpenAPI 3.0.3 spec generated from **zod schemas** (single source of truth)
- Interactive explorer (Scalar) at `/api/docs`
- Token model parallel to MCP: `purpose=api`, prefix `brapi_...`, scopes `api:userbot:read` / `api:userbot:write`
- **Shares dispatcher with MCP** — zero business-logic duplication
- Shares rate limiter, audit log, content sanitizer from `backend/shared/`

### Non-goals

- Replacing internal `/api/*` routes used by web app — those stay JWT-authed
- Webhooks (separate future plan)
- GraphQL
- Bulk/batch endpoints (single-resource per request for MVP)
- Sparse fieldsets (`?fields=`) — removed; deferred until real demand

---

## Architecture — Unified with Plan 01

```
                ┌─────────────────────────────┐
                │  POST /api/mcp              │   ← JSON-RPC (Plan 01)
                └──────────────┬──────────────┘
                               │
                ┌──────────────┴──────────────┐
                │                             │
                ▼                             ▼
┌──────────────────────────────┐  ┌──────────────────────────────┐
│  mcp/server.js               │  │  external/router.js          │
│  (JSON-RPC envelope handling)│  │  (HTTP routes, path params)  │
└──────────────┬───────────────┘  └──────────────┬───────────────┘
               │                                  │
               └──────────────┬───────────────────┘
                              │  both call:
                              ▼
              ┌────────────────────────────────┐
              │ shared/dispatch.js             │
              │  - auth kind check             │
              │  - scope guard                 │
              │  - account allowlist           │
              │  - rate limit (per class)      │
              │  - audit log open/finalize     │
              │  - call operation handler      │
              └──────────────┬─────────────────┘
                             │
                             ▼
              ┌────────────────────────────────┐
              │ UserbotService (singleton)     │
              └────────────────────────────────┘
```

The REST router is essentially: HTTP method + path → operation name → `dispatchOperation({ source: 'rest', ... })`.

---

## File Layout (revised)

```
backend/
├── shared/                                 # SHARED with Plan 01
│   ├── dispatch.js                         # unified dispatcher
│   ├── operations.js                       # operation registry (source of truth)
│   ├── scope-guard.js
│   ├── rate-limiter.js                     # RateLimiter interface + InMemory impl
│   ├── audit-log.js
│   ├── content-sanitizer.js
│   ├── pagination.js
│   ├── errors.js                           # MCPError, HttpError (both transport)
│   ├── utils.js                            # hashArgs, mapMcpErrorToHttp, etc.
│   └── schemas/                            # NEW — zod schemas (input + output)
│       ├── common.js                       # Cursor, Error, Pagination meta
│       ├── userbot.js                      # Userbot, HealthSnapshot
│       ├── dialog.js                       # Dialog
│       ├── message.js                      # Message, SendMessageRequest
│       └── participant.js                  # Participant
├── external/                               # NEW — REST transport layer
│   ├── auth.js                             # authenticateApiToken middleware
│   ├── router.js                           # mounts /api/external/v1/*
│   ├── request-id.js                       # assigns req.id, res.locals.requestId
│   ├── envelope.js                         # envelopeSuccess, envelopeError
│   ├── openapi/
│   │   ├── generate.js                     # builds openapi.json from operations.js + zod schemas
│   │   ├── generated.json                  # COMMITTED to repo (built artifact)
│   │   └── scalar.js                        # mounts Scalar at /api/docs
│   └── routes/
│       ├── userbots.js
│       ├── dialogs.js
│       ├── messages.js
│       └── participants.js
├── mcp/                                    # Plan 01
│   └── ...
└── routes/
    ├── agent-mcp.routes.js                 # Plan 01
    └── external-docs.routes.js             # NEW — mounts /api/docs (Scalar)
```

---

## Auth Model — parallel to MCP

### Token purposes

```js
// integration-tokens.service.js
const PURPOSE_CONFIG = {
  mcp: { /* Plan 01 */ },
  api: {
    label: 'External REST API',
    defaultScopes: ['api:userbot:read'],   // read-only default
    tokenPrefix: 'brapi'
  },
  custom: { /* unchanged */ }
};

const ALLOWED_SCOPES = new Set([
  'mcp:use',  // deprecated
  'mcp:proxy:read', 'mcp:proxy:write',
  'mcp:userbot:read', 'mcp:userbot:write',
  'api:userbot:read', 'api:userbot:write',
  'api:proxy:read', 'api:proxy:write',
  'integrations:read', 'orders:read', 'shop:read', 'payments:read', 'cashdesk:read'
]);
```

### Auth middleware (`external/auth.js`)

```js
import { authenticateIntegrationToken } from '../services/integration-tokens.service.js';

export async function authenticateApiToken({ requiredScopes = [] }) {
  return async function middleware(req, res, next) {
    try {
      const result = await authenticateIntegrationToken(req.supabase, {
        authorizationHeader: req.headers.authorization,
        requiredScopes: ['api:use', ...requiredScopes],
        purpose: 'api',
        requestIp: req.ip || req.headers['x-forwarded-for'] || ''
      });
      req.auth = {
        kind: 'integration_token',
        user: { id: result.ownerId, is_integration_token: true },
        profile: await loadProfileForUser(req.supabase, { id: result.ownerId }),
        integrationToken: result.token   // full token record incl. metadata
      };
      req.user = req.auth.user;
      req.token = result.token;
      next();
    } catch (error) {
      next(new HttpError('UNAUTHORIZED', error.message, 401));
    }
  };
}
```

**Integration tokens only** — JWT path not exposed at `/api/external/*`.

---

## Resource Model & Endpoints

### Base URL

```
https://bullgram.xyz/api/external/v1
```

### Discovery & health

```
GET  /api/external/v1/health           → no-auth, returns { status: 'ok', version, time }
GET  /api/external/v1/openapi.json     → OpenAPI 3.0.3 spec
GET  /api/docs                        → Scalar interactive explorer (outside /v1)
```

### Common parameters

| Param | Type | Description |
|---|---|---|
| `limit` | integer | Page size. Default 50, max 200. |
| `cursor` | string | Opaque pagination cursor. **Do not parse or persist.** |

(Sparse fieldsets via `?fields=` removed in revision 2 — adds complexity, low demand.)

### Common response envelope

Success (200/201):

```json
{
  "data": { ... } | [ ... ],
  "cursor": "base64...",
  "has_more": true,
  "rate_limit": {
    "limit": 120,
    "remaining": 118,
    "reset_at": "2026-07-27T12:01:00Z",
    "class": "read"
  },
  "request_id": "req_abc123"
}
```

Error (4xx/5xx):

```json
{
  "error": {
    "code": "SAFE_MODE_BLOCKED",
    "message": "Account is in safe-mode and cannot be operated externally.",
    "details": { "userbot_id": "...", "runtime_status": "pending_activation" },
    "doc_url": "https://bullgram.xyz/docs/integrations/errors#safe-mode-blocked",
    "request_id": "req_abc123"
  }
}
```

### Endpoint reference

#### Discovery

```
GET  /health                          → { status, version, time }
GET  /openapi.json                    → OpenAPI 3.0.3 spec
```

#### Account

```
GET  /userbots
  → list of userbots accessible to this token

GET  /userbots/{userbot_id}
  → health snapshot (runtime_status, last_check, spambot signals)
```

#### Dialogs

```
GET  /userbots/{userbot_id}/dialogs
  ?type=channel|group|private|megagroup
  ?search=text
  → paginated list of chats the userbot is a member of
```

#### Messages

```
GET  /userbots/{userbot_id}/dialogs/{chat_id}/messages
  ?since=2026-07-01T00:00:00Z
  ?until=2026-07-31T23:59:59Z
  ?q=search+text              → triggers search path
  ?limit=50
  ?cursor=...
  → paginated messages

POST /userbots/{userbot_id}/dialogs/{chat_id}/messages
  Body: { "text": "...", "reply_to_message_id": "..." }
  Required scope: api:userbot:write
  → { "message_id": "...", "date": "..." }
```

#### Participants

```
GET  /userbots/{userbot_id}/dialogs/{chat_id}/participants
  ?limit=100
  ?cursor=...
  → paginated participants
```

(Revision 2 removed `?filter=bots|admins|recent` — GramJS does not server-side filter, would require fetching all members and filtering client-side. If admins-only is needed in future, add separate `GET .../admins` endpoint using GramJS `ChannelParticipantsAdmins` server-side filter.)

### Reserved for v2

```
POST /userbots/:id/dialogs/:chatId/messages/:messageId/react
POST /userbots/:id/dialogs/:chatId/messages/:messageId/edit
DELETE /userbots/:id/dialogs/:chatId/messages/:messageId
POST /userbots/:id/dialogs/:chatId/messages/:messageId/forward
POST /userbots/:id/dialogs/:chatId/messages/:messageId/pin
POST /userbots/:id/dialogs/:chatId/join
DELETE /userbots/:id/dialogs/:chatId
GET  /userbots/:id/contacts
POST /userbots/:id/contacts
GET  /userbots/:id/folders
GET  /userbots/:id/dialogs/:chatId/admins   (server-side filter via GramJS)
```

---

## OpenAPI Generation — zod schemas as source of truth

### Decision: zod, not JSDoc

**Why zod:**
- Type-safe at runtime (inputs validated before reaching handlers)
- Refactor-friendly (rename a field, TypeScript catches all references)
- Single source of truth: same zod schema drives input validation, OpenAPI output schema, and TypeScript types
- Bullgram already uses shadcn/ui ecosystem which pairs with zod

**Why NOT JSDoc (revision 1 choice):**
- Fragile (typos in annotations not caught until build)
- Cannot validate runtime data
- Hard to refactor
- Two sources of truth (TypeScript types + JSDoc strings)

### Operation registry — extends Plan 01

```js
// shared/operations.js
import { z } from 'zod';
import { fetchMessagesHandler } from './mcp/tools/messages/fetch-messages.js';  // shared handler

const FetchMessagesInput = z.object({
  userbot_id: z.string().uuid(),
  chat_id: z.string(),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(200).default(50),
  cursor: z.string().optional()
});

const FetchMessagesOutput = z.object({
  messages: z.array(MessageSchema),
  cursor: z.string().nullable(),
  has_more: z.boolean()
});

export const OPERATIONS = {
  bullrun_userbot_messages: {
    handler: fetchMessagesHandler,
    inputSchema: FetchMessagesInput,
    outputSchema: FetchMessagesOutput,
    requiredScopes: ['mcp:userbot:read', 'api:userbot:read'],
    requiresIntegrationToken: true,
    rateLimitClass: 'read',
    description: 'Fetch messages from a chat with optional time-window filter.',
    transports: {
      mcp: { toolName: 'bullrun_userbot_messages' },
      rest: { method: 'GET', path: '/userbots/{userbot_id}/dialogs/{chat_id}/messages' }
    }
  }
  // ... etc
};
```

### OpenAPI generator

```js
// external/openapi/generate.js
import { zodToJsonSchema } from '@r贸易/zod-to-json-schema';  // or similar
import { OPERATIONS } from '../../shared/operations.js';
import { COMMON_SCHEMAS } from '../../shared/schemas/common.js';

export function buildOpenApiSpec() {
  const paths = {};
  const components = { schemas: collectComponentSchemas() };

  for (const [name, op] of Object.entries(OPERATIONS)) {
    if (!op.transports.rest) continue;

    const { method, path } = op.transports.rest;
    paths[path] = paths[path] || {};
    paths[path][method.toLowerCase()] = {
      summary: op.description,
      operationId: name,
      tags: classifyByPath(path),
      security: [{ bearerAuth: [] }],
      parameters: extractParameters(op.inputSchema, path),
      requestBody: method === 'POST' ? extractRequestBody(op.inputSchema) : undefined,
      responses: {
        200: { description: 'Success', content: { 'application/json': { schema: zodToJsonSchema(op.outputSchema) } } },
        400: { $ref: '#/components/responses/InvalidRequest' },
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
        423: { $ref: '#/components/responses/SafeModeBlocked' },
        429: { $ref: '#/components/responses/RateLimited' },
        502: { $ref: '#/components/responses/TelegramError' }
      }
    };
  }

  return {
    openapi: '3.0.3',
    info: { title: 'Bullgram External API', version: '1.0.0', description: '...' },
    servers: [{ url: 'https://bullgram.xyz/api/external/v1' }],
    components: {
      ...components,
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'brapi_...' } },
      responses: COMMON_RESPONSES
    },
    paths
  };
}
```

### Why OpenAPI 3.0.3 (not 3.1)

- 3.1 has stricter JSON Schema that breaks some older generators
- All current SDK generators (`openapi-generator`, `swagger-codegen`) fully support 3.0.3
- 3.1's main benefit (full JSON Schema compliance) doesn't matter for our use case
- Migrate to 3.1 in v2 once ecosystem catches up

### Build pipeline

```json
// package.json (root)
{
  "scripts": {
    "build:openapi": "node scripts/build-openapi.js",
    "validate:openapi": "node scripts/validate-openapi.js"
  }
}
```

`scripts/build-openapi.js`:
```js
import { writeFileSync } from 'node:fs';
import { buildOpenApiSpec } from '../backend/external/openapi/generate.js';

const spec = buildOpenApiSpec();
writeFileSync('backend/external/openapi/generated.json', JSON.stringify(spec, null, 2));
console.log('OpenAPI spec written.');
```

`scripts/validate-openapi.js`:
```js
import { readFileSync } from 'node:fs';
import SwaggerParser from '@apidevtools/swagger-parser';

const spec = JSON.parse(readFileSync('backend/external/openapi/generated.json'));
await SwaggerParser.validate(spec);
console.log('OpenAPI spec is valid.');
```

CI fails if `generated.json` is out of sync with source.

### Scalar integration

Use `@scalar/express-api-reference` (verified package: v0.10.11, MIT license).

```js
// routes/external-docs.routes.js
import express from 'express';
import { apiReference } from '@scalar/express-api-reference';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const specPath = path.resolve(__dirname, '../external/openapi/generated.json');
const openapiSpec = JSON.parse(readFileSync(specPath, 'utf-8'));

export default function externalDocsRoutes() {
  const router = express.Router();

  router.use('/api/docs', apiReference({
    spec: { content: openapiSpec },
    theme: 'purple',
    title: 'Bullgram API',
    favicon: '/favicon.ico',
    metaData: { title: 'Bullgram API Reference' },
    hideDarkModeSwitch: false
  }));

  return router;
}
```

Mount in `server.js`:
```js
app.use(externalDocsRoutes());
```

---

## Request ID Middleware

Every request gets a unique ID for correlation with audit log:

```js
// external/request-id.js
import crypto from 'node:crypto';

export function requestIdMiddleware() {
  return function middleware(req, res, next) {
    const incomingId = req.headers['x-request-id'];
    const generatedId = incomingId || `req_${crypto.randomUUID()}`;
    req.id = generatedId;
    res.locals.requestId = generatedId;
    res.setHeader('X-Request-ID', generatedId);
    next();
  };
}
```

Applied to `/api/external/*` and `/api/mcp`.

---

## Envelope Helpers (defined)

```js
// external/envelope.js
export function envelopeSuccess(data, { cursor, has_more, rateLimitInfo, requestId }) {
  return {
    data,
    ...(cursor !== undefined ? { cursor, has_more: has_more ?? Boolean(cursor) } : {}),
    rate_limit: rateLimitInfo,
    request_id: requestId
  };
}

export function envelopeError(error, requestId) {
  return {
    error: {
      code: error.code || 'INTERNAL',
      message: error.message || 'Internal error',
      ...(error.details ? { details: error.details } : {}),
      doc_url: error.docUrl || docUrlFor(error.code),
      request_id: requestId
    }
  };
}

function docUrlFor(code) {
  const slug = (code || '').toLowerCase().replace(/_/g, '-');
  return `https://bullgram.xyz/docs/integrations/errors#${slug}`;
}
```

---

## Router Structure

```js
// external/router.js
import express from 'express';
import { authenticateApiToken } from './auth.js';
import { requestIdMiddleware } from './request-id.js';
import { dispatchOperation } from '../shared/dispatch.js';
import { envelopeSuccess, envelopeError } from './envelope.js';
import { OPERATIONS } from '../shared/operations.js';
import { HttpError } from '../shared/errors.js';

function findOperationByRoute(method, path) {
  // Path comes from Express route match — already parametrized
  for (const [name, op] of Object.entries(OPERATIONS)) {
    if (!op.transports.rest) continue;
    if (op.transports.rest.method === method && op.transports.rest.path === path) {
      return { name, operation: op };
    }
  }
  return null;
}

function buildArgsFromRequest(req, operation) {
  const inputSchema = operation.inputSchema;
  const raw = {
    ...req.params,
    ...req.query,
    ...(req.body || {})
  };
  // zod parse — throws ZodError on invalid
  return inputSchema.parse(raw);
}

export function externalRouter(supabase, userbotService) {
  const router = express.Router();

  // Health (no auth)
  router.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      version: process.env.npm_package_version || 'unknown',
      time: new Date().toISOString()
    });
  });

  // Authenticated routes — apply requestId + auth middleware
  router.use(requestIdMiddleware());

  // Define routes via OPERATIONS registry
  for (const [name, op] of Object.entries(OPERATIONS)) {
    if (!op.transports.rest) continue;
    const { method, path } = op.transports.rest;
    const requiredScopes = op.requiredScopes.filter((s) => s.startsWith('api:'));

    router[method.toLowerCase()](path, authenticateApiToken({ requiredScopes }), async (req, res) => {
      const requestId = res.locals.requestId;
      let args;
      try {
        args = buildArgsFromRequest(req, op);
      } catch (error) {
        // ZodError → 400
        return res.status(400).json(envelopeError(
          new HttpError('INVALID_REQUEST', formatZodError(error), 400),
          requestId
        ));
      }

      try {
        const result = await dispatchOperation({
          supabase, req, operationName: name, args, userbotService, source: 'rest'
        });
        res.json(envelopeSuccess(result, {
          cursor: result.cursor,
          has_more: result.has_more,
          rateLimitInfo: res.locals.rateLimitInfo,
          requestId
        }));
      } catch (error) {
        const httpErr = error instanceof HttpError ? error : new HttpError('INTERNAL', error.message, 500);
        res.status(httpErr.status).json(envelopeError(httpErr, requestId));
      }
    });
  }

  return router;
}
```

Mount in `server.js`:
```js
import externalRouter from './external/router.js';
app.use('/api/external/v1', externalRouter(supabase, userbotService));
```

---

## Audit Log — Closure Capture Fix

Revision 1 had a bug: `res.locals.auditId` referenced in error path was never set. In revision 2, `auditId` is captured as a closure variable inside `dispatchOperation`:

```js
// shared/dispatch.js (excerpt)
export async function dispatchOperation({ supabase, req, operationName, args, userbotService, source }) {
  // ... auth/scope/rate checks ...

  let auditId = null;
  const startedAt = Date.now();

  try {
    auditId = await writeAuditLogEntry(supabase, { /* ... */ });

    const result = await operation.handler({ supabase, req, args, userbotService });

    await finalizeAuditLogEntry(supabase, auditId, {
      status: 'success',
      latency_ms: Date.now() - startedAt
    });

    return result;
  } catch (error) {
    if (auditId) {
      await finalizeAuditLogEntry(supabase, auditId, {
        status: mapErrorToAuditStatus(error),
        latency_ms: Date.now() - startedAt,
        error_code: error.code || null,
        error_message: error.message || null,
        telegram_error_event_id: error.telegram_error_event_id || null
      });
    } else {
      // Audit write itself failed before the operation ran — log standalone error
      console.error('[dispatch] Audit open failed; cannot finalize', error);
    }
    throw error;
  }
}
```

`auditId` lives in the function scope — accessible in both try and catch. No `res.locals` indirection.

---

## Error Contract

Same canonical error codes as MCP (single source in `shared/errors.js`), mapped to HTTP status:

| HTTP | Code | Meaning |
|---|---|---|
| 400 | INVALID_REQUEST | Schema validation failed (zod parse error) |
| 401 | UNAUTHORIZED | Missing/invalid token |
| 401 | INTEGRATION_TOKEN_REQUIRED | JWT used where integration token required |
| 403 | INSUFFICIENT_SCOPE | Token missing required scope |
| 403 | FORBIDDEN_ACCOUNT | userbot_id not in allowlist |
| 403 | DM_DISABLED | Send to DM attempted while USERBOT_DM_ENABLED=false |
| 404 | NOT_FOUND | Resource doesn't exist |
| 405 | METHOD_NOT_ALLOWED | Wrong HTTP verb |
| 409 | CONFLICT | State conflict |
| 422 | UNPROCESSABLE_ENTITY | Semantic validation failed |
| 423 | SAFE_MODE_BLOCKED | userbot is pending_activation |
| 410 | ACCOUNT_RESTRICTED | userbot restricted by SpamBot |
| 429 | RATE_LIMITED | Token bucket empty |
| 500 | INTERNAL | Unhandled server error |
| 502 | TELEGRAM_ERROR | Telegram-side failure (includes `telegram_error_event_id`, `retry_after_sec`) |
| 503 | SERVICE_UNAVAILABLE | Maintenance mode |

Every error response includes `error.code` (canonical, transport-agnostic — same string as MCP), `error.message`, optional `error.details`, `error.doc_url`, `error.request_id`.

---

## Pagination

Cursor-based, opaque base64 string.

```json
{
  "data": [...],
  "cursor": "eyJhZnRlciI6ICIxMjM0NTY3In0=",
  "has_more": true
}
```

Cursor encodes (for our internal use, **not** part of public contract):
- `after` — last seen ID (message_id for messages, dialog_id for dialogs, user_id for participants)

Clients treat cursor as opaque. If we change format, old cursors return clean `400 INVALID_CURSOR` with `doc_url` pointing to migration notes.

---

## Rate Limit Headers

Every response includes:

```
X-RateLimit-Limit:     120
X-RateLimit-Remaining: 118
X-RateLimit-Reset:     1754123400
X-RateLimit-Class:     read
```

On 429:

```
Retry-After: 12
```

Implementation: middleware sets `res.locals.rateLimitInfo` after `dispatchOperation` runs (dispatcher populates from `rateLimiter.lastConsumed`).

---

## Versioning Strategy

- URL-based: `/api/external/v1/...`, `/api/external/v2/...`
- v1 backward-compatible indefinitely (additive changes only: new fields, new endpoints)
- Breaking changes require v2 (separate OpenAPI spec, separate route file)
- Old versions kept alive 12 months after v(N+1) ships
- `Deprecation` header (RFC 7234) on responses when client uses deprecated path
- `Sunset` header when version is being decommissioned

---

## SDK Generation — deferred to post-MVP

Revision 1 had inconsistency: Plan 03 referenced TS/Python SDK guides, but Plan 02 marked SDK as post-MVP. Resolution:

- **v1 ships:** OpenAPI 3.0.3 spec at `/openapi.json` + Scalar explorer
- **Post-MVP (within 60 days of v1 stable):** Generate SDKs:
  - TypeScript: `@bullgram/api-client` on npm
  - Python: `bullgram-api` on PyPI
  - Go: `github.com/webzwezda/bullgram-go`
- **Plan 03 guides:** `typescript-client.md` and `python-client.md` exist but are marked "Coming after v1 stable". They show raw OpenAPI-generator-cli commands so early adopters can self-generate now.

---

## Implementation Phases (revised)

### Phase 1 — Foundation (1 day) — depends on Plan 01 Phase 1

1. Create `backend/external/` directory
2. Write `errors.js` extensions (HttpError class)
3. Write `auth.js` (authenticateApiToken middleware)
4. Write `request-id.js` middleware
5. Write `envelope.js` (envelopeSuccess, envelopeError)
6. Write `router.js` skeleton
7. Mount in `server.js`
8. Test stub: `GET /health`

### Phase 2 — Zod schemas & OpenAPI pipeline (1.5 days)

1. Install deps: `zod`, `@apidevtools/swagger-parser`, `@scalar/express-api-reference`, `zod-to-json-schema`
2. Define schemas in `shared/schemas/` (userbot, dialog, message, participant, common)
3. Extend `shared/operations.js` to include `inputSchema` / `outputSchema` (zod)
4. Write `scripts/build-openapi.js` and `scripts/validate-openapi.js`
5. Write `external/openapi/scalar.js` to mount Scalar at `/api/docs`
6. Commit `generated.json` to repo
7. CI gates: build + validate + drift check

### Phase 3 — All handlers (1.5 days) — depends on Plan 01 Phase 4

1. Implement 7 REST route handlers as thin wrappers calling `dispatchOperation`
2. Each handler is auto-wired from `OPERATIONS` registry — no manual route definitions
3. Verify each via Scalar try-out
4. Test pagination round-trip

### Phase 4 — Hardening (1 day)

1. Integration tests with real test userbot
2. Test all 4xx error paths
3. Test rate limit (burst 125 requests in 60s, verify 429 on 121st)
4. Test scope enforcement (read-only token trying POST → 403)
5. Test account allowlist enforcement
6. Test request_id propagation (every response has X-Request-ID)
7. Test OpenAPI validator catches drift

### Phase 5 — Documentation sync (0.5 day) — pairs with Plan 03

1. `docs/integrations/transports/rest.md` (conventions, pagination, errors)
2. Operations pages reference both transports (Plan 03)
3. Public-facing page on site-v2: `/docs` (Plan 03)

**Total: ~5.5 days.** Run in parallel with Plan 01 Phases 4-5.

---

## Server Integration

In `backend/server.js`:

```js
// existing imports
import externalRouter from './external/router.js';
import externalDocsRoutes from './routes/external-docs.routes.js';

// mounts
app.use('/api/external/v1', externalRouter(supabase, userbotService));
app.use(externalDocsRoutes());
```

Two new lines. Existing routes unchanged.

---

## Testing Plan

### curl

```bash
# Health (no auth)
curl https://bullgram.xyz/api/external/v1/health

# List userbots
curl -H "Authorization: Bearer brapi_..." \
  https://bullgram.xyz/api/external/v1/userbots

# Fetch messages
curl -H "Authorization: Bearer brapi_..." \
  "https://bullgram.xyz/api/external/v1/userbots/UUID/dialogs/-100123/messages?limit=10"

# Send message (write scope)
curl -X POST -H "Authorization: Bearer brapi_..." \
  -H "Content-Type: application/json" \
  -d '{"text":"Hello"}' \
  https://bullgram.xyz/api/external/v1/userbots/UUID/dialogs/-100123/messages
```

### Automated

- Handler unit tests (mock UserbotService)
- Dispatcher integration tests (real auth, real supabase, mocked Telegram)
- Zod schema tests (parse valid + reject invalid)
- OpenAPI validation tests (`swagger-parser` validates generated spec)
- Backward-compat smoke: existing tokens still work after deploy

---

## Rollout Strategy

1. Deploy Phase 1-2 — foundation + Scalar explorer
2. Test interactively at `/api/docs` (internal only)
3. Phase 3 — ship endpoints behind feature flag `EXTERNAL_API_ENABLED=false`
4. Issue test token, exercise all endpoints from local n8n
5. Flip flag for self-usage 1 week
6. Update `/app/integrations` UI (Plan 03 Phase 8)
7. Announce + publish docs
8. After 30 days stable: begin SDK generation

---

## Risks & Mitigations (updated)

| Risk | Mitigation |
|---|---|
| OpenAPI spec drifts from implementation | Single source: zod schemas → OpenAPI; CI validates drift |
| Telegram throttles server IP | Per-userbot hard cap from Plan 01 (60 read / 10 write per min) |
| Token leaked via n8n logs | Document n8n Predefined Credential Type; `allowed_userbot_ids` reduces blast |
| Backward-incompatible schema change slips through | CI step: diff `generated.json`; PR review for any breaking change |
| Scalar licensing changes | Spec is portable OpenAPI 3.0.3; swap renderer without losing docs |
| Clients depend on cursor format | Document as opaque; old cursors return `400 INVALID_CURSOR` with doc_url |
| Multi-instance scaling breaks rate limiter | Plan 01's abstract `RateLimiter` interface — swap to Redis impl |
| zod-to-json-schema produces invalid OpenAPI | CI `validate:openapi` step catches with `swagger-parser` |
| Operation registry becomes single point of failure | Unit tests for registry; type-safe via zod; refactor with confidence |
| n8n users need SDK | OpenAPI spec enables `openapi-generator-cli`; official SDKs within 60 days of v1 stable |
