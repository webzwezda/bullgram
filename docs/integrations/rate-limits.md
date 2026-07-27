# Rate limits

Rate limits are **per-token, per-class** — every token has independent
buckets for `read` and `write` operations. A second dimension
(per-userbot-id) protects individual accounts from being hammered.

## Token-bucket algorithm

- Refill: continuous — tokens accrue at `per_minute / 60_000` per ms.
- Cap: bucket size = `per_minute` (no bursts beyond the rate).
- Cost: every dispatched operation consumes 1 token from its class bucket.
- Reset: 429 responses include `Retry-After` (seconds until 1 token available).

Buckets are in-memory, scoped to a single Bullgram instance (PM2
`instances: 1`). Multi-instance deployments would need a Redis-backed
limiter; this is documented in `backend/shared/rate-limiter.js`.

## Default limits

| Bucket | Per-minute | Notes |
|---|---|---|
| Token read | 120 | Default for `rateLimitClass: 'read'` |
| Token write | 30 | Default for `rateLimitClass: 'write'` |
| Userbot read | 60 | Per-userbot-id bucket, in addition to the token bucket |
| Userbot write | 10 | Per-userbot-id bucket |

A single operation consumes from **both** buckets if it touches a userbot
(token bucket + userbot bucket). The tighter limit always wins.

## Per-token override

Issue a token with `metadata.rate_limit_override`:

```json
{
  "metadata": {
    "rate_limit_override": { "read_per_minute": 10, "write_per_minute": 5 }
  }
}
```

- Lowering is always allowed (useful for breaker-switching a misbehaving
  integration).
- Raising above the defaults is intentionally not exposed via UI — if you
  need higher throughput, contact support.

## Response on exhaustion

### MCP

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32001,
    "message": "Rate limit exceeded (read). Retry in 7s.",
    "data": { "auditStatus": "rate_limited", "retryAfterSec": 7, "details": { "bucket": "token:...", "class": "read" } }
  }
}
```

### REST

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 7
Content-Type: application/json

{ "error": { "code": -32001, "message": "...", "retry_after_sec": 7 } }
```

## Practical guidance

- **Polling health** is cheap (no Telegram connection). 30s intervals are
  well within budget for any tier.
- **Listing dialogs/messages** consumes 1 userbot-read token per call. At
  the 60/min userbot budget, you can poll dialogs every minute for ~60
  userbots simultaneously.
- **Bulk imports / sends** are limited by the 10/min userbot-write bucket.
  For 100+ sends, schedule them across multiple minutes.
- **Cursor pagination** — each page fetch is a separate rate-limited call.
  Don't loop without backoff.

## What's NOT rate-limited

- `/health` (REST public health check) — unauthenticated, no limit.
- `/openapi.json`, `/docs` — public, no limit.
- `/me` — counts as a normal read against your token bucket.

## Monitoring

The audit log (`mcp_tool_log`) records every rate-limited event with
`status='rate_limited'`. Filter by your `token_id` to see how close you are
to the ceiling.
