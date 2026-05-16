import { useCallback } from 'react';
import { toast } from 'sonner';
import { apiRequest } from '../../api/client.js';
import {
  INITIAL_FORM_STATE,
  INITIAL_PROXY_COMPOSER,
  purchaseAssetText,
  purchaseHasAssetType
} from './shop.utils.js';

export function useShopMutations({ accessToken, state, setState, loadShop, formState, setFormState, proxyComposer, setProxyComposer, saleProxies, canUseAssetSeller, planRules }) {

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
        price_rub: Number(formState.price_rub || 0),
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

  const approvePurchase = useCallback(async (target) => {
    const purchaseIds = Array.isArray(target?.purchase_ids) && target.purchase_ids.length
      ? target.purchase_ids
      : [target?.id || target].filter(Boolean);
    try {
      if (purchaseIds.length > 1) {
        await apiRequest('/api/shop/seller/purchases/approve-batch', { accessToken, method: 'POST', body: { purchase_ids: purchaseIds } });
      } else {
        await apiRequest(`/api/shop/seller/purchases/${purchaseIds[0]}/approve`, { accessToken, method: 'POST' });
      }
      await loadShop();
      toast.success('Заказ подтверждён');
    } catch (error) {
      toast.error(error.message);
    }
  }, [accessToken, loadShop]);

  const rejectPurchase = useCallback(async (target) => {
    const purchaseIds = Array.isArray(target?.purchase_ids) && target.purchase_ids.length
      ? target.purchase_ids
      : [target?.id || target].filter(Boolean);
    try {
      if (purchaseIds.length > 1) {
        await apiRequest('/api/shop/seller/purchases/reject-batch', { accessToken, method: 'POST', body: { purchase_ids: purchaseIds } });
      } else {
        await apiRequest(`/api/shop/seller/purchases/${purchaseIds[0]}/reject`, { accessToken, method: 'POST', body: {} });
      }
      await loadShop();
      toast.success('Заказ отклонён');
    } catch (error) {
      toast.error(error.message);
    }
  }, [accessToken, loadShop]);

  const openProxyComposer = useCallback((proxy) => {
    setProxyComposer({
      proxyId: String(proxy.id),
      title: proxy.name || `Прокси ${proxy.host}:${proxy.port}`,
      preview_text: 'Готовый серверный SOCKS5-прокси для одного Telegram-аккаунта.',
      description: `Прокси ${proxy.host}:${proxy.port}${proxy.last_check_country ? ` • ${proxy.last_check_country}` : ''}. Один прокси = один юзербот.`,
      sales_channel: 'admin_only',
      payment_methods: ['ton', 'p2p', 'robokassa'],
      price_ton: '5',
      price_rub: '',
      status: 'published',
      visibility: 'public',
      saving: false,
      error: ''
    });
  }, [setProxyComposer]);

  const resetProxyComposer = useCallback(() => {
    setProxyComposer({ ...INITIAL_PROXY_COMPOSER });
  }, [setProxyComposer]);

  const saveProxyComposer = useCallback(async () => {
    const proxy = saleProxies.find((p) => String(p.id) === String(proxyComposer.proxyId));
    if (!proxy) {
      setProxyComposer((prev) => ({ ...prev, error: 'Прокси не найден.' }));
      return;
    }
    setProxyComposer((prev) => ({ ...prev, saving: true, error: '' }));
    try {
      await apiRequest('/api/shop/seller/items', {
        accessToken,
        method: 'POST',
        body: {
          title: proxyComposer.title,
          description: proxyComposer.description,
          preview_text: proxyComposer.preview_text,
          payment_methods: proxyComposer.payment_methods,
          post_purchase_message: null,
          offer_code: null,
          item_type: 'proxy',
          sales_channel: proxyComposer.sales_channel,
          price_ton: Number(proxyComposer.price_ton || 0),
          price_rub: Number(proxyComposer.price_rub || 0),
          status: proxyComposer.status,
          visibility: 'public',
          transfer_mode: 'ownership_transfer',
          assets: [{ asset_type: 'proxy', asset_id: proxy.id, label: proxy.name || `${proxy.host}:${proxy.port}` }]
        }
      });
      await loadShop();
      resetProxyComposer();
      toast.success('Прокси выставлен на продажу');
    } catch (error) {
      setProxyComposer((prev) => ({ ...prev, saving: false, error: error.message }));
      toast.error(error.message);
    }
  }, [accessToken, loadShop, proxyComposer, resetProxyComposer, saleProxies, setProxyComposer]);

  return {
    saveItem,
    unpublishItem,
    deleteItem,
    checkPurchase,
    approvePurchase,
    rejectPurchase,
    openProxyComposer,
    resetProxyComposer,
    saveProxyComposer
  };
}
