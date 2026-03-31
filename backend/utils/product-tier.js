export function getProductTier(profile) {
    return String(profile?.product_tier || 'trial').trim().toLowerCase() || 'trial';
}

export function isTrialTier(profile) {
    return getProductTier(profile) === 'trial';
}

export function getTierRules(profile) {
    const tier = getProductTier(profile);

    if (tier === 'pro') {
        return {
            id: 'pro',
            maxUserbots: Number.POSITIVE_INFINITY,
            maxOwnedProxies: Number.POSITIVE_INFINITY,
            canSendBroadcasts: true,
            canUseShopSeller: true,
            canUseTrialProxy: false,
            canBuyAssets: true
        };
    }

    if (tier === 'normal') {
        return {
            id: 'normal',
            maxUserbots: Number.POSITIVE_INFINITY,
            maxOwnedProxies: Number.POSITIVE_INFINITY,
            canSendBroadcasts: true,
            canUseShopSeller: true,
            canUseTrialProxy: false,
            canBuyAssets: true
        };
    }

    return {
        id: 'trial',
        maxUserbots: 1,
        maxOwnedProxies: 1,
        canSendBroadcasts: false,
        canUseShopSeller: false,
        canUseTrialProxy: false,
        canBuyAssets: true
    };
}

export async function enforceUserbotQuota({ supabase, ownerId, profile, ignoreAccountId = null }) {
    const rules = getTierRules(profile);
    if (!Number.isFinite(rules.maxUserbots)) {
        return;
    }

    const { data, error } = await supabase
        .from('tg_accounts')
        .select('id')
        .eq('owner_id', ownerId)
        .eq('account_type', 'userbot');

    if (error) throw error;

    const count = (data || []).filter(row => String(row.id) !== String(ignoreAccountId || '')).length;
    if (count >= rules.maxUserbots) {
        throw new Error('На Trial можно держать только одного юзербота. Чтобы подключить еще один, сначала перейди на Normal.');
    }
}

export async function enforceOwnedProxyQuota({ supabase, ownerId, profile, ignoreProxyId = null }) {
    const rules = getTierRules(profile);
    if (!Number.isFinite(rules.maxOwnedProxies)) {
        return;
    }

    const { data, error } = await supabase
        .from('proxies')
        .select('id')
        .eq('owner_id', ownerId)
        .eq('provision_source', 'manual_owned');

    if (error) throw error;

    const count = (data || []).filter(row => String(row.id) !== String(ignoreProxyId || '')).length;
    if (count >= rules.maxOwnedProxies) {
        throw new Error('На Trial можно держать только один свой прокси. Чтобы добавить еще один, сначала перейди на Normal.');
    }
}

export function ensureBroadcastAllowed(profile) {
    const rules = getTierRules(profile);
    if (!rules.canSendBroadcasts) {
        throw new Error('На Trial нельзя запускать живые рассылки. Сначала перейди на Normal.');
    }
}

export function ensureShopSellerAllowed(profile) {
    if (profile?.role === 'admin') {
        return;
    }
    const rules = getTierRules(profile);
    if (!rules.canUseShopSeller) {
        throw new Error('На Trial seller-mode закрыт. Сначала перейди на Normal.');
    }
}
