import { Router } from 'express';
import crypto from 'node:crypto';
import { authenticateUser } from '../middlewares/auth.middleware.js';

const WIDGET_MAX_AGE_SEC = 3600;

function verifyTelegramWidget(data, botToken) {
    const { hash, ...rest } = data;
    const checkString = Object.keys(rest)
        .sort()
        .map((key) => `${key}=${rest[key]}`)
        .join('\n');
    const secret = crypto.createHash('sha256').update(botToken).digest();
    const hmac = crypto.createHmac('sha256', secret).update(checkString).digest('hex');
    if (hmac !== hash) return false;
    const authDate = Number(data.auth_date || 0);
    if (!authDate || Date.now() / 1000 - authDate > WIDGET_MAX_AGE_SEC) return false;
    return true;
}

export default function profileRoutes(supabase) {
    const router = Router();
    const BOT_USERNAME = process.env.PLATFORM_BOT_USERNAME;
    const BOT_TOKEN = process.env.TG_BOT_TOKEN;

    router.get('/telegram/status', authenticateUser, async (req, res) => {
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
        return res.json({
            linked: Boolean(primaryTgId),
            telegram_user_id: primaryTgId,
            telegram_username: profileResp.data?.telegram_username || null,
            source: fromProfile ? 'verified' : (fromSettings ? 'manual' : autopostSource),
            bot_username: BOT_USERNAME || null
        });
    });

    router.post('/telegram/widget', authenticateUser, async (req, res) => {
        if (!BOT_TOKEN || !BOT_USERNAME) {
            return res.status(503).json({ error: 'TG_BOT_TOKEN или PLATFORM_BOT_USERNAME не настроен' });
        }
        const payload = req.body || {};
        if (!payload.id || !payload.auth_date || !payload.hash) {
            return res.status(400).json({ error: 'Неполные данные Telegram' });
        }
        if (!verifyTelegramWidget(payload, BOT_TOKEN)) {
            return res.status(401).json({ error: 'Подпись Telegram не прошла проверку' });
        }

        const telegramUserId = Number(payload.id);
        const telegramUsername = payload.username || null;

        const { error: profileError } = await supabase
            .from('profiles')
            .update({ telegram_user_id: telegramUserId, telegram_username: telegramUsername })
            .eq('id', req.user.id);
        if (profileError) {
            if (String(profileError.code || '').includes('23505')) {
                return res.status(409).json({ error: 'Этот Telegram уже привязан к другому аккаунту Bullgram' });
            }
            return res.status(500).json({ error: profileError.message });
        }

        // Sync admin_tg_id so autopost/sales-bot/referral all see the same ID
        const { error: settingsError } = await supabase
            .from('payment_settings')
            .upsert({ owner_id: req.user.id, admin_tg_id: String(telegramUserId) }, { onConflict: 'owner_id' });
        if (settingsError) {
            return res.status(500).json({ error: settingsError.message });
        }

        return res.json({
            linked: true,
            telegram_user_id: String(telegramUserId),
            telegram_username: telegramUsername,
            source: 'verified'
        });
    });

    router.delete('/telegram', authenticateUser, async (req, res) => {
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
