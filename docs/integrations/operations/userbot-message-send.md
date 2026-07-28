# `bullgram_userbot_message_send`

> Tag: **userbots** · Class: **write** · REST: `POST /userbots/{userbot_id}/messages`

Sends a text message as the userbot.

**DM safety**: for DMs (positive `chat_id`), the global `USERBOT_DM_ENABLED`
flag must be `true` on the backend. If it's `false`, all DM attempts throw
`DM_DISABLED`. Group/channel posts are not affected by this flag.

Telegram is more likely to deliver when the userbot already has a dialog with
the target user or shares a group with them. Admin rights in a group also
improve delivery odds.

## Scopes

`mcp:userbot:write` OR `api:userbot:write`

## Arguments

| Field | Type | Required | Description |
|---|---|---|---|
| `userbot_id` | uuid | yes | Path param |
| `chat_id` | string | yes | Telegram chat ID (positive = DM, negative = group/channel) |
| `text` | string | yes | 1–4096 chars (Telegram limit) |
| `reply_to_message_id` | string | no | Reply target |

## Result

```json
{
  "message_id": "8801",
  "date": "2026-07-27T10:00:00Z"
}
```

## Examples

### MCP

```json
{
  "method": "tools/call",
  "params": {
    "name": "bullgram_userbot_message_send",
    "arguments": {
      "userbot_id": "11111111-1111-1111-1111-111111111111",
      "chat_id": "-1001234567890",
      "text": "Daily digest: 12 new support tickets."
    }
  }
}
```

### REST

```bash
curl -X POST -H "Authorization: Bearer brapi_..." \
     -H "Content-Type: application/json" \
     -d '{"chat_id":"-1001234567890","text":"Daily digest: 12 new support tickets."}' \
     https://bullgram.xyz/api/external/v1/userbots/11111111-1111-1111-1111-111111111111/messages
```

## Errors

| Code | Cause |
|---|---|
| `-32602` | Missing/invalid `chat_id`/`text`, or `text` > 4096 chars |
| `-32006` | Telegram rejected (often: userbot was kicked, banned, or rate-limited) |
| `-32011` | DM disabled — `USERBOT_DM_ENABLED=false` on the backend |
| `-32004` | Userbot in safe-mode |
| `-32005` | Userbot restricted by SpamBot |
