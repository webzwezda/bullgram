import { transferShopAssets } from './shop-transfer.service.js';

async function loadBundleCandidates(supabase) {
    const { data: items, error } = await supabase
        .from('shop_items')
        .select('id, owner_id, title, item_type, status, visibility')
        .eq('item_type', 'bundle')
        .eq('status', 'published')
        .order('created_at', { ascending: true })
        .limit(25);
    if (error) throw error;
    return items || [];
}

async function loadBundleAssets(supabase, shopItemIds) {
    const { data, error } = await supabase
        .from('shop_item_assets')
        .select('id, shop_item_id, asset_type, asset_id, label, sort_order')
        .in('shop_item_id', shopItemIds)
        .order('sort_order', { ascending: true });
    if (error) throw error;
    const byItem = new Map();
    for (const asset of data || []) {
        const list = byItem.get(asset.shop_item_id) || [];
        list.push(asset);
        byItem.set(asset.shop_item_id, list);
    }
    return byItem;
}

// Source of truth for a blocked/restricted userbot — same flag the restricted-userbot cleanup job uses.
async function isUserbotTransferable(supabase, userbotId) {
    const { data: account, error } = await supabase
        .from('tg_accounts')
        .select('id, runtime_status')
        .eq('id', userbotId)
        .eq('account_type', 'userbot')
        .maybeSingle();
    if (error) throw error;
    if (!account) return false;
    return String(account.runtime_status || '') !== 'restricted';
}

async function finalizeFulfillment(supabase, order, fulfillmentStatus, extra) {
    const payload = {
        ...(order.payload || {}),
        fulfillment_status: fulfillmentStatus,
        ...extra
    };
    // CAS on the claim token: if the recovery sweep re-claimed the order while this
    // worker was running, our finalize must not overwrite the newer claim's result.
    const { data, error } = await supabase
        .from('billing_orders')
        .update({ payload })
        .eq('id', order.id)
        .eq('payload->>fulfillment_claimed_at', order.payload?.fulfillment_claimed_at)
        .select('id')
        .maybeSingle();
    if (error) throw error;
    return !!data;
}

