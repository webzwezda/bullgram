import { Router } from 'express';
import { authenticateUser } from '../middlewares/auth.middleware.js';
import { createLinkCode, getTtlMs } from '../services/tg-link.service.js';

export default function profileRoutes(supabase) {
    const router = Router();
    const BOT_USERNAME = process.env.PLATFORM_BOT_USERNAME;
    const CODE_TTL_MS = getTtlMs();

    router.post('/tg-link/init', authenticateUser, async (req, res) => {
        if (!BOT_USERNAME) {
            return res.status(503).json({ error: 'PLATFORM_BOT_USERNAME не настроен' });
        }
        const code = createLinkCode(req.user.id);
        return res.json({
            code,
            deeplink_url: `https://t.me/${BOT_USERNAME}?start=${code}`,
            expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString()
        });
    });

    router.get('/tg-link/status', authenticateUser, async (req, res) => {
        const { data: profile, error } = await supabase
            .from('profiles')
            .select('telegram_user_id, telegram_username')
            .eq('id', req.user.id)
            .maybeSingle();
        if (error) return res.status(500).json({ error: error.message });
        if (profile?.telegram_user_id) {
            return res.json({
                linked: true,
                telegram_user_id: profile.telegram_user_id,
                telegram_username: profile.telegram_username
            });
        }
        return res.json({ linked: false });
    });

    router.delete('/tg-link', authenticateUser, async (req, res) => {
        const { error } = await supabase
            .from('profiles')
            .update({ telegram_user_id: null, telegram_username: null })
            .eq('id', req.user.id);
        if (error) return res.status(500).json({ error: error.message });
        return res.json({ success: true });
    });

    return router;
}
