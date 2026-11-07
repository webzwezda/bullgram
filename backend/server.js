// backend/server.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import http from 'http';
import { WebSocketServer } from 'ws';
import { randomUUID } from 'node:crypto';
import { pinoHttp } from 'pino-http';
import { requireTelegramApiCredentials } from './utils/telegram-api-credentials.js';
import { createClient } from '@supabase/supabase-js'; // ВОТ ТОТ САМЫЙ ПОТЕРЯННЫЙ ИМПОРТ!
import { logger, installConsoleShim } from './utils/logger.js';
import { optionalAuthenticateUser } from './middlewares/auth.middleware.js';
import clientLogRoutes from './routes/client-log.routes.js';

// Импортируем роуты
import userbotRoutes from './routes/userbot.routes.js';
import officialBotRoutes, { initAllBots, getBotById } from './routes/official-bot.routes.js';
import autopostRoutes from './routes/autopost.routes.js';
import { AutopostService } from './services/autopost.service.js';
import analyticsRoutes from './routes/analytics.routes.js'; // <-- НОВОЕ: Импорт роутов аналитики
import accessRoutes from './routes/access.routes.js';
import broadcastRoutes from './routes/broadcast.routes.js';
import broadcastPreparationRoutes from './routes/broadcast-preparation.routes.js';
import messagingRoutes from './routes/messaging.routes.js';
import { BroadcastPreparationService } from './services/broadcast-preparation.service.js';
import paymentRoutes from './routes/payment.routes.js';
import paymentSettingsRoutes from './routes/payment-settings.routes.js';
import billingRoutes from './routes/billing.routes.js';
import { publicBillingRoutes } from './routes/billing-public.routes.js';
import ordersRoutes from './routes/orders.routes.js';
import channelAudiencesRoutes from './routes/channel-audiences.routes.js';
import clientBasesRoutes from './routes/client-bases.routes.js';
import audienceRoutes from './routes/audience.routes.js';
import customersRoutes from './routes/customers.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import referralRoutes from './routes/referral.routes.js';
import shopRoutes from './routes/shop.routes.js';
import { invoicePublicRoutes } from './routes/invoice-public.routes.js';
import { accessRequestRoutes } from './routes/access-requests.routes.js';
import { publicInvoiceRoutes } from './routes/public-invoices.routes.js';
import telegramOauthRoutes from './routes/telegram-oauth.routes.js';
import agentMcpRoutes from './routes/agent-mcp.routes.js';
import projectAdminRoutes from './routes/project-admin.routes.js';
import integrationsRoutes from './routes/integrations.routes.js';
import userbotWebRoutes from './routes/userbot-web.routes.js';
import tonconnectRoutes from './routes/tonconnect.routes.js';
import profileRoutes from './routes/profile.routes.js';
import { buildExternalRouter } from './external/router.js';
import { UserbotService } from './services/userbot.service.js';
import { MtprotoBridgeService } from './services/mtproto-bridge.service.js';