export async function fulfillProOrderBundle(supabase, order) {
    const log = (...args) => console.log('[pro-fulfillment]', ...args);
    try {
        if (!order || order.status !== 'paid' || !order.owner_id) {
            return { fulfillment_status: null, reason: 'order_not_paid' };
        }

        // Fresh read: is fulfillment already claimed/finished?
        const { data: fresh, error: freshError } = await supabase
            .from('billing_orders')
            .select('id, owner_id, status, payload')
            .eq('id', order.id)
            .maybeSingle();
        if (freshError) throw freshError;
        if (!fresh || fresh.status !== 'paid') {
            return { fulfillment_status: null, reason: 'order_not_paid' };
        }
        const payload = fresh.payload || {};
        if (payload.fulfillment_status === 'completed') {
            return { fulfillment_status: 'completed', reason: 'already_fulfilled' };
        }
        // 'failed' and stale 'processing' (crashed mid-fulfillment) are re-claimable;
        // fresh 'processing' means another worker is on it.
        const STALE_PROCESSING_MS = 10 * 60_000;
        const prevClaimedAt = payload.fulfillment_claimed_at ? Date.parse(payload.fulfillment_claimed_at) : 0;
        const prevStatus = payload.fulfillment_status;
        const reclaimable = !prevStatus
            || prevStatus === 'failed'
            || (prevStatus === 'processing' && Date.now() - prevClaimedAt > STALE_PROCESSING_MS);
        if (!reclaimable) {
            return { fulfillment_status: prevStatus, reason: 'already_claimed' };
        }

        // Atomic claim: CAS on the exact previous (status, claimed_at) pair so two
        // workers retrying the same stale claim cannot both proceed.
        const claimedAt = new Date().toISOString();
        const claimPayload = {
            ...payload,
            fulfillment_status: 'processing',
            fulfillment_claimed_at: claimedAt
        };
        let claimQuery = supabase
            .from('billing_orders')
            .update({ payload: claimPayload })
            .eq('id', fresh.id)
            .eq('status', 'paid');
        claimQuery = prevStatus
            ? claimQuery
                .eq('payload->>fulfillment_status', prevStatus)
                .eq('payload->>fulfillment_claimed_at', payload.fulfillment_claimed_at)
            : claimQuery.is('payload->>fulfillment_status', null);
        const { data: claimed, error: claimError } = await claimQuery
            .select('id')
            .maybeSingle();
        if (claimError) throw claimError;
        if (!claimed) {
            log(`order ${fresh.id} fulfillment already claimed by another worker`);
            return { fulfillment_status: payload.fulfillment_status || 'processing', reason: 'claim_lost' };
        }

        const workingOrder = { ...fresh, payload: claimPayload };

        // Pick a bundle candidate.
        const items = await loadBundleCandidates(supabase);
        const assetsByItem = items.length > 0
            ? await loadBundleAssets(supabase, items.map(item => item.id))
            : new Map();

        for (const item of items) {
            // The recovery sweep may have re-claimed this order while we were looping.
            const { data: mine, error: mineError } = await supabase
                .from('billing_orders')
                .select('payload')
                .eq('id', fresh.id)
                .maybeSingle();
            if (mineError) throw mineError;
            if (mine?.payload?.fulfillment_claimed_at !== claimedAt) {
                log(`order ${fresh.id}: claim lost mid-run, aborting`);
                return { fulfillment_status: 'claim_lost' };
            }

            const assets = assetsByItem.get(item.id) || [];
            const userbotAssets = assets.filter(asset => asset.asset_type === 'userbot');
            const proxyAssets = assets.filter(asset => asset.asset_type === 'proxy');
            if (userbotAssets.length !== 1 || proxyAssets.length !== 1) continue;

            const userbotAsset = userbotAssets[0];
            const transferable = await isUserbotTransferable(supabase, userbotAsset.asset_id);
            if (!transferable) continue;

            // CAS-claim the shop item: published -> sold.
            const { data: claimedItem, error: itemError } = await supabase
                .from('shop_items')
                .update({
                    status: 'sold',
                    visibility: 'private',
                    updated_at: claimedAt
                })
                .eq('id', item.id)
                .eq('status', 'published')
                .select('id, owner_id')
                .maybeSingle();
            if (itemError) throw itemError;
            if (!claimedItem) continue;

            const shopItemId = claimedItem.id;
            const userbotId = userbotAsset.asset_id;
            const proxyId = proxyAssets[0].asset_id;

            const purchase = {
                shop_item_id: shopItemId,
                seller_owner_id: claimedItem.owner_id || item.owner_id,
                buyer_owner_id: fresh.owner_id,
                status: 'paid',
                amount_ton: 0,
                ownership_transfer_status: 'pending',
                payload: {
                    source: 'pro_billing',
                    billing_order_id: fresh.id
                }
            };
            let shopPurchaseId = null;
            try {
                const { data: insertedPurchase, error: purchaseError } = await supabase
                    .from('shop_purchases')
                    .insert(purchase)
                    .select('id')
                    .maybeSingle();
                if (purchaseError) throw purchaseError;
                shopPurchaseId = insertedPurchase?.id || null;

                await transferShopAssets(supabase, purchase, item, assets);

                if (shopPurchaseId) {
                    const { error: purchaseUpdateError } = await supabase
                        .from('shop_purchases')
                        .update({ ownership_transfer_status: 'completed', ownership_transfer_error: null })
                        .eq('id', shopPurchaseId);
                    if (purchaseUpdateError) throw purchaseUpdateError;
                }

                const finalized = await finalizeFulfillment(supabase, workingOrder, 'completed', {
                    fulfillment_error: null,
                    fulfillment: {
                        shop_item_id: shopItemId,
                        userbot_id: userbotId,
                        proxy_id: proxyId,
                        shop_purchase_id: shopPurchaseId,
                        fulfilled_at: new Date().toISOString()
                    }
                });
                if (!finalized) {
                    log(`order ${fresh.id}: claim lost before finalize, skipping`);
                    return { fulfillment_status: 'claim_lost' };
                }
                log(`order ${fresh.id}: fulfilled bundle ${shopItemId} (userbot ${userbotId}, proxy ${proxyId})`);
                return { fulfillment_status: 'completed', shop_item_id: shopItemId };
            } catch (transferErr) {
                // Item stays consumed (sold/private) — same semantics as Shop failed transfer.
                const message = transferErr?.message || String(transferErr);
                console.error(`[pro-fulfillment] order ${fresh.id}: transfer failed for bundle ${shopItemId}:`, message);

                if (shopPurchaseId) {
                    const { error: purchaseFailError } = await supabase
                        .from('shop_purchases')
                        .update({ ownership_transfer_status: 'failed', ownership_transfer_error: message })
                        .eq('id', shopPurchaseId);
                    if (purchaseFailError) {
                        console.error('[pro-fulfillment] failed to mark purchase failed:', purchaseFailError.message);
                    }
                }

                const failFinalized = await finalizeFulfillment(supabase, workingOrder, 'failed', {
                    fulfillment_error: message
                });
                if (!failFinalized) {
                    log(`order ${fresh.id}: claim lost before failure finalize, skipping`);
                }
                return { fulfillment_status: 'failed', error: message };
            }
        }

        const noStockError = 'нет свободных бандлов на витрине';
        const noStockFinalized = await finalizeFulfillment(supabase, workingOrder, 'failed', {
            fulfillment_error: noStockError
        });
        if (!noStockFinalized) {
            log(`order ${fresh.id}: claim lost before no-stock finalize, skipping`);
        }
        log(`order ${fresh.id}: ${noStockError}`);
        return { fulfillment_status: 'failed', error: noStockError };
    } catch (err) {
        console.error('[pro-fulfillment] unexpected failure:', err?.message || err);
        return { fulfillment_status: 'failed', error: err?.message || String(err) };
    }
}
