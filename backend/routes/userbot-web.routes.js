import express from 'express';
import { authenticateUser } from '../middlewares/auth.middleware.js';
import { rateLimit } from '../middlewares/rate-limit.middleware.js';

export default function (supabase, mtprotoBridgeService) {
    const router = express.Router();

    const issueLimit = rateLimit({
        windowMs: 60_000,
        max: 5,
        message: 'Слишком много запросов на открытие Telegram Web'
    });

    router.post('/web-session/:userbotId', authenticateUser, issueLimit, async (req, res) => {
        if (!mtprotoBridgeService.isEnabled()) {
            return res.status(503).json({ error: 'TELEGRAM_WEB_DISABLED' });
        }

        const { userbotId } = req.params;
        if (!userbotId || typeof userbotId !== 'string') {
            return res.status(400).json({ error: 'INVALID_USERBOT_ID' });
        }

        const adminIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
            || req.socket.remoteAddress
            || null;
        const userAgent = req.headers['user-agent'] || null;

        try {
            const issued = await mtprotoBridgeService.issueBridgeToken({
                userbotId,
                adminId: req.user.id,
                adminIp,
                userAgent
            });
            res.set('Cache-Control', 'no-store, private, max-age=0');
            res.set('Pragma', 'no-cache');
            return res.json(issued);
        } catch (err) {
            const message = String(err.message || err);
            if (message === 'TELEGRAM_WEB_DISABLED') {
                return res.status(503).json({ error: 'TELEGRAM_WEB_DISABLED' });
            }
            if (message === 'USERBOT_NOT_FOUND') {
                return res.status(404).json({ error: 'USERBOT_NOT_FOUND' });
            }
            if (message === 'FORBIDDEN') {
                return res.status(403).json({ error: 'FORBIDDEN' });
            }
            if (message === 'SESSION_INVALID' || message === 'SESSION_DECODE_FAILED') {
                return res.status(422).json({ error: message });
            }
            console.error('[userbot-web] issueBridgeToken failed:', message);
            return res.status(500).json({ error: 'INTERNAL_ERROR' });
        }
    });

    // Read-only audit log for the bridge. Filterable by userbot + action.
    // Auth-scoped to the current admin: rows are filtered by admin_id to
    // respect multi-tenancy (admin only sees their own bridge activity).
    router.get('/audit', authenticateUser, async (req, res) => {
        try {
            const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 200);
            const offset = Math.max(Number(req.query.offset) || 0, 0);
            const userbotId = req.query.userbot_id ? String(req.query.userbot_id) : null;
            const action = req.query.action ? String(req.query.action) : null;

            let query = supabase
                .from('telegram_web_audit')
                .select('id, admin_id, userbot_id, action, dc_id, bytes_in, bytes_out, duration_ms, error_code, error_message, admin_ip, user_agent, created_at', { count: 'exact' })
                .eq('admin_id', req.user.id)
                .order('created_at', { ascending: false })
                .range(offset, offset + limit - 1);

            if (userbotId) {
                query = query.eq('userbot_id', userbotId);
            }
            if (action) {
                query = query.eq('action', action);
            }

            const { data, error: queryError, count } = await query;
            if (queryError) throw queryError;

            const activeBridges = mtprotoBridgeService.countActiveBridges({
                adminId: req.user.id,
                userbotId: userbotId || undefined
            });

            res.set('Cache-Control', 'no-store, private, max-age=0');
            return res.json({
                success: true,
                events: data || [],
                total: count ?? 0,
                active_bridges: activeBridges
            });
        } catch (err) {
            console.error('[userbot-web] audit query failed:', err.message);
            return res.status(500).json({ error: err.message || 'AUDIT_QUERY_FAILED' });
        }
    });

    return router;
}
