# `bullrun_userbot_participants`

> Tag: **userbots** · Class: **read** · REST: `GET /userbots/{userbot_id}/participants`

Lists participants of a chat/group/channel. **Hard-capped at 5000 per chat** to
bound cost — beyond that Telegram degrades and Bullgram refuses.

## Scopes

`mcp:userbot:read` OR `api:userbot:read`

## Arguments

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `userbot_id` | uuid | yes | — | Path param |
| `chat_id` | string | yes | — | Telegram chat ID |
| `limit` | integer | no | 100 | 1–200 per page |
| `cursor` | string | no | — | Opaque pagination cursor (encodes offset) |

## Result

```json
{
  "participants": [
    {
      "id": "555",
      "username": "alice",
      "first_name": "Alice",
      "last_name": "Smith",
      "is_bot": false,
      "is_verified": false,
      "is_admin": true
    }
  ],
  "cursor": "eyJvZmZzZXQiOjEwMH0=",
  "has_more": true
}
```

## Examples

### MCP

```json
{
  "method": "tools/call",
  "params": {
    "name": "bullrun_userbot_participants",
    "arguments": {
      "userbot_id": "11111111-1111-1111-1111-111111111111",
      "chat_id": "-1001234567890",
      "limit": 200
    }
  }
}
```

### REST

```bash
curl -H "Authorization: Bearer brapi_..." \
  "https://bullgram.xyz/api/external/v1/userbots/11111111-1111-1111-1111-111111111111/participants?chat_id=-1001234567890&limit=200"
```

## Errors

| Code | Cause |
|---|---|
| `-32602` | Missing `chat_id` |
| `-32006` | Telegram rejected the call (often: userbot isn't a member) |
| `-32013` | Malformed cursor — drop and refetch |
