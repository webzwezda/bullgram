// backend/server.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { createClient } from '@supabase/supabase-js'; // ВОТ ТОТ САМЫЙ ПОТЕРЯННЫЙ ИМПОРТ!
import { normalizeSbpBankSelection } from './utils/payment-settings.js';

// Импортируем роуты
import userbotRoutes from './routes/userbot.routes.js';
import officialBotRoutes, { initAllBots, getBotById } from './routes/official-bot.routes.js';
import analyticsRoutes from './routes/analytics.routes.js'; // <-- НОВОЕ: Импорт роутов аналитики
import accessRoutes from './routes/access.routes.js';
import broadcastRoutes from './routes/broadcast.routes.js';
import paymentRoutes from './routes/payment.routes.js';
import ordersRoutes from './routes/orders.routes.js';
import customerBasesRoutes from './routes/customer-bases.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import clientDossierRoutes from './routes/client-dossier.routes.js';
import referralRoutes from './routes/referral.routes.js';
import shopRoutes from './routes/shop.routes.js';
import observerRoutes from './routes/observer.routes.js';
import agentMcpRoutes from './routes/agent-mcp.routes.js';

// Импортируем фоновые задачи (Cron)
import { startAutoKick } from './jobs/auto-kick.job.js';
import { startRetention } from './jobs/retention.job.js';
import { startAbandonedCart } from './jobs/abandoned-cart.job.js';
import { startUserbotInboxWatch } from './jobs/userbot-inbox.job.js';
import { startRestrictedUserbotCleanup } from './jobs/restricted-userbot-cleanup.job.js';
import { startTonReserveWatch } from './jobs/ton-reserve-watch.job.js';
import { startCryptoRatesRefresh } from './jobs/crypto-rates.job.js';
import { startReferralSettlementRetry } from './jobs/referral-settlement-retry.job.js';

// ==========================================
// ИНИЦИАЛИЗАЦИЯ SUPABASE
// ==========================================
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const publicAppOrigin = String(process.env.PUBLIC_APP_ORIGIN || 'https://bullrun.ru').replace(/\/$/, '');
const corsOrigins = Array.from(new Set([
    publicAppOrigin,
    'http://localhost:8080'
]));

function envFlag(name) {
    return String(process.env[name] || '').trim().toLowerCase() === 'true';
}

// ==========================================
// ГЛОБАЛЬНЫЙ ПЕРЕХВАТЧИК ОШИБОК
// ==========================================
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection:', reason);
});

// ==========================================
// НАСТРОЙКА EXPRESS
// ==========================================
const app = express();
app.use(express.json());
app.use(cors({ origin: corsOrigins }));
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// ==========================================
// МИДДЛВАР: ПРОВЕРКА АВТОРИЗАЦИИ
// ==========================================
const authenticateUser = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Отсутствует или неверный Authorization заголовок' });
    }

    const token = authHeader.split(' ')[1];
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) return res.status(401).json({ error: 'Недействительный токен' });
    req.user = user; 
    next();
};

// ==========================================
// ПОДКЛЮЧЕНИЕ РОУТОВ (МОДУЛИ)
// ==========================================
app.use('/api/userbot', userbotRoutes(supabase));
app.use('/api/official-bot', officialBotRoutes(supabase));
app.use('/api/analytics', analyticsRoutes(supabase)); // <-- НОВОЕ: Подключение роута аналитики
app.use('/api/access', accessRoutes(supabase));
app.use('/api/broadcast', broadcastRoutes(supabase, getBotById));
app.use('/api/payment', paymentRoutes(supabase, getBotById));
app.use('/api/orders', ordersRoutes(supabase));
app.use('/api/customer-bases', customerBasesRoutes(supabase));
app.use('/api/dashboard', dashboardRoutes(supabase));
app.use('/api/client-dossier', clientDossierRoutes(supabase));
app.use('/api/referrals', referralRoutes(supabase));
app.use('/api/shop', shopRoutes(supabase));
app.use('/api/observer', observerRoutes(supabase, getBotById));
app.use('/api/mcp', agentMcpRoutes(supabase));

// ==========================================
// РОУТЫ НАСТРОЕК КАССЫ (Остались локально)
// ==========================================
app.post('/api/payment-settings', authenticateUser, async (req, res) => {
        const {
            sbp_phone,
            sbp_bank,
            sbp_fio,
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
        const legacyPayload = {
            owner_id: req.user.id,
            sbp_phone,
            sbp_bank: normalizeSbpBankSelection(sbp_bank),
            sbp_fio,
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

        let { data, error } = await supabase
            .from('payment_settings')
            .upsert(extendedPayload, { onConflict: 'owner_id' })
            .select('*')
            .single();

        if (error && (
            (error.message || '').includes('billing_') ||
            (error.message || '').includes('referral_')
        )) {
            const legacyResult = await supabase
                .from('payment_settings')
                .upsert(legacyPayload, { onConflict: 'owner_id' })
                .select('*')
                .single();
            error = legacyResult.error;
            data = legacyResult.data;
        }

        if (error) throw error;
        res.json({ success: true, settings: data || legacyPayload });
    } catch (err) {
        console.error('Ошибка сохранения настроек:', err.message);
        res.status(500).json({ error: 'Ошибка базы данных при сохранении' }); 
    }
});

app.get('/api/payment-settings', authenticateUser, async (req, res) => {
    try {
        const { data } = await supabase.from('payment_settings').select('*').eq('owner_id', req.user.id).single();
        res.json({ settings: data || {} });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// ЗАПУСК СЕРВЕРА И ФОНОВЫХ ЗАДАЧ
// ==========================================
const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
    console.log(`✅ Бэкенд запущен на порту ${PORT}`);
    console.log('[UserbotAutomation]', {
        manual_dm_enabled: envFlag('USERBOT_DM_ENABLED'),
        retention_dm_enabled: envFlag('USERBOT_RETENTION_DM_ENABLED'),
        auto_kick_dm_enabled: envFlag('USERBOT_AUTO_KICK_DM_ENABLED'),
        auto_kick_fallback_enabled: envFlag('USERBOT_AUTO_KICK_FALLBACK_ENABLED'),
        inbox_watch_enabled: envFlag('USERBOT_INBOX_WATCH_ENABLED'),
        broadcast_enabled: envFlag('USERBOT_BROADCAST_ENABLED'),
        restricted_userbot_auto_delete_enabled: String(process.env.RESTRICTED_USERBOT_AUTO_DELETE_ENABLED || 'true').trim().toLowerCase() !== 'false',
        restricted_userbot_delete_after_hours: Number(process.env.RESTRICTED_USERBOT_DELETE_AFTER_HOURS || 72),
        ton_reserve_watch_enabled: envFlag('TON_RESERVE_WATCH_ENABLED'),
        crypto_rates_enabled: String(process.env.CRYPTO_RATES_ENABLED || 'true').trim().toLowerCase() !== 'false',
        referral_settlement_retry_enabled: String(process.env.REFERRAL_SETTLEMENT_RETRY_ENABLED || 'true').trim().toLowerCase() !== 'false'
    });

    // Запускаем всех ботов из БД
    await initAllBots(supabase);

    // Запускаем фоновые задачи (Cron)
    startAutoKick(supabase, getBotById);
    startRetention(supabase, getBotById);
    startAbandonedCart(supabase, getBotById); // Наша новая фича работает!
    startUserbotInboxWatch(supabase, getBotById);
    startRestrictedUserbotCleanup(supabase);
    startTonReserveWatch(supabase);
    startCryptoRatesRefresh(supabase);
    startReferralSettlementRetry(supabase, getBotById);
});