// Импортируем фоновые задачи (Cron)
import { startAutoKick } from './jobs/auto-kick.job.js';
import { startRetention } from './jobs/retention.job.js';
import { startBotRightsMonitor } from './jobs/bot-rights-monitor.job.js';
import { startAbandonedCart } from './jobs/abandoned-cart.job.js';
import { startBrowseFollowup } from './jobs/browse-followup.job.js';
import { startAutopostScheduler } from './jobs/autopost-scheduler.job.js';
import { startAutopostStuckEditingRecovery } from './jobs/autopost-stuck-editing.job.js';
import { startAutopostChecklistEventsCleanup } from './jobs/autopost-checklist-events-cleanup.job.js';
import { startUserbotInboxWatch } from './jobs/userbot-inbox.job.js';
import { startRestrictedUserbotCleanup } from './jobs/restricted-userbot-cleanup.job.js';
import { startListedUserbotHealthCheck } from './jobs/listed-userbot-health.job.js';
import { startIntakeRestingCheck } from './jobs/intake-resting.job.js';
import { startSoldFilesPurge } from './jobs/sold-files-purge.job.js';
import { startAudienceSync } from './jobs/audience-sync.job.js';
import { startTelegramWebHealth } from './jobs/telegram-web-health.job.js';
import { startTonReserveWatch } from './jobs/ton-reserve-watch.job.js';
import { startCryptoRatesRefresh } from './jobs/crypto-rates.job.js';
import { startReferralSettlementRetry } from './jobs/referral-settlement-retry.job.js';
import { startReferralPayoutSender } from './jobs/referral-payout-sender.job.js';
import { startReferralPayoutConfirmation } from './jobs/referral-payout-confirmation.job.js';
import { startOfficialBotWebhookQueue } from './jobs/official-bot-webhook-queue.job.js';
import { startManagedProxyReconcile } from './jobs/managed-proxy-reconcile.job.js';
import { runProxyBootSweep } from './jobs/proxy-boot-sweep.job.js';
import { startInvoiceAutoDetect } from './jobs/invoice-auto-detect.job.js';
import { startPublicInvoicesCleanup } from './jobs/public-invoices-cleanup.job.js';
import { startBillingActivationRecovery } from './jobs/billing-activation-recovery.job.js';
import { startShopPurchaseExpiry } from './jobs/shop-purchase-expiry.job.js';
import { startBroadcastDeliveryJob } from './jobs/broadcast-delivery.job.js';
import { startBroadcastMembershipCleanupJob } from './jobs/broadcast-membership-cleanup.job.js';

// ==========================================
// ИНИЦИАЛИЗАЦИЯ SUPABASE
// ==========================================
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const publicAppOrigin = String(process.env.PUBLIC_APP_ORIGIN || 'https://bullgram.xyz').replace(/\/$/, '');
const corsOrigins = Array.from(new Set([
    publicAppOrigin,
    'http://localhost:8080'
]));

// ==========================================
// ИНИЦИАЛИЗАЦИЯ СЕРВИСОВ ДЛЯ TELEGRAM WEB
// ==========================================
// Project-wide UserbotService singleton. One instance per process — multiple
// instances would each maintain their own QR-session map, SpamBot cache, and
// GramJS connection pool. env — единственный источник API-кредов: без
// TG_API_ID/TG_API_HASH старт падает (волна 5.3, fallback api_id=4 удалён).
const { apiId, apiHash } = requireTelegramApiCredentials();
const userbotService = new UserbotService(supabase, apiId, apiHash);
export { userbotService };
const mtprotoBridgeService = new MtprotoBridgeService(supabase, userbotService);

function envFlag(name) {
    return String(process.env[name] || '').trim().toLowerCase() === 'true';
}

// ==========================================
// ГЛОБАЛЬНЫЙ ПЕРЕХВАТЧИК ОШИБОК + CONSOLE-SHIM
// ==========================================
// Shim ставим в entry-точке: весь легаси console.* (мигрируется поэтапно,
// BACKLOG §28 фаза 3) попадает в JSONL и проходит санитизацию секретов.
// Тесты импортируют модули напрямую — там console остаётся чистым.
installConsoleShim();

process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'Unhandled Rejection');
});
process.on('uncaughtException', (error) => {
    // Поведение «процесс не падает» сохранено (решение владельца — открытый
    // вопрос №2 в docs/plans/2026-11-05-logging-research.md).
    logger.fatal({ err: error }, '[FATAL] Uncaught Exception');
});

// ==========================================
// GRACEFUL SHUTDOWN
// ==========================================
import { stopAllAutopostBots } from './services/autopost/bot-lifecycle.js';

let shuttingDown = false;
async function gracefulShutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, '[Shutdown] Получен сигнал, корректно завершаем работу');
    try {
        stopAllAutopostBots();
        logger.info('[Shutdown] Autopost polling-боты остановлены');
    } catch (e) {
        logger.error({ err: e }, '[Shutdown] Ошибка остановки autopost-ботов');
    }
    // Даём Time Telegram-клиентам закрыться чисто
    setTimeout(() => process.exit(0), 1500);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ==========================================
