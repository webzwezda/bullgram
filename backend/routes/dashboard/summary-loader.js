import { loadReservedUserbotIds } from '../../utils/shop-reservations.js';

export async function loadDashboardData(supabase, ownerId) {
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
            .from('channel_audiences')
            .select('id')
            .eq('owner_id', ownerId),
        supabase
            .from('payment_settings')
            // PK = owner_id, колонки id нет
            .select('owner_id, ton_wallet, billing_provider, billing_mode, admin_tg_id')
            .eq('owner_id', ownerId)
            .maybeSingle()
    ]);

    if (accountsError) throw accountsError;
    if (channelsError) throw channelsError;
    if (proxiesError) throw proxiesError;
    if (customerBasesError && !(customerBasesError.message || '').includes('channel_audiences')) throw customerBasesError;
    // Терпим только «таблицы ещё нет» на свежих инсталлах; остальное логируем,
    // иначе ошибки схемы (как с несуществующей колонкой id) молча зануляют readiness.
    if (paymentSettingsError) {
        if ((paymentSettingsError.code || '') === 'PGRST205') {
            console.warn('dashboard: payment_settings недоступна:', paymentSettingsError.message);
        } else {
            throw paymentSettingsError;
        }
    }

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

    const { count: proFulfillmentPending, error: proFulfillmentError } = await supabase
        .from('billing_orders')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'paid')
        .or('payload->>fulfillment_status.is.null,payload->>fulfillment_status.eq.failed');
    if (proFulfillmentError) throw proFulfillmentError;

    return {
        reservedUserbotIds,
        accounts,
        channels,
        proxies,
        customerBases,
        paymentSettings,
        botIds,
        opsBots,
        salesBots,
        signalAdminConfigured,
        signalRoutingReady,
        monthAgo,
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
        proFulfillmentPending
    };
}
