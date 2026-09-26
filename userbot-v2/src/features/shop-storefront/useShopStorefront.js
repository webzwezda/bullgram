import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../../api/client.js';

const DEFAULT_NETWORK = 'mainnet';

function shopItemPaymentMethods(item) {
  const source = Array.isArray(item?.available_payment_methods)
    ? item.available_payment_methods
    : Array.isArray(item?.payment_methods) && item.payment_methods.length
      ? item.payment_methods
      : ['ton'];
  return source.filter((method) => method === 'ton');
}

function batchPaymentMethods(items) {
  const batchItems = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!batchItems.length) return ['ton'];

  const methods = batchItems.reduce((allowed, item, index) => {
    const itemMethods = shopItemPaymentMethods(item);
    if (index === 0) return itemMethods;
    return allowed.filter((method) => itemMethods.includes(method));
  }, []);

  return methods.length ? methods : shopItemPaymentMethods(batchItems[0]);
}

function purchaseShapeFromApiResponse(data, fallbackPaymentMethod, isBatch = false) {
  return {
    id: isBatch ? (data.batch_token || data.purchase_ids?.[0] || '') : data.purchase_id,
    purchase_ids: isBatch ? (data.purchase_ids || []) : null,
    amount_ton: data.amount_ton,
    amount_nanoton: data.amount_nanoton || '',
    payment_method: data.payment_method || fallbackPaymentMethod,
    seller_wallet: data.seller_wallet || '',
    memo: data.memo || '',
    ton_uri: data.ton_uri || '',
    trust_wallet_uri: data.trust_wallet_uri || '',
    trust_wallet_qr: data.trust_wallet_qr || '',
    ton_qr: data.ton_qr || '',
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
    payment_method: row.payload?.payment_method || fallbackPaymentMethod,
    seller_wallet: row.payload?.seller_wallet || '',
    memo: row.payload?.memo || '',
    ton_uri: row.payload?.ton_uri || '',
    trust_wallet_uri: row.payload?.trust_wallet_uri || '',
    trust_wallet_qr: row.payload?.trust_wallet_qr || '',
    ton_qr: row.payload?.ton_qr || '',
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

function defaultBatchTitleFor(count, firstItem) {
  const base = firstItem?.title || 'Пакет';
  return count > 1 ? `${base} x${count}` : base;
}

export function useShopStorefront({
  accessToken,
  profileRole,
  showUiMessage,
  isShopItem,
  isPurchase,
  batchTitleFor = defaultBatchTitleFor,
  onAssetsChanged = null
}) {
  const [storefrontState, setStorefrontState] = useState({
    loading: true,
    error: '',
    items: [],
    purchases: [],
    network: DEFAULT_NETWORK
  });
  const [checkoutState, setCheckoutState] = useState(emptyCheckoutState());
  const [selectedOpenPurchaseId, setSelectedOpenPurchaseId] = useState('');
  const [buyQuantities, setBuyQuantities] = useState({});

  const refreshPurchasesRef = useRef(null);
  const onAssetsChangedRef = useRef(onAssetsChanged);
  useEffect(() => {
    onAssetsChangedRef.current = onAssetsChanged;
  }, [onAssetsChanged]);

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
          items: (itemsData.items || []).filter((item) => isShopItem(item)),
          purchases: (purchasesData.purchases || []).filter((purchase) => isPurchase(purchase)),
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
  }, [accessToken, profileRole, isShopItem, isPurchase]);

  async function refreshPurchases() {
    const purchasesData = await apiRequest('/api/shop/public/my-purchases', { accessToken });
    const purchases = (purchasesData.purchases || []).filter((purchase) => isPurchase(purchase));
    setStorefrontState((prev) => ({
      ...prev,
      purchases,
      network: purchasesData.network || prev.network || DEFAULT_NETWORK
    }));
    return purchases;
  }

  refreshPurchasesRef.current = refreshPurchases;

  async function openCheckout(item, preferredPaymentMethod = null) {
    const selectedPaymentMethod = shopItemPaymentMethods(item).includes(preferredPaymentMethod)
      ? preferredPaymentMethod
      : shopItemPaymentMethods(item).includes(checkoutState.paymentMethod)
        ? checkoutState.paymentMethod
        : (shopItemPaymentMethods(item)[0] || 'ton');

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

  async function createBatchCheckout(items, preferredPaymentMethod = null) {
    const batchItems = Array.isArray(items) ? items.filter(Boolean) : [];
    if (!batchItems.length) return;

    const availableMethods = batchPaymentMethods(batchItems);
    const selectedPaymentMethod = availableMethods.includes(preferredPaymentMethod)
      ? preferredPaymentMethod
      : (availableMethods[0] || 'ton');

    if (batchItems.length === 1) {
      await openCheckout(batchItems[0], selectedPaymentMethod);
      return;
    }

    const syntheticItem = {
      item_type: batchItems[0]?.item_type || '',
      title: batchTitleFor(batchItems.length, batchItems[0])
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
        error: error.message || 'Не удалось создать общую покупку.',
        notice: '',
        noticeTone: 'default'
      });
    }
  }

  function showPurchaseInline(purchase) {
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

  async function cancelCheckout(purchaseOverride = null) {
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
      if (onAssetsChanged) await onAssetsChanged().catch(() => null);
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

  // Ручная проверка оплаты (запасной способ без TonConnect).
  // /check возвращает 200 + status:'pending', пока платёж не найден —
  // различаем их, чтобы не рапортовать ложный успех.
  async function checkPurchase(purchaseOverride = null) {
    const targetPurchase = purchaseOverride || checkoutState.purchase;
    const targetIds = Array.isArray(targetPurchase?.purchase_ids) && targetPurchase.purchase_ids.length
      ? targetPurchase.purchase_ids
      : [targetPurchase?.id].filter(Boolean);
    if (!targetIds.length) return null;

    setCheckoutState((prev) => ({
      ...prev,
      checking: true,
      error: ''
    }));

    try {
      const data = targetIds.length > 1
        ? await apiRequest('/api/shop/public/purchase/check-batch', {
            accessToken,
            method: 'POST',
            body: { purchase_ids: targetIds }
          })
        : await apiRequest('/api/shop/public/purchase/check', {
            accessToken,
            method: 'POST',
            body: { purchase_id: targetIds[0] }
          });

      const paid = data?.status === 'paid';
      await refreshPurchases();

      if (paid) {
        if (onAssetsChanged) await onAssetsChanged().catch(() => null);
        setCheckoutState(emptyCheckoutState(checkoutState.paymentMethod));
        return 'paid';
      }

      setCheckoutState((prev) => ({
        ...prev,
        checking: false,
        error: 'Платёж пока не найден. Проверь memo и сумму перевода — потом нажми ещё раз.'
      }));
      return 'pending';
    } catch (error) {
      setCheckoutState((prev) => ({
        ...prev,
        checking: false,
        error: error.message
      }));
      return null;
    }
  }

  // После перезагрузки страницы чекаут не сохраняется — если есть свежая
  // pending-покупка, открываем её автоматически (один раз за заход, чтобы
  // ручной «Сбросить» не открывал панель заново).
  const autoRestoredRef = useRef(false);
  useEffect(() => {
    if (autoRestoredRef.current || storefrontState.loading) return;
    autoRestoredRef.current = true;
    if (checkoutState.purchase) return;
    const pendingRows = (storefrontState.purchases || []).filter((p) => p.status === 'pending');
    if (!pendingRows.length) return;

    const first = pendingRows[0];
    const batchToken = first.payload?.batch_token;
    const batchRows = batchToken
      ? pendingRows.filter((p) => p.payload?.batch_token === batchToken)
      : [];

    if (batchRows.length > 1) {
      const nanoParts = batchRows.map((p) => String(p.amount_nanoton || '').trim()).filter(Boolean);
      let amountNanoTon = '';
      if (nanoParts.length === batchRows.length) {
        try {
          amountNanoTon = nanoParts.reduce((sum, value) => sum + BigInt(value), 0n).toString();
        } catch {
          amountNanoTon = '';
        }
      }
      const expiresAt = batchRows
        .map((p) => (p.expires_at ? new Date(p.expires_at).getTime() : null))
        .filter(Number.isFinite)
        .sort((left, right) => left - right)[0];

      showPurchaseInline({
        ...first,
        id: batchToken,
        purchase_ids: batchRows.map((p) => p.id),
        amount_ton: batchRows.reduce((sum, p) => sum + Number(p.amount_ton || 0), 0),
        amount_nanoton: amountNanoTon,
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : first.expires_at,
        batch: true
      });
    } else {
      showPurchaseInline(first);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storefrontState.loading, storefrontState.purchases]);

  // Тихая автопроверка оплаты: пока открыта pending-покупка, опрашиваем статус
  // без смены состояния. Реагируем только на paid/expired, чтобы панель не мигала.
  const activePurchaseId = checkoutState.purchase?.id || null;
  const activePurchaseStatus = checkoutState.purchase?.status || null;
  const activePurchaseIds = checkoutState.purchase?.purchase_ids || null;

  useEffect(() => {
    if (!accessToken || !activePurchaseId || activePurchaseStatus !== 'pending') return;

    let cancelled = false;
    const ids = Array.isArray(activePurchaseIds) && activePurchaseIds.length
      ? activePurchaseIds.map(String)
      : [String(activePurchaseId)];

    const timer = setInterval(async () => {
      if (cancelled) return;
      try {
        const data = ids.length > 1
          ? await apiRequest('/api/shop/public/purchase/check-batch', {
              accessToken,
              method: 'POST',
              body: { purchase_ids: ids }
            })
          : await apiRequest('/api/shop/public/purchase/check', {
              accessToken,
              method: 'POST',
              body: { purchase_id: ids[0] }
            });
        if (cancelled) return;

        if (data?.status === 'paid') {
          clearInterval(timer);
          await refreshPurchasesRef.current?.().catch(() => null);
          await onAssetsChangedRef.current?.().catch(() => null);
          if (!cancelled) {
            setCheckoutState((prev) => ({
              ...emptyCheckoutState(prev.paymentMethod),
              notice: 'Оплата найдена. Покупка завершена.',
              noticeTone: 'success'
            }));
          }
        } else if (data?.status === 'expired') {
          clearInterval(timer);
          await refreshPurchasesRef.current?.().catch(() => null);
          if (!cancelled) {
            setCheckoutState((prev) => ({
              ...emptyCheckoutState(prev.paymentMethod),
              notice: 'Время на оплату истекло — бронь снята, лот вернулся в продажу.',
              noticeTone: 'error'
            }));
          }
        }
      } catch {
        // сеть/5xx — попробуем на следующем тике
      }
    }, 15000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [accessToken, activePurchaseId, activePurchaseStatus, activePurchaseIds]);

  return {
    cancelCheckout,
    checkPurchase,
    checkoutState,
    createBatchCheckout,
    openCheckout,
    refreshPurchases,
    selectedOpenPurchaseId,
    setCheckoutState,
    setSelectedOpenPurchaseId,
    setBuyQuantities,
    showPurchaseInline,
    storefrontState,
    buyQuantities
  };
}
