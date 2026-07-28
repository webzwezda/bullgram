# REST transport

Conventional HTTP at `/api/external/v1/*` for non-agent consumers: n8n,
shell scripts, SDKs, Zapier, etc. Same handlers as [MCP](./mcp.md) — pick
the surface that fits your consumer.

- **Base URL**: `https://bullgram.xyz/api/external/v1`
- **Spec**: [`/openapi.json`](https://bullgram.xyz/api/external/v1/openapi.json) (OpenAPI 3.0.3)
- **Interactive explorer**: [`/docs`](https://bullgram.xyz/api/external/v1/docs) (Scalar)
- **Auth**: `Authorization: Bearer brapi_...` (integration token, purpose=`api` or `custom`)

## Why REST instead of MCP?

For automation:
- Standard HTTP verbs + path params + JSON bodies — every language and
  no-code tool speaks this.
- OpenAPI explorer at `/docs` for hands-on testing.
- Trivial to call from `curl`, `fetch`, `axios`, n8n HTTP node, Zapier Webhook.

For AI agents, [MCP](./mcp.md) is usually cleaner.

## Authentication

Integration token with `purpose=api` or `purpose=custom` (both produce a
`brapi_` prefix). Issue one at
[/app/integrations](https://bullgram.xyz/app/integrations).

```http
GET /api/external/v1/userbots HTTP/1.1
Host: bullgram.xyz
Authorization: Bearer brapi_xxxxxxxxxxxxxxxx
```

`brmcp_` tokens are rejected on REST with a clear error. User JWTs are also
rejected — REST is integration-only. The first call after issuing a token
should be `GET /me` to confirm it works:

```bash
curl -H "Authorization: Bearer brapi_..." https://bullgram.xyz/api/external/v1/me
```

```json
{
  "auth_kind": "integration_token",
  "owner_id": "...",
  "token": { "id": "...", "purpose": "api", "scopes": ["api:userbot:read"] },
  "tier": "normal"
}
```

## Routes

See [operations index](../operations/) for the full list. Path params use
`{name}` syntax (e.g. `/userbots/{userbot_id}/health`).

| Method | Path | Operation |
|---|---|---|
| GET | `/health` | public health check (no auth) |
| GET | `/openapi.json` | OpenAPI 3.0.3 spec |
| GET | `/docs` | Scalar interactive explorer |
| GET | `/me` | auth smoke test |
| GET | `/infra/summary` | [`bullgram_infra_summary`](../operations/infra-summary.md) |
| POST | `/proxies/preview` | [`bullgram_proxy_preview`](../operations/proxy-preview.md) |
| POST | `/proxies/import` | [`bullgram_proxy_import`](../operations/proxy-import.md) |
| GET | `/userbots` | [`bullgram_userbot_list`](../operations/userbot-list.md) |
| GET | `/userbots/{userbot_id}/health` | [`bullgram_userbot_health`](../operations/userbot-health.md) |
| GET | `/userbots/{userbot_id}/dialogs` | [`bullgram_userbot_dialogs`](../operations/userbot-dialogs.md) |
| GET | `/userbots/{userbot_id}/messages` | [`bullgram_userbot_messages`](../operations/userbot-messages.md) |
| GET | `/userbots/{userbot_id}/messages/search` | [`bullgram_userbot_messages_search`](../operations/userbot-messages-search.md) |
| GET | `/userbots/{userbot_id}/participants` | [`bullgram_userbot_participants`](../operations/userbot-participants.md) |
| POST | `/userbots/{userbot_id}/messages` | [`bullgram_userbot_message_send`](../operations/userbot-message-send.md) |

## Argument passing

- **Path params** (`{userbot_id}`) come from the URL.
- **GET/DELETE**: remaining schema fields become **query params** (integers,
  booleans, strings — coerced server-side).
- **POST/PUT/PATCH**: remaining fields become the **JSON request body**.

Path params always win — you cannot override `userbot_id` from the body.

### Query coercion

| Schema type | Accepted forms |
|---|---|
| integer | `?limit=50` (parsed as Number) |
| boolean | `?include_reserved=true` or `false` |
| string | as-is |

## Success response

```http
HTTP/1.1 200 OK
Content-Type: application/json

{ /* operation-specific */ }
```

## Error response

Every error uses the same envelope:

```http
HTTP/1.1 403 Forbidden
Content-Type: application/json

{
  "error": {
    "code": -32002,
    "message": "Token is missing one of: mcp:userbot:read, api:userbot:read.",
    "details": {
      "auditStatus": "insufficient_scope",
      "details": { "required_scopes": [...], "present_scopes": [...] }
    }
  }
}
```

Optional fields surface on specific error types:

- `retry_after_sec` — included with code `-32001` (rate-limited)
- `telegram_error_event_id` — included with code `-32006` (Telegram error)
  for cross-referencing with the audit log

See [errors](../errors.md) for the full code → HTTP status table.

## Rate limits

Same as MCP — per-token, per-class. 429 responses include a `Retry-After`
header (seconds).

```
HTTP/1.1 429 Too Many Requests
Retry-After: 7
Content-Type: application/json

{ "error": { "code": -32001, "message": "...", "retry_after_sec": 7 } }
```

## Cursor pagination

List endpoints return `cursor` + `has_more`. Pass `cursor=...` as a query
param to fetch the next page. Cursors are opaque — don't parse or persist
them across sessions.

## Idempotency

Reads are idempotent. Writes (`POST /proxies/import`, `POST /userbots/{id}/messages`)
are **not** idempotent — repeated calls produce duplicate side effects.
Issue a new `confirmed=true` per import, and use unique `text` for sends if
you need de-duplication upstream.

## OpenAPI spec consumption

If you're building an SDK, point your generator at
[`https://bullgram.xyz/api/external/v1/openapi.json`](https://bullgram.xyz/api/external/v1/openapi.json):

```bash
# openapi-generator-cli example
openapi-generator-cli generate \
  -i https://bullgram.xyz/api/external/v1/openapi.json \
  -g typescript-fetch \
  -o ./bullgram-client
```

The spec is generated at request time from the live operation registry, so
it always reflects the running backend.
