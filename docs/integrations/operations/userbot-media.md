# Media download (`bullgram_userbot_media_save` / `bullgram_userbot_media_download`)

> Tag: **userbots** · Class: **read** · REST:
> `POST /userbots/{userbot_id}/chats/{chat_id}/messages/{message_id}/media/save`
> · `GET /userbots/{userbot_id}/chats/{chat_id}/messages/{message_id}/media`

Downloads chat media (documents, photos; Telegram ships video/audio/voice as
documents) from any chat the userbot can read. Two operations, two delivery
modes:

| Operation | Transports | Delivery |
|---|---|---|
| `bullgram_userbot_media_save` | MCP + REST | Downloads to a server-side temp store, returns JSON `{file_name, mime, size_bytes, sha256, download_url, expires_at}` |
| `bullgram_userbot_media_download` | REST only | Streams the bytes directly (`application/octet-stream`) |

## Why two modes

MCP clients authenticate with `brmcp_` tokens, which the REST surface rejects
— so an MCP agent cannot stream bytes itself. `media_save` hands it a **signed,
expiring link** instead: `GET /api/external/v1/media/{token}`, no auth header
required (the token is HMAC-signed and expires). REST clients with a `brapi_`
token should prefer the binary `GET .../media` endpoint.

## Scopes

`mcp:userbot:read` OR `api:userbot:read` (media_save);
`api:userbot:read` (media_download — REST-only).

## Arguments (both operations)

| Field | Type | Required | Description |
|---|---|---|---|
| `userbot_id` | uuid | yes | Path param |
| `chat_id` | string | yes | Telegram chat ID (channels start with `-100`) |
| `message_id` | string | yes | Telegram message carrying the media |
| `max_bytes` | integer | no | Lower the size cap for this call (cannot exceed the server cap) |

## Result

### media_save

```json
{
  "file_name": "ИИ от Ивина Андрея.pdf",
  "mime": "application/pdf",
  "size_bytes": 47109750,
  "sha256": "9f2c…",
  "download_url": "https://bullgram.xyz/api/external/v1/media/eyJwIjoi…",
  "expires_at": "2026-11-21T12:45:00.000Z",
  "storage": "server-temp"
}
```

Fetch `download_url` right away — it expires (default 15 min,
`MEDIA_URL_TTL_MS` env) and the file behind it is wiped after ~1h
(`MEDIA_STORE_TTL_MS` env). `sha256` lets you verify the downloaded bytes.

### media_download

Binary stream with headers:

- `Content-Type` — the document's MIME type
- `Content-Disposition` — `attachment` with UTF-8 filename
- `X-Media-SHA256` — integrity hash

## Limits

| Limit | Default | Env override |
|---|---|---|
| Max media size | 200 MB | `MEDIA_MAX_BYTES` |
| Signed-link TTL | 15 min | `MEDIA_URL_TTL_MS` |
| Store TTL (file wipe) | 1 h | `MEDIA_STORE_TTL_MS` |

Oversized media fails **before** downloading when the size is declared
(documents), and right after the transfer otherwise — you never pay for a
download that cannot succeed silently.

## Examples

### MCP (media_save → fetch the signed URL)

```json
{
  "method": "tools/call",
  "params": {
    "name": "bullgram_userbot_media_save",
    "arguments": {
      "userbot_id": "11111111-1111-1111-1111-111111111111",
      "chat_id": "1678390029",
      "message_id": "169729"
    }
  }
}
```

```bash
curl -L -o course.pdf "$(jq -r .download_url response.json)"
```

### REST (binary)

```bash
curl -H "Authorization: Bearer brapi_..." \
  -o course.pdf \
  "https://bullgram.xyz/api/external/v1/userbots/11111111-1111-1111-1111-111111111111/chats/1678390029/messages/169729/media"
```

## Errors

| Code | Cause |
|---|---|
| `-32014` | Message not found or has no media |
| `-32015` | Media above the size cap (`MEDIA_TOO_LARGE`, HTTP 413) |
| `-32016` | Media kind not downloadable (contact/geo/poll/invoice/…, HTTP 415) |
| `-32006` | Telegram rejected the call (chat not accessible, flood wait) |

The public `GET /media/{token}` link returns `410 Gone` once the link or the
stored file expired, and `403` on a bad signature.
