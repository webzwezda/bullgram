import { useEffect, useState } from 'react';
import { Copy, ExternalLink, QrCode, Wallet } from 'lucide-react';

export const FILTERS = [
  { id: 'all', label: 'Все' },
  { id: 'with_balance', label: 'С балансом' },
  { id: 'rewards', label: 'Начисления' },
  { id: 'payouts', label: 'Выплаты' }
];

export function formatWhen(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value));
}

export function formatTon(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return '0 TON';
  return `${amount.toLocaleString('ru-RU', { maximumFractionDigits: 6 })} TON`;
}

export function eventBadge(event) {
  if (event?.event_type === 'reward_granted') return { text: 'Начисление', className: 'pill pill--ok' };
  if (event?.event_type === 'payout_marked') return { text: 'Выплата', className: 'pill pill--info' };
  if (event?.event_type === 'payout_request_sending') return { text: 'Отправляется', className: 'pill pill--info' };
  if (event?.event_type === 'payout_request_sent') return { text: 'Отправлена', className: 'pill pill--ok' };
  if (event?.event_type === 'payout_request_queued') return { text: 'В очереди', className: 'pill pill--info' };
  if (event?.event_type === 'payout_request_failed') return { text: 'Ошибка выплаты', className: 'pill pill--danger' };
  if (event?.event_type === 'payout_request_cancelled') return { text: 'Отклонена', className: 'pill pill--warning' };
  return { text: event?.event_type || '—', className: 'pill' };
}

export function leadStatus(lead) {
  if (lead?.converted) return { text: 'Оплатил', tone: 'reward' };
  if (lead?.expired) return { text: 'Истекло', tone: 'muted' };
  if (lead?.discount_eligible) return { text: 'Скидка жива', tone: 'ok' };
  return { text: 'Без скидки', tone: 'warning' };
}

export function payoutStatusLabel(status) {
  if (status === 'requested') return 'Запрошена';
  if (status === 'queued') return 'В очереди';
  if (status === 'sending') return 'Отправляется';
  if (status === 'sent') return 'Отправлена';
  if (status === 'failed') return 'Ошибка';
  if (status === 'cancelled') return 'Отклонена';
  return 'Запрошена';
}

export function payoutStatusTone(status) {
  if (status === 'sent') return 'sent';
  if (status === 'failed') return 'failed';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'sending') return 'sending';
  if (status === 'queued') return 'queued';
  return 'requested';
}

export function refundStatusLabel(status) {
  if (status === 'confirmed') return 'Подтвержден';
  if (status === 'sent') return 'Отправлен';
  if (status === 'failed') return 'Ошибка';
  if (status === 'cancelled') return 'Отменен';
  return 'Запрошен';
}

export function isPayoutEvent(event) {
  return event?.event_type === 'payout_marked' || String(event?.event_type || '').startsWith('payout_request_');
}

