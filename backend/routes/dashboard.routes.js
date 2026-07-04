import express from 'express';
import { authenticateUser } from '../middlewares/auth.middleware.js';
import { loadReservedUserbotIds } from '../utils/shop-reservations.js';

function sumAmounts(invoices = [], currency) {
    return invoices
        .filter(invoice => invoice.currency === currency)
        .reduce((total, invoice) => total + Number(invoice.amount || 0), 0);
}

function normalizeOfferCode(value) {
    return String(value || '').trim().toLowerCase();
}

function packageCheckoutSignals(purchases = []) {
    const signals = [];
    const textOfferPurchases = purchases.filter(purchase => purchase.item_type === 'text_offer');

    const buildSignal = (code, title, href) => {
        const related = textOfferPurchases.filter(purchase => normalizeOfferCode(purchase.offer_code) === code);
        if (!related.length) return null;

        const failed = related.find(purchase => purchase.ownership_transfer_status === 'failed');
        if (failed) {
            return {
                id: code,
                title,
                status: 'failed',
                tone: 'danger',
                href,
                hint: 'Оплата уже прошла, но передача прав сломалась. Не покупай заново, сначала добей handoff.'
            };
        }

        const awaitingReceipt = related.find(purchase => purchase.status === 'awaiting_receipt');
        if (awaitingReceipt) {
            return {
                id: code,
                title,
                status: 'awaiting_receipt',
                tone: 'warning',
                href,
                hint: 'Покупка ждет ручного подтверждения продавцом. Следующий шаг — не новый checkout, а добить этот.'
            };
        }

        const pending = related.find(purchase => purchase.status === 'pending');
        if (pending) {
            return {
                id: code,
                title,
                status: 'pending',
                tone: 'warning',
                href,
                hint: 'Checkout уже открыт и ждет оплату. Сначала закрой его, а потом двигайся дальше.'
            };
        }

        const paid = related.find(purchase => purchase.status === 'paid');
        if (paid) {
            return {
                id: code,
                title,
                status: 'paid',
                tone: 'ok',
                href,
                hint: 'Покупка уже закрыта. Дальше нужно использовать unlock в кабинете, а не открывать новый checkout.'
            };
        }

        const expired = related.find(purchase => purchase.status === 'expired' || purchase.status === 'rejected');
        if (expired) {
            return {
                id: code,
                title,
                status: 'expired',
                tone: 'default',
                href,
                hint: 'Раньше тут был checkout, но он протух или был отклонен. Если сценарий еще нужен, его надо перезапустить.'
            };
        }

        return null;
    };

    const trialSignal = buildSignal('trial', 'Trial checkout', '/shop?offer=trial');
    const normalSignal = buildSignal('normal', 'Normal checkout', '/billing/normal');
    const sellerSignal = buildSignal('seller', 'Seller checkout', '/shop?offer=seller');

    if (trialSignal) signals.push(trialSignal);
    if (normalSignal) signals.push(normalSignal);
    if (sellerSignal) signals.push(sellerSignal);

    return signals;
}

