# `bullgram_infra_summary`

> Tag: **infra** · Class: **read** · REST: `GET /infra/summary`

Returns an at-a-glance summary of the token owner's Bullgram footprint:
managed proxies, userbot accounts, and tier limits.

Useful as the first call in a session to confirm the token works and to
discover `userbot_id` / `proxy_id` values you'll need for subsequent calls.

## Scopes

`mcp:proxy:read` OR `api:proxy:read`

This operation **does not require** an integration token (the scope check still
runs, but a user JWT is accepted if the scopes match — useful for in-app calls).

## Arguments

None.

## Result

Returns an object with three sections:

```json
{
  "tier": { "product_tier": "normal", "limits": { ... } },
  "userbots": { "count": 3, "active": 2, "restricted": 0 },
  "proxies":  { "count": 5, "working": 4 }
}
```

Shape is owned by `buildAgentInfraPayload`; field set may evolve. Treat any
unknown field as informational.

## Examples

### MCP

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "bullgram_infra_summary",
    "arguments": {}
  }
}
```

### REST (curl)

```bash
curl -H "Authorization: Bearer brapi_..." \
  https://bullgram.xyz/api/external/v1/infra/summary
```

## Errors

| Code | Cause |
|---|---|
| `-32002` | Token lacks `mcp:proxy:read` or `api:proxy:read` scope |
| `-32603` | Internal failure (DB, profile load) |
