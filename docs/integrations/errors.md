# Errors

Bullgram uses canonical JSON-RPC 2.0 error codes (`-32xxx` range) across
both transports. The same code means the same thing whether you're calling
MCP or REST.

## Canonical codes

| Code | Constant | Meaning | HTTP |
|---|---|---|---|
| `-32700` | `PARSE_ERROR` | JSON body unparseable | 400 |
| `-32600` | `INVALID_REQUEST` | JSON-RPC envelope malformed | 400 |
| `-32601` | `METHOD_NOT_FOUND` | Unknown operation name | 404 |
| `-32602` | `INVALID_PARAMS` | Argument missing or invalid (e.g. bad UUID) | 422 |
| `-32603` | `INTERNAL` | Unexpected server error | 500 |
| `-32001` | `RATE_LIMITED` | Token bucket exhausted | 429 |
| `-32002` | `INSUFFICIENT_SCOPE` | Token lacks required scope | 403 |
| `-32003` | `FORBIDDEN_ACCOUNT` | userbot_id not in token's allowlist | 403 |
| `-32004` | `SAFE_MODE_BLOCKED` | Userbot in safe-mode (`pending_activation`) | 423 |
| `-32005` | `ACCOUNT_RESTRICTED` | Userbot restricted by SpamBot | 410 |
| `-32006` | `TELEGRAM_ERROR` | Telegram rejected the call | 502 |
| `-32007` | `NOT_FOUND` | Resource not found (or not owned) | 404 |
| `-32008` | `CONFLICT` | State conflict (e.g. duplicate) | 409 |
| `-32009` | `QUOTA_EXCEEDED` | Tier quota exhausted (e.g. proxy limit) | 429 |
| `-32010` | `INTEGRATION_TOKEN_REQUIRED` | Missing/invalid bearer token | 401 |
| `-32011` | `DM_DISABLED` | `USERBOT_DM_ENABLED=false` on backend | 403 |
| `-32012` | `TOOL_DISABLED` | Feature flag disabled this tool | 503 |
| `-32013` | `INVALID_CURSOR` | Pagination cursor malformed | 400 |

## Envelope shape

### REST

```json
{
  "error": {
    "code": -32002,
    "message": "Token is missing one of: mcp:userbot:read, api:userbot:read.",
    "details": { /* optional, operation-specific */ },
    "retry_after_sec": 7,           // optional — only on RATE_LIMITED
    "telegram_error_event_id": "..." // optional — only on TELEGRAM_ERROR
  }
}
```

### MCP (JSON-RPC)

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32002,
    "message": "...",
    "data": { /* same fields as REST, nested under data */ }
  }
}
```

## Recovery strategies

### `RATE_LIMITED` (-32001)

Wait `retry_after_sec` seconds, then retry the same request. Don't back off
exponentially — the bucket refills linearly, so retying too soon will fail
again. For sustained throughput, reduce your polling frequency.

### `INVALID_CURSOR` (-32013)

Drop the cursor and refetch the first page. Cursors are opaque strings
that may change format between releases; never persist them across runs.

### `TELEGRAM_ERROR` (-32006)

Cross-reference `telegram_error_event_id` in the audit log to see the raw
MTProto error. Common causes:
- `FLOOD_WAIT_N` — wait N seconds before retrying
- `USER_BANNED_IN_CHANNEL` — userbot was banned; surface to admin
- `PEER_FLOOD` — Telegram thinks the userbot is spamming; stop and reassess

### `SAFE_MODE_BLOCKED` (-32004)

The userbot is in `pending_activation` status — recently imported, not yet
manually activated by an admin. This is the safe-mode gate. Activate the
userbot at `/app/userbots` to clear this state.

### `ACCOUNT_RESTRICTED` (-32005)

`@SpamBot` confirmed a restriction on the userbot. The account is in
quarantine (`restricted` runtime status) and will be auto-deleted after
`RESTRICTED_USERBOT_DELETE_AFTER_HOURS` (default 72h). Don't retry — surface
to admin.

### `INTEGRATION_TOKEN_REQUIRED` (-32010)

For REST: missing `Authorization: Bearer` header, malformed token, or the
token doesn't exist in Bullgram's database. Issue a new token at
`/app/integrations`.

If you see this mid-session on a previously-working token, the token was
revoked — check with your admin.

### `INSUFFICIENT_SCOPE` (-32002)

The token's scopes don't include any of the required scopes for the
operation. Either:
- Reissue the token with broader scopes
- Switch to a different operation your token can call

The error message lists `required_scopes` and `present_scopes` — diff them.

## Idempotency on retry

Reads are safe to retry. Writes (`proxy_import`, `message_send`) are **not**
idempotent — if you got a 5xx mid-write, the side effect may have landed.
Don't blindly retry; check the result first (e.g. fetch messages to see if
the send landed).

## Production alerting

Treat these as actionable:
- Sustained `RATE_LIMITED` from the same token over hours — investigate the
  upstream automation
- Any `ACCOUNT_RESTRICTED` — admin should review whether the userbot's
  behavior needs adjustment
- Spike in `TELEGRAM_ERROR` with `FLOOD_WAIT` — back off globally, not just
  per-call
