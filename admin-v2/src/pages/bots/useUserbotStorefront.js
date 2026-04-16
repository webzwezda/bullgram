import { useEffect, useState } from 'react';
import { apiRequest } from '../../api/client.js';
import {
  batchUserbotLotPaymentMethods,
  isUserbotPurchase,
  isUserbotShopItem,
  normalizeOpenUserbotPurchaseGroup,
  userbotLotPaymentMethods
} from './bots-accounts.utils.js';

export function useUserbotStorefront({
  accessToken,
  profileRole,
  showUiMessage
}) {
  const [storefrontState, setStorefrontState] = useState({
    loading: true,
    error: '',
    items: [],
    purchases: []
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
  const [receiptNote, setReceiptNote] = useState('');
  const [receiptFile, setReceiptFile] = useState(null);
  const [selectedOpenPurchaseId, setSelectedOpenPurchaseId] = useState('');
  const [userbotBuyQuantity, setUserbotBuyQuantity] = useState({
    userbot: 1,
    bundle: 1
  });

  useEffect(() => {
    let cancelled = false;

    async function loadStorefront() {
      if (!accessToken || profileRole === 'admin') {
        setStorefrontState({
          loading: false,
          error: '',
          items: [],
          purchases: []
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
          purchases: (purchasesData.purchases || []).filter(isUserbotPurchase)
        });
      } catch (error) {
        if (cancelled) return;

        setStorefrontState({
          loading: false,
          error: error.message,
          items: [],
          purchases: []
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
      purchases
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
        purchase: {
          id: data.purchase_id,
          amount_ton: data.amount_ton,
          amount_rub: data.amount_rub || item.price_rub || 0,
          payment_method: data.payment_method || selectedPaymentMethod,
          seller_wallet: data.seller_wallet || '',
          memo: data.memo || '',
          ton_uri: data.ton_uri || '',
          trust_wallet_uri: data.trust_wallet_uri || '',
          trust_wallet_qr: data.trust_wallet_qr || '',
          ton_qr: data.ton_qr || '',
          expires_at: data.expires_at || null,
          status: 'pending',
          sbp_phone: data.sbp_phone || '',
          sbp_bank: data.sbp_bank || '',
          sbp_fio: data.sbp_fio || '',
          receipt_file_url: ''
        }
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
        purchase: existingPurchase ? {
          id: existingPurchase.id,
          amount_ton: existingPurchase.amount_ton,
          amount_rub: existingPurchase.amount_rub || 0,
          payment_method: existingPurchase.payload?.payment_method || selectedPaymentMethod,
          seller_wallet: existingPurchase.payload?.seller_wallet || '',
          memo: existingPurchase.payload?.memo || '',
          ton_uri: existingPurchase.payload?.ton_uri || '',
          trust_wallet_uri: existingPurchase.payload?.trust_wallet_uri || '',
          trust_wallet_qr: existingPurchase.payload?.trust_wallet_qr || '',
          ton_qr: existingPurchase.payload?.ton_qr || '',
          expires_at: existingPurchase.expires_at || null,
          status: existingPurchase.status,
          sbp_phone: existingPurchase.payload?.sbp_phone || '',
          sbp_bank: existingPurchase.payload?.sbp_bank || '',
          sbp_fio: existingPurchase.payload?.sbp_fio || '',
          receipt_file_url: existingPurchase.payload?.receipt_file_url || ''
        } : null,
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

    setCheckoutState({
      item: {
        item_type: batchItems[0]?.item_type || 'userbot',
        title: batchItems[0]?.item_type === 'bundle' ? `Аккаунты + прокси x${batchItems.length}` : `Аккаунты x${batchItems.length}`
      },
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
        item: {
          item_type: batchItems[0]?.item_type || 'userbot',
          title: batchItems[0]?.item_type === 'bundle' ? `Аккаунты + прокси x${batchItems.length}` : `Аккаунты x${batchItems.length}`
        },
        purchase: {
          id: data.batch_token || data.purchase_ids?.[0] || '',
          purchase_ids: data.purchase_ids || [],
          amount_ton: data.amount_ton,
          amount_rub: data.amount_rub || 0,
          payment_method: data.payment_method || selectedPaymentMethod,
          seller_wallet: data.seller_wallet || '',
          memo: data.memo || '',
          ton_uri: data.ton_uri || '',
          trust_wallet_uri: data.trust_wallet_uri || '',
          trust_wallet_qr: data.trust_wallet_qr || '',
          ton_qr: data.ton_qr || '',
          expires_at: data.expires_at || null,
          status: 'pending',
          sbp_phone: data.sbp_phone || '',
          sbp_bank: data.sbp_bank || '',
          sbp_fio: data.sbp_fio || '',
          receipt_file_url: '',
          batch: true
        },
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

  async function checkUserbotCheckout() {
    if (!checkoutState.purchase?.id) return;

    setCheckoutState((prev) => ({
      ...prev,
      checking: true,
      error: '',
      notice: '',
      noticeTone: 'default'
    }));

    try {
      let result;
      if (Array.isArray(checkoutState.purchase?.purchase_ids) && checkoutState.purchase.purchase_ids.length > 1) {
        result = await apiRequest('/api/shop/public/purchase/check-batch', {
          accessToken,
          method: 'POST',
          body: {
            purchase_ids: checkoutState.purchase.purchase_ids
          }
        });
      } else {
        result = await apiRequest('/api/shop/public/purchase/check', {
          accessToken,
          method: 'POST',
          body: {
            purchase_id: checkoutState.purchase.id
          }
        });
      }

      const purchases = await refreshPurchases();
      const targetIds = Array.isArray(checkoutState.purchase?.purchase_ids) && checkoutState.purchase.purchase_ids.length
        ? checkoutState.purchase.purchase_ids.map((value) => String(value))
        : [String(checkoutState.purchase.id)];
      const refreshed = purchases.filter((purchase) => targetIds.includes(String(purchase.id)));

      const noticeTone = result?.status === 'paid' ? 'success' : result?.status === 'awaiting_receipt' ? 'warning' : 'default';
      const notice = result?.status === 'paid'
        ? 'Оплата найдена. Дальше ждём передачу актива.'
        : result?.status === 'awaiting_receipt'
          ? 'Чек уже отправлен продавцу. Жди ручную проверку.'
          : result?.status === 'rejected'
            ? 'Продавец отклонил этот платёж. Проверь детали и создай покупку заново.'
            : 'Оплата пока не найдена. Проверь сумму, memo и попробуй ещё раз через минуту.';

      if (refreshed.length === 1) {
        showUserbotPurchaseInline(refreshed[0]);
        setCheckoutState((prev) => ({
          ...prev,
          checking: false,
          notice,
          noticeTone
        }));
      } else if (refreshed.length > 1) {
        showUserbotPurchaseInline(normalizeOpenUserbotPurchaseGroup(refreshed));
        setCheckoutState((prev) => ({
          ...prev,
          checking: false,
          notice,
          noticeTone
        }));
      } else {
        setCheckoutState((prev) => ({
          ...prev,
          checking: false,
          purchase: prev.purchase ? {
            ...prev.purchase,
            status: result?.status || prev.purchase.status
          } : prev.purchase,
          notice,
          noticeTone
        }));
      }
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

  function showUserbotPurchaseInline(purchase) {
    setCheckoutState({
      item: purchase.item || null,
      purchase: {
        id: purchase.id,
        purchase_ids: purchase.purchase_ids || [purchase.id],
        amount_ton: purchase.amount_ton,
        amount_rub: purchase.amount_rub || 0,
        payment_method: purchase.payload?.payment_method || 'ton',
        seller_wallet: purchase.payload?.seller_wallet || '',
        memo: purchase.payload?.memo || '',
        ton_uri: purchase.payload?.ton_uri || '',
        trust_wallet_uri: purchase.payload?.trust_wallet_uri || '',
        trust_wallet_qr: purchase.payload?.trust_wallet_qr || '',
        ton_qr: purchase.payload?.ton_qr || '',
        expires_at: purchase.expires_at || null,
        status: purchase.status,
        sbp_phone: purchase.payload?.sbp_phone || '',
        sbp_bank: purchase.payload?.sbp_bank || '',
        sbp_fio: purchase.payload?.sbp_fio || '',
        receipt_file_url: purchase.payload?.receipt_file_url || '',
        batch: !!purchase.batch
      },
      paymentMethod: purchase.payload?.payment_method || 'ton',
      loading: false,
      checking: false,
      error: '',
      notice: '',
      noticeTone: 'default'
    });
  }

  async function markUserbotCheckoutPaid() {
    if (!checkoutState.purchase?.id) return;

    setCheckoutState((prev) => ({
      ...prev,
      checking: true,
      error: '',
      notice: '',
      noticeTone: 'default'
    }));

    try {
      const formData = new FormData();
      formData.append('receipt_note', receiptNote);
      if (receiptFile) {
        formData.append('receipt_file', receiptFile);
      }
      if (Array.isArray(checkoutState.purchase?.purchase_ids) && checkoutState.purchase.purchase_ids.length > 1) {
        formData.append('purchase_ids', checkoutState.purchase.purchase_ids.join(','));
        await apiRequest('/api/shop/public/purchase/mark-paid-batch', {
          accessToken,
          method: 'POST',
          body: formData
        });
      } else {
        formData.append('purchase_id', checkoutState.purchase.id);
        await apiRequest('/api/shop/public/purchase/mark-paid', {
          accessToken,
          method: 'POST',
          body: formData
        });
      }

      const purchases = await refreshPurchases();
      const refreshed = purchases.filter((purchase) =>
        (checkoutState.purchase.purchase_ids || [checkoutState.purchase.id]).includes(purchase.id)
      );
      setReceiptNote('');
      setReceiptFile(null);
      if (refreshed.length === 1) {
        showUserbotPurchaseInline(refreshed[0]);
      } else if (refreshed.length > 1) {
        showUserbotPurchaseInline(normalizeOpenUserbotPurchaseGroup(refreshed));
      }
      setCheckoutState((prev) => ({
        ...prev,
        checking: false
      }));
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
      setCheckoutState({
        item: null,
        purchase: null,
        paymentMethod: 'ton',
        loading: false,
        checking: false,
        error: '',
        notice: '',
        noticeTone: 'default'
      });
      setReceiptNote('');
      setReceiptFile(null);
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
    checkUserbotCheckout,
    checkoutState,
    createUserbotBatchCheckout,
    markUserbotCheckoutPaid,
    openUserbotCheckout,
    receiptFile,
    receiptNote,
    selectedOpenPurchaseId,
    setCheckoutState,
    setReceiptFile,
    setReceiptNote,
    setSelectedOpenPurchaseId,
    setUserbotBuyQuantity,
    showUserbotPurchaseInline,
    storefrontState,
    userbotBuyQuantity
  };
}
