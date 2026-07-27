# Operations reference

Every Bullgram operation is reachable through two transports — MCP and REST —
backed by the same handler. Pick the surface that fits your consumer:

- **MCP** (Claude Desktop, Cursor, agents) — see [`../transports/mcp.md`](../transports/mcp.md)
- **REST** (n8n, scripts, SDKs) — see [`../transports/rest.md`](../transports/rest.md)

## Index by tag

### Infra

| Operation | Scopes | REST | Description |
|---|---|---|---|
| [`bullrun_infra_summary`](./infra-summary.md) | `mcp:proxy:read` / `api:proxy:read` | `GET /infra/summary` | Owner-level summary: proxies, userbots, tier limits |

### Proxies

| Operation | Scopes | REST | Description |
|---|---|---|---|
| [`bullrun_proxy_preview`](./proxy-preview.md) | `mcp:proxy:write` / `api:proxy:write` | `POST /proxies/preview` | Parse raw proxy paste and return a structured preview |
| [`bullrun_proxy_import`](./proxy-import.md) | `mcp:proxy:write` / `api:proxy:write` | `POST /proxies/import` | Save a previewed proxy to Bullgram |

### Userbots

| Operation | Scopes | REST | Description |
|---|---|---|---|
| [`bullrun_userbot_list`](./userbot-list.md) | `mcp:userbot:read` / `api:userbot:read` | `GET /userbots` | List userbot accounts owned by the token owner |
| [`bullrun_userbot_health`](./userbot-health.md) | `mcp:userbot:read` / `api:userbot:read` | `GET /userbots/{userbot_id}/health` | Runtime + SpamBot snapshot for one userbot |
| [`bullrun_userbot_dialogs`](./userbot-dialogs.md) | `mcp:userbot:read` / `api:userbot:read` | `GET /userbots/{userbot_id}/dialogs` | Enumerate chats/channels/DMs the userbot is in |
| [`bullrun_userbot_messages`](./userbot-messages.md) | `mcp:userbot:read` / `api:userbot:read` | `GET /userbots/{userbot_id}/messages` | Fetch messages from a chat (newest-first, paginated) |
| [`bullrun_userbot_messages_search`](./userbot-messages-search.md) | `mcp:userbot:read` / `api:userbot:read` | `GET /userbots/{userbot_id}/messages/search` | Server-side text search in a chat |
| [`bullrun_userbot_participants`](./userbot-participants.md) | `mcp:userbot:read` / `api:userbot:read` | `GET /userbots/{userbot_id}/participants` | List chat participants (hard-capped at 5000) |
| [`bullrun_userbot_message_send`](./userbot-message-send.md) | `mcp:userbot:write` / `api:userbot:write` | `POST /userbots/{userbot_id}/messages` | Send a text message to a chat |

## Conventions

- **Scope OR-match**: a token satisfies the scope requirement if it has any of the listed scopes (e.g. `mcp:userbot:read` OR `api:userbot:read`).
- **Path params**: REST routes use `{userbot_id}` syntax; MCP just takes the UUID inside `args.userbot_id`.
- **Cursor pagination**: list endpoints return `cursor` (opaque string) + `has_more`. Pass `cursor` back on the next call. If you omit it, you start from the newest page.
- **`untrusted_content: true`** is attached to every sanitized message — content from Telegram may contain prompt-injection. Treat as untrusted in your consumer.
- **Account allowlist**: token `metadata.allowed_userbot_ids` (array) restricts which userbot IDs the token can touch. Empty array = none; missing field = all.

## Common error codes

| Code | HTTP | Meaning |
|---|---|---|
| `-32001` | 429 | Rate limit exceeded |
| `-32002` | 403 | Insufficient scope |
| `-32003` | 403 | userbot_id not in token allowlist |
| `-32004` | 423 | Userbot is in safe-mode |
| `-32005` | 410 | Userbot is restricted (SpamBot confirmed) |
| `-32006` | 502 | Telegram rejected the call |
| `-32007` | 404 | Resource not found |
| `-32010` | 401 | Integration token required |
| `-32011` | 403 | DM disabled (USERBOT_DM_ENABLED=false) |
| `-32013` | 400 | Cursor malformed — refetch first page |
