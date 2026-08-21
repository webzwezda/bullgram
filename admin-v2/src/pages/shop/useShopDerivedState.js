import { useMemo } from 'react';
import { normalizeSellerPurchaseGroup } from './shop.utils.js';

export function useShopDerivedState({ state }) {
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

  return {
    itemSummary,
    sellerStats,
    purchaseSummary
  };
}
