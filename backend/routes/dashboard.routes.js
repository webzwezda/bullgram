import express from 'express';
import { authenticateUser } from '../middlewares/auth.middleware.js';
import { loadDashboardData } from './dashboard/summary-loader.js';
import { buildDashboardMetrics } from './dashboard/metrics-builder.js';

export default function dashboardRoutes(supabase) {
    const router = express.Router();

    router.get('/', authenticateUser, async (req, res) => {
        try {
            const ownerId = req.user.id;
            const data = await loadDashboardData(supabase, ownerId);
            const metrics = buildDashboardMetrics(data, ownerId);
            const {
                accounts, channels, proxies, customerBases, paymentSettings,
                opsBots, salesBots, signalAdminConfigured, signalRoutingReady, proFulfillmentPending,
                activeSubscriptions, expiredButInside, paidNotJoined,
                workingProxies, brokenProxies, sharedProxies,
                userbots, listedUserbots, userbotsOnSharedProxy, userbotsWithDeadProxy,
                failoverEnabledUserbots, failoverEmptyPoolUserbots, recentFailovers,
                directUserbots, directUserbotOverflow, channelsWithoutBot, channelsWithBot,
                recentKicks, autoConfirmedPayments, manualConfirmedPayments,
                referralOutstandingRub, referralOutstandingTon, referralOutstandingUsdt, referralPartnersWithDebt,
                referralProfiles, referralRewardEvents, shopItems, publishedShopItems, pendingShopPayments, paidShopPurchases, shopPendingTransfers, shopTonRevenue,
                pendingInvoices, awaitingReceiptInvoices, trialPendingInvoices, remindedInvoices,
                mrrRub, mrrTon,
                recentInboxAlerts, recentTelegramErrorEvents, recentTelegramRestrictions,
                recentInboxAlertRows, recentTelegramErrorRows, channelStats,
                recentFailoverRows, sharedProxyRows, buyerPackageSignals
            } = { ...data, ...metrics };

            const urgentActions = [
                {
                    id: 'orders_access_pending',
                    title: 'Оплата есть, вход не подтвержден',
                    value: paidNotJoined.length,
                    tone: paidNotJoined.length > 0 ? 'danger' : 'ok',
                    href: '/paywall/orders',
                    hint: 'Это сигнал к проверке доступа: Telegram-вход мог не записаться, поэтому сначала сверяешь контур.'
                },
                {
                    id: 'dead_userbots',
                    title: 'Юзерботы на битом прокси',
                    value: userbotsWithDeadProxy.length,
                    tone: userbotsWithDeadProxy.length > 0 ? 'danger' : 'ok',
                    href: '/userbot/accounts',
                    hint: 'Эти аккаунты формально висят, но в бою будут только валиться. Сначала чини им прокси.'
                },
                {
                    id: 'failover_misconfigured',
                    title: 'Failover включен, но пула нет',
                    value: failoverEmptyPoolUserbots.length,
                    tone: failoverEmptyPoolUserbots.length > 0 ? 'warning' : 'ok',
                    href: '/userbot/accounts',
                    hint: 'Авто-переключение включили, а резервные прокси не выбрали. Значит при смерти основного прокси аккаунт все равно ляжет.'
                },
                {
                    id: 'shared_proxy_legacy',
                    title: 'На одном прокси сидит больше одного юзербота',
                    value: sharedProxies.length,
                    tone: sharedProxies.length > 0 ? 'danger' : 'ok',
                    href: '/userbot/proxies',
                    hint: sharedProxies.length > 0
                        ? 'Это старые опасные связки. Новые такие уже режутся, а эти надо разруливать руками.'
                        : 'Ок. Сейчас нет старых shared-proxy связок, которые могли бы класть пачку аккаунтов одним ударом.'
                },
                {
                    id: 'direct_userbot_overflow',
                    title: 'Лишние юзерботы без прокси',
                    value: directUserbotOverflow,
                    tone: directUserbotOverflow > 0 ? 'danger' : 'ok',
                    href: '/userbot/accounts',
                    hint: 'Без прокси можно держать только один direct-аккаунт. Остальным нужен живой прокси.'
                },
                {
                    id: 'ops_signal_setup',
                    title: 'Сигналы от юзерботов не собраны',
                    value: signalRoutingReady ? 0 : 1,
                    tone: signalRoutingReady ? 'ok' : 'warning',
                    href: signalAdminConfigured ? '/userbot/accounts' : '/paywall/payments',
                    hint: signalRoutingReady
                        ? 'Ops-бот есть, admin_tg_id указан, входящие от юзерботов должны прилетать.'
                        : signalAdminConfigured
                            ? 'admin_tg_id уже есть, но нет official-бота с ролью "Админ юзерботов".'
                            : 'Нет admin_tg_id. Даже если ops-бот есть, слать сигналы пока некуда.'
                },
                {
                    id: 'userbot_hot_inbox',
                    title: 'Горячие лички у юзерботов',
                    value: recentInboxAlerts.length,
                    tone: recentInboxAlerts.length > 0 ? 'warning' : 'ok',
                    href: '/userbot/accounts',
                    hint: recentInboxAlerts.length > 0
                        ? 'Ops-бот уже словил мутные входящие. Проверь, кому надо ответить, пока деньги не ушли.'
                        : 'За последние сутки ops-бот не пинговал новые горячие лички.'
                },
                {
                    id: 'telegram_restrictions',
                    title: 'Telegram ругался на аккаунты',
                    value: recentTelegramRestrictions.length,
                    tone: recentTelegramRestrictions.length > 0 ? 'danger' : (recentTelegramErrorEvents.length > 0 ? 'warning' : 'ok'),
                    href: '/userbot/accounts',
                    hint: recentTelegramRestrictions.length > 0
                        ? 'Есть свежие flood/restricted/privacy/session ошибки. Сначала разбери их, потом снова лезь в лички.'
                        : recentTelegramErrorEvents.length > 0
                            ? 'Свежие Telegram-ошибки есть, но без явных ограничений. Проверь журнал и не долби дальше вслепую.'
                            : 'За последние сутки Telegram не присылал новых ограничений по аккаунтам.'
                },
                {
                    id: 'expired_inside',
                    title: 'Сидят внутри без живой подписки',
                    value: expiredButInside.length,
                    tone: expiredButInside.length > 0 ? 'danger' : 'ok',
                    href: '/paywall/access',
                    hint: 'Вот тут прям течь по деньгам. Эти люди уже должны были вылететь или продлиться.'
                },
                {
                    id: 'unpaid_leads',
                    title: 'Теплые неоплаты',
                    value: pendingInvoices.length,
                    tone: pendingInvoices.length > 0 ? 'warning' : 'ok',
                    href: '/paywall/abandoned',
                    hint: 'Это быстрые деньги. Люди уже нажали тариф, но не добили оплату.'
                },
                {
                    id: 'referral_payouts',
                    title: 'Партнерам надо занести',
                    value: referralPartnersWithDebt,
                    tone: referralPartnersWithDebt > 0 ? 'warning' : 'ok',
                    href: '/paywall/referrals',
                    hint: 'Тут висит хвост по партнерке. Если не закрывать выплаты, нормальная органика быстро сдуется.'
                },
                {
                    id: 'shop_transfers',
                    title: 'Shop: права еще не переведены',
                    value: shopPendingTransfers,
                    tone: shopPendingTransfers > 0 ? 'warning' : 'ok',
                    href: '/paywall/billing?tab=purchases',
                    hint: 'Если деньги по shop уже есть, а актив не перешел, это надо разбирать сразу.'
                }
            ];

            res.json({
                success: true,
                summary: {
                    userbotCount: userbots.length,
                    userbotDeadProxyCount: userbotsWithDeadProxy.length,
                    userbotOnSharedProxyCount: userbotsOnSharedProxy.length,
                    userbotFailoverEnabledCount: failoverEnabledUserbots.length,
                    userbotFailoverMisconfiguredCount: failoverEmptyPoolUserbots.length,
                    recentFailoversCount: recentFailovers.length,
                    directUserbotCount: directUserbots.length,
                    directUserbotOverflow,
                    userbotListedInShopCount: listedUserbots.length,
                    botCount: (accounts || []).filter(account => account.account_type === 'bot').length,
                    salesBotCount: salesBots.length,
                    opsBotCount: opsBots.length,
                    signalRoutingReady,
                    signalAdminConfigured,
                    recentInboxAlerts: recentInboxAlerts.length,
                    recentTelegramErrors: recentTelegramErrorEvents.length,
                    recentTelegramRestrictions: recentTelegramRestrictions.length,
                    proxyCount: (proxies || []).length,
                    workingProxyCount: workingProxies.length,
                    brokenProxyCount: brokenProxies.length,
                    sharedProxyCount: sharedProxies.length,
                    channelCount: (channels || []).length,
                    channelWithBotCount: channelsWithBot.length,
                    channelWithoutBotCount: channelsWithoutBot.length,
                    customerBaseCount: (customerBases || []).length,
                    activeSubscribers: activeSubscriptions.length,
                    paidNotJoined: paidNotJoined.length,
                    expiredButInside: expiredButInside.length,
                    pendingInvoices: pendingInvoices.length,
                    awaitingReceiptInvoices: awaitingReceiptInvoices.length,
                    trialPendingInvoices: trialPendingInvoices.length,
                    remindedInvoices: remindedInvoices.length,
                    mrrRub: Number(mrrRub.toFixed(2)),
                    mrrTon: Number(mrrTon.toFixed(4)),
                    autoConfirmedPayments,
                    manualConfirmedPayments,
                    recentKicks,
                    referralPartners: (referralProfiles || []).length,
                    referralPaidConversions: (referralRewardEvents || []).length,
                    referralPartnersWithDebt,
                    referralOutstandingRub: Number(referralOutstandingRub.toFixed(2)),
                    referralOutstandingTon: Number(referralOutstandingTon.toFixed(4)),
                    referralOutstandingUsdt: Number(referralOutstandingUsdt.toFixed(4)),
                    shopItemCount: (shopItems || []).length,
                    proFulfillmentPending: Number(proFulfillmentPending || 0),
                    shopPublishedItemCount: publishedShopItems,
                    shopPendingPayments: pendingShopPayments,
                    shopPaidPurchases: paidShopPurchases,
                    shopPendingTransfers,
                    shopTonRevenue: Number(shopTonRevenue.toFixed(4))
                },
                paymentReadiness: {
                    hasSettings: !!paymentSettings,
                    hasTon: !!paymentSettings?.ton_wallet,
                    adminTgId: paymentSettings?.admin_tg_id ? String(paymentSettings.admin_tg_id) : '',
                    billingProvider: paymentSettings?.billing_provider || null,
                    billingMode: paymentSettings?.billing_mode || null
                },
                urgentActions,
                channelStats,
                recentInboxAlertRows,
                recentTelegramErrorRows,
                recentFailoverRows,
                sharedProxyRows,
                buyerPackageSignals
            });
        } catch (error) {
            console.error('Ошибка dashboard:', error);
            res.status(500).json({ error: 'Ошибка загрузки дашборда' });
        }
    });

    return router;
}
