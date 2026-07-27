# `bullrun_proxy_import`

> Tag: **proxies** · Class: **write** · REST: `POST /proxies/import`

Saves a proxy to Bullgram after an explicit confirmation in a previous
[`bullrun_proxy_preview`](./proxy-preview.md) turn. Never call this blind —
always preview first.

## Scopes

`mcp:proxy:write` OR `api:proxy:write`

## Arguments

| Field | Type | Required | Description |
|---|---|---|---|
| `raw` | string | yes | Same raw text used in the preview turn |
| `confirmed` | boolean | yes | Must be `true` — explicit user confirmation |
| `name` | string | no | Optional label. Defaults to `host:port` |
| `inventory_group` | enum (`self_use`, `shop_sale`) | no | Admin only — bucket the proxy into an inventory group |

## Result

```json
{
  "success": true,
  "proxy": { "id": "<uuid>", "name": "...", "host": "1.2.3.4", "port": 1080 },
  "parsed": { /* same shape as preview */ },
  "message": "Proxy saved from pasted text."
}
```

## Quota

Non-admin tokens are subject to the owned-proxy quota enforced by the product
tier (`enforceOwnedProxyQuota`). Exceeding the quota throws with a clear
message — surface it to the user.

## Examples

### MCP

```json
{
  "method": "tools/call",
  "params": {
    "name": "bullrun_proxy_import",
    "arguments": {
      "raw": "socks5://user:pass@1.2.3.4:1080",
      "confirmed": true,
      "name": "US-east-1 exit"
    }
  }
}
```

### REST

```bash
curl -X POST -H "Authorization: Bearer brapi_..." \
     -H "Content-Type: application/json" \
     -d '{"raw":"socks5://user:pass@1.2.3.4:1080","confirmed":true,"name":"US-east-1 exit"}' \
     https://bullgram.xyz/api/external/v1/proxies/import
```

## Errors

| Code | Cause |
|---|---|
| `-32602` | `confirmed !== true`, or `raw` missing |
| `-32002` | Insufficient scope |
| `-32009` | Quota exceeded (non-admin) |
