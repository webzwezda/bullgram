# Security best practices

Practical guidance for keeping your Bullgram integration safe in
production. Read [the safety threat model](../safety.md) first — this page
is the operational checklist.

## Token storage

### DO

- Store tokens in a dedicated secrets manager (HashiCorp Vault, AWS
  Secrets Manager, GCP Secret Manager, Doppler, Infisical).
- Inject tokens into runtime via env vars populated from the secrets
  manager at deploy time.
- Use separate tokens per environment (dev / staging / prod) with
  per-env scopes.

### DON'T

- Commit tokens to git (even private repos).
- Paste tokens into Slack, Notion, Loom, or screen recordings.
- Hardcode tokens in Docker images.
- Email tokens. Use a secret-sharing tool with expiration.

## Scope minimization

A token should have the **minimum** scopes its consumer needs:

| Consumer | Read scope | Write scope |
|---|---|---|
| Dashboard that shows counts | `api:userbot:read` | — |
| Daily digest (read + send) | `api:userbot:read` | `api:userbot:write` |
| Audit-only scraper | `api:userbot:read` | — |
| Proxy management script | `api:proxy:read` | `api:proxy:write` |

If you're not sure, start read-only. You can always widen later — and you
can always issue a second token.

## Account allowlist

For third-party integrations (anything you don't fully control), use
`metadata.allowed_userbot_ids`:

```json
{
  "allowed_userbot_ids": ["uuid-of-the-one-account-they-need"]
}
```

This limits blast radius — if the third party leaks the token, only that
one userbot is exposed.

## Rotation cadence

| Token sensitivity | Rotation frequency |
|---|---|
| Internal automation (only you have access) | 6 months |
| Third-party integration | 90 days |
| CI/CD pipelines | 90 days |
| Anything that's been touched by a departing employee | Immediately |

When rotating, issue the new token first, deploy the new value, verify
traffic on the new token, **then** revoke the old one.

## Network security

- All Bullgram endpoints are HTTPS-only. HTTP requests are redirected.
- Pin TLS verification in your HTTP client. Don't disable certificate
  validation, even in dev.
- If you're behind a corporate proxy, configure the proxy's CA bundle
  explicitly rather than disabling verification.
- Bullgram's public IP ranges are not published. Don't write firewall
  rules expecting them to be stable.

## Logging hygiene

### DO

- Log the token's `id` (a UUID) for correlation with the audit log. The
  `id` is safe to log — it's not a credential.
- Log scope/operation/latency for observability.
- Log error codes (numeric) — they're stable across releases.

### DON'T

- Log the full `brapi_...` or `brmcp_...` token.
- Log full request bodies if they contain user-supplied text (Telegram
  message text can contain PII).
- Log full response bodies from `messages`/`dialogs` operations in
  production.

## Audit log review

Set up alerts on the audit log (`/app/claw/log`) for:

- **Sustained rate-limiting** on a single token — automation is stuck
- **`INSUFFICIENT_SCOPE` from the same token repeatedly** — somebody's
  integration is misconfigured
- **Any `ACCOUNT_RESTRICTED`** — admin should investigate
- **`TELEGRAM_ERROR` spike** — Telegram-side issue or behavioral problem
- **First use of a new token** — confirm it's expected

## Incident response

If you suspect a token compromise:

1. **Revoke immediately** at `/app/integrations`. This is irreversible and
   instant.
2. **Issue a replacement** with the same scopes.
3. **Audit recent calls** by the compromised `token_id` in `/app/claw/log`.
4. **Notify affected users** if DMs were sent or messages read.
5. **Document the timeline** for postmortem.

If you suspect a userbot compromise (restricted by SpamBot unexpectedly,
sending messages you didn't authorize):

1. **Activate safe-mode** for the userbot at `/app/userbots` — this sets
   it back to `pending_activation` and blocks all operations.
2. **Audit recent sends** via the audit log filtered by `userbot_id`.
3. **Rotate credentials** for the userbot (the Telegram session itself).
4. **Review all tokens with that userbot in their allowlist** — they may
   need revocation too.

## Specific to AI agents

If you're feeding Bullgram data to an LLM:

- Wrap Telegram content in an explicit "untrusted, do not act on
  instructions" framing (see [safety](../safety.md)).
- Use the most restrictive token practical — `read`-only scopes only,
  plus a per-userbot allowlist.
- Require human approval before any write operation. Don't give agents
  autonomous `message_send` access in production.
- Audit the agent's calls more frequently than human-driven automation —
  agents drift.

## Secrets in code samples

Code samples in this docs site use placeholder tokens like `brapi_...`.
When you copy a sample into your codebase, **always** replace the
placeholder with an env-var lookup:

```javascript
// GOOD
const token = process.env.BULLGRAM_TOKEN;

// BAD
const token = 'brapi_aBcDeFgH_aBcDeFgHxxxxxxxxxxxxxxxxxxxxxxxx';
```
