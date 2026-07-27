# Support

## Where to get help

| Channel | Use for |
|---|---|
| [Interactive API explorer](https://bullgram.xyz/api/external/v1/docs) | Probe any operation live, see the exact request/response shape |
| [curl cookbook](./guides/curl-cookbook.md) | Test the API from the shell before reporting an issue |
| [Contributing & CI](./contributing.md) | Local dev setup, adding operations, CI gates |
| [/app/integrations](https://bullgram.xyz/app/integrations) | Issue, reveal, revoke tokens |
| [/app/claw/log](https://bullgram.xyz/app/claw/log) | Browse the audit log of every call |
| Bullgram in-app support | Account, billing, and token-management issues |

## What to include in a bug report

1. **The exact request** that failed. For curl, the full command with
   the token redacted (`brapi_...`, not the real value).
2. **The full response body** — including `error.code`, `error.message`,
   and `error.details` if present.
3. **The `request_id`** if you see one in the response. We can look it
   up in `mcp_tool_log`.
4. **What you expected to happen** vs. what actually happened.
5. **Timestamp** with timezone — helps correlate with our logs.
6. **Token purpose and scopes** — find these at `/app/integrations`
   or via `GET /api/external/v1/me`.

## Common issues and quick fixes

### "Insufficient scope" (`INSUFFICIENT_SCOPE`, code -32007)

Your token doesn't have the scope required for the operation. Issue a
new token at [/app/integrations](https://bullgram.xyz/app/integrations)
with the scope listed in the operation's docs page. See [scopes](./scopes.md).

Required scope is named in the error message — copy it directly.

### "Account not in allowlist" (`FORBIDDEN_ACCOUNT`, code -32011)

The token has an `allowed_userbot_ids` allowlist and the userbot you
referenced isn't on it. Re-issue the token without the allowlist, or
add the userbot to the allowlist at issue time.

### "Account is in safe-mode" (`SAFE_MODE_BLOCKED`, code -32010)

The userbot hasn't been activated yet — it's in `pending_activation`
status after QR/file import. Activate it from `/app/userbots` first.
You can't read or send through a safe-mode account.

See [safety → safe-mode](./safety.md) for why this exists.

### "Account is restricted" (`ACCOUNT_RESTRICTED`, code -32009)

Telegram `@SpamBot` confirmed the userbot is restricted. The account
is removed from shop and any operations through it are blocked.
Decommission the account and activate a new one.

### "Rate limit exceeded" (`RATE_LIMITED`, code -32013)

Slow down. Defaults:

- **Token bucket**: 120 reads + 60 writes per minute
- **Userbot bucket**: 60 reads + 30 writes per minute per userbot

The `retry_after_sec` field tells you how long to wait. See
[rate limits](./rate-limits.md) for override and backoff guidance.

### MCP: tool missing from `tools/list`

The MCP server filters tools by your token's scopes. If a tool is
missing, your token lacks the corresponding scope. Either reissue with
the right scope, or check `/me` to see what scopes are active.

### REST: 404 on a documented path

Two common causes:

1. **Path mismatch** — OpenAPI uses `{userbot_id}`, REST URL uses
   `:userbot_id`. Make sure you substituted an actual UUID.
2. **Old deploy** — `/api/external/v1/openapi.json` is generated from
   the live registry. If a path isn't there, the backend hasn't been
   deployed with that operation yet.

### "Token must start with brapi_ or brmcp_" (`INTEGRATION_TOKEN_REQUIRED`, code -32001)

You're sending the wrong token type. `brmcp_` is for `POST /api/mcp`,
`brapi_` is for `/api/external/v1/*`. They are not interchangeable —
even though the underlying scopes overlap.

## Status dashboard

- Live health: `GET https://bullgram.xyz/api/external/v1/health`
- OpenAPI spec: `GET https://bullgram.xyz/api/external/v1/openapi.json`
- Interactive explorer: `https://bullgram.xyz/api/external/v1/docs`

## Incident response

If you suspect a token has been leaked:

1. **Revoke immediately** at `/app/integrations` → token row → "Отозвать".
2. **Review the audit log** at `/app/claw/log` filtered by that token's
   ID — look for unexpected IPs or operations.
3. **Issue a replacement** with the same scopes (or narrower).
4. **Update your integration** with the new token before re-enabling
   traffic.

Token revocation takes effect on the next request — there's no caching
layer that would let a revoked token through.
