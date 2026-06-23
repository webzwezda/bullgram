/**
 * Простой in-memory rate limiter.
 * Не требует Redis — достаточно для защиты отдельных эндпоинтов от брутфорса.
 * Для multi-instance деплоя стоит заменить на Redis-based limiter.
 */

export function rateLimit({ windowMs, max, message = 'Слишком много запросов, попробуйте позже' }) {
    const hits = new Map(); // key → array of timestamps

    return function rateLimitMiddleware(req, res, next) {
        const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
        const key = `${req.method}:${req.originalUrl}:${ip}`;
        const now = Date.now();

        const arr = (hits.get(key) || []).filter(ts => now - ts < windowMs);
        arr.push(now);

        if (arr.length > max) {
            hits.set(key, arr);
            const retryAfterSec = Math.ceil(windowMs / 1000);
            res.setHeader('Retry-After', String(retryAfterSec));
            return res.status(429).json({ error: message });
        }

        hits.set(key, arr);
        next();
    };
}
