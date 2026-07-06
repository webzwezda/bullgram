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
        const [profileResp, settingsResp, autopostResp] = await Promise.all([
            supabase
                .from('profiles')
                .select('telegram_user_id, telegram_username')
                .eq('id', req.user.id)
                .maybeSingle(),
            supabase
                .from('payment_settings')
                .select('admin_tg_id')
                .eq('owner_id', req.user.id)
                .maybeSingle(),
            supabase
                .from('autopost_bots')
                .select('admin_tg_ids')
                .eq('owner_id', req.user.id)
        ]);
        if (profileResp.error) return res.status(500).json({ error: profileResp.error.message });

        const fromProfile = profileResp.data?.telegram_user_id || null;
        const fromSettings = settingsResp.data?.admin_tg_id
            ? String(settingsResp.data.admin_tg_id).trim() || null
            : null;

        // Fallback: infer from autopost_bots.admin_tg_ids if there's a single unique ID
        let fromAutopost = null;
        let autopostSource = null;
        if (autopostResp.data && autopostResp.data.length > 0) {
            const uniqueIds = new Set();
            for (const bot of autopostResp.data) {
                for (const id of bot.admin_tg_ids || []) {
                    if (id !== null && id !== undefined && String(id).trim()) {
                        uniqueIds.add(String(id).trim());
                    }
                }
            }
            if (uniqueIds.size === 1) {
                fromAutopost = [...uniqueIds][0];
                autopostSource = 'autopost';
            }
        }

        const primaryTgId = fromProfile || fromSettings || fromAutopost;
        if (primaryTgId) {
            return res.json({
                linked: true,
                telegram_user_id: primaryTgId,
                telegram_username: profileResp.data?.telegram_username || null,
                source: fromProfile ? 'verified' : (fromSettings ? 'manual' : autopostSource)
            });
        }
        return res.json({ linked: false });
    });

    router.delete('/tg-link', authenticateUser, async (req, res) => {
        await Promise.all([
            supabase
                .from('profiles')
                .update({ telegram_user_id: null, telegram_username: null })
                .eq('id', req.user.id),
            supabase
                .from('payment_settings')
                .update({ admin_tg_id: null })
                .eq('owner_id', req.user.id)
        ]);
        return res.json({ success: true });
    });

    return router;
}
