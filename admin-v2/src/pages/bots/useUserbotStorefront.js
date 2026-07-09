import { useEffect, useState } from 'react';
import { apiRequest } from '../../api/client.js';
import {
  batchUserbotLotPaymentMethods,
  isUserbotPurchase,
  isUserbotShopItem,
  userbotLotPaymentMethods
} from './bots-accounts.utils.js';

const DEFAULT_NETWORK = 'mainnet';

function purchaseShapeFromApiResponse(data, fallbackPaymentMethod, isBatch = false) {
  return {
    id: isBatch ? (data.batch_token || data.purchase_ids?.[0] || '') : data.purchase_id,
    purchase_ids: isBatch ? (data.purchase_ids || []) : null,
    amount_ton: data.amount_ton,
    amount_nanoton: data.amount_nanoton || '',
    amount_rub: data.amount_rub || 0,
    payment_method: data.payment_method || fallbackPaymentMethod,
    seller_wallet: data.seller_wallet || '',
    memo: data.memo || '',
    expires_at: data.expires_at || null,
    network: data.network || DEFAULT_NETWORK,
    status: 'pending',
    batch: !!isBatch
  };
}

function purchaseShapeFromRow(row, fallbackPaymentMethod) {
  const isBatch = !!row.batch;
  return {
    id: row.id,
    purchase_ids: isBatch ? (row.purchase_ids || [row.id]) : null,
    amount_ton: Number(row.amount_ton || 0),
    amount_nanoton: row.amount_nanoton || '',
    amount_rub: Number(row.amount_rub || 0),
    payment_method: row.payload?.payment_method || fallbackPaymentMethod,
    seller_wallet: row.payload?.seller_wallet || '',
    memo: row.payload?.memo || '',
    expires_at: row.expires_at || null,
    network: row.network || DEFAULT_NETWORK,
    status: row.status,
    batch: isBatch
  };
}

function emptyCheckoutState(prevPaymentMethod = 'ton') {
  return {
    item: null,
    purchase: null,
    paymentMethod: prevPaymentMethod,
    loading: false,
    checking: false,
    error: '',
    notice: '',
    noticeTone: 'default'
  };
}

