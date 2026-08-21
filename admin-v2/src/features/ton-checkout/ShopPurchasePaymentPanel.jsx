import { useCallback, useState } from 'react';
import { QrCode, Wallet } from 'lucide-react';
import { TonConnectPayButton } from './TonConnectPayButton.jsx';
import { ManualTonPaymentCard } from './ManualTonPaymentCard.jsx';
import { ExpiryCountdown } from '../../ui/ExpiryCountdown.jsx';

const VERIFY_ENDPOINT = '/api/shop/public/purchase/verify-ton-connect';

export function ShopPurchasePaymentPanel({
  purchase,
  checking = false,
  accessToken,
  onPaid,
  onPayError,
  onManualCheck,
  onReset
}) {
  const [method, setMethod] = useState('tonconnect');

  const selectMethod = useCallback((next) => {
    setMethod(next);
  }, []);

  const buildVerifyBody = useCallback(({ senderWallet }) => {
    if (!purchase) return { sender_wallet: senderWallet };
    if (purchase.batch && Array.isArray(purchase.purchase_ids)) {
      return {
        purchase_ids: purchase.purchase_ids,
        sender_wallet: senderWallet
      };
    }
    return {
      purchase_id: purchase.id,
      sender_wallet: senderWallet
    };
  }, [purchase]);

  const tabClass = (active) => `flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-[11px] font-extrabold uppercase tracking-wide rounded-lg transition-all ${
    active ? 'bg-white text-sky-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
  }`;

  return (
    <div className="space-y-3">
      <div className="flex p-1 bg-slate-100 rounded-xl w-full" role="tablist" aria-label="Способ оплаты">
        <button
          type="button"
          role="tab"
          aria-selected={method === 'tonconnect'}
          className={tabClass(method === 'tonconnect')}
          onClick={() => selectMethod('tonconnect')}
        >
          <Wallet className="size-3.5" />
          TON Connect
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={method === 'manual'}
          className={tabClass(method === 'manual')}
          onClick={() => selectMethod('manual')}
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
          verifyEndpoint={VERIFY_ENDPOINT}
          buildVerifyBody={buildVerifyBody}
          accessToken={accessToken}
          onPaid={onPaid}
          onError={onPayError}
        />
      ) : (
        <ManualTonPaymentCard purchase={purchase} checking={checking} onCheck={onManualCheck} />
      )}

      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-slate-500">
          {purchase.expires_at
            ? <ExpiryCountdown expiresAt={purchase.expires_at} prefix="Бронь держится ещё" />
            : 'Лот зарезервирован'}
        </span>
        <button
          type="button"
          className="text-[11px] font-medium text-slate-500 hover:text-rose-600 transition"
          onClick={onReset}
        >
          Сбросить
        </button>
      </div>
    </div>
  );
}
