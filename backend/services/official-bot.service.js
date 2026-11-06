import { Telegraf } from 'telegraf';
import { createMenuBuilders } from './official-bot/shared/menu-builders.js';
import { registerAllHandlers } from './official-bot/handlers/handler-registry.js';
import { getTariffBundleItems, upsertSubscriptionForChannel } from './official-bot/subscriptions.js';
import {
    buildTelegramTargets,
    escapeHtml,
    formatResourceLine,
    getTariffDisplayTitle,
    buildTariffPaymentGroups,
    formatDiscountedAmount,
    formatTariffPaymentOptions,
    getTariffGroupIcon,
    getTariffCategory
} from './official-bot/tariff-format.js';
import {
    logAccessEvent,
    logPaymentEvent,
    logCustomerFunnelEvent,
    buildCustomerFunnelSessionKey
} from './official-bot/bot-events.js';
import {
    createAccessInvite,
    findLatestAccessInvite,
    issueDirectChannelAccess,
    createGiftAccessCode,
    redeemGiftAccessCode,
    getBotOwner,
    getChannelByChatId,
    hasActiveSubscription
} from './official-bot/access-gifts.js';
import {
    notifyReferralPayoutStatus,
    notifyReferralReserveDeposit,
    notifyReferralReserveRefund,
    notifyReferralReserveStatus
} from './official-bot/referral-notify.js';
import {
    getBotAdminContext,
    buildAdminOwnershipHint,
    getUserRole
} from './official-bot/bot-admin-context.js';
import {
    getReferralSettings,
    ensureReferralProfile,
    getReferralProfile,
    getReferralPayoutMethod,
    getPendingReferralPayout,
    registerReferralLead,
    getReferralSnapshot,
    getActiveReferralAttribution,
    getBrowseFollowupDiscount
} from './official-bot/referral-profiles.js';
import {
    saveReferralPayoutWallet,
    requestReferralPartnerPayout,
    processReferralReward
} from './official-bot/referral-rewards.js';

const activeBots = new Map();

/**
 * Сервис для работы с официальными ботами (Telegraf)
 *
 * Разрезан под pre-commit лимит: форматтеры — official-bot/tariff-format.js,
 * подписки — subscriptions.js, события — bot-events.js, доступ/гифты — access-gifts.js,
 * notify* — referral-notify.js, админ-контекст — bot-admin-context.js,
 * профили партнерки — referral-profiles.js, выплаты/награды — referral-rewards.js.
 * Здесь остаются lifecycle (activeBots, start/stop), activateSubscription
 * и делегаты публичных методов с прежними сигнатурами.
 */
export class OfficialBotService {
    constructor(supabase) {
        this.supabase = supabase;
    }

    // --- тарифы/меню/оплаты (тела в official-bot/tariff-format.js) ---

    getTariffDisplayTitle(tariff) { return getTariffDisplayTitle(tariff); }

    buildTariffPaymentGroups(tariffs) { return buildTariffPaymentGroups(tariffs); }

    formatDiscountedAmount(amount, currency, discountPercent) { return formatDiscountedAmount(amount, currency, discountPercent); }

    formatTariffPaymentOptions(variants, discountPercent) { return formatTariffPaymentOptions(variants, discountPercent); }

    getTariffGroupIcon() { return getTariffGroupIcon(); }

    getTariffCategory(tariff) { return getTariffCategory(tariff); }

    // --- события бота (тела в official-bot/bot-events.js) ---

    async logAccessEvent(options) { return logAccessEvent(this.supabase, options); }

    async logPaymentEvent(options) { return logPaymentEvent(this.supabase, options); }

    async logCustomerFunnelEvent(options) { return logCustomerFunnelEvent(this.supabase, options); }

    buildCustomerFunnelSessionKey(options) { return buildCustomerFunnelSessionKey(options); }

    // --- доступ/гифты (тела в official-bot/access-gifts.js) ---

    async findLatestAccessInvite(channelId, tgUserId) { return findLatestAccessInvite(this.supabase, channelId, tgUserId); }

    async issueDirectChannelAccess(options) { return issueDirectChannelAccess(this.supabase, options); }

