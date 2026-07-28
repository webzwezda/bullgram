# `bullgram_userbot_list`

> Tag: **userbots** · Class: **read** · REST: `GET /userbots`

Lists userbot accounts owned by the token owner. Reserved-for-shop accounts
are excluded by default — pass `include_reserved=true` to see them.

This is the cheapest call to discover `userbot_id` values you'll need for
other endpoints.

## Scopes

`mcp:userbot:read` OR `api:userbot:read`

Requires an integration token (`brmcp_` or `brapi_`).

## Arguments

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `limit` | integer | no | 50 | 1–200 |
| `include_reserved` | boolean | no | false | Include accounts reserved for shop sale |

## Result

```json
{
  "userbots": [
    {
      "id": "11111111-1111-1111-1111-111111111111",
      "tg_username": "my_helper_bot",
      "tg_account_id": "8414225338",
      "runtime_status": "online",
      "proxy_id": "98e40691-446e-4a69-b924-3c98e6bd9c68",
      "last_seen_at": "2026-07-27T03:02:35.094Z"
    }
  ],
  "count": 1
}
```

`runtime_status` values include `online`, `pending_activation` (safe-mode),
`restricted` (SpamBot confirmed).

## Examples

### MCP

```json
{
  "method": "tools/call",
  "params": {
    "name": "bullgram_userbot_list",
    "arguments": { "limit": 20 }
  }
}
```

### REST

```bash
curl -H "Authorization: Bearer brapi_..." \
  "https://bullgram.xyz/api/external/v1/userbots?limit=20&include_reserved=false"
```

## Errors

| Code | Cause |
|---|---|
| `-32002` | Insufficient scope |
| `-32010` | Missing integration token |
