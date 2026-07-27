# `bullrun_userbot_messages_search`

> Tag: **userbots** · Class: **read** · REST: `GET /userbots/{userbot_id}/messages/search`

Server-side text search inside a chat. Cheaper than fetching + filtering
client-side — Telegram does the work.

## Scopes

`mcp:userbot:read` OR `api:userbot:read`

## Arguments

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `userbot_id` | uuid | yes | — | Path param |
| `chat_id` | string | yes | — | Telegram chat ID |
| `query` | string | yes | — | Search query, 2–200 chars |
| `limit` | integer | no | 50 | 1–200 |
| `cursor` | string | no | — | Opaque pagination cursor |

## Result

Same shape as [`bullrun_userbot_messages`](./userbot-messages.md).

## Examples

### MCP

```json
{
  "method": "tools/call",
  "params": {
    "name": "bullrun_userbot_messages_search",
    "arguments": {
      "userbot_id": "11111111-1111-1111-1111-111111111111",
      "chat_id": "-1001234567890",
      "query": "invoice past due"
    }
  }
}
```

### REST

```bash
curl -H "Authorization: Bearer brapi_..." \
  "https://bullgram.xyz/api/external/v1/userbots/11111111-1111-1111-1111-111111111111/messages/search?chat_id=-1001234567890&query=invoice%20past%20due"
```

## Errors

| Code | Cause |
|---|---|
| `-32602` | `query` shorter than 2 chars, or `chat_id` missing |
| `-32006` | Telegram rejected the call |
| `-32013` | Malformed cursor |
