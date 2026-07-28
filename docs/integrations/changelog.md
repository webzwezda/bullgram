# Changelog

Tracks notable changes to the Bullgram Integrations surface — MCP +
REST API. Within `v1`, the contract is **additive only**: fields are
added, never removed without a deprecation window.

Format: `## YYYY-MM-DD — short title`, then bullet points.

## 2026-07-28 — MCP/API tokens default to full per-domain scopes

`purpose=mcp` and `purpose=api` tokens now ship with all per-domain
read+write scopes by default. Previously they carried only the legacy
`mcp:use` / `api:use` umbrellas, which left `tools/list` empty and
made every `tools/call` fail with `insufficient_scope` — the token
looked valid but couldn't do anything. Use `purpose=custom` for
narrower scope sets.

## 2026-07-27 — v1 initial public release

The integration surface ships with:

- **2 transports** — MCP (`POST /api/mcp`, JSON-RPC 2.0 over HTTP) and
  REST (`/api/external/v1/*`, OpenAPI 3.0.3).
- **10 operations** across 2 domains:
  - `proxy`: `infra_summary`, `proxy_preview`, `proxy_import`
  - `userbot`: `userbot_list`, `userbot_health`, `userbot_dialogs`,
    `userbot_messages`, `userbot_messages_search`,
    `userbot_participants`, `userbot_message_send`
- **Token system** — `brmcp_*` (MCP) and `brapi_*` (REST/custom) tokens
  with per-domain read/write scopes, optional account allowlist, and
  per-token rate-limit override.
- **Audit log** — every call lands in `mcp_tool_log` with operation,
  source, status, latency, IP, user-agent, request-id.
- **Safety** — content sanitizer flags every Telegram message with
  `untrusted_content: true`. Safe-mode and restricted accounts are
  blocked from operations automatically.
- **6 CI gates** — backend tests, docs integrity, secrets scan,
  OpenAPI validation, MCP smoke, REST smoke. See [contributing](./contributing.md).
- **Documentation** — 28 markdown pages covering operations, transports,
  auth, scopes, rate limits, errors, safety, plus 5 guides.

### Operational notes

- The legacy `agent_mcp_tokens` table was removed on 2026-07-28. All
  access now goes through the modern integration token system
  (`integration_tokens` table with `brmcp_`/`brapi_` prefixes). Issue
  and rotate tokens at `/app/integrations`.
- The `mcp_tool_log_status_check` constraint includes `started` so the
  initial audit insert (before the handler runs) doesn't fail.
- Rate limiter is in-memory (Map-based). Backend runs as PM2
  `instances: 1`, so this is safe — multi-instance deploy would require
  migrating to Redis.

## Older product-level changes

For changes to subscriptions, shop, billing, and the rest of the
Bullgram product (outside the integration surface), see product release
notes. This changelog covers only the MCP + REST API surface.
