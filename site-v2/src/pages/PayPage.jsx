import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import { apiRequest } from '../api/client.js';
import { TonConnectPayButton } from '../features/ton-checkout/TonConnectPayButton.jsx';
import { ManualTonPaymentCard } from '../features/ton-checkout/ManualTonPaymentCard.jsx';
import { SecretRevealBlock } from '../components/SecretRevealBlock.jsx';
import { Card } from '../components/ui/card.jsx';

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

function formatExpiry(expiresAt) {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return '00:00';
  const totalSec = Math.floor(ms / 1000);
  const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const ss = String(totalSec % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function shortWallet(addr) {
  if (!addr) return '';
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-8)}`;
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
  const timerRef = useRef(null);

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
        setTimeout(() => fetchPurchase(true), delay);
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
    };
  }, [purchaseId]);

  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (purchase?.status === 'pending' && !error) {
      timerRef.current = setInterval(() => {
        fetchPurchase();
      }, POLL_INTERVAL_MS);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [purchase?.status, purchase?.id, error, fetchPurchase]);

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

  if (loading) return <SkeletonView />;
  if (error) return <ErrorView message={error} onRetry={() => fetchPurchase(true)} />;
  if (purchase?.status === 'paid' || isProcessingStatus(purchase?.status)) {
    return <PaidView purchase={purchase} processing={isProcessingStatus(purchase?.status)} purchaseKind={purchaseKind} />;
  }
  if (purchase && purchaseKind !== 'public_invoice' && isExpired(purchase)) return <ExpiredView />;
  if (purchase && purchaseKind === 'public_invoice' && purchase.status === 'expired') return <ExpiredView />;

  const verifyEndpoint = purchaseKind === 'invoice'
    ? INVOICE_VERIFY_ENDPOINT(purchase.id)
    : purchaseKind === 'public_invoice'
      ? PUBLIC_INVOICE_VERIFY_ENDPOINT(purchase.id)
      : purchaseKind === 'billing'
        ? BILLING_VERIFY_ENDPOINT(purchase.id)
        : SHOP_VERIFY_ENDPOINT(purchase.id);

  return (
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
    />
  );
}

function PaymentView({
  purchase,
  verifying,
  verifyEndpoint,
  onPaymentSent,
  onPaid,
  onError,
  onVerifyManually,
  manualVerifying,
  manualMessage,
  purchaseKind,
}) {
  const [remaining, setRemaining] = useState(formatExpiry(purchase.expires_at));
  const [method, setMethod] = useState('tonconnect');

  useEffect(() => {
    if (!purchase.expires_at) return;
    const t = setInterval(() => setRemaining(formatExpiry(purchase.expires_at)), 1000);
    return () => clearInterval(t);
  }, [purchase.expires_at]);

  const isPublicInvoice = purchaseKind === 'public_invoice';
  const isTestnet = isPublicInvoice && purchase.network === 'testnet';
  const amount = Number(purchase.amount_ton || 0);

  const tabClass = (active) => `flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-[11px] font-extrabold uppercase tracking-wide rounded-lg transition-all ${
    active ? 'bg-white text-sky-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
  }`;

  return (
    <section className="space-y-6">
      <Card className="p-0 gap-0 border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 bg-white overflow-hidden rounded-2xl">
        <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6">
          <div className="flex flex-row items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-500/20 shrink-0">
              <Wallet className="w-6 h-6" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-bold text-slate-900">Оплата счёта</h2>
              <p className="text-sm font-medium text-slate-500 mt-0.5">
                {purchase.item_title || 'Заказ'}
              </p>
            </div>
            {remaining ? (
              <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white border border-slate-200 text-[11px] font-mono text-slate-600 shrink-0">
                <Clock className="w-3.5 h-3.5" />
                {remaining}
              </span>
            ) : null}
          </div>
        </div>

        <div className="p-5 sm:p-6 bg-white space-y-5">
          <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4 space-y-2">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Сумма к оплате</div>
            <div className="text-3xl font-black tracking-tight text-slate-900 leading-none">
              {amount}
              <span className="text-sm font-bold text-slate-500 ml-1.5">TON</span>
              {isTestnet ? (
                <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-md bg-orange-100 text-orange-700 text-[10px] font-bold uppercase tracking-wider align-middle">
                  Testnet
                </span>
              ) : null}
            </div>
            {verifying ? (
              <div className="inline-flex items-center gap-1.5 text-indigo-600 text-xs font-semibold pt-1">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Валидация платежа…
              </div>
            ) : null}
          </div>

          {isPublicInvoice ? (
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900 leading-relaxed">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
                <p>
                  Bullgram не гарантирует доставку товара — платформа только обеспечивает оплату.
                  Проверяйте продавца перед оплатой.
                </p>
              </div>
            </div>
          ) : null}

          {isTestnet ? (
            <div className="rounded-xl bg-orange-50 border border-orange-200 p-3 text-xs text-orange-900 leading-relaxed">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-orange-600" />
                <div>
                  <div className="font-bold mb-0.5">Testnet — для тестирования</div>
                  <p>Платёж тестовый, реальная ценность = 0. Убедитесь что ваш TonConnect подключён к testnet.</p>
                </div>
              </div>
            </div>
          ) : null}

          <div className="space-y-3">
            <div className="flex p-1 bg-slate-100 rounded-xl w-full" role="tablist" aria-label="Способ оплаты">
              <button
                type="button"
                role="tab"
                aria-selected={method === 'tonconnect'}
                className={tabClass(method === 'tonconnect')}
                onClick={() => setMethod('tonconnect')}
              >
                <Wallet className="size-3.5" />
                TON Connect
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={method === 'manual'}
                className={tabClass(method === 'manual')}
                onClick={() => setMethod('manual')}
              >
                <QrCode className="size-3.5" />
                Перевод вручную
              </button>
            </div>

            {method === 'tonconnect' ? (
              <TonConnectPayButton
                fullWidth
                amountTon={purchase.amount_ton}
                amountNano={purchase.amount_nanoton}
                merchantWallet={purchase.seller_wallet}
                memo={purchase.memo}
                network={purchase.network || 'mainnet'}
                verifyEndpoint={verifyEndpoint}
                buildVerifyBody={isPublicInvoice
                  ? () => ({})
                  : ({ senderWallet }) => ({ sender_wallet: senderWallet })}
                onPaid={onPaid}
                onError={onError}
                onTransactionSent={onPaymentSent}
              />
            ) : (
              <ManualTonPaymentCard
                purchase={purchase}
                checking={manualVerifying}
                error={manualMessage}
                onCheck={onVerifyManually}
              />
            )}
          </div>
        </div>
      </Card>

      <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-400 px-2">
        <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
        <span>Платёж проходит напрямую через TON-блокчейн. Bullgram не хранит ваши средства.</span>
      </div>
    </section>
  );
}

function SkeletonView() {
  return (
    <section className="space-y-6">
      <Card className="p-0 gap-0 border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 bg-white overflow-hidden rounded-2xl">
        <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6">
          <div className="flex flex-row items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-slate-200 animate-pulse shrink-0" />
            <div className="space-y-2">
              <div className="h-5 w-40 bg-slate-200 animate-pulse rounded" />
              <div className="h-3 w-56 bg-slate-100 animate-pulse rounded" />
            </div>
          </div>
        </div>
        <div className="p-5 sm:p-6 bg-white space-y-4">
          <div className="h-20 bg-slate-100 animate-pulse rounded-2xl" />
          <div className="h-32 bg-slate-100 animate-pulse rounded-2xl" />
        </div>
      </Card>
    </section>
  );
}

function ErrorView({ message, onRetry }) {
  return (
    <section className="space-y-6">
      <Card className="p-0 gap-0 border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 bg-white overflow-hidden rounded-2xl">
        <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6">
          <div className="flex flex-row items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-rose-600 flex items-center justify-center text-white shadow-md shadow-rose-500/20 shrink-0">
              <AlertCircle className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900">Не удалось загрузить счёт</h2>
              <p className="text-sm font-medium text-slate-500 mt-0.5">{message}</p>
            </div>
          </div>
        </div>
        <div className="p-5 sm:p-6 bg-white">
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold transition-colors shadow-md shadow-indigo-200"
          >
            <RefreshCw className="w-4 h-4" />
            Повторить
          </button>
        </div>
      </Card>
    </section>
  );
}

function formatBillingEndDate(durationDays) {
  if (!durationDays) return null;
  const date = new Date(Date.now() + Number(durationDays) * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long' }).format(date);
}

function PaidView({ purchase, processing, purchaseKind }) {
  const isBilling = purchaseKind === 'billing';

  useEffect(() => {
    if (!isBilling) return;
    const timer = setTimeout(() => {
      window.location.reload();
    }, 1500);
    return () => clearTimeout(timer);
  }, [isBilling]);

  const title = isBilling ? 'Тариф Pro активирован' : processing ? 'Платёж получен' : 'Счёт оплачен';
  const description = isBilling ? (
    <>
      Доступ открыт до {formatBillingEndDate(purchase.duration_days) || '—'}
      {purchase.duration_days ? ` (${purchase.duration_days} дн.)` : null}.
    </>
  ) : processing ? (
    `${purchase.item_title || 'Заказ'} оплачен на ${Number(purchase.amount_ton || 0)} TON. Подписка активируется в течение нескольких минут — если доступ не пришёл, нажмите «Проверить оплату» в боте.`
  ) : (
    `${purchase.item_title || 'Заказ'} оплачен на ${Number(purchase.amount_ton || 0)} TON. Доступ активирован в течение нескольких минут.`
  );

  return (
    <section className="space-y-6">
      <Card className="p-0 gap-0 border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 bg-white overflow-hidden rounded-2xl">
        <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6">
          <div className="flex flex-row items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-emerald-600 flex items-center justify-center text-white shadow-md shadow-emerald-500/20 shrink-0">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-bold text-slate-900">{title}</h2>
              <p className="text-sm font-medium text-slate-500 mt-0.5">{description}</p>
            </div>
          </div>
        </div>
        <div className="p-5 sm:p-6 bg-white space-y-4">
          {isBilling ? (
            <a
              href="/app"
              className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold transition-colors shadow-md shadow-indigo-200"
            >
              Перейти в кабинет
              <ExternalLink className="w-4 h-4" />
            </a>
          ) : null}
          {purchaseKind === 'public_invoice' && purchase.secret_payload ? (
            <SecretRevealBlock secret={purchase.secret_payload} />
          ) : null}
        </div>
      </Card>
    </section>
  );
}

function ExpiredView() {
  return (
    <section className="space-y-6">
      <Card className="p-0 gap-0 border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 bg-white overflow-hidden rounded-2xl">
        <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6">
          <div className="flex flex-row items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-slate-500 flex items-center justify-center text-white shadow-md shadow-slate-400/20 shrink-0">
              <Clock className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900">Срок оплаты истёк</h2>
              <p className="text-sm font-medium text-slate-500 mt-0.5">
                Создайте новый счёт, чтобы продолжить оплату.
              </p>
            </div>
          </div>
        </div>
      </Card>
    </section>
  );
}