export function useUserbotStorefront({
  accessToken,
  profileRole,
  showUiMessage
}) {
  const [storefrontState, setStorefrontState] = useState({
    loading: true,
    error: '',
    items: [],
    purchases: [],
    network: DEFAULT_NETWORK
  });
  const [checkoutState, setCheckoutState] = useState({
    item: null,
    purchase: null,
    paymentMethod: 'ton',
    loading: false,
    checking: false,
    error: '',
    notice: '',
    noticeTone: 'default'
  });
  const [selectedOpenPurchaseId, setSelectedOpenPurchaseId] = useState('');
  const [userbotBuyQuantity, setUserbotBuyQuantity] = useState({
    userbot: 1,
    bundle: 1
  });

  useEffect(() => {
    let cancelled = false;

    async function loadStorefront() {
      if (!accessToken) {
        setStorefrontState({
          loading: false,
          error: '',
          items: [],
          purchases: [],
          network: DEFAULT_NETWORK
        });
        return;
      }

      try {
        const [itemsData, purchasesData] = await Promise.all([
          apiRequest('/api/shop/app/items', { accessToken }),
          apiRequest('/api/shop/public/my-purchases', { accessToken })
        ]);

        if (cancelled) return;

        setStorefrontState({
          loading: false,
          error: '',
          items: (itemsData.items || []).filter(isUserbotShopItem),
          purchases: (purchasesData.purchases || []).filter(isUserbotPurchase),
          network: purchasesData.network || DEFAULT_NETWORK
        });
      } catch (error) {
        if (cancelled) return;

        setStorefrontState({
          loading: false,
          error: error.message,
          items: [],
          purchases: [],
          network: DEFAULT_NETWORK
        });
      }
    }

    loadStorefront();

    return () => {
      cancelled = true;
    };
  }, [accessToken, profileRole]);

  async function refreshPurchases() {
    const purchasesData = await apiRequest('/api/shop/public/my-purchases', { accessToken });
    const purchases = (purchasesData.purchases || []).filter(isUserbotPurchase);
    setStorefrontState((prev) => ({
      ...prev,
      purchases,
      network: purchasesData.network || prev.network || DEFAULT_NETWORK
    }));
    return purchases;
  }

  async function openUserbotCheckout(item, preferredPaymentMethod = null) {
    const selectedPaymentMethod = userbotLotPaymentMethods(item).includes(preferredPaymentMethod)
      ? preferredPaymentMethod
      : userbotLotPaymentMethods(item).includes(checkoutState.paymentMethod)
        ? checkoutState.paymentMethod
        : (userbotLotPaymentMethods(item)[0] || 'ton');

    setCheckoutState({
      item,
      purchase: null,
      paymentMethod: selectedPaymentMethod,
      loading: true,
      checking: false,
      error: '',
      notice: '',
      noticeTone: 'default'
    });

    try {
      const data = await apiRequest('/api/shop/public/purchase', {
        accessToken,
        method: 'POST',
        body: {
          item_id: item.id,
          payment_method: selectedPaymentMethod
        }
      });

      await refreshPurchases();

      setCheckoutState({
        item,
        paymentMethod: selectedPaymentMethod,
        loading: false,
        checking: false,
        error: '',
        notice: '',
        noticeTone: 'default',
        purchase: purchaseShapeFromApiResponse(data, selectedPaymentMethod, false)
      });
    } catch (error) {
      let existingPurchase = null;
      try {
        const purchases = await refreshPurchases();
        existingPurchase = purchases.find((purchase) => (
          String(purchase.item?.id || '') === String(item.id) &&
          (purchase.status === 'pending' || purchase.status === 'awaiting_receipt' || purchase.status === 'paid')
        )) || null;
      } catch {
        existingPurchase = null;
      }

      setCheckoutState({
        item,
        paymentMethod: selectedPaymentMethod,
        purchase: existingPurchase ? purchaseShapeFromRow(existingPurchase, selectedPaymentMethod) : null,
        loading: false,
        checking: false,
        error: error.message,
        notice: '',
        noticeTone: 'default'
      });
    }
  }

  async function createUserbotBatchCheckout(items, preferredPaymentMethod = null) {
    const batchItems = Array.isArray(items) ? items.filter(Boolean) : [];
    if (!batchItems.length) return;

    const availableMethods = batchUserbotLotPaymentMethods(batchItems);
    const selectedPaymentMethod = availableMethods.includes(preferredPaymentMethod)
      ? preferredPaymentMethod
      : (availableMethods[0] || 'ton');

    if (batchItems.length === 1) {
      await openUserbotCheckout(batchItems[0], selectedPaymentMethod);
      return;
    }

    const syntheticItem = {
      item_type: batchItems[0]?.item_type || 'userbot',
      title: batchItems[0]?.item_type === 'bundle' ? `Аккаунты + прокси x${batchItems.length}` : `Аккаунты x${batchItems.length}`
    };

    setCheckoutState({
      item: syntheticItem,
      purchase: null,
      paymentMethod: selectedPaymentMethod,
      loading: true,
      checking: false,
      error: '',
      notice: '',
      noticeTone: 'default'
    });

    try {
      const data = await apiRequest('/api/shop/public/purchase/batch', {
        accessToken,
        method: 'POST',
        body: {
          item_ids: batchItems.map((item) => item.id),
          payment_method: selectedPaymentMethod
        }
      });

      await refreshPurchases();

      setCheckoutState({
        item: syntheticItem,
        purchase: purchaseShapeFromApiResponse(data, selectedPaymentMethod, true),
        paymentMethod: selectedPaymentMethod,
        loading: false,
        checking: false,
        error: '',
        notice: '',
        noticeTone: 'default'
      });
    } catch (error) {
      await refreshPurchases().catch(() => null);
      setCheckoutState({
        item: null,
        purchase: null,
        paymentMethod: selectedPaymentMethod,
        loading: false,
        checking: false,
        error: error.message || 'Не удалось создать общую покупку аккаунтов.',
        notice: '',
        noticeTone: 'default'
      });
    }
  }

  function showUserbotPurchaseInline(purchase) {
    setCheckoutState({
      item: purchase.item || null,
      purchase: purchaseShapeFromRow(purchase, 'ton'),
      paymentMethod: purchase.payload?.payment_method || 'ton',
      loading: false,
      checking: false,
      error: '',
      notice: '',
      noticeTone: 'default'
    });
  }

  async function cancelUserbotCheckout(purchaseOverride = null) {
    const targetPurchase = purchaseOverride || checkoutState.purchase;
    const targetIds = Array.isArray(targetPurchase?.purchase_ids) && targetPurchase.purchase_ids.length
      ? targetPurchase.purchase_ids
      : [targetPurchase?.id].filter(Boolean);
    if (!targetIds.length) return;
    if (!window.confirm('Отменить покупку и снять бронь?')) return;

    setCheckoutState((prev) => ({
      ...prev,
      checking: true,
      error: '',
      notice: '',
      noticeTone: 'default'
    }));

    try {
      if (targetIds.length > 1) {
        await apiRequest('/api/shop/public/purchase/cancel-batch', {
          accessToken,
          method: 'POST',
          body: {
            purchase_ids: targetIds
          }
        });
      } else {
        await apiRequest('/api/shop/public/purchase/cancel', {
          accessToken,
          method: 'POST',
          body: {
            purchase_id: targetIds[0]
          }
        });
      }

      await refreshPurchases();
      setCheckoutState(emptyCheckoutState(checkoutState.paymentMethod));
      showUiMessage('Покупка отменена, бронь снята.', 'success');
    } catch (error) {
      setCheckoutState((prev) => ({
        ...prev,
        checking: false,
        error: error.message,
        notice: '',
        noticeTone: 'default'
      }));
    }
  }

  return {
    cancelUserbotCheckout,
    checkoutState,
    createUserbotBatchCheckout,
    openUserbotCheckout,
    refreshPurchases,
    selectedOpenPurchaseId,
    setCheckoutState,
    setSelectedOpenPurchaseId,
    setUserbotBuyQuantity,
    showUserbotPurchaseInline,
    storefrontState,
    userbotBuyQuantity
  };
}
