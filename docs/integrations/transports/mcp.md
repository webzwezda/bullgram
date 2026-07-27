# MCP transport

Bullgram speaks [Model Context Protocol](https://modelcontextprotocol.io/) —
JSON-RPC 2.0 over HTTP. MCP is the surface for AI agents (Claude Desktop,
Cursor, custom agents) that want to drive Bullgram operations.

- **Endpoint**: `POST https://bullgram.xyz/api/mcp`
- **Protocol version**: `2025-03-26`
- **Auth**: `Authorization: Bearer brmcp_...` (integration token, purpose=`mcp`)
- **Content-Type**: `application/json`

## Why MCP instead of REST?

For an AI agent:
- The server publishes a `tools/list` so the agent can discover available
  operations at runtime — no hardcoded endpoint URLs.
- Argument validation uses JSON Schema — the agent gets structured
  constraints ("userbot_id must be a UUID") without parsing prose docs.
- All operations look identical from the wire: one method (`tools/call`),
  one argument envelope. No HTTP verb juggling.

For non-agent consumers (scripts, n8n, SDKs), [REST](./rest.md) is simpler.

## Authentication

Every MCP request needs an integration token with `purpose=mcp`. Issue one
at [/app/integrations](https://bullgram.xyz/app/integrations) and copy the
full `brmcp_...` string.

```http
POST /api/mcp HTTP/1.1
Host: bullgram.xyz
Authorization: Bearer brmcp_xxxxxxxxxxxxxxxx
Content-Type: application/json
```

Tokens are scoped. Each operation declares required scopes; the dispatcher
does OR-match (any of the listed scopes satisfies the requirement). See
[scopes](../scopes.md) for the full list.

## Request envelope

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "bullrun_userbot_health",
    "arguments": {
      "userbot_id": "11111111-1111-1111-1111-111111111111"
    }
  }
}
```

`id` is any string/number you'll recognize in the response. `name` is the
operation name from [`tools/list`](#toolslist). `arguments` matches that
operation's input schema.

## Response envelope

### Success

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": { /* operation-specific */ }
}
```

### Error

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32002,
    "message": "Token is missing one of: mcp:userbot:read, api:userbot:read.",
    "data": { "auditStatus": "insufficient_scope", "details": { /* ... */ } }
  }
}
```

Error codes are [canonical](../errors.md). HTTP status is irrelevant inside
JSON-RPC (the wrapper is the response), but the server still sets an
appropriate HTTP status so generic monitoring tools work.

## `tools/list`

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/list",
  "params": {}
}
```

Returns `{ tools: [...] }` filtered to the scopes your token has. If a tool
doesn't appear, your token doesn't have any of its required scopes.

## Batched requests

JSON-RPC 2.0 supports batching — pass an array of requests in one POST. The
server processes them in order and returns an array of responses. Useful for
"fetch dialogs, then fetch messages for the first dialog" patterns.

```json
[
  { "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": { "name": "bullrun_userbot_list", "arguments": {} } },
  { "jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": { "name": "bullrun_infra_summary", "arguments": {} } }
]
```

## Notification semantics

JSON-RPC notifications (requests without `id`) are accepted but produce no
response — Bullgram currently treats them identically to regular requests
for audit and rate-limit purposes. Don't use notifications as a "fire and
forget" optimization; they still consume your rate budget.

## Rate limits

Per-token, per-class:

- **read**: 120/min default, 60/min for userbot-touching operations
- **write**: 30/min default, 10/min for userbot-touching operations

Override per-token via `metadata.rate_limit_override`. See
[rate limits](../rate-limits.md).

## Cursor pagination

List operations return opaque `cursor` strings. Pass them back as
`arguments.cursor` to fetch the next page. If you omit `cursor`, you start
from the newest page. Never parse or persist cursors — they may change
format without notice.

## Content safety

Every sanitized Telegram message is tagged `untrusted_content: true`. The
accompanying `_sanitization_note` reminds consumers that the text may contain
prompt-injection. Never feed raw message text into an agent decision prompt
without sanitization. See [safety](../safety.md).

## Debugging

- `POST /api/mcp/_debug/operations` — list every registered operation
  (intentionally undocumented; useful during local development).
