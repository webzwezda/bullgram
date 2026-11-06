// Роуты настроек кассы (вынесены из server.js дословно; замыкания переданы
// явными параметрами: supabase, authenticateUser, logger).
import express from 'express';

export default function paymentSettingsRoutes(supabase, authenticateUser, logger) {
    const router = express.Router();

    router.post('/', authenticateUser, async (req, res) => {
        const {
            ton_wallet,
            admin_tg_id,
            reminder_text,
        billing_provider,
        billing_mode,
        billing_webhook_secret,
        billing_shop_id,
        billing_api_key,
        referral_enabled,
        referral_reward_percent,
        referral_client_discount_percent,
        referral_welcome_text
    } = req.body;
    try {
        // --- серверная валидация (до upsert) ---
        if (ton_wallet != null && String(ton_wallet).trim() !== '') {
            const wallet = String(ton_wallet).trim();
            // UQ/EQ/0Q — все три префикса user-friendly TON-адресов (placeholder UI обещает все три)
            if (!/^(UQ|EQ|0Q)[A-Za-z0-9_-]{46}$/.test(wallet)) {
                return res.status(400).json({ error: 'Некорректный TON-кошелёк: адрес должен начинаться с UQ, 0Q или EQ и содержать 48 символов' });
            }
        }

        if (admin_tg_id != null && String(admin_tg_id).trim() !== '' && !/^\d+$/.test(String(admin_tg_id).trim())) {
            return res.status(400).json({ error: 'Telegram ID должен состоять только из цифр' });
        }

        const percentFields = [
            [referral_reward_percent, 'Процент вознаграждения по рефералам должен быть числом от 0 до 100'],
            [referral_client_discount_percent, 'Скидка клиента по рефералам должна быть числом от 0 до 100']
        ];
        for (const [rawValue, message] of percentFields) {
            if (rawValue === undefined || rawValue === null || rawValue === '') continue;
            const num = Number(rawValue);
            if (!Number.isFinite(num) || num < 0 || num > 100) {
                return res.status(400).json({ error: message });
            }
        }

        const legacyPayload = {
            owner_id: req.user.id,
            ton_wallet,
            admin_tg_id,
            reminder_text
        };

        const extendedPayload = {
            ...legacyPayload,
            reminder_text,
            billing_provider,
            billing_mode,
            billing_webhook_secret,
            billing_shop_id,
            billing_api_key,
            referral_enabled,
            referral_reward_percent,
            referral_client_discount_percent,
            referral_welcome_text
        };

        // В ответе эхоим те же не-секретные колонки, что и в GET:
        // billing_api_key / billing_webhook_secret не возвращаем.
        const publicColumns = 'ton_wallet, admin_tg_id, reminder_text, billing_provider, billing_mode, billing_shop_id, referral_enabled, referral_reward_percent, referral_client_discount_percent, referral_welcome_text';
        let { data, error } = await supabase
            .from('payment_settings')
            .upsert(extendedPayload, { onConflict: 'owner_id' })
            .select(publicColumns)
            .single();

        if (error && (
            (error.message || '').includes('billing_') ||
            (error.message || '').includes('referral_')
        )) {
            // Легаси-схема без billing_/referral_-колонок: select должен быть
            // только из реально существующих колонок legacyPayload.
            const legacyResult = await supabase
                .from('payment_settings')
                .upsert(legacyPayload, { onConflict: 'owner_id' })
                .select('ton_wallet, admin_tg_id, reminder_text')
                .single();
            error = legacyResult.error;
            data = legacyResult.data;
        }

        if (error) throw error;
        res.json({ success: true, settings: data || legacyPayload });
    } catch (err) {
        logger.error({ err }, 'Ошибка сохранения настроек');
        res.status(500).json({ error: 'Ошибка базы данных при сохранении' });
    }
    });

    router.get('/', authenticateUser, async (req, res) => {
    try {
        // Явный список колонок без секретов: billing_api_key и
        // billing_webhook_secret не должны утекать в браузер.
        const { data } = await supabase
            .from('payment_settings')
            .select('ton_wallet, admin_tg_id, reminder_text, billing_provider, billing_mode, billing_shop_id, referral_enabled, referral_reward_percent, referral_client_discount_percent, referral_welcome_text')
            .eq('owner_id', req.user.id)
            .single();
        res.json({ settings: data || {} });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
    });

    return router;
}
