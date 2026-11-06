import {
    ACCOUNT_LOT_NOT_READY_MESSAGE,
    findUnsellableAccountLot
} from '../../services/shop-delivery.service.js';
import { getTierRules } from '../../utils/product-tier.js';
import {
    buildAvailablePaymentMethods,
    buildShopMemo,
    expireStalePendingPurchases,
    getPendingPurchaseExpiry,
    inferOfferCodeFromLegacyItem,
    isMissingShopTables,
    isPendingPurchaseExpired,
    isTextServiceItem,
    normalizeOfferCode,
    siteWallet
} from './helpers.js';

export async function createOrRefreshBuyerPurchase({
    supabase,
    buyerOwnerId,
    itemId,
    paymentMethod,
    memoOverride = null,
    batchToken = null
}) {
    const { data: itemPurchases, error: itemPurchasesError } = await supabase
        .from('shop_purchases')
        .select('id, buyer_owner_id, status, created_at, payload')
        .eq('shop_item_id', itemId)
        .order('created_at', { ascending: false });

    if (itemPurchasesError) {
        if (isMissingShopTables(itemPurchasesError)) {
            throw new Error('Сначала примени SQL под shop foundation');
        }
        throw itemPurchasesError;
    }

    await expireStalePendingPurchases(supabase, itemPurchases || []);

    const { data: item, error: itemError } = await supabase
        .from('shop_items')
        .select('*')
        .eq('id', itemId)
        .eq('status', 'published')
        .in('visibility', ['public', 'unlisted'])
        .single();

    if (itemError) {
        if (isMissingShopTables(itemError)) {
            throw new Error('Сначала примени SQL под shop foundation');
        }
        throw itemError;
    }

    if (!item) {
        const missing = new Error('Лот не найден или уже недоступен');
        missing.statusCode = 404;
        throw missing;
    }

    if (String(item.owner_id) === String(buyerOwnerId)) {
        const ownItem = new Error('Свой собственный лот покупать не надо');
        ownItem.statusCode = 400;
        throw ownItem;
    }

    const textServiceItem = isTextServiceItem(item);

    // Отстойник: проблемный юзербот не бронируется, даже если лот ещё висит
    // опубликованным (проверка устареть могла уже после публикации).
    if (!textServiceItem) {
        const { data: purchaseAssets, error: purchaseAssetsError } = await supabase
            .from('shop_item_assets')
            .select('asset_type, asset_id')
            .eq('shop_item_id', item.id);
        if (purchaseAssetsError) throw purchaseAssetsError;
        const purchaseUserbotIds = (purchaseAssets || [])
            .filter(asset => asset.asset_type === 'userbot')
            .map(asset => String(asset.asset_id));

        if (purchaseUserbotIds.length > 0) {
            const { data: userbotRows, error: userbotRowsError } = await supabase
                .from('tg_accounts')
                .select('id, tg_username, runtime_status, last_checked_at, health_summary, custom_label')
                .in('id', purchaseUserbotIds);
            if (userbotRowsError) throw userbotRowsError;
            // pending_activation сюда тоже входит: аккаунт мог вернуться в safe-mode
            // через восстановление из файлов после публикации лота.
            // Аккаунт-лоты (intake): pending_activation со свежей чистой проверкой —
            // продаваемый сток, а не карантин (см. shop-delivery.service).
            const isAccountLot = item.item_type === 'account';
            const quarantineStatuses = ['restricted', 'expired', 'dead_proxy', 'error', 'pending_activation', 'frozen'];
            const quarantined = isAccountLot
                ? findUnsellableAccountLot(userbotRows)
                : (userbotRows || []).find(row =>
                    quarantineStatuses.includes(String(row.runtime_status || '').trim().toLowerCase())
                );
            if (quarantined) {
                const blocked = new Error(isAccountLot
                    ? ACCOUNT_LOT_NOT_READY_MESSAGE
                    : `Аккаунт @${quarantined.tg_username || quarantined.id} сейчас проблемный (${quarantined.runtime_status}) — продажа лота приостановлена`);
                blocked.statusCode = 400;
                throw blocked;
            }
        }
    }

    if (!textServiceItem) {
        const liveForeignPending = (itemPurchases || []).find(purchase =>
            String(purchase.buyer_owner_id) !== String(buyerOwnerId) &&
            purchase.status === 'pending' &&
            !isPendingPurchaseExpired(purchase)
        );

        const liveForeignPaid = (itemPurchases || []).find(purchase =>
            String(purchase.buyer_owner_id) !== String(buyerOwnerId) &&
            purchase.status === 'paid'
        );

        if (liveForeignPending) {
            const expiresAt = getPendingPurchaseExpiry(liveForeignPending.created_at);
            const busy = new Error(`Лот уже забронирован другим покупателем до ${expiresAt.toLocaleString('ru-RU')}`);
            busy.statusCode = 400;
            throw busy;
        }

        if (liveForeignPaid) {
            const paid = new Error('Этот лот уже оплачен другим покупателем и ждет передачи прав.');
            paid.statusCode = 400;
            throw paid;
        }

        // Два анонима на одном лоте: String(null)===String(null) делает чужую
        // бронь «своей» — второй гость получил бы тот же UUID и качал архив
        // после чужой оплаты (ревью P2). Живая анонимная бронь = лот занят.
        if (buyerOwnerId === null) {
            const liveAnonPending = (itemPurchases || []).find(purchase =>
                purchase.buyer_owner_id === null &&
                purchase.status === 'pending' &&
                !isPendingPurchaseExpired(purchase)
            );
            if (liveAnonPending) {
                const expiresAt = getPendingPurchaseExpiry(liveAnonPending.created_at);
                const busy = new Error(`Лот уже забронирован до ${expiresAt.toLocaleString('ru-RU')}. Если бронь не вы — повторите через пару минут.`);
                busy.statusCode = 400;
                throw busy;
            }
        }
    }

    const { data: existingPurchase } = await supabase
        .from('shop_purchases')
        .select('id, status, created_at, payload')
        .eq('shop_item_id', item.id)
        .eq('buyer_owner_id', buyerOwnerId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    const availablePaymentMethods = buildAvailablePaymentMethods(item);
    if (!availablePaymentMethods.includes(paymentMethod)) {
        const methodError = new Error('Этот способ оплаты для лота недоступен');
        methodError.statusCode = 400;
        throw methodError;
    }

    const wallet = siteWallet();
    if (paymentMethod === 'ton' && !wallet) {
        const walletError = new Error('Приём TON-платежей сайтом не настроен');
        walletError.statusCode = 400;
        throw walletError;
    }

    const memo = String(memoOverride || buildShopMemo()).trim();
    const amountTon = Number(item.price_ton || 0);

    const payloadPatch = {
        payment_method: paymentMethod,
        memo,
        seller_wallet: wallet,
        post_purchase_message: item.post_purchase_message || null,
        batch_token: batchToken || null
    };

    if (existingPurchase?.status === 'paid') {
        const paidExists = new Error('У тебя уже есть открытая покупка по этому лоту. Сначала добей ее.');
        paidExists.statusCode = 400;
        throw paidExists;
    }

    let purchase = null;

    if (existingPurchase?.status === 'pending' && !isPendingPurchaseExpired(existingPurchase)) {
        const nextPayload = {
            ...(existingPurchase.payload || {}),
            ...payloadPatch,
            receipt_note: null,
            receipt_marked_at: null,
            receipt_file_name: null,
            receipt_file_url: null
        };

        const { data: updatedPurchase, error: updatePurchaseError } = await supabase
            .from('shop_purchases')
            .update({
                amount_ton: amountTon,
                payload: nextPayload,
                updated_at: new Date().toISOString()
            })
            .eq('id', existingPurchase.id)
            .select('*')
            .single();

        if (updatePurchaseError) throw updatePurchaseError;
        purchase = updatedPurchase;
    } else {
        const { data: createdPurchase, error: purchaseError } = await supabase
            .from('shop_purchases')
            .insert({
                shop_item_id: item.id,
                seller_owner_id: item.owner_id,
                buyer_owner_id: buyerOwnerId,
                status: 'pending',
                amount_ton: amountTon,
                ownership_transfer_status: 'pending',
                payload: payloadPatch
            })
            .select('*')
            .single();

        if (purchaseError) {
            if (isMissingShopTables(purchaseError)) {
                throw new Error('Сначала примени SQL под shop foundation');
            }
            throw purchaseError;
        }
        purchase = createdPurchase;
    }

    return {
        purchase,
        item,
        wallet,
        amountTon,
        memo,
        paymentMethod
    };
}

function parsePurchaseIdsInput(value) {
    if (Array.isArray(value)) {
        return value.map((entry) => String(entry || '').trim()).filter(Boolean);
    }
    return String(value || '')
        .split(',')
        .map((entry) => String(entry || '').trim())
        .filter(Boolean);
}

function ensureSingleBatchContext(purchases) {
    if (!Array.isArray(purchases) || purchases.length <= 1) return;
    const batchTokens = Array.from(new Set(
        purchases
            .map((purchase) => String(purchase?.payload?.batch_token || '').trim())
            .filter(Boolean)
    ));
    if (batchTokens.length !== 1) {
        const error = new Error('Для batch-действия нужен один общий счет');
        error.statusCode = 400;
        throw error;
    }
}

async function summarizeIncomingOwnedAssets(supabase, items = []) {
    const itemIds = items.map((item) => item?.id).filter(Boolean);
    if (!itemIds.length) {
        return { proxyCount: 0, userbotCount: 0 };
    }

    const { data: assetRows, error } = await supabase
        .from('shop_item_assets')
        .select('shop_item_id, asset_type')
        .in('shop_item_id', itemIds);
    if (error) throw error;

    const assetsByItem = new Map();
    for (const asset of assetRows || []) {
        const bucket = assetsByItem.get(asset.shop_item_id) || [];
        bucket.push(asset);
        assetsByItem.set(asset.shop_item_id, bucket);
    }

    let proxyCount = 0;
    let userbotCount = 0;

    for (const item of items) {
        const assetList = assetsByItem.get(item.id) || [];
        if (assetList.length) {
            proxyCount += assetList.filter((asset) => asset.asset_type === 'proxy').length;
            userbotCount += assetList.filter((asset) => asset.asset_type === 'userbot').length;
            continue;
        }

        if (item.item_type === 'proxy') proxyCount += 1;
        if (item.item_type === 'userbot') userbotCount += 1;
    }

    return { proxyCount, userbotCount };
}

async function assertBuyerOwnershipLimits({ supabase, profile, buyerOwnerId, items = [] }) {
    const rules = getTierRules(profile);
    if (!Number.isFinite(rules.maxOwnedProxies) && !Number.isFinite(rules.maxUserbots)) {
        return;
    }

    const { proxyCount: incomingProxyCount, userbotCount: incomingUserbotCount } = await summarizeIncomingOwnedAssets(supabase, items);
    if (!incomingProxyCount && !incomingUserbotCount) {
        return;
    }

    if (Number.isFinite(rules.maxOwnedProxies) && incomingProxyCount > 0) {
        const { count, error } = await supabase
            .from('proxies')
            .select('id', { count: 'exact', head: true })
            .eq('owner_id', buyerOwnerId);
        if (error) throw error;

        if ((Number(count || 0) + incomingProxyCount) > rules.maxOwnedProxies) {
            const limitError = new Error('На Trial можно владеть только одним прокси. Сначала перейди на Normal или освободи текущий proxy.');
            limitError.statusCode = 400;
            throw limitError;
        }
    }

    if (Number.isFinite(rules.maxUserbots) && incomingUserbotCount > 0) {
        const { count, error } = await supabase
            .from('tg_accounts')
            .select('id', { count: 'exact', head: true })
            .eq('owner_id', buyerOwnerId)
            .eq('account_type', 'userbot');
        if (error) throw error;

        if ((Number(count || 0) + incomingUserbotCount) > rules.maxUserbots) {
            const limitError = new Error('На Trial можно владеть только одним юзерботом. Сначала перейди на Normal или удали текущий.');
            limitError.statusCode = 400;
            throw limitError;
        }
    }
}

async function applyShopOfferUnlock(supabase, purchase, item) {
    const offerCode = normalizeOfferCode(item?.offer_code) || inferOfferCodeFromLegacyItem(item);
    if (!offerCode) return;

    const ownerId = purchase?.buyer_owner_id;
    if (!ownerId) return;

    const now = new Date();

    if (offerCode === 'normal') {
        console.warn('[Shop] Игнорируем Normal unlock из Shop. Normal теперь выдается только через Bullgram billing.');
        return;
    }

    if (offerCode === 'trial') {
        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('id, product_tier, trial_started_at')
            .eq('id', ownerId)
            .single();

        if (profileError) {
            if (String(profileError.message || '').includes('product_tier')) return;
            throw profileError;
        }

        if (String(profile?.product_tier || '').toLowerCase() === 'pro') {
            return;
        }

        const startedAt = profile?.trial_started_at || now.toISOString();

        // Trial бессрочный — срока окончания нет, закрывается только апгрейдом на Pro
        const { error } = await supabase
            .from('profiles')
            .update({
                product_tier: 'trial',
                trial_started_at: startedAt,
                trial_ends_at: null
            })
            .eq('id', ownerId);

        if (error && !String(error.message || '').includes('product_tier')) throw error;
    }
}

async function loadOwnerUserbotProxyUsage(supabase, ownerId) {
    const { data, error } = await supabase
        .from('tg_accounts')
        .select('id, tg_account_id, tg_username, proxy_id')
        .eq('owner_id', ownerId)
        .eq('account_type', 'userbot');

    if (error) throw error;

    const rows = data || [];
    const usage = new Map();
    for (const row of rows) {
        if (!row.proxy_id) continue;
        const key = String(row.proxy_id);
        const bucket = usage.get(key) || [];
        bucket.push(row);
        usage.set(key, bucket);
    }
    return { rows, usage };
}

function proxyHasMultipleUserbots(usageMap, proxyId) {
    return (usageMap.get(String(proxyId)) || []).length > 1;
}

// Правило 1:1 — прокси с живым юзерботом продавать нельзя вообще.
function proxyHasUserbot(usageMap, proxyId) {
    return (usageMap.get(String(proxyId)) || []).length > 0;
}

export {
    parsePurchaseIdsInput,
    ensureSingleBatchContext,
    summarizeIncomingOwnedAssets,
    assertBuyerOwnershipLimits,
    applyShopOfferUnlock,
    loadOwnerUserbotProxyUsage,
    proxyHasMultipleUserbots,
    proxyHasUserbot
};
