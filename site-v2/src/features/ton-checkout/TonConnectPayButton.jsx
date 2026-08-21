import { useCallback, useMemo } from 'react';
import { useTonAddress, useTonWallet, useTonConnectUI } from '@tonconnect/ui-react';
import { Wallet } from 'lucide-react';
import { useTonCheckout } from './useTonCheckout.js';

function formatAmount(ton) {
  const n = Number(ton);
  if (!Number.isFinite(n)) return ton;
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

export function TonConnectPayButton({
  amountTon,
  amountNano,
  merchantWallet,
  memo,
  network = 'mainnet',
  verifyEndpoint,
  buildVerifyBody,
  accessToken,
  onPaid,
  onError,
  onTransactionSent,
  disabled = false,
  fullWidth = false,
  className = ''
}) {
  const address = useTonAddress();
  const wallet = useTonWallet();
  const [tonConnectUI] = useTonConnectUI();
  const connected = Boolean(wallet);

  const handleComplete = useCallback((data) => { onPaid?.(data); }, [onPaid]);
  const handleError = useCallback((err) => { onError?.(err); }, [onError]);

  const bodyBuilder = useMemo(() => buildVerifyBody, [buildVerifyBody]);

  const { pay, paying, verifying, status, error } = useTonCheckout({
    verifyEndpoint,
    buildVerifyBody: bodyBuilder,
    accessToken,
    onComplete: handleComplete,
    onError: handleError
  });

  if (!connected) {
    return (
      <div className={`flex flex-col items-center gap-2 ${fullWidth ? 'w-full' : ''} ${className}`}>
        <button
          type="button"
          onClick={() => tonConnectUI.openModal()}
          className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-sky-600 text-white font-bold text-sm shadow-md shadow-sky-600/20 hover:bg-sky-700 transition-all ${fullWidth ? 'w-full justify-center h-11' : ''}`}
        >
          <Wallet className="size-4" />
          Подключить TON-кошелёк
        </button>
      </div>
    );
  }

  const busy = paying || verifying;
  const statusLabel = (() => {
    if (status === 'sending') return 'Отправляем транзакцию…';
    if (status === 'verifying') return 'Проверяем оплату…';
    if (status === 'paid') return 'Оплачено';
    if (status === 'pending') return 'Ждём подтверждения сети…';
    if (status === 'failed') return 'Ошибка';
    return null;
  })();

  const handlePay = async () => {
    onTransactionSent?.();
    await pay({ amountNano, merchantWallet, memo, network });
  };

  return (
    <div className={`flex flex-col items-center gap-2 ${fullWidth ? 'w-full' : ''} ${className}`}>
      <button
        type="button"
        disabled={disabled || busy || status === 'paid'}
        onClick={handlePay}
        className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-sky-600 text-white font-bold text-sm shadow-md shadow-sky-600/20 hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all ${fullWidth ? 'w-full justify-center h-11' : ''}`}
      >
        {busy ? (
          <>
            <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            {statusLabel}
          </>
        ) : status === 'paid' ? (
          <>✓ Оплачено</>
        ) : (
          <>Оплатить {formatAmount(amountTon)} TON</>
        )}
      </button>
      {address ? (
        <span className="text-[11px] text-slate-500 font-mono">
          {address.slice(0, 4)}…{address.slice(-6)}
        </span>
      ) : null}
      {error ? <span className="text-xs text-rose-600">{error}</span> : null}
    </div>
  );
}
