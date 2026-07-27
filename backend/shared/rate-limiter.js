// Synchronous token-bucket rate limiter.
// Plan 01 Phase 1.
//
// Why synchronous: the original async read-then-write design had a race window
// where concurrent requests could both read the same `tokens` value and both
// pass the check. The consume() method here is fully synchronous — no `await`
// between reading and writing the bucket state. Express handlers do not need
// to await between checks.
//
// PM2 runs Bullgram as a single instance (ecosystem.config.cjs: instances: 1),
// so an in-memory limiter is correct. If we ever move to multi-instance,
// implement the same RateLimiter interface against Redis.

import { MCPError, ERROR_CODES } from './errors.js';

const DEFAULT_READ_PER_MIN = 120;
const DEFAULT_WRITE_PER_MIN = 30;
const USERBOT_READ_PER_MIN = 60;
const USERBOT_WRITE_PER_MIN = 10;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const STALE_AFTER_MS = 5 * 60 * 1000;

export class RateLimiter {
  consume(_opts) {
    throw new Error('RateLimiter.consume not implemented');
  }
}

export class InMemoryRateLimiter extends RateLimiter {
  constructor() {
    super();
    this.buckets = new Map();
    this.lastConsumed = new Map();
    this._cleanupInterval = setInterval(() => this._cleanup(), CLEANUP_INTERVAL_MS);
    this._cleanupInterval.unref?.();
  }

  consume({ key, perMinute, class: rateLimitClass }) {
    if (!key) throw new Error('rate-limiter.consume: key required');
    if (!Number.isFinite(perMinute) || perMinute <= 0) {
      throw new Error(`rate-limiter.consume: invalid perMinute=${perMinute}`);
    }
    const now = Date.now();
    const refillPerMs = perMinute / 60_000;
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: perMinute, last_refill: now, perMinute, class: rateLimitClass || null };
      this.buckets.set(key, bucket);
    }
    const elapsedMs = now - bucket.last_refill;
    bucket.tokens = Math.min(perMinute, bucket.tokens + elapsedMs * refillPerMs);
    bucket.last_refill = now;
    bucket.perMinute = perMinute;
    bucket.class = rateLimitClass || null;

    if (bucket.tokens < 1) {
      const retryAfterSec = Math.max(1, Math.ceil((1 - bucket.tokens) / refillPerMs / 1000));
      const meta = { bucket: key, class: bucket.class, retryAfterSec };
      this.lastConsumed.set(key, { allowed: false, ...meta, ts: now });
      throw new MCPError(
        ERROR_CODES.RATE_LIMITED,
        `Rate limit exceeded (${bucket.class || 'default'}). Retry in ${retryAfterSec}s.`,
        { auditStatus: 'rate_limited', retryAfterSec, details: meta }
      );
    }
    bucket.tokens -= 1;
    const remaining = Math.floor(bucket.tokens);
    const resetAt = new Date(now + Math.ceil((perMinute - bucket.tokens) / refillPerMs));
    this.lastConsumed.set(key, {
      allowed: true,
      limit: perMinute,
      remaining,
      class: bucket.class,
      reset_at: resetAt.toISOString(),
      ts: now
    });
    return this.lastConsumed.get(key);
  }

  lastSeen(key) {
    return this.lastConsumed.get(key) || null;
  }

  _cleanup() {
    const cutoff = Date.now() - STALE_AFTER_MS;
    for (const [k, b] of this.buckets) {
      if (b.last_refill < cutoff) this.buckets.delete(k);
    }
  }
}

export const rateLimiter = new InMemoryRateLimiter();

export function defaultTokenLimits(metadata = {}) {
  const override = metadata && typeof metadata === 'object' ? metadata.rate_limit_override : null;
  return {
    read: Number(override?.read_per_minute) > 0 ? Number(override.read_per_minute) : DEFAULT_READ_PER_MIN,
    write: Number(override?.write_per_minute) > 0 ? Number(override.write_per_minute) : DEFAULT_WRITE_PER_MIN
  };
}

export function userbotLimits(rateLimitClass) {
  return rateLimitClass === 'write' ? USERBOT_WRITE_PER_MIN : USERBOT_READ_PER_MIN;
}