export function parsePayload(payload) {
  if (!payload) return {};
  if (typeof payload === 'object') return payload;
  if (typeof payload !== 'string') return {};
  try {
    const parsed = JSON.parse(payload);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function firstPresent(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

export function preferredDepositCheckoutView(reserve) {
  if (reserve?.depositTrustWalletQr || reserve?.depositTrustWalletUri) return 'trust';
  if (reserve?.depositTonQr || reserve?.depositTonUri) return 'ton';
  return 'trust';
}

export function payoutTxHash(row) {
  const payload = parsePayload(row?.payload);
  return firstPresent(
    row?.chain_tx_hash,
    row?.pending_payout_chain_tx_hash,
    row?.latest_payout_chain_tx_hash,
    payload.chain_tx_hash,
    payload.tx_hash,
    payload.manual_sent?.chain_tx_hash,
    payload.sender?.chain_tx_hash
  );
}

export function payoutNetworkFeeTon(row) {
  const payload = parsePayload(row?.payload);
  const fee = firstPresent(
    row?.network_fee_ton,
    row?.pending_payout_network_fee_ton,
    row?.latest_payout_network_fee_ton,
    payload.network_fee_ton,
    payload.network_fee_ton_amount,
    payload.manual_sent?.network_fee_ton,
    payload.sender?.network_fee_ton
  );
  if (fee === undefined || fee === null || fee === '') return null;
  const amount = Number(fee);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

export function shortTxHash(value) {
  const hash = String(value || '').trim();
  if (hash.length <= 22) return hash;
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
}

export function TableEmptyState({ icon: Icon, title, hint }) {
  return (
    <div className="p-20 text-center space-y-3 flex flex-col items-center">
      <div className="w-16 h-16 rounded-full bg-slate-50 flex items-center justify-center text-slate-300">
        <Icon className="w-8 h-8" />
      </div>
      <p className="text-slate-500 font-bold tracking-tight">{title}</p>
      {hint && <p className="text-sm text-slate-500 font-medium max-w-sm">{hint}</p>}
    </div>
  );
}

export function PayoutChainDetails({ row }) {
  const txHash = payoutTxHash(row);
  const networkFeeTon = payoutNetworkFeeTon(row);

  if (!txHash && networkFeeTon === null) return null;

  return (
    <div className="mt-2 text-xs text-slate-500 flex flex-col gap-1">
      {networkFeeTon !== null && (
        <div className="flex items-center gap-1">Комиссия сети: {formatTon(networkFeeTon)}</div>
      )}
      {txHash && (
        <div className="flex items-center gap-1">
          Tx: <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-slate-600 cursor-help" title={String(txHash)}>{shortTxHash(txHash)}</span>
        </div>
      )}
    </div>
  );
}

export function PayoutTransferBox({ row }) {
  const uri = row?.ton_transfer_uri || '';
  const qr = row?.ton_transfer_qr || '';
  const memo = row?.pending_payout_memo || '';
  if (!uri && !memo) return null;

  async function copyValue(value, label) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      window.alert(`${label} скопирован.`);
    } catch {
      window.prompt(label, value);
    }
  }

  return (
    <div className="bg-slate-50 rounded-2xl p-4 flex gap-4 mt-2 border border-slate-200">
      {qr && <img className="w-24 h-24 rounded-xl border border-slate-200 bg-white p-1" src={qr} alt="QR для TON-выплаты" />}
      <div className="flex-1 flex flex-col gap-2">
        <div className="font-bold text-sm text-slate-900">Оплата через кошелек</div>
        {memo && (
          <div className="text-xs text-slate-600 font-mono bg-white px-2 py-1 rounded-md border border-slate-100">
            Memo: <span>{memo}</span>
          </div>
        )}
        <div className="flex gap-2 mt-auto">
          {uri && (
            <a className="inline-flex items-center justify-center px-3 py-1.5 rounded-lg font-bold text-xs transition-colors bg-slate-100 !text-slate-600 hover:bg-slate-200 hover:!text-slate-900 bg-blue-50 !text-blue-600 hover:bg-blue-100 hover:!text-blue-700" href={uri}>
              Открыть
            </a>
          )}
          {memo && (
            <button
              type="button"
              className="inline-flex items-center justify-center px-3 py-1.5 rounded-lg font-bold text-xs transition-colors bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900"
              onClick={() => copyValue(memo, 'Memo')}
            >
              Memo
            </button>
          )}
          {uri && (
            <button
              type="button"
              className="inline-flex items-center justify-center px-3 py-1.5 rounded-lg font-bold text-xs transition-colors bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900"
              onClick={() => copyValue(uri, 'TON-ссылка')}
            >
              Ссылка
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function RefundTransferBox({ reserve }) {
  const uri = reserve?.refundTransferUri || '';
  const qr = reserve?.refundTransferQr || '';
  const memo = reserve?.refundMemo || '';
  const wallet = reserve?.refundWallet || '';
  if (!uri && !memo && !wallet) return null;

  async function copyValue(value, label) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      window.alert(`${label} скопирован.`);
    } catch {
      window.prompt(label, value);
    }
  }

  return (
    <div className="bg-slate-50 rounded-2xl p-4 flex gap-4 mt-2 border border-slate-200">
      {qr && <img className="w-24 h-24 rounded-xl border border-slate-200 bg-white p-1" src={qr} alt="QR для возврата TON-резерва" />}
      <div className="flex-1 flex flex-col gap-2">
        <div className="font-bold text-sm text-slate-900">Возврат через TON-кошелек</div>
        {wallet && (
          <div className="text-xs text-slate-600 font-mono bg-white px-2 py-1 rounded-md border border-slate-100">
            Кошелек: <span>{wallet}</span>
          </div>
        )}
        {memo && (
          <div className="text-xs text-slate-600 font-mono bg-white px-2 py-1 rounded-md border border-slate-100">
            Memo: <span>{memo}</span>
          </div>
        )}
        <div className="flex gap-2 mt-auto">
          {uri && (
            <a className="inline-flex items-center justify-center px-3 py-1.5 rounded-lg font-bold text-xs transition-colors bg-slate-100 !text-slate-600 hover:bg-slate-200 hover:!text-slate-900 bg-blue-50 !text-blue-600 hover:bg-blue-100 hover:!text-blue-700" href={uri}>
              Открыть
            </a>
          )}
          {wallet && (
            <button type="button" className="inline-flex items-center justify-center px-3 py-1.5 rounded-lg font-bold text-xs transition-colors bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900" onClick={() => copyValue(wallet, 'Кошелек')}>
              Кошелек
            </button>
          )}
          {memo && (
            <button type="button" className="inline-flex items-center justify-center px-3 py-1.5 rounded-lg font-bold text-xs transition-colors bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900" onClick={() => copyValue(memo, 'Memo')}>
              Memo
            </button>
          )}
          {uri && (
            <button type="button" className="inline-flex items-center justify-center px-3 py-1.5 rounded-lg font-bold text-xs transition-colors bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900" onClick={() => copyValue(uri, 'TON-ссылка')}>
              Ссылка
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function DepositTransferBox({ reserve }) {
  const [checkoutView, setCheckoutView] = useState(preferredDepositCheckoutView(reserve));

  useEffect(() => {
    setCheckoutView(preferredDepositCheckoutView(reserve));
  }, [
    reserve?.depositAddress,
    reserve?.depositMemo,
    reserve?.depositTrustWalletQr,
    reserve?.depositTrustWalletUri,
    reserve?.depositTonQr,
    reserve?.depositTonUri
  ]);

  const wallet = reserve?.depositAddress || '';
  const memo = reserve?.depositMemo || '';
  const suggestedAmount = Number(reserve?.depositSuggestedTon || 0);
  const hasTrustQr = !!reserve?.depositTrustWalletQr;
  const hasTonQr = !!reserve?.depositTonQr;
  const hasTrustLink = !!reserve?.depositTrustWalletUri;
  const hasTonLink = !!reserve?.depositTonUri;
  const activeQrSrc = checkoutView === 'ton'
    ? (reserve?.depositTonQr || reserve?.depositTrustWalletQr)
    : (reserve?.depositTrustWalletQr || reserve?.depositTonQr);
  const activeQrLabel = checkoutView === 'ton' ? 'QR для TON-кошелька' : 'QR для Trust Wallet';

  if (!wallet && !memo && !activeQrSrc) return null;

  async function copyValue(value, label) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      window.alert(`${label} скопирован.`);
    } catch {
      window.prompt(label, value);
    }
  }

  function DepositCopyRow({ label, value }) {
    if (!value) return null;

    return (
      <button
        type="button"
        className="flex min-h-[44px] w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2 text-left shadow-sm"
        onClick={() => copyValue(value, label)}
      >
        <span className="w-20 shrink-0 text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs font-bold text-slate-700">{value}</span>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-slate-500">
          <Copy className="h-3.5 w-3.5" />
          Copy
        </span>
      </button>
    );
  }

  return (
    <div className="flex flex-col md:flex-row gap-6 p-6 sm:p-8 rounded-[2rem] bg-slate-50/50 border border-slate-200 mt-8 mb-4">
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center text-blue-600 shadow-inner">
            <Wallet className="w-5 h-5" strokeWidth={2.5} />
          </div>
          <h3 className="text-xl font-extrabold text-slate-900 tracking-tight">Пополнение через кошелек</h3>
        </div>
        
        <p className="text-base text-slate-600 font-medium mb-8 leading-relaxed max-w-md">
          Переведи ровно с этим memo. QR ставит сумму <strong className="whitespace-nowrap text-slate-900 font-bold bg-slate-200/50 px-1.5 py-0.5 rounded-md">{suggestedAmount > 0 ? formatTon(suggestedAmount) : formatTon(reserve?.minimumDepositTon || 100)}.</strong>
        </p>

        <div className="mb-6 flex w-full flex-col gap-2">
          <DepositCopyRow label="Кошелек" value={wallet} />
          <DepositCopyRow label="Memo" value={memo} />
        </div>

        <div className="flex flex-wrap gap-3 mt-auto">
          {hasTrustLink && (
            <a className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 !text-white text-sm font-bold shadow-md shadow-blue-500/20 hover:bg-blue-700 hover:-translate-y-0.5 transition-all" href={reserve.depositTrustWalletUri}>
              <ExternalLink className="w-4 h-4" strokeWidth={2.5} /> Trust Wallet
            </a>
          )}
          {hasTonLink && (
            <a className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-900 !text-white text-sm font-bold shadow-md shadow-slate-900/10 hover:bg-slate-800 hover:-translate-y-0.5 transition-all" href={reserve.depositTonUri}>
              <ExternalLink className="w-4 h-4" strokeWidth={2.5} /> TON
            </a>
          )}
        </div>
      </div>

      {activeQrSrc && (
        <div className="shrink-0 flex flex-col items-center bg-white p-5 rounded-3xl border border-slate-200 shadow-sm w-full md:w-[260px]">
          {hasTrustQr && hasTonQr && (
            <div className="flex p-1 bg-slate-100 rounded-xl mb-5 w-full">
              <button
                type="button"
                className={`flex-1 px-3 py-2 text-xs font-extrabold uppercase tracking-wide rounded-lg transition-all ${checkoutView === 'trust' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                onClick={() => setCheckoutView('trust')}
              >
                Trust
              </button>
              <button
                type="button"
                className={`flex-1 px-3 py-2 text-xs font-extrabold uppercase tracking-wide rounded-lg transition-all ${checkoutView === 'ton' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                onClick={() => setCheckoutView('ton')}
              >
                TON
              </button>
            </div>
          )}
          <div className="flex items-center justify-center gap-1.5 text-[11px] font-extrabold uppercase tracking-widest text-slate-400 mb-3">
            <QrCode className="w-3.5 h-3.5" />
            {checkoutView === 'ton' ? 'TON QR' : 'Trust Wallet QR'}
          </div>
          <div className="w-full aspect-square rounded-2xl border border-slate-100 p-2 bg-slate-50/50">
            <img className="w-full h-full object-contain mix-blend-multiply" src={activeQrSrc} alt={activeQrLabel} />
          </div>
        </div>
      )}
    </div>
  );
}

export   const payoutFieldClass = 'w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-900 focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all';