    async createGiftAccessCode(options) { return createGiftAccessCode(this.supabase, options); }

    async redeemGiftAccessCode(options) { return redeemGiftAccessCode(this.supabase, options); }

    async getBotOwner(botId) { return getBotOwner(this.supabase, botId); }

    async getChannelByChatId(chatId, botId = null) { return getChannelByChatId(this.supabase, chatId, botId); }

    async hasActiveSubscription(tgUserId, channelId) { return hasActiveSubscription(this.supabase, tgUserId, channelId); }

    // --- notify* партнерки (тела в official-bot/referral-notify.js; activeBots общая с lifecycle) ---

    async notifyReferralPayoutStatus(ownerId, payout, status, meta = {}) { return notifyReferralPayoutStatus(activeBots, this.supabase, ownerId, payout, status, meta); }

    async notifyReferralReserveDeposit(ownerId, depositResult) { return notifyReferralReserveDeposit(activeBots, this.supabase, ownerId, depositResult); }

    async notifyReferralReserveRefund(ownerId, refund, status) { return notifyReferralReserveRefund(activeBots, this.supabase, ownerId, refund, status); }

    async notifyReferralReserveStatus(ownerId, reserveAccount, previousStatus = null) { return notifyReferralReserveStatus(activeBots, this.supabase, ownerId, reserveAccount, previousStatus); }

    // --- админ-контекст (тела в official-bot/bot-admin-context.js) ---

    async getBotAdminContext(botId, ownerIdFallback = null) { return getBotAdminContext(this.supabase, botId, ownerIdFallback); }

    buildAdminOwnershipHint(context, role = 'sales') { return buildAdminOwnershipHint(context, role); }

    async getUserRole(ctx, botId) { return getUserRole(this.supabase, ctx, botId); }

    // --- профили/лиды партнерки (тела в official-bot/referral-profiles.js) ---

    async getReferralSettings(ownerId) { return getReferralSettings(this.supabase, ownerId); }

    async ensureReferralProfile(ownerId, tgUserId, username = null, displayName = null) { return ensureReferralProfile(this.supabase, ownerId, tgUserId, username, displayName); }

    async getReferralProfile(ownerId, tgUserId) { return getReferralProfile(this.supabase, ownerId, tgUserId); }

    async getReferralPayoutMethod(ownerId, tgUserId) { return getReferralPayoutMethod(this.supabase, ownerId, tgUserId); }

    async getPendingReferralPayout(ownerId, tgUserId) { return getPendingReferralPayout(this.supabase, ownerId, tgUserId); }

    async registerReferralLead(options) { return registerReferralLead(activeBots, this.supabase, options); }

    async getReferralSnapshot(ownerId, tgUserId) { return getReferralSnapshot(this.supabase, ownerId, tgUserId); }

    async getActiveReferralAttribution(ownerId, tgUserId) { return getActiveReferralAttribution(this.supabase, ownerId, tgUserId); }

    async getBrowseFollowupDiscount(ownerId, tgUserId) { return getBrowseFollowupDiscount(this.supabase, ownerId, tgUserId); }

    // --- выплаты/награды партнерки (тела в official-bot/referral-rewards.js) ---

    async saveReferralPayoutWallet(ownerId, tgUserId, tonWallet) { return saveReferralPayoutWallet(this.supabase, ownerId, tgUserId, tonWallet); }

    async requestReferralPartnerPayout(ownerId, tgUserId) { return requestReferralPartnerPayout(activeBots, this.supabase, ownerId, tgUserId); }

    async processReferralReward(bot, invoice, tariff, ownerId) { return processReferralReward(activeBots, this.supabase, bot, invoice, tariff, ownerId); }

    /**
     * Регистрация handlers для официального бота (общий код для polling и webhook)
     */
    registerHandlers(bot, botId, username, role = 'sales') {
        const normalizedRole = role === 'ops' ? 'ops' : 'sales';
        this._normalizedRole = normalizedRole;
        const { sendAdminMenu, sendUserMainMenu, sendMainMenu, createInvoiceForTariff } = createMenuBuilders({ service: this, botId });

        const regCtx = { service: this, botId, username, sendMainMenu, sendUserMainMenu, sendAdminMenu, createInvoiceForTariff };
        registerAllHandlers(bot, regCtx);
    }


