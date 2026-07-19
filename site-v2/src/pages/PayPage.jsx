import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Wallet,
} from 'lucide-react';
import QRCode from 'qrcode';
import { apiRequest } from '../api/client.js';
import { TonConnectPayButton } from '../features/ton-checkout/TonConnectPayButton.jsx';

const POLL_INTERVAL_MS = 10000;
const MAX_RETRIES = 3;
const SHOP_VIEW_ENDPOINT = (id) => `/api/shop/public/purchase/${id}/public-view`;
const INVOICE_VIEW_ENDPOINT = (id) => `/api/invoices/public/${id}/public-view`;
const SHOP_VERIFY_ENDPOINT = (id) => `/api/shop/public/purchase/${id}/verify-public`;
const INVOICE_VERIFY_ENDPOINT = (id) => `/api/invoices/public/${id}/verify-public`;
const PROCESSING_STATUSES = ['awaiting_receipt', 'wait_admin'];

function buildWalletDeepLinks(purchase) {
  const addr = purchase.seller_wallet;
  const nano = purchase.amount_nanoton;
  const memo = purchase.memo || '';
  if (!addr) return [];
  return [
    {
      key: 'tonkeeper',
      label: 'Tonkeeper',
      url: `https://tonkeeper.com/transfer/${addr}?amount=${nano}&text=${encodeURIComponent(memo)}`,
    },
    {
      key: 'mytonwallet',
      label: 'MyTonWallet',
      url: `https://app.mytonwallet.io/transfer/${addr}?amount=${nano}&text=${encodeURIComponent(memo)}`,
    },
    {
      key: 'trust',
      label: 'Trust Wallet',
      url: `https://link.trustwallet.com/send?asset=TON&address=${addr}&amount=${Number(purchase.amount_ton || 0)}&memo=${encodeURIComponent(memo)}`,
    },
    {
      key: 'generic',
      label: 'Другой',
      url: `ton://transfer/${addr}?amount=${nano}&text=${encodeURIComponent(memo)}`,
    },
  ];
}

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
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [activeWallet, setActiveWallet] = useState('tonkeeper');
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
      } else {
        const [shopRes, invoiceRes] = await Promise.allSettled([
          apiRequest(SHOP_VIEW_ENDPOINT(purchaseId)),
          apiRequest(INVOICE_VIEW_ENDPOINT(purchaseId)),
        ]);
        if (shopRes.status === 'fulfilled') {
          data = shopRes.value;
          setPurchaseKind('shop');
        } else if (invoiceRes.status === 'fulfilled') {
          data = invoiceRes.value;
          setPurchaseKind('invoice');
        } else {
          const shopErr = shopRes.reason;
          const invoiceErr = invoiceRes.reason;
          if (shopErr && shopErr.status !== 404) throw shopErr;
          if (invoiceErr && invoiceErr.status !== 404) throw invoiceErr;
          throw shopErr || invoiceErr || new Error('Счёт не найден');
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

  useEffect(() => {
    if (!purchase?.seller_wallet) return;
    const links = buildWalletDeepLinks(purchase);
    const active = links.find((l) => l.key === activeWallet) || links[0];
    if (!active?.url) {
      setQrDataUrl(null);
      return;
    }
    QRCode.toDataURL(active.url, { margin: 1, width: 240 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null));
  }, [purchase?.seller_wallet, purchase?.amount_nanoton, purchase?.amount_ton, purchase?.memo, activeWallet]);

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
    return <PaidView purchase={purchase} processing={isProcessingStatus(purchase?.status)} />;
  }
  if (purchase && isExpired(purchase)) return <ExpiredView />;

  const verifyEndpoint = purchaseKind === 'invoice'
    ? INVOICE_VERIFY_ENDPOINT(purchase.id)
    : SHOP_VERIFY_ENDPOINT(purchase.id);

  return (
    <PaymentView
      purchase={purchase}
      qrDataUrl={qrDataUrl}
      verifying={verifying}
      verifyEndpoint={verifyEndpoint}
      onPaymentSent={() => setVerifying(true)}
      onPaid={handlePaid}
      onError={handlePayError}
      onVerifyManually={verifyManually}
      manualVerifying={manualVerifying}
      manualMessage={manualMessage}
      activeWallet={activeWallet}
      onWalletChange={setActiveWallet}
    />
  );
}

function BrandingHeader() {
  const host = typeof window !== 'undefined' ? window.location.host : 'bullgram.xyz';
  return (
    <header className="flex items-center justify-between mb-5">
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-sm">
          <Sparkles className="w-5 h-5" />
        </div>
        <div className="leading-tight">
          <div className="font-bold text-slate-900 text-sm">BullRun</div>
          <div className="text-[10px] text-slate-400 uppercase tracking-wider">Оплата счёта</div>
        </div>
      </div>
      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white border border-slate-200">
        <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
        <span className="text-[11px] font-mono text-slate-500">{host}</span>
      </div>
    </header>
  );
}

