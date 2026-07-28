# `bullgram_userbot_health`

> Tag: **userbots** · Class: **read** · REST: `GET /userbots/{userbot_id}/health`

Reads the userbot's runtime status, recent Telegram error events, and cached
SpamBot signal. **Does not connect to Telegram** — pure DB/cache lookup, so
it's safe to poll every few seconds.

Use this as the cheapest way to decide whether a userbot is healthy enough
to attempt a Telegram-touching operation.

## Scopes

`mcp:userbot:read` OR `api:userbot:read`

## Arguments

| Field | Type | Required | Description |
|---|---|---|---|
| `userbot_id` | uuid | yes | Path param in REST; field in MCP `args` |

## Result

```json
{
  "status": "active",
  "runtime_status": "online",
  "last_seen_at": "2026-07-27T03:02:35.094Z",
  "recent_errors": [
    { "code": "FLOOD_WAIT", "at": "2026-07-26T10:00:00Z", "seconds": 30 }
  ],
  "spambot_signal": null
}
```

`spambot_signal` is non-null only when an admin has manually triggered a
SpamBot check that returned a restriction. `null` means no signal cached.

## Examples

### MCP

```json
{
  "method": "tools/call",
  "params": {
    "name": "bullgram_userbot_health",
    "arguments": { "userbot_id": "11111111-1111-1111-1111-111111111111" }
  }
}
```

### REST

```bash
curl -H "Authorization: Bearer brapi_..." \
  https://bullgram.xyz/api/external/v1/userbots/11111111-1111-1111-1111-111111111111/health
```

## Errors

| Code | Cause |
|---|---|
| `-32602` | `userbot_id` not a UUID |
| `-32007` | Userbot not found (or not owned by token owner) |
| `-32003` | userbot_id not in token's allowlist |
| `-32004` | Userbot is in safe-mode (pending_activation) |
| `-32005` | Userbot is restricted — SpamBot confirmed |
