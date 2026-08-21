import { useCallback } from 'react';
import { toast } from 'sonner';
import { apiRequest } from '../../api/client.js';
import { INITIAL_FORM_STATE } from './shop.utils.js';

export function useShopMutations({ accessToken, state, setState, loadShop, formState, setFormState, canUseAssetSeller }) {

  const saveItem = useCallback(async () => {
    setState((prev) => ({ ...prev, saving: true, error: '' }));
    try {
      const body = {
        title: formState.title,
        description: formState.description,
        preview_text: formState.preview_text,
        post_purchase_message: formState.post_purchase_message,
        offer_code: formState.offer_code || null,
        item_type: 'text_offer',
        sales_channel: formState.sales_channel,
        payment_methods: formState.payment_methods,
        price_ton: Number(formState.price_ton || 0),
        status: formState.status,
        visibility: formState.visibility,
        transfer_mode: 'post_purchase_message',
        assets: []
      };

      await apiRequest('/api/shop/seller/items', { accessToken, method: 'POST', body });
      setFormState({ ...INITIAL_FORM_STATE });
      await loadShop();
      setState((prev) => ({ ...prev, saving: false }));
      toast.success('Оффер создан');
    } catch (error) {
      setState((prev) => ({ ...prev, saving: false, error: error.message }));
      toast.error(error.message);
    }
  }, [accessToken, formState, loadShop, setFormState, setState]);

  const unpublishItem = useCallback(async (itemId) => {
    try {
      await apiRequest(`/api/shop/seller/items/${itemId}/unpublish`, { accessToken, method: 'POST' });
      await loadShop();
      toast.success('Товар снят с витрины');
    } catch (error) {
      toast.error(error.message);
    }
  }, [accessToken, loadShop]);

  const deleteItem = useCallback(async (itemId) => {
    try {
      const result = await apiRequest(`/api/shop/seller/items/${itemId}`, { accessToken, method: 'DELETE' });
      setState((prev) => ({
        ...prev,
        items: prev.items.filter((i) => String(i.id) !== String(result.deleted_item_id || itemId))
      }));
      await loadShop();
      toast.success('Товар удалён');
    } catch (error) {
      toast.error(error.message);
    }
  }, [accessToken, loadShop, setState]);

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
    saveItem,
    unpublishItem,
    deleteItem,
    checkPurchase
  };
}