function Card({ children }) {
  return (
    <div className="rounded-2xl border-0 bg-white shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 overflow-hidden">
      <div className="p-5 sm:p-6 space-y-5">{children}</div>
    </div>
  );
}

function AmountBlock({ purchase, remaining, verifying }) {
  const amount = Number(purchase.amount_ton || 0);
  return (
    <div className="rounded-2xl bg-slate-50/70 p-4 ring-1 ring-slate-100">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            {purchase.item_title || 'Заказ'}
          </div>
          <div className="text-3xl font-black tracking-tight text-slate-900 leading-none">
            {amount}
            <span className="text-sm font-bold text-slate-500 ml-1.5">TON</span>
          </div>
        </div>
        <div className="shrink-0 text-right">
          {verifying ? (
            <span className="inline-flex items-center gap-1.5 text-indigo-600 text-xs font-semibold">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Валидация…
            </span>
          ) : remaining ? (
            <span className="inline-flex items-center gap-1.5 text-slate-500 text-xs font-medium">
              <Clock className="w-3.5 h-3.5" />
              <span className="font-mono tabular-nums">{remaining}</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-slate-400 text-xs">
              <Clock className="w-3.5 h-3.5" />
              Ожидает оплаты
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function CopyRow({ label, value }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 border border-slate-100 px-3 py-2.5">
      <div className="min-w-0">
        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-0.5">{label}</div>
        <code className="text-xs text-slate-900 font-mono break-all">{value}</code>
      </div>
      <button
        type="button"
        onClick={onCopy}
        className={`shrink-0 inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
          copied ? 'bg-emerald-100 text-emerald-700' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
        }`}
        aria-label={`Скопировать ${label}`}
      >
        {copied ? (
          <>
            <CheckCircle2 className="w-3.5 h-3.5" /> Скопировано
          </>
        ) : (
          <>
            <Copy className="w-3.5 h-3.5" /> Копировать
          </>
        )}
      </button>
    </div>
  );
}

function PaymentView({
  purchase,
  qrDataUrl,
  verifying,
  verifyEndpoint,
  onPaymentSent,
  onPaid,
  onError,
  onVerifyManually,
  manualVerifying,
  manualMessage,
  activeWallet,
  onWalletChange,
}) {
  const [remaining, setRemaining] = useState(formatExpiry(purchase.expires_at));

  useEffect(() => {
    if (!purchase.expires_at) return;
    const t = setInterval(() => setRemaining(formatExpiry(purchase.expires_at)), 1000);
    return () => clearInterval(t);
  }, [purchase.expires_at]);

  const walletLinks = buildWalletDeepLinks(purchase);
  const activeLink = walletLinks.find((l) => l.key === activeWallet) || walletLinks[0];

  return (
    <div>
      <BrandingHeader />
      <Card>
        <AmountBlock purchase={purchase} remaining={remaining} verifying={verifying} />

        <div className="rounded-2xl bg-gradient-to-br from-sky-50 via-indigo-50/60 to-white ring-1 ring-sky-100 p-4 sm:p-5">
          <div className="flex items-center gap-2 text-sky-700 mb-3">
            <Wallet className="w-4 h-4" />
            <span className="text-[11px] font-bold uppercase tracking-wider">Оплата через TON Connect</span>
          </div>
          <div className="flex justify-center">
            <TonConnectPayButton
              amountTon={purchase.amount_ton}
              amountNano={purchase.amount_nanoton}
              merchantWallet={purchase.seller_wallet}
              memo={purchase.memo}
              network={purchase.network || 'mainnet'}
              verifyEndpoint={verifyEndpoint}
              buildVerifyBody={() => ({})}
              onPaid={onPaid}
              onError={onError}
              onTransactionSent={onPaymentSent}
              className="items-center"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-slate-200" />
          <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">или через другой кошелёк</span>
          <div className="h-px flex-1 bg-slate-200" />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {walletLinks.map((w) => {
            const isActive = w.key === activeLink?.key;
            return (
              <button
                key={w.key}
                type="button"
                onClick={() => onWalletChange(w.key)}
                className={`px-3 py-2 rounded-lg text-xs font-bold transition-colors ${
                  isActive
                    ? 'bg-slate-900 text-white'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {w.label}
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-4 items-start">
          {qrDataUrl ? (
            <div className="flex flex-col items-center gap-2">
              <img
                src={qrDataUrl}
                alt={`QR для ${activeLink?.label || 'перевода'}`}
                className="w-40 h-40 sm:w-44 sm:h-44 rounded-xl bg-white border border-slate-200 p-2"
              />
              <span className="text-[10px] text-slate-400 text-center max-w-[10rem] leading-tight">
                Откройте {activeLink?.label} и наведите камеру
              </span>
            </div>
          ) : (
            <div className="w-40 h-40 sm:w-44 sm:h-44 rounded-xl bg-slate-100 animate-pulse self-center" />
          )}

          <div className="space-y-2">
            {activeLink ? (
              <a
                href={activeLink.url}
                className="flex items-center justify-center gap-2 h-12 px-4 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-bold transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                Открыть в {activeLink.label}
              </a>
            ) : null}

            <div className="pt-2 space-y-2">
              <CopyRow label="Кошелёк продавца" value={purchase.seller_wallet || ''} />
              <CopyRow label="Memo (обязательно)" value={purchase.memo || ''} />
            </div>
          </div>
        </div>

        <div className="pt-3 border-t border-slate-100 space-y-2">
          {manualMessage ? (
            <p className="text-xs text-rose-600 text-center">{manualMessage}</p>
          ) : null}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
            <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
              <ShieldCheck className="w-3 h-3 text-emerald-500" />
              Memo обязательно — без него платёж не зачтётся
            </span>
            <button
              type="button"
              onClick={onVerifyManually}
              disabled={manualVerifying}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {manualVerifying ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Проверяем…
                </>
              ) : (
                <>
                  <RefreshCw className="w-3.5 h-3.5" />
                  Проверить оплату
                </>
              )}
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function SkeletonView() {
  return (
    <div>
      <BrandingHeader />
      <Card>
        <div className="rounded-2xl bg-slate-100 h-20 animate-pulse" />
        <div className="rounded-2xl bg-slate-100 h-32 animate-pulse" />
        <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-4">
          <div className="w-40 h-40 sm:w-44 sm:h-44 rounded-xl bg-slate-100 animate-pulse" />
          <div className="space-y-2">
            <div className="h-11 rounded-xl bg-slate-100 animate-pulse" />
            <div className="h-14 rounded-xl bg-slate-100 animate-pulse" />
            <div className="h-14 rounded-xl bg-slate-100 animate-pulse" />
          </div>
        </div>
      </Card>
    </div>
  );
}

function ErrorView({ message, onRetry }) {
  return (
    <div>
      <BrandingHeader />
      <Card>
        <div className="flex flex-col items-center justify-center text-center py-8">
          <div className="w-14 h-14 rounded-2xl bg-rose-50 border border-rose-100 flex items-center justify-center mb-4">
            <AlertCircle className="w-7 h-7 text-rose-500" />
          </div>
          <h3 className="text-base font-bold text-slate-900 mb-1">Не удалось загрузить счёт</h3>
          <p className="text-sm text-slate-500 max-w-sm mb-4">{message}</p>
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Повторить
          </button>
        </div>
      </Card>
    </div>
  );
}

function PaidView({ purchase, processing }) {
  return (
    <div>
      <BrandingHeader />
      <Card>
        <div className="flex flex-col items-center justify-center text-center py-8">
          <div className="w-16 h-16 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center mb-4">
            <CheckCircle2 className="w-8 h-8 text-emerald-500" />
          </div>
          <h3 className="text-lg font-bold text-slate-900 mb-1">
            {processing ? 'Платёж получен' : 'Счёт оплачен'}
          </h3>
          <p className="text-sm text-slate-500 max-w-sm">
            {processing
              ? `${purchase.item_title || 'Заказ'} оплачен на ${Number(purchase.amount_ton || 0)} TON. Подписка активируется в течение нескольких минут — если доступ не пришёл, нажмите «Проверить оплату» в боте.`
              : `${purchase.item_title || 'Заказ'} оплачен на ${Number(purchase.amount_ton || 0)} TON. Доступ активирован в течение нескольких минут.`}
          </p>
        </div>
      </Card>
    </div>
  );
}

function ExpiredView() {
  return (
    <div>
      <BrandingHeader />
      <Card>
        <div className="flex flex-col items-center justify-center text-center py-8">
          <div className="w-14 h-14 rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center mb-4">
            <Clock className="w-7 h-7 text-slate-400" />
          </div>
          <h3 className="text-base font-bold text-slate-900 mb-1">Срок оплаты истёк</h3>
          <p className="text-sm text-slate-500 max-w-sm">
            Создайте новый счёт в боте, чтобы продолжить оплату.
          </p>
        </div>
      </Card>
    </div>
  );
}