export default function dashboardRoutes(supabase) {
    const router = express.Router();

    router.get('/', authenticateUser, async (req, res) => {
        try {
            const ownerId = req.user.id;
            const reservedUserbotIds = await loadReservedUserbotIds(supabase, ownerId);

            const [{ data: accounts, error: accountsError }, { data: channels, error: channelsError }, { data: proxies, error: proxiesError }, { data: customerBases, error: customerBasesError }, { data: paymentSettings, error: paymentSettingsError }] = await Promise.all([
                supabase
                    .from('tg_accounts')
                    .select('id, account_type, proxy_id, bot_role, tg_username, tg_account_id, allow_proxy_failover, failover_proxy_ids, last_failover_at, last_failover_from_proxy_id')
                    .eq('owner_id', ownerId),
                supabase
                    .from('channels')
                    .select('id, title, bot_id, tg_chat_id')
                    .eq('owner_id', ownerId),
                supabase
                    .from('proxies')
                    .select('id, name, host, port, last_check_country, is_working, last_checked_at, last_check_error')
                    .eq('owner_id', ownerId),
                supabase
                    .from('customer_bases')
                    .select('id')
                    .eq('owner_id', ownerId),
                supabase
                    .from('payment_settings')
                    .select('id, ton_wallet, billing_provider, billing_mode, admin_tg_id')
                    .eq('owner_id', ownerId)
                    .maybeSingle()
            ]);

            if (accountsError) throw accountsError;
            if (channelsError) throw channelsError;
            if (proxiesError) throw proxiesError;
            if (customerBasesError && !(customerBasesError.message || '').includes('customer_bases')) throw customerBasesError;
            if (paymentSettingsError && !(paymentSettingsError.message || '').includes('payment_settings')) throw paymentSettingsError;

            const channelIds = (channels || []).map(channel => channel.id);
            const botIds = new Set((accounts || []).filter(account => account.account_type === 'bot').map(account => account.id));
            const opsBots = (accounts || []).filter(account => account.account_type === 'bot' && (account.bot_role || 'sales') === 'ops');
            const salesBots = (accounts || []).filter(account => account.account_type === 'bot' && (account.bot_role || 'sales') !== 'ops');
            const signalAdminConfigured = !!paymentSettings?.admin_tg_id;
            const signalRoutingReady = signalAdminConfigured && opsBots.length > 0;
            const monthAgo = new Date();
            monthAgo.setDate(monthAgo.getDate() - 30);

            const [{ data: subscriptions, error: subscriptionsError }, { data: invoices, error: invoicesError }, { data: accessEvents, error: accessEventsError }, { data: paymentEvents, error: paymentEventsError }, { data: referralProfiles, error: referralProfilesError }, { data: referralRewardEvents, error: referralRewardEventsError }, { data: shopItems, error: shopItemsError }, { data: shopPurchases, error: shopPurchasesError }, { data: buyerShopPurchases, error: buyerShopPurchasesError }, { data: inboxNotifications, error: inboxNotificationsError }, { data: telegramErrorEvents, error: telegramErrorEventsError }] = await Promise.all([
                channelIds.length > 0
                    ? supabase
                        .from('subscriptions')
                        .select('id, channel_id, tg_user_id, status, expires_at, last_join_approved_at, last_access_event, created_at')
                        .in('channel_id', channelIds)
                    : Promise.resolve({ data: [], error: null }),
                supabase
                    .from('invoices')
                    .select('id, tg_user_id, amount, currency, status, reminded, created_at, tariffs(owner_id, channel_id, title, is_trial)')
                    .order('created_at', { ascending: false })
                    .limit(300),
                supabase
                    .from('access_events')
                    .select('id, channel_id, tg_user_id, event_type, created_at')
                    .eq('owner_id', ownerId)
                    .order('created_at', { ascending: false })
                    .limit(200),
                supabase
                    .from('payment_events')
                    .select('id, event_type, created_at')
                    .eq('owner_id', ownerId)
                    .order('created_at', { ascending: false })
                    .limit(200),
                supabase
                    .from('referral_profiles')
                    .select('id, balance_rub, balance_ton, balance_usdt')
                    .eq('owner_id', ownerId),
                supabase
                    .from('referral_events')
                    .select('id')
                    .eq('owner_id', ownerId)
                    .eq('event_type', 'reward_granted'),
                supabase
                    .from('shop_items')
                    .select('id, status')
                    .eq('owner_id', ownerId),
                supabase
                    .from('shop_purchases')
                    .select('id, status, amount_ton, ownership_transfer_status')
                    .eq('seller_owner_id', ownerId),
                supabase
                    .from('shop_purchases')
                    .select('id, status, ownership_transfer_status, shop_items(item_type, offer_code, title)')
                    .eq('buyer_owner_id', ownerId)
                    .order('created_at', { ascending: false })
                    .limit(100),
                supabase
                    .from('userbot_inbox_notifications')
                    .select('id, userbot_id, dialog_tg_user_id, notified_at, preview_text')
                    .eq('owner_id', ownerId)
                    .order('notified_at', { ascending: false })
                    .limit(300)
                ,
                supabase
                    .from('telegram_error_events')
                    .select('id, userbot_id, tg_user_id, event_source, event_type, severity, restriction_kind, is_restriction, error_message, happened_at')
                    .eq('owner_id', ownerId)
                    .order('happened_at', { ascending: false })
                    .limit(300)
            ]);

            if (subscriptionsError) throw subscriptionsError;
            if (invoicesError) throw invoicesError;
            if (accessEventsError && !(accessEventsError.message || '').includes('access_events')) throw accessEventsError;
            if (paymentEventsError && !(paymentEventsError.message || '').includes('payment_events')) throw paymentEventsError;
            if (referralProfilesError && !(referralProfilesError.message || '').includes('referral_profiles')) throw referralProfilesError;
            if (referralRewardEventsError && !(referralRewardEventsError.message || '').includes('referral_events')) throw referralRewardEventsError;
            if (shopItemsError && !(shopItemsError.message || '').includes('shop_items')) throw shopItemsError;
            if (shopPurchasesError && !(shopPurchasesError.message || '').includes('shop_purchases')) throw shopPurchasesError;
            if (buyerShopPurchasesError && !(buyerShopPurchasesError.message || '').includes('shop_purchases')) throw buyerShopPurchasesError;
            if (inboxNotificationsError && !(inboxNotificationsError.message || '').includes('userbot_inbox_notifications')) throw inboxNotificationsError;
            if (telegramErrorEventsError && !(telegramErrorEventsError.message || '').includes('telegram_error_events')) throw telegramErrorEventsError;

            const ownInvoices = (invoices || []).filter(invoice => invoice.tariffs?.owner_id === ownerId);
            const activeSubscriptions = (subscriptions || []).filter(sub => sub.status === 'active');
            const expiredButInside = (subscriptions || []).filter(sub => sub.status === 'expired' && sub.last_join_approved_at);
            const paidNotJoined = (subscriptions || []).filter(sub => sub.status === 'active' && !sub.last_join_approved_at);
            const proxyMap = Object.fromEntries((proxies || []).map(proxy => [String(proxy.id), proxy]));
            const workingProxies = (proxies || []).filter(proxy => proxy.is_working);
            const brokenProxies = (proxies || []).filter(proxy => proxy.is_working === false);
            const brokenProxyIds = new Set(brokenProxies.map(proxy => String(proxy.id)));
            const allUserbots = (accounts || []).filter(account => account.account_type === 'userbot');
            const userbots = allUserbots.filter(account => !reservedUserbotIds.has(String(account.id)));
            const listedUserbots = allUserbots.filter(account => reservedUserbotIds.has(String(account.id)));
            const userbotsByProxy = allUserbots.reduce((map, account) => {
                if (!account.proxy_id) return map;
                const key = String(account.proxy_id);
                if (!map.has(key)) map.set(key, []);
                map.get(key).push(account);
                return map;
            }, new Map());
            const sharedProxyIds = new Set(
                Array.from(userbotsByProxy.entries())
                    .filter(([, linkedUserbots]) => linkedUserbots.length > 1)
                    .map(([proxyId]) => proxyId)
            );
            const sharedProxies = (proxies || []).filter(proxy => sharedProxyIds.has(String(proxy.id)));
            const userbotsOnSharedProxy = allUserbots.filter(account => account.proxy_id && sharedProxyIds.has(String(account.proxy_id)));
            const userbotsWithDeadProxy = userbots.filter(account => account.proxy_id && brokenProxyIds.has(String(account.proxy_id)));
            const failoverEnabledUserbots = userbots.filter(account => account.allow_proxy_failover);
            const failoverEmptyPoolUserbots = failoverEnabledUserbots.filter(account => {
                const pool = Array.isArray(account.failover_proxy_ids) ? account.failover_proxy_ids : [];
                return pool.length === 0;
            });
            const failoverDayAgo = new Date();
            failoverDayAgo.setDate(failoverDayAgo.getDate() - 1);
            const recentFailovers = failoverEnabledUserbots.filter(account => account.last_failover_at && new Date(account.last_failover_at) >= failoverDayAgo);
            const recentFailoverRows = recentFailovers
                .sort((a, b) => new Date(b.last_failover_at) - new Date(a.last_failover_at))
                .slice(0, 8)
                .map(account => {
                    const currentProxy = account.proxy_id ? proxyMap[String(account.proxy_id)] : null;
                    const previousProxy = account.last_failover_from_proxy_id ? proxyMap[String(account.last_failover_from_proxy_id)] : null;
                    return {
                        userbot_id: account.id,
                        userbot_label: account.tg_username ? '@' + account.tg_username : `ID ${account.tg_account_id}`,
                        from_proxy_label: previousProxy
                            ? `${previousProxy.name} (${previousProxy.host}:${previousProxy.port})`
                            : 'Неизвестный прокси',
                        to_proxy_label: currentProxy
                            ? `${currentProxy.name} (${currentProxy.host}:${currentProxy.port})`
                            : 'Сейчас без прокси',
                        to_proxy_country: currentProxy?.last_check_country || '',
                        happened_at: account.last_failover_at
                    };
                });
            const sharedProxyRows = sharedProxies
                .map(proxy => {
                    const linkedUserbots = userbotsByProxy.get(String(proxy.id)) || [];
                    return {
                        proxy_id: proxy.id,
                        proxy_label: `${proxy.name} (${proxy.host}:${proxy.port})`,
                        proxy_country: proxy.last_check_country || '',
                        userbot_count: linkedUserbots.length,
                        userbot_labels: linkedUserbots.map(account =>
                            account.tg_username ? '@' + account.tg_username : `ID ${account.tg_account_id}`
                        )
                    };
                })
                .sort((a, b) => b.userbot_count - a.userbot_count)
                .slice(0, 8);
            const directUserbots = userbots.filter(account => !account.proxy_id);
            const directUserbotOverflow = Math.max(0, directUserbots.length - 1);
            const channelsWithoutBot = (channels || []).filter(channel => !channel.bot_id || !botIds.has(channel.bot_id));
            const channelsWithBot = (channels || []).filter(channel => channel.bot_id && botIds.has(channel.bot_id));
            const recentKicks = (accessEvents || []).filter(event => event.event_type === 'kicked' && new Date(event.created_at) >= monthAgo).length;
            const autoConfirmedPayments = (paymentEvents || []).filter(event => event.event_type === 'invoice_completed').length;
            const manualConfirmedPayments = (paymentEvents || []).filter(event => event.event_type === 'admin_approved' || event.event_type === 'ton_manual_confirmed').length;
            const referralOutstandingRub = (referralProfiles || []).reduce((sum, profile) => sum + Number(profile.balance_rub || 0), 0);
            const referralOutstandingTon = (referralProfiles || []).reduce((sum, profile) => sum + Number(profile.balance_ton || 0), 0);
            const referralOutstandingUsdt = (referralProfiles || []).reduce((sum, profile) => sum + Number(profile.balance_usdt || 0), 0);
            const referralPartnersWithDebt = (referralProfiles || []).filter(profile =>
                Number(profile.balance_rub || 0) > 0 || Number(profile.balance_ton || 0) > 0 || Number(profile.balance_usdt || 0) > 0
            ).length;
            const publishedShopItems = (shopItems || []).filter(item => item.status === 'published').length;
            const pendingShopPayments = (shopPurchases || []).filter(purchase => purchase.status === 'pending').length;
            const paidShopPurchases = (shopPurchases || []).filter(purchase => purchase.status === 'paid').length;
            const shopPendingTransfers = (shopPurchases || []).filter(purchase => purchase.status === 'paid' && purchase.ownership_transfer_status !== 'completed').length;
            const shopTonRevenue = (shopPurchases || [])
                .filter(purchase => purchase.status === 'paid')
                .reduce((sum, purchase) => sum + Number(purchase.amount_ton || 0), 0);
            const normalizedBuyerShopPurchases = (buyerShopPurchases || []).map(purchase => ({
                id: purchase.id,
                status: purchase.status,
                ownership_transfer_status: purchase.ownership_transfer_status || 'pending',
                item_type: purchase.shop_items?.item_type || '',
                offer_code: purchase.shop_items?.offer_code || '',
                title: purchase.shop_items?.title || ''
            }));
            const buyerPackageSignals = packageCheckoutSignals(normalizedBuyerShopPurchases);

            const paidInvoices = ownInvoices.filter(invoice => invoice.status === 'paid');
            const pendingInvoices = ownInvoices.filter(invoice => invoice.status === 'pending');
            const awaitingReceiptInvoices = ownInvoices.filter(invoice => invoice.status === 'awaiting_receipt' || invoice.status === 'wait_admin');
            const trialPendingInvoices = ownInvoices.filter(invoice => invoice.status !== 'paid' && invoice.tariffs?.is_trial);
            const remindedInvoices = ownInvoices.filter(invoice => invoice.reminded);
            const mrrRub = sumAmounts(paidInvoices.filter(invoice => new Date(invoice.created_at) >= monthAgo), 'RUB') + sumAmounts(paidInvoices.filter(invoice => new Date(invoice.created_at) >= monthAgo), 'STARS');
            const mrrTon = sumAmounts(paidInvoices.filter(invoice => new Date(invoice.created_at) >= monthAgo), 'TON');
            const inboxDayAgo = new Date();
            inboxDayAgo.setDate(inboxDayAgo.getDate() - 1);
            const recentInboxAlerts = (inboxNotifications || []).filter(item => item.notified_at && new Date(item.notified_at) >= inboxDayAgo);
            const telegramErrorsDayAgo = new Date();
            telegramErrorsDayAgo.setDate(telegramErrorsDayAgo.getDate() - 1);
            const recentTelegramErrorEvents = (telegramErrorEvents || []).filter(item => item.happened_at && new Date(item.happened_at) >= telegramErrorsDayAgo);
            const recentTelegramRestrictions = recentTelegramErrorEvents.filter(item => item.is_restriction);
            const userbotLabelMap = Object.fromEntries(
                userbots.map(account => [
                    String(account.id),
                    account.tg_username ? '@' + account.tg_username : `ID ${account.tg_account_id}`
                ])
            );
            const recentInboxAlertRows = recentInboxAlerts.slice(0, 8).map(item => ({
                userbot_id: item.userbot_id,
                userbot_label: userbotLabelMap[String(item.userbot_id)] || `ID ${item.userbot_id}`,
                tg_user_id: String(item.dialog_tg_user_id || ''),
                notified_at: item.notified_at || null,
                preview_text: item.preview_text || ''
            }));
            const recentTelegramErrorRows = (telegramErrorEvents || []).slice(0, 8).map(item => ({
                id: item.id,
                userbot_id: item.userbot_id || null,
                userbot_label: item.userbot_id ? (userbotLabelMap[String(item.userbot_id)] || `ID ${item.userbot_id}`) : 'Не указан',
                tg_user_id: item.tg_user_id ? String(item.tg_user_id) : '',
                event_source: item.event_source || 'telegram',
                event_type: item.event_type || 'unknown',
                severity: item.severity || 'warning',
                restriction_kind: item.restriction_kind || 'unknown',
                is_restriction: item.is_restriction === true,
                happened_at: item.happened_at || null,
                error_message: item.error_message || ''
            }));

            const channelStats = (channels || []).map(channel => {
                const channelSubscriptions = (subscriptions || []).filter(sub => sub.channel_id === channel.id);
                const activeCount = channelSubscriptions.filter(sub => sub.status === 'active').length;
                const pendingJoinCount = channelSubscriptions.filter(sub => sub.status === 'active' && !sub.last_join_approved_at).length;
                const expiredInsideCount = channelSubscriptions.filter(sub => sub.status === 'expired' && sub.last_join_approved_at).length;

                return {
                    id: channel.id,
                    title: channel.title,
                    tg_chat_id: channel.tg_chat_id,
                    hasOfficialBot: !!channel.bot_id && botIds.has(channel.bot_id),
                    activeSubscribers: activeCount,
                    paidNotJoined: pendingJoinCount,
                    expiredButInside: expiredInsideCount
                };
            }).sort((a, b) => (b.paidNotJoined + b.expiredButInside) - (a.paidNotJoined + a.expiredButInside)).slice(0, 8);

            const urgentActions = [
                {
                    id: 'orders_access_pending',
                    title: 'Оплата есть, вход не подтвержден',
                    value: paidNotJoined.length,
                    tone: paidNotJoined.length > 0 ? 'danger' : 'ok',
                    href: '/app/orders',
                    hint: 'Это сигнал к проверке доступа: Telegram-вход мог не записаться, поэтому сначала сверяешь контур.'
                },
                {
                    id: 'dead_userbots',
                    title: 'Юзерботы на битом прокси',
                    value: userbotsWithDeadProxy.length,
                    tone: userbotsWithDeadProxy.length > 0 ? 'danger' : 'ok',
                    href: '/app/userbots',
                    hint: 'Эти аккаунты формально висят, но в бою будут только валиться. Сначала чини им прокси.'
                },
                {
                    id: 'failover_misconfigured',
                    title: 'Failover включен, но пула нет',
                    value: failoverEmptyPoolUserbots.length,
                    tone: failoverEmptyPoolUserbots.length > 0 ? 'warning' : 'ok',
                    href: '/app/userbots',
                    hint: 'Авто-переключение включили, а резервные прокси не выбрали. Значит при смерти основного прокси аккаунт все равно ляжет.'
                },
                {
                    id: 'shared_proxy_legacy',
                    title: 'На одном прокси сидит больше одного юзербота',
                    value: sharedProxies.length,
                    tone: sharedProxies.length > 0 ? 'danger' : 'ok',
                    href: '/app/proxies',
                    hint: sharedProxies.length > 0
                        ? 'Это старые опасные связки. Новые такие уже режутся, а эти надо разруливать руками.'
                        : 'Ок. Сейчас нет старых shared-proxy связок, которые могли бы класть пачку аккаунтов одним ударом.'
                },
                {
                    id: 'direct_userbot_overflow',
                    title: 'Лишние юзерботы без прокси',
                    value: directUserbotOverflow,
                    tone: directUserbotOverflow > 0 ? 'danger' : 'ok',
                    href: '/app/userbots',
                    hint: 'Без прокси можно держать только один direct-аккаунт. Остальным нужен живой прокси.'
                },
                {
                    id: 'ops_signal_setup',
                    title: 'Сигналы от юзерботов не собраны',
                    value: signalRoutingReady ? 0 : 1,
                    tone: signalRoutingReady ? 'ok' : 'warning',
                    href: signalAdminConfigured ? '/app/userbots' : '/app/payments',
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
                    href: '/app/userbot-center',
                    hint: recentInboxAlerts.length > 0
                        ? 'Ops-бот уже словил мутные входящие. Проверь, кому надо ответить, пока деньги не ушли.'
                        : 'За последние сутки ops-бот не пинговал новые горячие лички.'
                },
                {
                    id: 'telegram_restrictions',
                    title: 'Telegram ругался на аккаунты',
                    value: recentTelegramRestrictions.length,
                    tone: recentTelegramRestrictions.length > 0 ? 'danger' : (recentTelegramErrorEvents.length > 0 ? 'warning' : 'ok'),
                    href: '/app/userbot-center',
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
                    href: '/app/access',
                    hint: 'Вот тут прям течь по деньгам. Эти люди уже должны были вылететь или продлиться.'
                },
                {
                    id: 'unpaid_leads',
                    title: 'Теплые неоплаты',
                    value: pendingInvoices.length,
                    tone: pendingInvoices.length > 0 ? 'warning' : 'ok',
                    href: '/app/abandoned',
                    hint: 'Это быстрые деньги. Люди уже нажали тариф, но не добили оплату.'
                },
                {
                    id: 'referral_payouts',
                    title: 'Партнерам надо занести',
                    value: referralPartnersWithDebt,
                    tone: referralPartnersWithDebt > 0 ? 'warning' : 'ok',
                    href: '/app/referrals',
                    hint: 'Тут висит хвост по партнерке. Если не закрывать выплаты, нормальная органика быстро сдуется.'
                },
                {
                    id: 'shop_transfers',
                    title: 'Shop: права еще не переведены',
                    value: shopPendingTransfers,
                    tone: shopPendingTransfers > 0 ? 'warning' : 'ok',
                    href: '/app/shop',
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
                    shopPublishedItemCount: publishedShopItems,
                    shopPendingPayments: pendingShopPayments,
                    shopPaidPurchases: paidShopPurchases,
                    shopPendingTransfers,
                    shopTonRevenue: Number(shopTonRevenue.toFixed(4))
                },
                paymentReadiness: {
                    hasSettings: !!paymentSettings?.id,
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