// НАСТРОЙКА EXPRESS
// ==========================================
const app = express();
app.set('trust proxy', 1);

// HTTP-логирование: request-id на каждый запрос, успешные (<400) — silent.
// Политика уровней и форматы: docs/plans/2026-11-05-logging-research.md §5.
app.use(pinoHttp({
    logger,
    genReqId: (req, res) => {
        const incoming = req.headers['x-request-id'];
        const id = typeof incoming === 'string' && incoming.length > 0 && incoming.length <= 64
            ? incoming
            : randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
    },
    customLogLevel: (req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'silent';
    },
    serializers: {
        // id обязателен: без него строки request completed не коррелируют с
        // x-request-id ответа и с mcp_tool_log.request_id.
        req: (req) => ({ id: req.id, method: req.method, url: req.url })
    }
}));

app.use(express.json());
app.use(cors({ origin: corsOrigins }));
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// Приёмник клиентских ошибок SPA (публичный, rate-limit внутри роута):
// docs/plans/2026-11-05-logging-research.md §5.7.
app.use('/api/log', clientLogRoutes({ attachUser: optionalAuthenticateUser }));

// ==========================================
// HTTP + WEBSOCKET SERVER (для MTProto bridge)
// ==========================================
const httpServer = http.createServer(app);
const mtprotoBridgeWss = new WebSocketServer({
    server: httpServer,
    path: '/api/mtproto-bridge',
    maxPayload: 4 * 1024 * 1024
});
mtprotoBridgeWss.on('connection', (ws, req) => {
    mtprotoBridgeService.handleConnection(ws, req);
});
mtprotoBridgeService.start();

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
app.use('/api/autopost', autopostRoutes(supabase));
app.use('/api/analytics', analyticsRoutes(supabase)); // <-- НОВОЕ: Подключение роута аналитики
app.use('/api/access', accessRoutes(supabase));
app.use('/api/broadcast', broadcastRoutes(supabase));
app.use('/api/broadcast', broadcastPreparationRoutes(supabase));
app.use('/api/messaging', messagingRoutes(supabase));
app.use('/api/payment', paymentRoutes(supabase, getBotById));
app.use('/api/billing', billingRoutes(supabase));
app.use('/api/billing', publicBillingRoutes(supabase));
app.use('/api/access-requests', accessRequestRoutes(supabase));
app.use('/api/orders', ordersRoutes(supabase));
app.use('/api/channel-audiences', channelAudiencesRoutes(supabase));
app.use('/api/client-bases', clientBasesRoutes(supabase));
app.use('/api/audience', audienceRoutes(supabase));
app.use('/api/customers', customersRoutes(supabase));
app.use('/api/dashboard', dashboardRoutes(supabase));
app.use('/api/referrals', referralRoutes(supabase));
app.use('/api/shop', shopRoutes(supabase, { userbotService }));
app.use('/api/invoices', invoicePublicRoutes(supabase, getBotById));
app.use('/api/public-invoices', publicInvoiceRoutes(supabase));
app.use('/api/public/telegram-oidc', telegramOauthRoutes());
app.use('/api/mcp', agentMcpRoutes(supabase, userbotService));
app.use('/api/external/v1', buildExternalRouter({ supabase, userbotService }));
app.use('/api/integrations', integrationsRoutes(supabase));
app.use('/api/project-admin', projectAdminRoutes(supabase));
app.use('/api/userbot-web', userbotWebRoutes(supabase, mtprotoBridgeService));
app.use('/api/profile', profileRoutes(supabase));
app.use(tonconnectRoutes());

// ==========================================
// РОУТЫ НАСТРОЕК КАССЫ (вынесены в routes/payment-settings.routes.js)
// ==========================================
app.use('/api/payment-settings', paymentSettingsRoutes(supabase, authenticateUser, logger));

// ==========================================
// ЗАПУСК СЕРВЕРА И ФОНОВЫХ ЗАДАЧ
// ==========================================
const PORT = process.env.PORT || 3000;

