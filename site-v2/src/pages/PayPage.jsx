import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiRequest } from '../api/client.js';
import { PaymentView } from './sections/PaymentView.jsx';
import { SkeletonView, ErrorView, PaidView, ExpiredView, CancelledView } from './sections/PayViews.jsx';

const POLL_INTERVAL_MS = 10000;
const MAX_RETRIES = 3;
const SHOP_VIEW_ENDPOINT = (id) => `/api/shop/public/purchase/${id}/public-view`;
const INVOICE_VIEW_ENDPOINT = (id) => `/api/invoices/public/${id}/public-view`;
const PUBLIC_INVOICE_VIEW_ENDPOINT = (id) => `/api/public-invoices/public/${id}/public-view`;
const BILLING_VIEW_ENDPOINT = (id) => `/api/billing/public/${id}/public-view`;
const SHOP_VERIFY_ENDPOINT = (id) => `/api/shop/public/purchase/${id}/verify-public`;
const INVOICE_VERIFY_ENDPOINT = (id) => `/api/invoices/public/${id}/verify-public`;
const PUBLIC_INVOICE_VERIFY_ENDPOINT = (id) => `/api/public-invoices/public/${id}/verify-public`;
const BILLING_VERIFY_ENDPOINT = (id) => `/api/billing/public/${id}/verify-public`;
const PROCESSING_STATUSES = ['awaiting_receipt', 'wait_admin'];

function isProcessingStatus(status) {
  return PROCESSING_STATUSES.includes(status);
}

function isExpired(purchase) {
  if (purchase?.status === 'expired') return true;
  if (!purchase?.expires_at) return false;
  return new Date(purchase.expires_at).getTime() <= Date.now();
}

