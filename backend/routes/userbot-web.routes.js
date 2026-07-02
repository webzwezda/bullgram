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

    return router;
}
