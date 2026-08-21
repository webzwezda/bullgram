import { useCallback } from 'react';
import { toast } from 'sonner';
import { apiRequest } from '../../api/client.js';

export function useShopMutations({ accessToken, loadShop }) {

  const checkPurchase = useCallback(async (target) => {
    const purchaseIds = Array.isArray(target?.purchase_ids) && target.purchase_ids.length
      ? target.purchase_ids
      : [target?.id || target].filter(Boolean);
    try {
      if (purchaseIds.length > 1) {
        await apiRequest('/api/shop/seller/purchases/check-batch', { accessToken, method: 'POST', body: { purchase_ids: purchaseIds } });
      } else {
        await apiRequest(`/api/shop/seller/purchases/${purchaseIds[0]}/check`, { accessToken, method: 'POST' });
      }
      await loadShop();
      toast.success('Статус обновлён');
    } catch (error) {
      toast.error(error.message);
    }
  }, [accessToken, loadShop]);

  return {
    checkPurchase
  };
}
