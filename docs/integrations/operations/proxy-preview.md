# `bullrun_proxy_preview`

> Tag: **proxies** · Class: **read** · REST: `POST /proxies/preview`

Parses raw proxy paste text and returns a structured preview. Vendor formats
are messy — this call normalizes them. Always call this before
[`bullrun_proxy_import`](./proxy-import.md) so the human (or agent) can confirm
the parsed result is what they intended.

## Scopes

`mcp:proxy:write` OR `api:proxy:write`

Note: this is a **read** operation (nothing is persisted), but the scope is
`proxy:write` because preview is the first step of an import — you'd typically
issue a token capable of both steps.

## Arguments

| Field | Type | Required | Description |
|---|---|---|---|
| `raw` | string | yes | Raw proxy text. Accepts vendor-prefixed forms like `socks5://user:pass@host:port`, `host:port:user:pass`, etc. |

## Result

```json
{
  "success": true,
  "parsed": {
    "host": "1.2.3.4",
    "port": 1080,
    "username": "user",
    "password": "pass",
    "scheme": "socks5"
  },
  "message": "Proxy parsed. Show preview and ask user for confirmation before importing."
}
```

If the parser cannot identify host/port, `parsed` will contain nulls — surface
this to the user and ask them to re-paste.

## Examples

### MCP

```json
{
  "method": "tools/call",
  "params": {
    "name": "bullrun_proxy_preview",
    "arguments": { "raw": "socks5://user:pass@1.2.3.4:1080" }
  }
}
```

### REST

```bash
curl -X POST -H "Authorization: Bearer brapi_..." \
     -H "Content-Type: application/json" \
     -d '{"raw":"socks5://user:pass@1.2.3.4:1080"}' \
     https://bullgram.xyz/api/external/v1/proxies/preview
```

## Errors

| Code | Cause |
|---|---|
| `-32602` | `raw` argument missing or empty |
| `-32002` | Token lacks `proxy:write` scope |