function shortWallet(addr) {
  if (!addr) return '';
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-8)}`;
}

// Счёт — тихая колонка по центру (sketch «Центр 720»): max-w-2xl ≈ 672px —
// QR и кнопки кошельков встают в ряд, карточка не теряется и не растягивается.
function PayPageFrame({ children }) {
  return <div className="mx-auto w-full max-w-2xl">{children}</div>;
}

export function PayPage() {
  const { purchaseId } = useParams();
  const [purchase, setPurchase] = useState(null);
  const [purchaseKind, setPurchaseKind] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryCount, setRetryCount] = useState(0);
  const [verifying, setVerifying] = useState(false);
  const [manualVerifying, setManualVerifying] = useState(false);
  const [manualMessage, setManualMessage] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [cancelError, setCancelError] = useState('');
  const timerRef = useRef(null);
  const retryTimeoutRef = useRef(null);
  const [loadedPurchaseId, setLoadedPurchaseId] = useState(purchaseId);

  if (loadedPurchaseId !== purchaseId) {
    setLoadedPurchaseId(purchaseId);
    setPurchase(null);
    setPurchaseKind(null);
    setRetryCount(0);
    setVerifying(false);
    setManualVerifying(false);
    setManualMessage('');
    setCancelling(false);
    setCancelled(false);
    setCancelError('');
    setError('');
    setLoading(true);
  }

  const fetchPurchase = useCallback(async (isRetry = false) => {
    try {
      let data;
      if (purchaseKind === 'shop') {
        data = await apiRequest(SHOP_VIEW_ENDPOINT(purchaseId));
      } else if (purchaseKind === 'invoice') {
        data = await apiRequest(INVOICE_VIEW_ENDPOINT(purchaseId));
      } else if (purchaseKind === 'public_invoice') {
        data = await apiRequest(PUBLIC_INVOICE_VIEW_ENDPOINT(purchaseId));
      } else if (purchaseKind === 'billing') {
        data = await apiRequest(BILLING_VIEW_ENDPOINT(purchaseId));
      } else {
        const [shopRes, invoiceRes, publicRes, billingRes] = await Promise.allSettled([
          apiRequest(SHOP_VIEW_ENDPOINT(purchaseId)),
          apiRequest(INVOICE_VIEW_ENDPOINT(purchaseId)),
          apiRequest(PUBLIC_INVOICE_VIEW_ENDPOINT(purchaseId)),
          apiRequest(BILLING_VIEW_ENDPOINT(purchaseId)),
        ]);
        if (shopRes.status === 'fulfilled') {
          data = shopRes.value;
          setPurchaseKind('shop');
        } else if (billingRes.status === 'fulfilled') {
          data = billingRes.value;
          setPurchaseKind('billing');
        } else if (invoiceRes.status === 'fulfilled') {
          data = invoiceRes.value;
          setPurchaseKind('invoice');
        } else if (publicRes.status === 'fulfilled') {
          data = publicRes.value;
          setPurchaseKind('public_invoice');
        } else {
          const shopErr = shopRes.reason;
          const invoiceErr = invoiceRes.reason;
          const publicErr = publicRes.reason;
          const billingErr = billingRes.reason;
          if (shopErr && shopErr.status !== 404) throw shopErr;
          if (billingErr && billingErr.status !== 404) throw billingErr;
          if (invoiceErr && invoiceErr.status !== 404) throw invoiceErr;
          if (publicErr && publicErr.status !== 404) throw publicErr;
          throw shopErr || billingErr || invoiceErr || publicErr || new Error('Счёт не найден');
        }
      }
      setPurchase(data);
      setError('');
      setRetryCount(0);
      if (data?.status !== 'pending') setVerifying(false);
    } catch (e) {
      if (isRetry && retryCount < MAX_RETRIES) {
        const delay = 2000 * (retryCount + 1);
        setRetryCount((c) => c + 1);
        retryTimeoutRef.current = setTimeout(() => fetchPurchase(true), delay);
        return;
      }
      setError(e.message || 'Не удалось загрузить счёт');
    } finally {
      setLoading(false);
    }
  }, [purchaseId, retryCount, purchaseKind]);

  useEffect(() => {
    fetchPurchase();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
    };
  }, [purchaseId]);

  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    // покупка отменена — счёт удалён, опрашивать нечего
    if (cancelled) return;
    const billingAwaitingFulfillment = purchase?.status === 'paid'
      && purchaseKind === 'billing'
      && purchase?.fulfillment_status !== 'completed';
    if (purchase?.status === 'pending' && !error) {
      timerRef.current = setInterval(() => {
        fetchPurchase();
      }, POLL_INTERVAL_MS);
    } else if (billingAwaitingFulfillment && !error) {
      let attempts = 0;
      timerRef.current = setInterval(() => {
        attempts += 1;
        if (attempts > 10) {
          clearInterval(timerRef.current);
          timerRef.current = null;
          return;
        }
        fetchPurchase();
      }, POLL_INTERVAL_MS);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [purchase?.status, purchase?.id, purchase?.fulfillment_status, error, fetchPurchase, purchaseKind, cancelled]);

  // Снять бронь со страницы счёта: публичная отмена с memo-подтверждением
  // (покупатель /shop может быть не залогинен).
  const cancelPurchase = useCallback(async () => {
    if (purchaseKind !== 'shop' || !purchase) return;
    setCancelling(true);
    setCancelError('');
    try {
      await apiRequest('/api/shop/public/purchase/cancel-public', {
        method: 'POST',
        body: { purchase_id: purchase.id, memo: purchase.memo }
      });
      setCancelled(true);
    } catch (e) {
      setCancelError(e.message || 'Не удалось отменить покупку');
    } finally {
      setCancelling(false);
    }
  }, [purchase, purchaseKind]);

  const handlePaid = useCallback(() => {
    setVerifying(false);
    fetchPurchase();
  }, [fetchPurchase]);

  const handlePayError = useCallback(() => {
    setVerifying(false);
  }, []);

  const verifyManually = useCallback(async () => {
    if (!purchase) return;
    const endpoint = purchaseKind === 'invoice'
      ? INVOICE_VERIFY_ENDPOINT(purchase.id)
      : purchaseKind === 'public_invoice'
        ? PUBLIC_INVOICE_VERIFY_ENDPOINT(purchase.id)
        : purchaseKind === 'billing'
          ? BILLING_VERIFY_ENDPOINT(purchase.id)
          : SHOP_VERIFY_ENDPOINT(purchase.id);
    setManualVerifying(true);
    setManualMessage('');
    try {
      await apiRequest(endpoint, { method: 'POST', body: {} });
      await fetchPurchase();
    } catch (e) {
      setManualMessage(e.message || 'Не удалось проверить оплату');
    } finally {
      setManualVerifying(false);
    }
  }, [purchase, purchaseKind, fetchPurchase]);

  if (loading) return <PayPageFrame><SkeletonView /></PayPageFrame>;
  if (cancelled) return <PayPageFrame><CancelledView /></PayPageFrame>;
  if (error) return <PayPageFrame><ErrorView message={error} onRetry={() => fetchPurchase(true)} /></PayPageFrame>;
  if (purchase?.status === 'paid' || isProcessingStatus(purchase?.status)) {
    return (
      <PayPageFrame>
        <PaidView
          purchase={purchase}
          processing={isProcessingStatus(purchase?.status)}
          purchaseKind={purchaseKind}
          fulfillmentStatus={purchase?.fulfillment_status ?? null}
          onRefresh={fetchPurchase}
        />
      </PayPageFrame>
    );
  }
  if (purchase && purchaseKind !== 'public_invoice' && isExpired(purchase)) {
    return (
      <PayPageFrame>
        <ExpiredView
          canVerifyPayment={purchaseKind === 'shop'}
          verifying={manualVerifying}
          message={manualMessage}
          onVerify={verifyManually}
        />
      </PayPageFrame>
    );
  }
  if (purchase && purchaseKind === 'public_invoice' && purchase.status === 'expired') {
    return <PayPageFrame><ExpiredView /></PayPageFrame>;
  }

  const verifyEndpoint = purchaseKind === 'invoice'
    ? INVOICE_VERIFY_ENDPOINT(purchase.id)
    : purchaseKind === 'public_invoice'
      ? PUBLIC_INVOICE_VERIFY_ENDPOINT(purchase.id)
      : purchaseKind === 'billing'
        ? BILLING_VERIFY_ENDPOINT(purchase.id)
        : SHOP_VERIFY_ENDPOINT(purchase.id);

  return (
    <PayPageFrame>
      <PaymentView
        purchase={purchase}
        verifying={verifying}
        verifyEndpoint={verifyEndpoint}
        onPaymentSent={() => setVerifying(true)}
        onPaid={handlePaid}
        onError={handlePayError}
        onVerifyManually={verifyManually}
        manualVerifying={manualVerifying}
        manualMessage={manualMessage}
        purchaseKind={purchaseKind}
        onCancel={purchaseKind === 'shop' ? cancelPurchase : undefined}
        cancelling={cancelling}
        cancelError={cancelError}
      />
    </PayPageFrame>
  );
}
