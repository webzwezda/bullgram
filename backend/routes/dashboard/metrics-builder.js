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
    const normalSignal = buildSignal('normal', 'Pro checkout', '/billing');
    const sellerSignal = buildSignal('seller', 'Seller checkout', '/shop?offer=seller');

    if (trialSignal) signals.push(trialSignal);
    if (normalSignal) signals.push(normalSignal);
    if (sellerSignal) signals.push(sellerSignal);

    return signals;
}

export function buildDashboardMetrics(data, ownerId) {
    const {
        reservedUserbotIds,
        accounts,
        channels,
        proxies,
        subscriptions,
        invoices,
        accessEvents,
        paymentEvents,
        referralProfiles,
        referralRewardEvents,
        shopItems,
        shopPurchases,
        buyerShopPurchases,
        inboxNotifications,
        telegramErrorEvents,
        monthAgo,
        botIds
    } = data;

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

    return {
        activeSubscriptions,
        expiredButInside,
        paidNotJoined,
        workingProxies,
        brokenProxies,
        userbots,
        listedUserbots,
        sharedProxies,
        userbotsOnSharedProxy,
        userbotsWithDeadProxy,
        failoverEnabledUserbots,
        failoverEmptyPoolUserbots,
        recentFailovers,
        recentFailoverRows,
        sharedProxyRows,
        directUserbots,
        directUserbotOverflow,
        channelsWithoutBot,
        channelsWithBot,
        recentKicks,
        autoConfirmedPayments,
        manualConfirmedPayments,
        referralOutstandingRub,
        referralOutstandingTon,
        referralOutstandingUsdt,
        referralPartnersWithDebt,
        publishedShopItems,
        pendingShopPayments,
        paidShopPurchases,
        shopPendingTransfers,
        shopTonRevenue,
        buyerPackageSignals,
        pendingInvoices,
        awaitingReceiptInvoices,
        trialPendingInvoices,
        remindedInvoices,
        mrrRub,
        mrrTon,
        recentInboxAlerts,
        recentTelegramErrorEvents,
        recentTelegramRestrictions,
        recentInboxAlertRows,
        recentTelegramErrorRows,
        channelStats
    };
}