    /**
     * Запуск официального бота (polling)
     */
    startBot(botId, token, username, role = 'sales') {
        if (activeBots.has(botId)) return;

        const bot = new Telegraf(token);
        this.registerHandlers(bot, botId, username, role);
        // Telegraf launch() резолвится только на graceful shutdown и реджектится
        // при падении polling. set в .then никогда бы не вызвался во время работы
        // бота — поэтому добавляем синхронно, а .then/.catch удаляют из Map.
        activeBots.set(botId, bot);
        console.log(`🤖 Бот @${username} запускается (polling)`);
        bot.launch()
            .then(() => {
                activeBots.delete(botId);
                console.log(`🤖 Бот @${username} остановлен (polling)`);
            })
            .catch(err => {
                activeBots.delete(botId);
                console.error(`🤖 Launch @${username} не удался:`, err.message);
            });
    }

    /**
     * Запуск официального бота (webhook) — без polling, готов к handleUpdate()
     */
    startWebhookBot(botId, token, username, role = 'sales') {
        if (activeBots.has(botId)) return;

        const bot = new Telegraf(token);
        this.registerHandlers(bot, botId, username, role);
        activeBots.set(botId, bot);
        console.log(`🤖 Бот @${username} готов к webhook-обработке!`);
    }

    /**
     * Активация подписки
     */
    async activateSubscription(bot, invoice) {
        try {
            const { data: tariff } = await this.supabase.from('tariffs').select('*').eq('id', invoice.tariff_id).single();
            let primaryChannel = null;
            if (tariff.channel_id) {
                const { data } = await this.supabase.from('channels').select('*').eq('id', tariff.channel_id).single();
                primaryChannel = data || null;
            }
            const ownerId = primaryChannel?.owner_id || tariff.owner_id;
            const bundleItems = await getTariffBundleItems(this.supabase, tariff, ownerId);

            const channelTargets = bundleItems
                .filter(item => item.item_type === 'channel' && item.channels)
                .map(item => item.channels);

            const resourceTargets = bundleItems
                .filter(item => item.item_type === 'resource')
                .map(item => ({
                    title: item.resource_title,
                    url: item.resource_url
                }));

            const telegramTargets = buildTelegramTargets(primaryChannel, channelTargets);
            const inviteLinks = [];
            let finalExpiresAt = null;

            for (const channel of telegramTargets) {
                const { subscriptionId, expiresAt } = await upsertSubscriptionForChannel(
                    this.supabase, invoice.tg_user_id, channel.id, tariff.duration_days
                );

                if (!finalExpiresAt) {
                    finalExpiresAt = expiresAt;
                }

                const inviteName = `Sub_${invoice.tg_user_id}_${new Date().toISOString().split('T')[0]}_${channel.id.slice(0, 6)}`;
                const inviteLink = await bot.telegram.createChatInviteLink(channel.tg_chat_id, {
                    creates_join_request: true,
                    name: inviteName
                });

                const accessInvite = await createAccessInvite(this.supabase, {
                    ownerId,
                    channelId: channel.id,
                    tariffId: tariff.id,
                    invoiceId: invoice.id,
                    subscriptionId,
                    tgUserId: invoice.tg_user_id,
                    inviteLink: inviteLink.invite_link,
                    inviteName
                });

                await this.logAccessEvent({
                    ownerId,
                    channelId: channel.id,
                    inviteId: accessInvite?.id || null,
                    subscriptionId,
                    invoiceId: invoice.id,
                    tgUserId: invoice.tg_user_id,
                    eventType: 'invite_issued',
                    eventSource: 'official_bot',
                    payload: {
                        tariff_title: tariff.title,
                        expires_at: expiresAt,
                        bundle_size: telegramTargets.length
                    }
                });

                await this.supabase
                    .from('subscriptions')
                    .update({
                        last_access_event: 'invite_issued',
                        access_note: telegramTargets.length > 1
                            ? 'Выдан пакет ссылок с join request'
                            : 'Выдана ссылка с join request'
                    })
                    .eq('id', subscriptionId);

                inviteLinks.push({
                    title: channel.title,
                    url: inviteLink.invite_link
                });
            }

            const expText = telegramTargets.length === 0
                ? `Материалы: <b>отправлены</b>`
                : finalExpiresAt
                    ? `Продлен до: <b>${new Date(finalExpiresAt).toLocaleDateString('ru-RU')}</b>`
                    : `Доступ: <b>Навсегда</b>`;

            const accessLines = inviteLinks
                .map((item, index) => `${index + 1}. <b>${item.title}</b>\n👉 ${item.url}`)
                .join('\n\n') || 'Telegram-доступ в этом тарифе не включен.';

            const resourceLines = resourceTargets.length > 0
                ? `\n\n<b>Доп. материалы:</b>\n${resourceTargets.map((item, index) => formatResourceLine(item, index)).join('\n\n')}`
                : '';
            const deliveryNote = telegramTargets.length > 0
                ? '\n\nВсе ссылки работают через запрос на вступление. Бот пропустит только аккаунт с активной подпиской.'
                : '';

            await bot.telegram.sendMessage(
                invoice.tg_user_id,
                `🎉 <b>Оплата успешно подтверждена!</b>\n\nТариф: «${this.getTariffDisplayTitle(tariff)}»\n⏳ ${expText}\n\n<b>Что ты получил:</b>\n${accessLines}${resourceLines}${deliveryNote}`,
                { parse_mode: 'HTML', disable_web_page_preview: true }
            );

            await this.processReferralReward(bot, invoice, tariff, ownerId);

            if (tariff.is_trial && tariff.upsell_tariff_id) {
                const { data: upsellTariff } = await this.supabase
                    .from('tariffs')
                    .select('id, title, price, currency, duration_days')
                    .eq('id', tariff.upsell_tariff_id)
                    .single();

                if (upsellTariff) {
                    const upsellDuration = Number(upsellTariff.duration_days) > 0
                        ? `${upsellTariff.duration_days} дней`
                        : 'без срока';

                    await bot.telegram.sendMessage(
                        invoice.tg_user_id,
                        `🔥 <b>Что дальше</b>\n\nТы сейчас зашел через пробник. Если захочешь остаться надолго, следующий шаг уже готов:\n\n<b>${escapeHtml(upsellTariff.title)}</b>\n💰 ${upsellTariff.price} ${upsellTariff.currency}\n⏳ ${upsellDuration}\n\nНапиши /start и выбери основной тариф, когда будешь готов зайти плотнее.`,
                        { parse_mode: 'HTML' }
                    );
                }
            }
        } catch (error) { console.error('Ошибка при активации подписки:', error); }
    }

    /**
     * Проверка TON платежа
     */
    async checkTonPayment(memo, expectedAmount, wallet) {
        try {
            const response = await fetch(`https://tonapi.io/v2/blockchain/accounts/${wallet}/transactions?limit=30`);
            const data = await response.json();
            if (!data.transactions) return false;

            for (const tx of data.transactions) {
                if (tx.in_msg && tx.in_msg.decoded_body && tx.in_msg.decoded_body.text === memo) {
                    const paidNanoTon = parseInt(tx.in_msg.value);
                    const expectedNanoTon = expectedAmount * 1000000000;
                    if (paidNanoTon >= expectedNanoTon) return true;
                }
            }
            return false;
        } catch (error) { return false; }
    }

    /**
     * Получить активного бота по ID
     */
    getBot(botId) {
        return activeBots.get(botId);
    }

    stopBot(botId) {
        const bot = activeBots.get(botId);
        if (!bot) return;
        try {
            bot.stop('SIGTERM');
        } catch (error) {
            console.error(`Не удалось остановить бота ${botId}:`, error.message);
        }
        activeBots.delete(botId);
    }

    /**
     * Остановить всех ботов
     */
    stopAll() {
        activeBots.forEach(bot => bot.stop('SIGTERM'));
    }
}
