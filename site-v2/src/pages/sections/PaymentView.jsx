import { useEffect, useState } from 'react';
import { AlertTriangle, Clock, Loader2, QrCode, ShieldCheck, Wallet } from 'lucide-react';
import { Card } from '../../components/ui/card.jsx';
import { TonConnectPayButton } from '../../features/ton-checkout/TonConnectPayButton.jsx';
import { ManualTonPaymentCard } from '../../features/ton-checkout/ManualTonPaymentCard.jsx';

function formatExpiry(expiresAt) {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return '00:00';
  const totalSec = Math.floor(ms / 1000);
  const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const ss = String(totalSec % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

export function PaymentView({
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
  const isTestnet = purchase.network === 'testnet';
  const amount = Number(purchase.amount_ton || 0);

  const tabClass = (active) => `flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-[11px] font-extrabold uppercase tracking-wide rounded-lg transition-all ${
    active ? 'bg-white text-sky-700 shadow-sm' : 'text-slate-600 hover:text-slate-800'
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
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] font-mono shrink-0 ${
                  remaining.split(':')[0] === '00' || (remaining.split(':').length === 2 && Number(remaining.split(':')[0]) < 5)
                    ? 'bg-red-50 border-red-200 text-red-700'
                    : 'bg-white border-slate-200 text-slate-600'
                }`}
                title="Срок оплаты счёта"
                aria-label={`До конца оплаты счёта: ${remaining}`}
              >
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
                  Проверь продавца перед оплатой.
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
                  <p>Платёж тестовый, реальная ценность = 0. Убедись, что твой TonConnect подключён к testnet.</p>
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
              <>
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
                <p className="text-center text-[11px] text-slate-500">
                  Memo уйдёт вместе с переводом автоматически — статус проверится сам.
                </p>
              </>
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

      <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-500 px-2">
        <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
        <span>Платёж проходит напрямую через TON-блокчейн. Bullgram не хранит ваши средства.</span>
      </div>
    </section>
  );
}
