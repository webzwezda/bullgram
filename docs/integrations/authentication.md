# Authentication

Bullgram integrations authenticate with **integration tokens** — long-lived,
scoped, revocable bearer tokens. There are no API keys, OAuth flows, or
session cookies.

## Token anatomy

A token looks like:

```
brapi_aBcDeFgH_aBcDeFgHxxxxxxxxxxxxxxxxxxxxxxxx
```

- **Prefix** — `brmcp_` (MCP) or `brapi_` (REST)
- **Hint** — first 8 chars of the secret (`aBcDeFgH`); visible in the admin
  UI for identification without revealing the secret
- **Secret** — the actual credential; shown **once** at issue time

The full token is **SHA-256 hashed** before storage. Bullgram cannot recover
the secret if you lose it — revoke and reissue.

## Token purposes

| Purpose | Prefix | Use case | Default scopes |
|---|---|---|---|
| `mcp` | `brmcp_` | AI agents (Claude Desktop, Cursor) | `mcp:proxy:read`, `mcp:proxy:write`, `mcp:userbot:read`, `mcp:userbot:write` |
| `api` | `brapi_` | Automation (n8n, scripts, SDKs) | `api:proxy:read`, `api:proxy:write`, `api:userbot:read`, `api:userbot:write` |
| `custom` | `brapi_` | Bespoke integrations | `integrations:read` |

`api` and `custom` both work on REST endpoints. `mcp` works on the JSON-RPC
endpoint. A `brmcp_` token used against REST gets a clear 401 error.

## Issuing tokens

Tokens are issued at **[/app/integrations](https://bullgram.xyz/app/integrations)**.
On issue:

1. Bullgram generates a random 24-byte secret.
2. Prefixes with the purpose identifier.
3. Stores the SHA-256 hash + an encrypted copy (for reveal-later).
4. Returns the full plaintext **once** in the UI.

Copy the plaintext immediately. If you lose it, revoke and reissue.

## Scopes

Scopes are dot-namespaced: `<domain>:<verb>`. Domains: `proxy`, `userbot`.
Verbs: `read`, `write`. Each operation declares its required scopes; the
dispatcher does OR-match (any of the listed scopes satisfies).

See [scopes reference](./scopes.md) for the complete list.

## Account allowlist

Every token can carry a `metadata.allowed_userbot_ids` array. This restricts
which userbot IDs the token can touch:

| Value | Behavior |
|---|---|
| `undefined` / missing | All userbots owned by the token owner are accessible |
| `[]` (empty array) | **No** userbots accessible — useful as a "breaker switch" |
| `["uuid-A", "uuid-B"]` | Only those IDs are accessible |

Use this to give a third-party integration access to specific accounts
without exposing your whole fleet.

## Per-token rate limit override

```json
{
  "metadata": {
    "rate_limit_override": { "read_per_minute": 10, "write_per_minute": 5 }
  }
}
```

Use sparingly — the defaults (120/min read, 30/min write) cover most
automation. Lower an integration's limit if it's behaving badly.

## Revocation

Revoke from the integrations page. Revoked tokens immediately fail auth with
code `-32010`. The revocation is permanent — to "undo," issue a new token.

Audit logs for revoked tokens remain queryable by `token_id` for compliance.

## Audit trail

Every operation flows through the audit log (`mcp_tool_log` table) with:

- `token_id` (nullable — null for unauthenticated attempts that fail at scope check)
- `auth_kind` (always `integration_token` for REST)
- `owner_id`
- `operation_name`
- `source` (`mcp` or `rest`)
- `arguments_hash` (SHA-256 of arguments, with volatile fields stripped)
- `status` (`started` → `success` / `error` / specific failure code)
- `latency_ms`
- `request_ip`, `user_agent`, `request_id`

Arguments are **never** logged in plaintext — only the hash, for replay
detection. View the log at **[/app/claw/log](https://bullgram.xyz/app/claw/log)**.
