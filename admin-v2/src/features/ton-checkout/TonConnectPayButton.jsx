import { useCallback, useMemo } from 'react';
import { useTonAddress, useTonWallet, TonConnectButton } from '@tonconnect/ui-react';
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
  disabled = false,
  className = ''
}) {
  const address = useTonAddress();
  const wallet = useTonWallet();
  const connected = Boolean(wallet);

  const handleComplete = useCallback(
    (data) => {
      onPaid?.(data);
    },
    [onPaid]
  );

  const handleError = useCallback(
    (err) => {
      onError?.(err);
    },
    [onError]
  );

  const bodyBuilder = useMemo(
    () => buildVerifyBody,
    [buildVerifyBody]
  );

  const { pay, paying, verifying, status, error } = useTonCheckout({
    verifyEndpoint,
    buildVerifyBody: bodyBuilder,
    accessToken,
    onComplete: handleComplete,
    onError: handleError
  });

  if (!connected) {
    return (
      <div className={`flex flex-col items-start gap-2 ${className}`}>
        <TonConnectButton />
        <span className="text-xs text-slate-500">Подключите TON-кошелёк для оплаты</span>
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

  return (
    <div className={`flex flex-col items-start gap-2 ${className}`}>
      <button
        type="button"
        disabled={disabled || busy || status === 'paid'}
        onClick={() => pay({ amountNano, merchantWallet, memo, network })}
        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-sky-600 text-white font-bold text-sm shadow-md shadow-sky-600/20 hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
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
