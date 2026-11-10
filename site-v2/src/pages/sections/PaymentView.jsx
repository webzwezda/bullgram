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

// «Тихий счёт» (sketch 2026-11-11, направление владельца): editorial-минимализм —
// волосяные линии, крупная сумма как заголовок, подчёркнутые табы, TON-контур
// action.ton (DESIGN.md §Actions), CTA с суммой, тихая отмена внизу.
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
  onCancel,
  cancelling,
  cancelError,
}) {
  const [remaining, setRemaining] = useState(formatExpiry(purchase.expires_at));
  const [method, setMethod] = useState('tonconnect');

  useEffect(() => {
    if (!purchase.expires_at) return;
    const t = setInterval(() => setRemaining(formatExpiry(purchase.expires_at)), 1000);
    return () => clearInterval(t);
  }, [purchase.expires_at]);

  const isPublicInvoice = purchaseKind === 'public_invoice';
  const isShop = purchaseKind === 'shop';
  const isTestnet = purchase.network === 'testnet';
  const amount = Number(purchase.amount_ton || 0);
  const isLowTime = Boolean(remaining) && (
    remaining === '00:00' || Number(remaining.split(':')[0]) < 5
  );

  const tabClass = (active) => `inline-flex items-center gap-1.5 pb-2.5 -mb-px border-b-2 text-[13px] font-extrabold transition-colors ${
    active
      ? 'border-action-ton text-action-ton'
      : 'border-transparent text-ink-muted hover:text-ink-body'
  }`;

  return (
    <section className="space-y-6">
      <Card className="p-0 gap-0 border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 bg-white overflow-hidden rounded-2xl">
        {/* Шапка-счёт: лот + сумма как заголовок, таймер справа */}
        <div className="px-5 sm:px-6 pt-6 pb-5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink-muted">{purchase.item_title || 'Заказ'}</p>
            <div className="mt-1.5 text-5xl font-black tracking-tighter text-ink-strong leading-none tabular-nums">
              {amount}
              <span className="text-lg font-bold text-ink-muted ml-2 tracking-normal">TON</span>
              {isTestnet ? (
                <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-md bg-orange-100 text-orange-700 text-[10px] font-bold uppercase tracking-wider align-middle">
                  Testnet
                </span>
              ) : null}
            </div>
            {verifying ? (
              <div className="inline-flex items-center gap-1.5 text-action-ton text-xs font-semibold mt-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Валидация платежа…
              </div>
            ) : null}
          </div>
          {remaining ? (
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-bold shrink-0 tabular-nums ${
                isLowTime
                  ? 'bg-feedback-error-bg border-red-200 text-feedback-error-text'
                  : 'bg-surface-card border-border-default text-ink-muted'
              }`}
              title="Срок оплаты счёта"
              aria-label={`До конца оплаты счёта: ${remaining}`}
            >
              <Clock className="w-3.5 h-3.5" />
              {remaining}
            </span>
          ) : null}
        </div>

        {isPublicInvoice ? (
          <div className="mx-5 sm:mx-6 mb-4 rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900 leading-relaxed">
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
          <div className="mx-5 sm:mx-6 mb-4 rounded-xl bg-orange-50 border border-orange-200 p-3 text-xs text-orange-900 leading-relaxed">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-orange-600" />
              <div>
                <div className="font-bold mb-0.5">Testnet — для тестирования</div>
                <p>Платёж тестовый, реальная ценность = 0. Убедись, что твой TonConnect подключён к testnet.</p>
              </div>
            </div>
          </div>
        ) : null}

        {/* Табы-подчёркивания: TON-контур */}
        <div className="flex gap-5 px-5 sm:px-6 border-b border-border-default" role="tablist" aria-label="Способ оплаты">
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
          <div className="px-5 sm:px-6 py-4 space-y-3">
            {isShop ? (
              <p className="text-xs font-medium text-ink-muted">
                Лот забронирован за тобой — когда таймер истечёт, бронь снимется и лот вернётся в магазин.
              </p>
            ) : null}
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
            <p className="text-center text-[11px] text-ink-muted">
              Memo уйдёт вместе с переводом автоматически — статус проверится сам.
            </p>
          </div>
        ) : (
          <div className="px-5 sm:px-6 py-4">
            <ManualTonPaymentCard
              purchase={purchase}
              checking={manualVerifying}
              error={manualMessage}
              onCheck={onVerifyManually}
            />
          </div>
        )}

        {onCancel ? (
          <div className="border-t border-border-default">
            {cancelError ? (
              <p className="text-xs font-medium text-feedback-error-text text-center pt-2">{cancelError}</p>
            ) : null}
            <button
              type="button"
              onClick={onCancel}
              disabled={cancelling}
              className="w-full h-10 text-xs font-bold text-ink-muted hover:text-feedback-error-text transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
            >
              {cancelling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              Отменить покупку и снять бронь
            </button>
          </div>
        ) : null}
      </Card>

      <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-500 px-2">
        <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
        <span>Платёж проходит напрямую через TON-блокчейн. Bullgram не хранит ваши средства.</span>
      </div>
    </section>
  );
}
