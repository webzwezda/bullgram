/**
 * Приёмник клиентских ошибок SPA (фаза 4 логирования, план:
 * docs/plans/2026-11-05-logging-research.md §5.7).
 *
 * POST /api/log — публичный (ошибки бывают до логина), но жёстко ограничен:
 * rate-limit 10 запросов/мин на IP (in-memory, instances=1), батч ≤10 событий,
 * allowlist полей с клампами. Каждое событие — warn с source:'web';
 * owner_id присоединяется только при валидном JWT (optionalAuthenticateUser).
 */

import { Router } from 'express';
import { logger } from '../utils/logger.js';

const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 10;
const MAX_EVENTS_PER_REQUEST = 10;
const MAX_MESSAGE_LENGTH = 300;
const MAX_STACK_LENGTH = 2000;
const MAX_URL_LENGTH = 500;

const ALLOWED_APPS = new Set(['site', 'paywall', 'userbot', 'bots', 'treasury', 'profile']);
const ALLOWED_LEVELS = new Set(['error', 'warn']);

export function createClientLogRouter({ log = logger, attachUser = null } = {}) {
    const router = Router();
    const hits = new Map();

    const allowIp = (ip) => {
        const now = Date.now();
        if (hits.size > 5000) {
            for (const [key, entry] of hits) {
                if (now - entry.windowStart > RATE_WINDOW_MS) hits.delete(key);
            }
        }
        const entry = hits.get(ip);
        if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
            hits.set(ip, { count: 1, windowStart: now });
            return true;
        }
        entry.count += 1;
        return entry.count <= RATE_MAX_REQUESTS;
    };

    const sanitizeEvent = (raw) => {
        if (!raw || typeof raw !== 'object') return null;
        const app = String(raw.app || '').trim();
        if (!ALLOWED_APPS.has(app)) return null;
        const message = String(raw.message || '').slice(0, MAX_MESSAGE_LENGTH);
        if (!message) return null;
        return {
            app,
            level: ALLOWED_LEVELS.has(raw.level) ? raw.level : 'error',
            message,
            stack: String(raw.stack || '').slice(0, MAX_STACK_LENGTH),
            url: String(raw.url || '').slice(0, MAX_URL_LENGTH)
        };
    };

    router.post('/', attachUser || ((req, res, next) => next()), (req, res) => {
        const ip = req.ip || 'unknown';
        if (!allowIp(ip)) {
            return res.status(429).json({ error: 'Слишком много запросов' });
        }

        const body = req.body;
        const rawEvents = Array.isArray(body)
            ? body
            : Array.isArray(body?.events)
                ? body.events
                : body && typeof body === 'object'
                    ? [body]
                    : [];

        if (!rawEvents.length || rawEvents.length > MAX_EVENTS_PER_REQUEST) {
            return res.status(400).json({ error: `Ожидался батч из 1-${MAX_EVENTS_PER_REQUEST} событий` });
        }

        let accepted = 0;
        for (const raw of rawEvents) {
            const event = sanitizeEvent(raw);
            if (!event) continue;
            accepted += 1;
            const requestLog = req.log || log;
            // Клиентский level мапится в уровень серверной записи:
            // error → error (виден в jq 'select(.level=="error")'), warn → warn.
            requestLog[event.level === 'error' ? 'error' : 'warn']({
                source: 'web',
                web_app: event.app,
                web_url: event.url || null,
                stack: event.stack || null
            }, event.message);
        }

        return res.json({ ok: true, accepted });
    });

    return router;
}

export default function clientLogRoutes(deps) {
    return createClientLogRouter(deps);
}
