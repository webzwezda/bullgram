# Scopes reference

Scopes are dot-namespaced: `<domain>:<verb>`. Each operation declares
required scopes; the dispatcher does **OR-match** — any of the listed scopes
satisfies the requirement.

Two prefixes are in active use:

- **`mcp:*`** — for tokens with `purpose=mcp` (`brmcp_` prefix)
- **`api:*`** — for tokens with `purpose=api` or `purpose=custom` (`brapi_` prefix)

Most operations accept both prefixes (e.g. `bullrun_userbot_health` accepts
either `mcp:userbot:read` or `api:userbot:read`). This lets a single token
work on both transports if you want that.

## Domain scope map

### `proxy`

| Scope | Operations |
|---|---|
| `mcp:proxy:read` / `api:proxy:read` | [`bullrun_infra_summary`](./operations/infra-summary.md) |
| `mcp:proxy:write` / `api:proxy:write` | [`bullrun_proxy_preview`](./operations/proxy-preview.md), [`bullrun_proxy_import`](./operations/proxy-import.md) |

### `userbot`

| Scope | Operations |
|---|---|
| `mcp:userbot:read` / `api:userbot:read` | `bullrun_userbot_list`, `bullrun_userbot_health`, `bullrun_userbot_dialogs`, `bullrun_userbot_messages`, `bullrun_userbot_messages_search`, `bullrun_userbot_participants` |
| `mcp:userbot:write` / `api:userbot:write` | [`bullrun_userbot_message_send`](./operations/userbot-message-send.md) |

## Legacy scopes

The following scopes predate Plan 01 and remain in the allowlist for
backward compatibility. New integrations should not rely on them.

| Scope | Status |
|---|---|
| `mcp:use` | Legacy umbrella — superseded by per-domain scopes |
| `api:use` | Legacy umbrella — superseded by per-domain scopes |
| `integrations:read` | Default scope for `purpose=custom` tokens; no operation currently requires it |
| `orders:read`, `shop:read`, `payments:read`, `cashdesk:read` | Reserved for future domain expansion |

## Picking scopes for a new token

| Use case | Recommended scopes |
|---|---|
| Read-only monitoring (dashboards, alerts) | `api:userbot:read`, `api:proxy:read` |
| Daily digest automation (read + send one message) | `api:userbot:read`, `api:userbot:write` |
| AI agent (Claude Desktop) | `mcp:userbot:read`, `mcp:userbot:write`, `mcp:proxy:read` |
| Third-party proxy manager | `api:proxy:read`, `api:proxy:write` |

Always issue the **minimum** scope set the consumer needs. You can always
issue a second token with broader scopes later.

## Checking scopes at runtime

```bash
# Confirm token + scopes via REST
curl -H "Authorization: Bearer brapi_..." \
  https://bullgram.xyz/api/external/v1/me
```

```json
{
  "token": {
    "id": "...",
    "purpose": "api",
    "scopes": ["api:userbot:read", "api:userbot:write"]
  }
}
```

For MCP, call `tools/list` — the returned tool set is filtered to scopes
your token has. Missing tools = missing scopes.
