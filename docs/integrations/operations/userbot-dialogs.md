# `bullgram_userbot_dialogs`

> Tag: **userbots** · Class: **read** · REST: `GET /userbots/{userbot_id}/dialogs`

Enumerates chats/channels/DMs the userbot is a member of. Connects to
Telegram — costs one MTProto round-trip.

## Scopes

`mcp:userbot:read` OR `api:userbot:read`

## Arguments

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `userbot_id` | uuid | yes | — | Path param |
| `type` | enum | no | — | Filter: `channel`, `group`, `megagroup`, `private` |
| `search` | string | no | — | Server-side title/username search (max 200 chars) |
| `limit` | integer | no | 50 | 1–100 |
| `cursor` | string | no | — | Opaque pagination cursor from a previous call |

## Result

```json
{
  "dialogs": [
    {
      "id": "-1001234567890",
      "name": "My channel",
      "username": "mychannel",
      "kind": "channel",
      "unread_count": 5,
      "last_message_id": "8800"
    }
  ],
  "cursor": "eyJpZCI6Ii0xMDAxMjM0NTY3ODkwIn0=",
  "has_more": true
}
```

`kind` is one of: `channel`, `group`, `megagroup`, `private`, `unknown`.

## Examples

### MCP

```json
{
  "method": "tools/call",
  "params": {
    "name": "bullgram_userbot_dialogs",
    "arguments": {
      "userbot_id": "11111111-1111-1111-1111-111111111111",
      "type": "channel",
      "limit": 20
    }
  }
}
```

### REST

```bash
curl -H "Authorization: Bearer brapi_..." \
  "https://bullgram.xyz/api/external/v1/userbots/11111111-1111-1111-1111-111111111111/dialogs?type=channel&limit=20"
```

## Errors

| Code | Cause |
|---|---|
| `-32602` | `userbot_id` not a UUID, or `type` not in the allowed enum |
| `-32007` | Userbot not found / not owned |
| `-32004` | Userbot is in safe-mode |
| `-32005` | Userbot is restricted |
| `-32006` | Telegram rejected the call |
| `-32013` | `cursor` is malformed — drop it and refetch the first page |