httpServer.listen(PORT, async () => {
    logger.info({ port: PORT }, '✅ Бэкенд запущен');
    logger.info({
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
        referral_settlement_retry_enabled: String(process.env.REFERRAL_SETTLEMENT_RETRY_ENABLED || 'true').trim().toLowerCase() !== 'false',
        referral_payout_sender_enabled: envFlag('REFERRAL_PAYOUT_SENDER_ENABLED'),
        referral_payout_confirmation_enabled: String(process.env.REFERRAL_PAYOUT_CONFIRMATION_ENABLED || 'true').trim().toLowerCase() !== 'false',
        managed_proxy_reconcile_enabled: String(process.env.MANAGED_PROXY_RECONCILE_ENABLED || 'true').trim().toLowerCase() !== 'false',
        billing_activation_recovery_enabled: String(process.env.BILLING_ACTIVATION_RECOVERY_ENABLED || 'true').trim().toLowerCase() !== 'false'
    }, '[UserbotAutomation] флаги');

    // Запускаем всех ботов из БД
    await initAllBots(supabase);

    // Запускаем фоновые задачи (Cron)
    startAutoKick(supabase, getBotById);
    startRetention(supabase, getBotById);
    startBotRightsMonitor(supabase);
    startAbandonedCart(supabase, getBotById);
    startBrowseFollowup(supabase, getBotById);
    const autopostService = new AutopostService(supabase);
    startAutopostScheduler(supabase, (botId) => autopostService.getBot(botId), autopostService);
    startAutopostStuckEditingRecovery(supabase, autopostService);
    // Ретеншен ленты событий чек-листов (план: docs/plans/2026-09-17-autopost-checklists.md)
    startAutopostChecklistEventsCleanup(supabase);
    // Запускаем все активные autopost-боты
    try {
        const { data: autopostBots } = await supabase.from('autopost_bots').select('*').eq('is_active', true);
        for (const ab of autopostBots || []) {
            autopostService.startBot(ab.id, ab.bot_token);
        }
    } catch (e) { logger.error({ err: e }, '[Autopost] Ошибка запуска ботов'); }
    startUserbotInboxWatch(supabase, getBotById);
    startRestrictedUserbotCleanup(supabase);
    startListedUserbotHealthCheck(supabase, { userbotService });
    // Отстой свежепринятых пачек аккаунтов (intake): первый живой контакт,
    // identity + health для pending_activation-аккаунтов платформенных админов.
    startIntakeRestingCheck(supabase, { userbotService });
    // Пурж проданных «в файлы» аккаунтов после окна выдачи (account shop).
    startSoldFilesPurge(supabase);
    startAudienceSync(supabase);
    const broadcastPreparationService = new BroadcastPreparationService(supabase);
    // сначала перепроверяем прокси (после ребута сервера они могли лежать), потом возобновляем зависшие подготовки
    runProxyBootSweep(supabase)
        .then(() => broadcastPreparationService.resumeStuckPreparations())
        .catch(err => {
            logger.error({ err }, '[ProxyBootSweep] failed');
            broadcastPreparationService.resumeStuckPreparations().catch(resumeErr => {
                logger.error({ err: resumeErr }, '[BroadcastPreparation] resume failed');
            });
        });
    startTelegramWebHealth(supabase);
    startTonReserveWatch(supabase);
    startCryptoRatesRefresh(supabase);
    startReferralSettlementRetry(supabase, getBotById);
    startReferralPayoutSender(supabase);
    startReferralPayoutConfirmation(supabase);
    startOfficialBotWebhookQueue(supabase);
    startManagedProxyReconcile(supabase);
    startInvoiceAutoDetect(supabase, getBotById);
    startPublicInvoicesCleanup(supabase);
    startBillingActivationRecovery(supabase);
    startShopPurchaseExpiry(supabase);
    // Доставка массовых рассылок вынесена из POST /send в фоновую джобу (mark-and-queue)
    startBroadcastDeliveryJob(supabase, getBotById);
    // Выход юзерботов из групп после успешной рассылки (галочка «выйти по окончанию»)
    startBroadcastMembershipCleanupJob(supabase);
});
