import { useMemo } from 'react';
import { getProductTierRules } from '../../app/productTier.js';
import { normalizeSellerPurchaseGroup } from './shop.utils.js';

export function useShopDerivedState({
  state,
  profilePlan,
  profileRole,
  itemFilter,
  purchaseFilter,
  itemSearch,
  purchaseSearch
}) {
  const planRules = useMemo(() => getProductTierRules(profilePlan), [profilePlan]);

  const availableAssets = state.assets || {};
  const support = availableAssets.support || {};
  const sellerCanSellAssets = !!support.asset_marketplace || profileRole === 'admin';
  const canUseAssetSeller = profileRole === 'admin' || (sellerCanSellAssets && planRules.canUseShopAdmin);

  const filteredItems = useMemo(() => {
    const needle = itemSearch.trim().toLowerCase();
    return state.items.filter((item) => {
      if (itemFilter === 'published' && item.status !== 'published') return false;
      if (itemFilter === 'draft' && item.status !== 'draft') return false;
      if (itemFilter === 'reserved' && !(item.stats?.pending_purchases > 0)) return false;
      if (itemFilter === 'sold' && item.status !== 'sold') return false;
      if (itemFilter === 'unlisted' && item.visibility !== 'unlisted') return false;
      if (!needle) return true;
      const text = [item.title, item.description, item.preview_text, item.item_type, item.status, item.visibility,
        (item.assets || []).map((a) => a.label || a.asset_type).join(' ')
      ].filter(Boolean).join(' ').toLowerCase();
      return text.includes(needle);
    });
  }, [itemFilter, itemSearch, state.items]);

  const groupedPurchases = useMemo(() => {
    const buckets = new Map();
    for (const p of state.purchases) {
      const key = p.payload?.batch_token || p.id;
      const bucket = buckets.get(key) || [];
      bucket.push(p);
      buckets.set(key, bucket);
    }
    return Array.from(buckets.values()).map(normalizeSellerPurchaseGroup).filter(Boolean);
  }, [state.purchases]);

  const filteredPurchases = useMemo(() => {
    const needle = purchaseSearch.trim().toLowerCase();
    return groupedPurchases.filter((p) => {
      if (purchaseFilter === 'pending' && p.status !== 'pending') return false;
      if (purchaseFilter === 'awaiting_receipt' && p.status !== 'awaiting_receipt') return false;
      if (purchaseFilter === 'rejected' && p.status !== 'rejected') return false;
      if (purchaseFilter === 'paid' && p.status !== 'paid') return false;
      if (purchaseFilter === 'expired' && p.status !== 'expired') return false;
      if (!needle) return true;
      const text = [p.item?.title, p.item?.item_type, p.buyer_owner_id, p.payload?.memo,
        p.payload?.seller_wallet, p.status, p.ownership_transfer_status,
        (p.item?.assets || []).map((a) => a.label || a.asset_type).join(' '),
        p.purchase_ids?.length ? `x${p.purchase_ids.length}` : ''
      ].filter(Boolean).join(' ').toLowerCase();
      return text.includes(needle);
    });
  }, [groupedPurchases, purchaseFilter, purchaseSearch]);

  const itemSummary = useMemo(() => ({
    total: state.items.length,
    published: state.items.filter((i) => i.status === 'published').length,
    reserved: state.items.filter((i) => (i.stats?.pending_purchases || 0) > 0).length,
    sold: state.items.filter((i) => i.status === 'sold').length,
    unlisted: state.items.filter((i) => i.visibility === 'unlisted').length
  }), [state.items]);

  const sellerStats = useMemo(() => ({
    paidTon: Number(
      groupedPurchases
        .filter((p) => p.status === 'paid')
        .reduce((s, p) => s + Number(p.amount_ton || 0), 0)
        .toFixed(4)
    )
  }), [groupedPurchases]);

  const purchaseSummary = useMemo(() => ({
    total: groupedPurchases.length,
    pending: groupedPurchases.filter((p) => p.status === 'pending').length,
    awaiting_receipt: groupedPurchases.filter((p) => p.status === 'awaiting_receipt').length,
    rejected: groupedPurchases.filter((p) => p.status === 'rejected').length,
    paid: groupedPurchases.filter((p) => p.status === 'paid').length,
    expired: groupedPurchases.filter((p) => p.status === 'expired').length,
    completed: groupedPurchases.filter((p) => p.ownership_transfer_status === 'completed').length,
    failed: groupedPurchases.filter((p) => p.ownership_transfer_status === 'failed').length
  }), [groupedPurchases]);

  const receiptQueue = useMemo(
    () => groupedPurchases.filter((p) => p.status === 'awaiting_receipt'),
    [groupedPurchases]
  );

  return {
    canUseAssetSeller,
    filteredItems,
    filteredPurchases,
    itemSummary,
    sellerStats,
    purchaseSummary,
    receiptQueue
  };
}
