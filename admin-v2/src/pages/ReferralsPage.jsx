import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowRight,
  Bot,
  CheckCircle2,
  Copy,
  CreditCard,
  ExternalLink,
  Lock,
  QrCode,
  Users,
  Wallet,
  Zap
} from 'lucide-react';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { LoadingState } from '../ui/LoadingState.jsx';

const FILTERS = [
  { id: 'all', label: 'Все' },
  { id: 'with_balance', label: 'С балансом' },
  { id: 'rewards', label: 'Начисления' },
  { id: 'payouts', label: 'Выплаты' }
];

function formatWhen(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value));
}

function formatTon(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return '0 TON';
  return `${amount.toLocaleString('ru-RU', { maximumFractionDigits: 6 })} TON`;
}

function eventBadge(event) {
  if (event?.event_type === 'reward_granted') return { text: 'Начисление', className: 'pill pill--ok' };
  if (event?.event_type === 'payout_marked') return { text: 'Выплата', className: 'pill pill--info' };
  if (event?.event_type === 'payout_request_sending') return { text: 'Отправляется', className: 'pill pill--info' };
  if (event?.event_type === 'payout_request_sent') return { text: 'Отправлена', className: 'pill pill--ok' };
  if (event?.event_type === 'payout_request_queued') return { text: 'В очереди', className: 'pill pill--info' };
  if (event?.event_type === 'payout_request_failed') return { text: 'Ошибка выплаты', className: 'pill pill--danger' };
  if (event?.event_type === 'payout_request_cancelled') return { text: 'Отклонена', className: 'pill pill--warning' };
  return { text: event?.event_type || '—', className: 'pill' };
}

function leadStatus(lead) {
  if (lead?.converted) return { text: 'Оплатил', tone: 'reward' };
  if (lead?.expired) return { text: 'Истекло', tone: 'muted' };
  if (lead?.discount_eligible) return { text: 'Скидка жива', tone: 'ok' };
  return { text: 'Без скидки', tone: 'warning' };
}

function payoutStatusLabel(status) {
  if (status === 'requested') return 'Запрошена';
  if (status === 'queued') return 'В очереди';
  if (status === 'sending') return 'Отправляется';
  if (status === 'sent') return 'Отправлена';
  if (status === 'failed') return 'Ошибка';
  if (status === 'cancelled') return 'Отклонена';
  return 'Запрошена';
}

function payoutStatusTone(status) {
  if (status === 'sent') return 'sent';
  if (status === 'failed') return 'failed';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'sending') return 'sending';
  if (status === 'queued') return 'queued';
  return 'requested';
}

function refundStatusLabel(status) {
  if (status === 'confirmed') return 'Подтвержден';
  if (status === 'sent') return 'Отправлен';
  if (status === 'failed') return 'Ошибка';
  if (status === 'cancelled') return 'Отменен';
  return 'Запрошен';
}

function isPayoutEvent(event) {
  return event?.event_type === 'payout_marked' || String(event?.event_type || '').startsWith('payout_request_');
}

function parsePayload(payload) {
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

function firstPresent(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function preferredDepositCheckoutView(reserve) {
  if (reserve?.depositTrustWalletQr || reserve?.depositTrustWalletUri) return 'trust';
  if (reserve?.depositTonQr || reserve?.depositTonUri) return 'ton';
  return 'trust';
}

function payoutTxHash(row) {
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

function payoutNetworkFeeTon(row) {
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

function shortTxHash(value) {
  const hash = String(value || '').trim();
  if (hash.length <= 22) return hash;
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
}

function PayoutChainDetails({ row }) {
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

function PayoutTransferBox({ row }) {
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

function RefundTransferBox({ reserve }) {
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

function DepositTransferBox({ reserve }) {
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

  return (
    <div className="flex flex-col md:flex-row gap-6 p-6 sm:p-8 rounded-[2rem] bg-slate-50/50 border border-slate-200 mt-8 mb-4">
      <div className="flex-1 flex flex-col">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center text-blue-600 shadow-inner">
            <Wallet className="w-5 h-5" strokeWidth={2.5} />
          </div>
          <h3 className="text-xl font-extrabold text-slate-900 tracking-tight">Пополнение через кошелек</h3>
        </div>
        
        <p className="text-base text-slate-600 font-medium mb-8 leading-relaxed max-w-md">
          Переведи ровно с этим memo. QR ставит сумму <strong className="text-slate-900 font-bold bg-slate-200/50 px-1.5 py-0.5 rounded-md">{suggestedAmount > 0 ? formatTon(suggestedAmount) : formatTon(reserve?.minimumDepositTon || 100)}</strong>.
        </p>

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
          {wallet && (
            <button type="button" className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-700 text-sm font-bold shadow-sm hover:bg-slate-50 hover:border-slate-300 hover:text-slate-900 transition-all" onClick={() => copyValue(wallet, 'Кошелек')}>
              <Copy className="w-4 h-4 text-slate-400" /> Кошелек
            </button>
          )}
          {memo && (
            <button type="button" className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-700 text-sm font-bold shadow-sm hover:bg-slate-50 hover:border-slate-300 hover:text-slate-900 transition-all" onClick={() => copyValue(memo, 'Memo')}>
              <Copy className="w-4 h-4 text-slate-400" /> Memo
            </button>
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

export function ReferralsPage() {
  const { accessToken } = useAuth();
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [settingsDraft, setSettingsDraft] = useState({
    referral_enabled: false,
    referral_reward_percent: 20,
    referral_client_discount_percent: 10,
    referral_welcome_text: ''
  });
  const [state, setState] = useState({
    loading: true,
    refreshing: false,
    savingSettings: false,
    payouting: false,
    refunding: false,
    error: '',
    settings: null,
    summary: {},
    topPartners: [],
    leads: [],
    pendingPayouts: [],
    recentEvents: [],
    support: {},
    reserve: null,
    economics: {},
    updatedAt: null
  });

  useEffect(() => {
    let cancelled = false;

    async function loadReferrals({ silent = false } = {}) {
      if (!silent) {
        setState((prev) => ({
          ...prev,
          loading: !prev.topPartners.length,
          refreshing: !!prev.topPartners.length,
          error: ''
        }));
      }

      try {
        const data = await apiRequest('/api/referrals', { accessToken });
        if (!cancelled) {
          setState({
            loading: false,
            refreshing: false,
            savingSettings: false,
            payouting: false,
            refunding: false,
            error: '',
            settings: data.settings || null,
            summary: data.summary || {},
            topPartners: data.topPartners || [],
            leads: data.leads || [],
            pendingPayouts: data.pendingPayouts || [],
            recentEvents: data.recentEvents || [],
            support: data.support || {},
            reserve: data.reserve || null,
            economics: data.economics || {},
            updatedAt: new Date().toISOString()
          });
          setSettingsDraft({
            referral_enabled: !!data.settings?.referral_enabled,
            referral_reward_percent: Number(data.settings?.referral_reward_percent ?? 20),
            referral_client_discount_percent: Number(data.settings?.referral_client_discount_percent ?? data.economics?.clientDiscountPercent ?? 10),
            referral_welcome_text: data.settings?.referral_welcome_text || ''
          });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            loading: false,
            refreshing: false,
            savingSettings: false,
            payouting: false,
            refunding: false,
            error: error.message,
            settings: null,
            summary: {},
            topPartners: [],
            leads: [],
            pendingPayouts: [],
            recentEvents: [],
            support: {},
            reserve: null,
            economics: {},
            updatedAt: null
          });
        }
      }
    }

    if (accessToken) {
      loadReferrals();
    }

    const intervalId = accessToken
      ? window.setInterval(() => {
          loadReferrals({ silent: true });
        }, 60_000)
      : null;

    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [accessToken]);

  const filteredPartners = useMemo(() => {
    const needle = search.trim().toLowerCase();
    let rows = state.topPartners;

    if (filter === 'with_balance') {
      rows = rows.filter((row) => Number(row.balance_rub) > 0 || Number(row.balance_ton) > 0 || Number(row.balance_usdt) > 0);
    } else if (filter === 'rewards') {
      rows = rows.filter((row) => Number(row.earnedRub) > 0 || Number(row.earnedTon) > 0 || Number(row.earnedUsdt) > 0);
    } else if (filter === 'payouts') {
      rows = rows.filter((row) => (
        Number(row.pending_payout_ton) > 0 ||
        Number(row.paid_out_rub) > 0 ||
        Number(row.paid_out_ton) > 0 ||
        Number(row.paid_out_usdt) > 0
      ));
    }

    if (!needle) return rows;

    return rows.filter((row) => [
      row.tg_user_id,
      row.username || '',
      row.display_name || '',
      row.referral_code || ''
    ].join(' ').toLowerCase().includes(needle));
  }, [filter, search, state.topPartners]);

  const filteredLeads = useMemo(() => {
    const needle = search.trim().toLowerCase();
    let rows = state.leads;

    if (filter === 'rewards') {
      rows = rows.filter((row) => row.converted || row.reward_status);
    } else if (filter === 'payouts') {
      rows = [];
    }

    if (!needle) return rows;

    return rows.filter((row) => [
      row.referred_tg_user_id,
      row.referred_username || '',
      row.referred_display_name || '',
      row.referrer_tg_user_id || '',
      row.referrer_username || '',
      row.referrer_display_name || '',
      row.referral_code || ''
    ].join(' ').toLowerCase().includes(needle));
  }, [filter, search, state.leads]);

  const filteredEvents = useMemo(() => {
    if (filter === 'rewards') {
      return state.recentEvents.filter((event) => event.event_type === 'reward_granted');
    }
    if (filter === 'payouts') {
      return state.recentEvents.filter(isPayoutEvent);
    }
    return state.recentEvents;
  }, [filter, state.recentEvents]);

  const prioritySignals = useMemo(() => {
    const signals = [];
    if (state.reserve && !state.reserve.canEnableReferrals) {
      signals.push({
        tone: 'danger',
        title: state.reserve.statusLabel || 'Резерв не готов',
        text: state.reserve.reason || 'Пополни TON-резерв, чтобы включить защищенную партнерку.'
      });
    } else if (state.reserve?.status === 'reserve_low') {
      signals.push({
        tone: 'warning',
        title: 'Резерв на исходе',
        text: 'Новые партнеры пока доступны, но администратору уже пора пополнить TON-резерв.'
      });
    } else if (state.reserve?.canEnableReferrals) {
      signals.push({
        tone: 'ok',
        title: 'Резерв готов',
        text: 'Партнерку можно включать. Деньги зарезервированы под будущие выплаты.'
      });
    }
    if (!state.settings?.referral_enabled) {
      signals.push({
        tone: 'warning',
        title: 'Партнерка выключена',
        text: 'Включите настройки, чтобы пользователи видели партнерку в боте'
      });
    }
    const totalOutstanding = Number(state.summary.outstandingRub || 0) + Number(state.summary.outstandingTon || 0) + Number(state.summary.outstandingUsdt || 0);
    if (totalOutstanding > 0) {
      signals.push({
        tone: 'danger',
        title: 'К выплате',
        text: `Накоплено ${state.summary.outstandingRub || 0} RUB, ${state.summary.outstandingTon || 0} TON, ${state.summary.outstandingUsdt || 0} USDT`
      });
    }
    return signals;
  }, [state.reserve, state.settings, state.summary]);

  async function saveSettings() {
    setState((prev) => ({ ...prev, savingSettings: true, error: '' }));
    try {
      await apiRequest('/api/referrals/settings', {
        accessToken,
        method: 'POST',
        body: settingsDraft
      });
      setState((prev) => ({
        ...prev,
        savingSettings: false,
        settings: { ...settingsDraft },
        updatedAt: new Date().toISOString()
      }));
    } catch (error) {
      setState((prev) => ({ ...prev, savingSettings: false, error: error.message }));
    }
  }

  async function refreshReferralState(extra = {}) {
    const data = await apiRequest('/api/referrals', { accessToken });
    setState((prev) => ({
      ...prev,
      ...extra,
      settings: data.settings || prev.settings,
      summary: data.summary || prev.summary,
      topPartners: data.topPartners || prev.topPartners,
      leads: data.leads || prev.leads,
      pendingPayouts: data.pendingPayouts || [],
      recentEvents: data.recentEvents || prev.recentEvents,
      support: data.support || prev.support,
      reserve: data.reserve || prev.reserve,
      economics: data.economics || prev.economics,
      updatedAt: new Date().toISOString()
    }));
  }

  async function requestReserveRefund() {
    const refundableTon = Number(state.reserve?.refundableTon || 0);
    const grossRefundableTon = Number(state.reserve?.grossRefundableTon || 0);
    const refundNetworkFeeTon = Number(state.reserve?.refundNetworkFeeTon || 0);
    if (!state.reserve?.canRequestRefund) {
      window.alert('Депозит еще в локе. Возврат доступен после 30 дней.');
      return;
    }
    if (refundableTon <= 0) {
      window.alert('Свободного резерва для возврата нет после комиссии сети.');
      return;
    }
    const defaultRefundWallet = state.reserve?.defaultRefundWallet || state.reserve?.refundWallet || '';
    const automaticRefund = !!state.support?.automaticRefundSender;
    const confirmed = window.confirm(
      defaultRefundWallet
        ? `${automaticRefund ? 'Запросить и отправить' : 'Запросить'} возврат ${formatTon(refundableTon)} на кошелек из app/payments?\n\nДепозит: ${formatTon(grossRefundableTon)}\nКомиссия сети: ${formatTon(refundNetworkFeeTon)}\nК получению: ${formatTon(refundableTon)}\n\n${defaultRefundWallet}`
        : `${automaticRefund ? 'Запросить и отправить' : 'Запросить'} возврат ${formatTon(refundableTon)}? Новые партнеры будут на паузе.`
    );
    if (!confirmed) return;
    const rawWallet = defaultRefundWallet || window.prompt('TON-кошелек, куда вернуть свободный резерв:', state.reserve?.refundWallet || '');
    if (rawWallet === null) return;
    const refundWallet = String(rawWallet || '').trim();
    if (!refundWallet) {
      window.alert('Нужен TON-кошелек для возврата. Укажи его в app/payments.');
      return;
    }
    const note = window.prompt('Комментарий к возврату:', '') || '';

    setState((prev) => ({ ...prev, refunding: true, error: '' }));
    try {
      await apiRequest('/api/referrals/reserve/refund-request', {
        accessToken,
        method: 'POST',
        body: {
          note,
          refund_wallet: refundWallet
        }
      });
      if (automaticRefund) {
        await apiRequest('/api/referrals/reserve/refund-send-auto', {
          accessToken,
          method: 'POST'
        });
      }
      await refreshReferralState({ refunding: false });
    } catch (error) {
      await refreshReferralState({ refunding: false }).catch(() => {
        setState((prev) => ({ ...prev, refunding: false }));
      });
      window.alert(error.message);
    }
  }

  async function markReserveRefundSent() {
    const requestedTon = Number(state.reserve?.refundRequestedTon || 0);
    if (state.reserve?.status !== 'refund_requested' || requestedTon <= 0) {
      window.alert('Нет активного запроса на возврат.');
      return;
    }
    const rawTxHash = window.prompt('Tx hash TON-возврата:', '');
    if (rawTxHash === null) return;
    const chainTxHash = rawTxHash.trim();
    if (!chainTxHash) {
      window.alert('Нужен tx hash.');
      return;
    }
    const note = window.prompt('Комментарий к отправленному возврату:', '') || '';

    setState((prev) => ({ ...prev, refunding: true, error: '' }));
    try {
      await apiRequest('/api/referrals/reserve/refund-sent', {
        accessToken,
        method: 'POST',
        body: {
          amount_ton: requestedTon,
          chain_tx_hash: chainTxHash,
          note
        }
      });
      await refreshReferralState({ refunding: false });
    } catch (error) {
      setState((prev) => ({ ...prev, refunding: false }));
      window.alert(error.message);
    }
  }

  async function cancelReserveRefund() {
    if (state.reserve?.status !== 'refund_requested') {
      window.alert('Активной заявки на возврат нет.');
      return;
    }
    const confirmed = window.confirm('Отменить текущую заявку на возврат? После этого можно создать новую на актуальную сумму.');
    if (!confirmed) return;
    const note = window.prompt('Комментарий к отмене:', '') || '';

    setState((prev) => ({ ...prev, refunding: true, error: '' }));
    try {
      await apiRequest('/api/referrals/reserve/refund-cancel', {
        accessToken,
        method: 'POST',
        body: { note }
      });
      await refreshReferralState({ refunding: false });
    } catch (error) {
      setState((prev) => ({ ...prev, refunding: false }));
      window.alert(error.message);
    }
  }

  async function sendReserveRefundAutomatically() {
    const requestedTon = Number(state.reserve?.refundRequestedTon || 0);
    const refundWallet = state.reserve?.refundWallet || '';
    if (state.reserve?.status !== 'refund_requested' || requestedTon <= 0 || !refundWallet) {
      window.alert('Нет активного запроса на возврат с TON-кошельком.');
      return;
    }
    const confirmed = window.confirm(`Автоматически отправить ${formatTon(requestedTon)} на ${refundWallet}?`);
    if (!confirmed) return;

    setState((prev) => ({ ...prev, refunding: true, error: '' }));
    try {
      await apiRequest('/api/referrals/reserve/refund-send-auto', {
        accessToken,
        method: 'POST'
      });
      await refreshReferralState({ refunding: false });
    } catch (error) {
      setState((prev) => ({ ...prev, refunding: false }));
      window.alert(error.message);
    }
  }

  async function markPayout(row, currency) {
    const normalizedCurrency = String(currency || '').toUpperCase();
    const balanceField = normalizedCurrency === 'RUB'
      ? 'balance_rub'
      : normalizedCurrency === 'TON'
        ? 'balance_ton'
        : 'balance_usdt';
    const currentBalance = Number(row?.[balanceField] || 0);
    const pendingTon = Number(row?.pending_payout_ton || 0);
    const hasPendingTonRequest = normalizedCurrency === 'TON' && pendingTon > 0 && row?.pending_payout_id;

    if (currentBalance <= 0) {
      window.alert(`У партнера нет баланса в ${normalizedCurrency}.`);
      return;
    }

    const defaultAmount = hasPendingTonRequest ? pendingTon : currentBalance;
    const promptLines = [
      `Сколько выплатить ${row.display_name || row.username || row.tg_user_id}?`,
      `Баланс: ${currentBalance} ${normalizedCurrency}`
    ];
    if (hasPendingTonRequest) {
      promptLines.push(`Активная заявка: ${pendingTon} TON`);
      promptLines.push('Для заявки нужно закрыть ровно эту сумму.');
    }

    const rawAmount = window.prompt(
      promptLines.join('\n'),
      String(defaultAmount)
    );

    if (rawAmount === null) return;
    const amount = Number(String(rawAmount).replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0) {
      window.alert('Сумма должна быть больше нуля.');
      return;
    }

    let chainTxHash = null;
    let networkFeeTon = null;

    if (normalizedCurrency === 'TON' && hasPendingTonRequest) {
      const rawTxHash = window.prompt('Tx hash TON-перевода (если его нет — оставь пустым):', payoutTxHash(row) || '');
      if (rawTxHash === null) return;

      const defaultNetworkFee = payoutNetworkFeeTon(row) ?? '0';
      const rawNetworkFee = window.prompt('Комиссия сети в TON:', String(defaultNetworkFee));
      if (rawNetworkFee === null) return;

      const parsedNetworkFee = Number(String(rawNetworkFee || '0').replace(',', '.'));
      if (!Number.isFinite(parsedNetworkFee) || parsedNetworkFee < 0) {
        window.alert('Комиссия сети должна быть числом не меньше нуля.');
        return;
      }

      chainTxHash = rawTxHash.trim() || null;
      networkFeeTon = parsedNetworkFee;
    }

    const note = window.prompt('Примечание (карта, кошелек, дата):', '') || '';
    setState((prev) => ({ ...prev, payouting: true }));
    try {
      await apiRequest('/api/referrals/payout', {
        accessToken,
        method: 'POST',
        body: {
          tg_user_id: row.tg_user_id,
          currency: normalizedCurrency,
          amount,
          note,
          chain_tx_hash: chainTxHash,
          network_fee_ton: networkFeeTon,
          payout_request_id: hasPendingTonRequest ? row.pending_payout_id : null
        }
      });
      const data = await apiRequest('/api/referrals', { accessToken });
      setState((prev) => ({
        ...prev,
        payouting: false,
        settings: data.settings || prev.settings,
        summary: data.summary || prev.summary,
        topPartners: data.topPartners || prev.topPartners,
        leads: data.leads || prev.leads,
        pendingPayouts: data.pendingPayouts || prev.pendingPayouts,
        recentEvents: data.recentEvents || prev.recentEvents,
        support: data.support || prev.support,
        reserve: data.reserve || prev.reserve,
        economics: data.economics || prev.economics,
        updatedAt: new Date().toISOString()
      }));
    } catch (error) {
      setState((prev) => ({ ...prev, payouting: false }));
      window.alert(error.message);
    }
  }

  async function updatePayoutRequest(row, nextStatus) {
    if (!row?.pending_payout_id) {
      window.alert('У партнера нет активной заявки.');
      return;
    }

    const actionLabel = nextStatus === 'failed'
      ? 'ошибку выплаты'
      : nextStatus === 'cancelled'
        ? 'отклонение выплаты'
        : nextStatus === 'sending'
          ? 'начало отправки'
          : 'перевод заявки в очередь';
    const note = ['queued', 'sending'].includes(nextStatus)
      ? ''
      : window.prompt(`Комментарий про ${actionLabel}:`, '') || '';

    setState((prev) => ({ ...prev, payouting: true }));
    try {
      await apiRequest('/api/referrals/payout-request-status', {
        accessToken,
        method: 'POST',
        body: {
          payout_request_id: row.pending_payout_id,
          status: nextStatus,
          note
        }
      });
      const data = await apiRequest('/api/referrals', { accessToken });
      setState((prev) => ({
        ...prev,
        payouting: false,
        settings: data.settings || prev.settings,
        summary: data.summary || prev.summary,
        topPartners: data.topPartners || prev.topPartners,
        leads: data.leads || prev.leads,
        pendingPayouts: data.pendingPayouts || [],
        recentEvents: data.recentEvents || prev.recentEvents,
        support: data.support || prev.support,
        reserve: data.reserve || prev.reserve,
        economics: data.economics || prev.economics,
        updatedAt: new Date().toISOString()
      }));
    } catch (error) {
      setState((prev) => ({ ...prev, payouting: false }));
      window.alert(error.message);
    }
  }

  async function sendPayoutAutomatically(row) {
    if (!row?.pending_payout_id) {
      window.alert('У партнера нет активной заявки.');
      return;
    }

    const maxAutoPayoutTon = Number(state.support?.automaticPayoutSenderMaxAmountTon || 0);
    if (maxAutoPayoutTon > 0 && Number(row.pending_payout_ton || 0) > maxAutoPayoutTon) {
      window.alert(`Авто TON сейчас ограничен ${formatTon(maxAutoPayoutTon)} за одну заявку. Эту выплату нужно закрыть вручную.`);
      return;
    }

    const confirmed = window.confirm(`Автоматически отправить ${formatTon(row.pending_payout_ton)} на TON-кошелек партнера?`);
    if (!confirmed) return;

    setState((prev) => ({ ...prev, payouting: true }));
    try {
      await apiRequest('/api/referrals/payout-request-send', {
        accessToken,
        method: 'POST',
        body: {
          payout_request_id: row.pending_payout_id
        }
      });
      const data = await apiRequest('/api/referrals', { accessToken });
      setState((prev) => ({
        ...prev,
        payouting: false,
        settings: data.settings || prev.settings,
        summary: data.summary || prev.summary,
        topPartners: data.topPartners || prev.topPartners,
        leads: data.leads || prev.leads,
        pendingPayouts: data.pendingPayouts || [],
        recentEvents: data.recentEvents || prev.recentEvents,
        support: data.support || prev.support,
        reserve: data.reserve || prev.reserve,
        economics: data.economics || prev.economics,
        updatedAt: new Date().toISOString()
      }));
    } catch (error) {
      setState((prev) => ({ ...prev, payouting: false }));
      window.alert(error.message);
    }
  }

  async function sendMessagePrompt(row) {
    if (!row?.tg_user_id) {
      window.alert('Нет Telegram ID.');
      return;
    }
    const message = window.prompt(`Сообщение для ${row.display_name || row.username || row.tg_user_id}:`);
    if (!message || !message.trim()) return;

    try {
      await apiRequest('/api/userbot/send-message', {
        accessToken,
        method: 'POST',
        body: {
          tg_user_id: String(row.tg_user_id),
          message: message.trim()
        }
      });
      window.alert('Отправлено.');
    } catch (error) {
      window.alert(`Ошибка: ${error.message}`);
    }
  }

  if (state.loading) {
    return <LoadingState text="Загружаем рефералку..." />;
  }

  if (state.error) {
    return (
      <section className="max-w-[1400px] mx-auto p-4 sm:p-6 lg:p-8">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
        </div>
        <div className="p-4 bg-red-50 text-red-600 rounded-2xl border border-red-100 font-medium">{state.error}</div>
      </section>
    );
  }

  return (
    <div className="max-w-[1600px] mx-auto p-4 sm:p-6 lg:p-10 space-y-10">
      
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-1">
          <h1 className="text-4xl font-black text-slate-900 tracking-tight">Партнерская программа</h1>
          <p className="text-lg text-slate-500 font-medium">Резерв, настройки и управление выплатами</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="px-4 py-2 bg-white border border-slate-200 rounded-2xl shadow-sm text-sm font-bold text-slate-600">
            Обновлено: {state.updatedAt ? formatWhen(state.updatedAt) : '...'}
          </div>
        </div>
      </div>

      {/* Main Content Card */}
      <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-xl shadow-slate-200/40 p-6 sm:p-10 lg:p-12">
        
        <div className="space-y-12">
          
          {/* STEP 1: RESERVE FUND */}
          <section className="space-y-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-blue-600 text-white flex items-center justify-center text-xl font-black shadow-lg shadow-blue-600/20">
                  1
                </div>
                <div>
                  <h2 className="text-2xl font-black text-slate-900 tracking-tight">Резервный фонд</h2>
                  <p className="text-slate-500 font-medium text-sm">TON-резерв для автоматических и защищенных выплат</p>
                </div>
              </div>

              <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold shadow-sm border ${
                state.reserve?.canEnableReferrals 
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-100' 
                  : 'bg-amber-50 text-amber-700 border-amber-100'
              }`}>
                <div className={`w-2 h-2 rounded-full animate-pulse ${
                  state.reserve?.canEnableReferrals ? 'bg-emerald-500' : 'bg-amber-500'
                }`} />
                {state.reserve?.statusLabel || (state.reserve?.canEnableReferrals ? 'Резерв готов' : 'Резерв не готов')}
              </div>
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {[
                { label: 'Минимум', value: formatTon(state.reserve?.minimumDepositTon || state.economics?.minimumDepositTon || 100), icon: Lock, color: 'text-slate-400' },
                { label: 'Пополнено', value: formatTon(state.reserve?.fundedReserveTon ?? state.reserve?.totalDepositedTon), icon: Wallet, color: 'text-blue-500' },
                { label: 'Доступно', value: formatTon(state.reserve?.availableReserveTon), icon: Activity, color: 'text-emerald-500' },
                { label: 'Долг админа', value: formatTon(state.reserve?.adminDebtTon), icon: Zap, color: Number(state.reserve?.adminDebtTon || 0) > 0 ? 'text-red-500' : 'text-slate-400' },
              ].map((item, idx) => (
                <div key={idx} className="bg-slate-50/50 border border-slate-100 p-6 rounded-3xl hover:bg-white hover:shadow-xl hover:shadow-slate-200/50 hover:border-blue-100 transition-all group">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-xs font-black uppercase tracking-widest text-slate-400 group-hover:text-slate-500">{item.label}</span>
                    <item.icon className={`w-5 h-5 ${item.color} opacity-70 group-hover:opacity-100 transition-opacity`} />
                  </div>
                  <div className={`text-3xl font-black tracking-tighter ${item.color.includes('emerald') ? 'text-emerald-600' : 'text-slate-900'}`}>
                    {item.value}
                  </div>
                </div>
              ))}
            </div>

            {/* Wallet Info */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-5 bg-white border border-slate-100 rounded-2xl shadow-sm space-y-2">
                  <div className="text-[11px] font-black uppercase tracking-widest text-slate-400">Кошелёк для депозита</div>
                  <div className="font-mono text-xs break-all bg-slate-50 p-3 rounded-xl border border-slate-100 text-slate-700 leading-relaxed">
                    {state.reserve?.depositAddress || 'Кошелёк ещё не подключен'}
                  </div>
                </div>
                <div className="p-5 bg-white border border-slate-100 rounded-2xl shadow-sm space-y-2">
                  <div className="text-[11px] font-black uppercase tracking-widest text-slate-400">Комментарий / Memo</div>
                  <div className="font-mono text-xs break-all bg-slate-50 p-3 rounded-xl border border-slate-100 text-slate-700 leading-relaxed">
                    {state.reserve?.depositMemo || '—'}
                  </div>
                </div>
              </div>
              <div className="p-5 bg-blue-600 rounded-2xl shadow-lg shadow-blue-600/20 flex flex-col justify-center space-y-1">
                <div className="text-[11px] font-black uppercase tracking-widest text-blue-100 opacity-80">Лок депозита</div>
                <div className="text-2xl font-black text-white tracking-tight">
                  {state.reserve?.lockedUntil ? formatWhen(state.reserve?.lockedUntil) : 'Без лока'}
                </div>
              </div>
            </div>

            <DepositTransferBox reserve={state.reserve} />

            {/* Refund Block */}
            <div className="bg-slate-50 border border-slate-200 rounded-3xl p-6 sm:p-8 mt-4 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
                <div className="space-y-1">
                  <div className="text-lg font-black text-slate-900 tracking-tight flex items-center gap-2">
                    <Activity className="w-5 h-5 text-blue-500" />
                    Возврат депозита
                  </div>
                  <p className="text-sm text-slate-500 font-medium">
                    {state.reserve?.status === 'refund_requested'
                      ? `Заявка на ${formatTon(state.reserve?.refundRequestedTon)}. Вернем на TON-кошелек из app/payments.`
                      : state.reserve?.canRequestRefund
                        ? `К возврату: ${formatTon(state.reserve?.refundableTon)}. Сеть: ${formatTon(state.reserve?.refundNetworkFeeTon)}.`
                        : state.reserve?.lockedUntil
                          ? `Будет доступно: ${formatWhen(state.reserve?.lockedUntil)}.`
                          : 'До 100 TON можно вернуть сразу при отсутствии обязательств.'}
                  </p>
                </div>
                
                <div className="flex items-center gap-3">
                  {state.reserve?.status === 'refund_requested' ? (
                    <>
                      {state.support?.automaticRefundSender && (
                        <button
                          className="px-6 py-2.5 bg-blue-600 text-white rounded-xl font-bold text-sm shadow-md shadow-blue-500/20 hover:bg-blue-700 transition-all disabled:opacity-50"
                          onClick={sendReserveRefundAutomatically}
                          disabled={state.refunding}
                        >
                          {state.refunding ? 'Отправляем...' : 'Авто TON'}
                        </button>
                      )}
                      <button
                        className="px-6 py-2.5 bg-white border border-orange-200 text-orange-600 rounded-xl font-bold text-sm hover:bg-orange-50 transition-all disabled:opacity-50"
                        onClick={cancelReserveRefund}
                        disabled={state.refunding}
                      >
                        {state.refunding ? 'Отменяем...' : 'Отменить заявку'}
                      </button>
                    </>
                  ) : (
                    <button
                      className="px-6 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl font-bold text-sm hover:bg-slate-50 hover:border-slate-300 transition-all disabled:opacity-30"
                      onClick={requestReserveRefund}
                      disabled={state.refunding || !state.reserve?.canRequestRefund || Number(state.reserve?.refundableTon || 0) <= 0}
                    >
                      {state.refunding ? 'Запрашиваем...' : 'Запросить возврат'}
                    </button>
                  )}
                </div>
              </div>

              {state.reserve?.refundLast && (
                <div className="bg-white border border-slate-100 rounded-2xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center text-slate-400">
                      <Zap className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-0.5">Последний возврат</div>
                      <div className="text-sm font-bold text-slate-900">
                        {refundStatusLabel(state.reserve.refundLast.status)}
                        {Number(state.reserve.refundLast.amountTon || 0) > 0 && ` на ${formatTon(state.reserve.refundLast.amountTon)}`}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex flex-wrap items-center gap-3">
                    {state.reserve.refundLast.chainTxHash && (
                      <div className="font-mono text-[11px] bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100 text-slate-500" title={String(state.reserve.refundLast.chainTxHash)}>
                        TX: {shortTxHash(state.reserve.refundLast.chainTxHash)}
                      </div>
                    )}
                    {state.reserve.refundLast.error && (
                      <div className="text-xs font-bold text-red-600 bg-red-50 px-3 py-1.5 rounded-lg border border-red-100">
                        {state.reserve.refundLast.error}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </section>

          <div className="h-px bg-slate-100" />

          {/* STEP 2: SETTINGS */}
          <section className="space-y-8">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center text-xl font-black shadow-lg shadow-indigo-600/20">
                2
              </div>
              <div>
                <h2 className="text-2xl font-black text-slate-900 tracking-tight">Настройки партнерки</h2>
                <p className="text-slate-500 font-medium text-sm">Управление экономикой и активация</p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-xs font-black uppercase tracking-widest text-slate-400 ml-1">Статус программы</label>
                  <select
                    className="w-full px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-slate-900 font-bold focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all appearance-none cursor-pointer"
                    value={settingsDraft.referral_enabled ? 'yes' : 'no'}
                    onChange={(event) => setSettingsDraft((prev) => ({ ...prev, referral_enabled: event.target.value === 'yes' }))}
                  >
                    <option value="no">Выключена</option>
                    <option value="yes" disabled={!state.reserve?.canEnableReferrals}>Включена</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-black uppercase tracking-widest text-slate-400 ml-1">Награда партнера, %</label>
                  <div className="relative">
                    <input
                      className="w-full px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-slate-900 font-bold focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all"
                      type="number"
                      min="0"
                      max="100"
                      value={settingsDraft.referral_reward_percent}
                      onChange={(event) => setSettingsDraft((prev) => ({ ...prev, referral_reward_percent: Number(event.target.value || 0) }))}
                    />
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 font-black">%</div>
                  </div>
                </div>

                <div className="space-y-2 group">
                  <label className="text-xs font-black uppercase tracking-widest text-slate-400 ml-1">Скидка клиенту</label>
                  <div className="w-full px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-slate-400 font-bold opacity-60 cursor-not-allowed">
                    {settingsDraft.referral_client_discount_percent || 10}%
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-black uppercase tracking-widest text-slate-400 ml-1">BullRun Fee</label>
                  <div className="w-full px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl text-slate-400 font-bold opacity-60 cursor-not-allowed">
                    {state.economics?.bullrunFeePercent || 1}%
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-3 col-span-full mt-4">
                <label className="text-xs font-black uppercase tracking-widest text-slate-400 ml-1">Приветствие для партнеров</label>
                <textarea
                  className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-[1.5rem] text-slate-900 font-medium focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all min-h-[140px] resize-y shadow-inner"
                  value={settingsDraft.referral_welcome_text}
                  onChange={(event) => setSettingsDraft((prev) => ({ ...prev, referral_welcome_text: event.target.value }))}
                  placeholder="Добро пожаловать в партнерскую программу! Ваша реферальная ссылка готова..."
                  rows={4}
                />
              </div>
            </div>
          </section>

          {prioritySignals.length > 0 && (
            <>
              <div className="h-px bg-slate-100" />
              <section className="space-y-6">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-amber-500 text-white flex items-center justify-center text-xl font-black shadow-lg shadow-amber-500/20">
                    <Activity className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-black text-slate-900 tracking-tight">Уведомления</h2>
                    <p className="text-slate-500 font-medium text-sm">Требует вашего внимания</p>
                  </div>
                </div>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {prioritySignals.slice(0, 3).map((signal, idx) => (
                    <div
                      key={idx}
                      className={`p-5 rounded-[1.5rem] border flex flex-col gap-2 transition-all ${
                        signal.tone === 'danger' 
                          ? 'bg-red-50 border-red-100 shadow-sm' 
                          : 'bg-amber-50 border-amber-100 shadow-sm'
                      }`}
                    >
                      <div className={`text-[10px] font-black uppercase tracking-widest ${
                        signal.tone === 'danger' ? 'text-red-600' : 'text-amber-600'
                      }`}>{signal.title}</div>
                      <div className="text-sm font-bold text-slate-800 leading-snug">{signal.text}</div>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>

        {/* Action Bar */}
        <div className="mt-12 pt-8 border-t border-slate-100 flex justify-end">
          <button
            type="button"
            className="group relative inline-flex items-center justify-center gap-3 rounded-2xl bg-slate-900 px-10 py-4 text-base font-black text-white shadow-xl shadow-slate-900/20 transition-all hover:bg-slate-800 hover:-translate-y-1 active:scale-95 disabled:opacity-50 disabled:translate-y-0"
            onClick={saveSettings}
            disabled={state.savingSettings}
          >
            {state.savingSettings ? (
              <span className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Сохраняем...
              </span>
            ) : (
              <>
                Сохранить настройки
                <ArrowRight className="w-5 h-5 opacity-50 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
              </>
            )}
          </button>
        </div>
      </div>

      {/* DASHBOARD TABLES SECTION */}
      <div className="space-y-8">
        
        {/* PENDING PAYOUTS */}
        <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-xl shadow-slate-200/40 overflow-hidden flex flex-col border-amber-200/60 shadow-amber-500/5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between p-8 gap-4 border-b border-slate-100 bg-slate-50/30">
            <div className="space-y-1">
              <h3 className="text-xl font-black text-slate-900 flex items-center gap-3">
                <CreditCard className="w-6 h-6 text-amber-500" />
                Заявки на выплату
              </h3>
              <p className="text-sm text-slate-500 font-medium">Очередь выплат для ручной или автоматической отправки</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="px-4 py-1.5 bg-amber-100 text-amber-700 rounded-xl text-xs font-black uppercase tracking-wider border border-amber-200">
                {state.pendingPayouts.length} активных
              </span>
            </div>
          </div>

          {state.pendingPayouts.length === 0 ? (
            <div className="p-20 text-center space-y-4 flex flex-col items-center">
              <div className="w-16 h-16 rounded-full bg-slate-50 flex items-center justify-center text-slate-300">
                <CreditCard className="w-8 h-8" />
              </div>
              <p className="text-slate-400 font-bold tracking-tight">Активных заявок на выплату нет</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="bg-slate-50/80 border-b border-slate-100">
                    <th className="px-8 py-4 font-black text-slate-400 uppercase tracking-widest text-[10px]">Партнер</th>
                    <th className="px-8 py-4 font-black text-slate-400 uppercase tracking-widest text-[10px]">Кошелек</th>
                    <th className="px-8 py-4 font-black text-slate-400 uppercase tracking-widest text-[10px]">Сумма / Статус</th>
                    <th className="px-8 py-4 font-black text-slate-400 uppercase tracking-widest text-[10px] text-right">Действия</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {state.pendingPayouts.map((row) => {
                    const payoutStatus = row.pending_payout_status || 'requested';
                    const canQueue = payoutStatus === 'requested';
                    const canStartSending = ['requested', 'queued'].includes(payoutStatus);
                    const maxAutoPayoutTon = Number(state.support?.automaticPayoutSenderMaxAmountTon || 0);
                    const overAutoLimit = maxAutoPayoutTon > 0 && Number(row.pending_payout_ton || 0) > maxAutoPayoutTon;
                    const canAutoSend = state.support?.automaticPayoutSender && !overAutoLimit && ['requested', 'queued'].includes(payoutStatus);
                    const canMarkSent = ['requested', 'queued', 'sending'].includes(payoutStatus);
                    const canFail = ['requested', 'queued', 'sending'].includes(payoutStatus);
                    const canCancel = ['requested', 'queued'].includes(payoutStatus);

                    return (
                      <tr key={row.pending_payout_id || row.tg_user_id} className="hover:bg-slate-50/50 transition-colors group">
                        <td className="px-8 py-6">
                          <div className="font-black text-slate-900 text-base mb-0.5">{row.display_name || row.username || row.tg_user_id}</div>
                          <div className="text-xs text-slate-400 font-bold">ID: {row.tg_user_id}</div>
                        </td>
                        <td className="px-8 py-6">
                          <div className="font-mono text-[11px] text-slate-600 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100 inline-block mb-2 max-w-[200px] truncate" title={row.pending_payout_wallet || row.payout_wallet}>
                            {row.pending_payout_wallet || row.payout_wallet || 'кошелек не указан'}
                          </div>
                          <PayoutTransferBox row={row} />
                          <PayoutChainDetails row={row} />
                        </td>
                        <td className="px-8 py-6">
                          <div className="text-lg font-black text-blue-600 mb-1">{formatTon(row.pending_payout_ton)}</div>
                          <div className={`inline-flex px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wide border ${
                            payoutStatusTone(payoutStatus) === 'ok' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' :
                            payoutStatusTone(payoutStatus) === 'warning' ? 'bg-amber-50 text-amber-700 border-amber-100' :
                            'bg-slate-100 text-slate-600 border-slate-200'
                          }`}>
                            {payoutStatusLabel(payoutStatus)}
                          </div>
                        </td>
                        <td className="px-8 py-6 text-right">
                          <div className="flex justify-end gap-2 group-hover:opacity-100 transition-opacity">
                            {canAutoSend && (
                              <button
                                className="px-3 py-1.5 bg-blue-600 text-white rounded-lg font-bold text-xs shadow-md shadow-blue-500/20 hover:bg-blue-700"
                                onClick={() => sendPayoutAutomatically(row)}
                                disabled={state.payouting}
                              >
                                Авто TON
                              </button>
                            )}
                            <div className="flex items-center gap-1">
                              {canQueue && (
                                <button className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all" onClick={() => updatePayoutRequest(row, 'queued')} title="В очередь">
                                  <Activity className="w-4 h-4" />
                                </button>
                              )}
                              {canMarkSent && (
                                <button className="p-2 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all" onClick={() => markPayout(row, 'TON')} title="Отправлено">
                                  <CheckCircle2 className="w-4 h-4" />
                                </button>
                              )}
                              {canFail && (
                                <button className="p-2 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-all" onClick={() => updatePayoutRequest(row, 'failed')} title="Ошибка">
                                  <Zap className="w-4 h-4" />
                                </button>
                              )}
                              {canCancel && (
                                <button className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all" onClick={() => updatePayoutRequest(row, 'cancelled')} title="Отклонить">
                                  <Lock className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* FILTERS BAR */}
        <div className="flex flex-col md:flex-row items-center gap-6 p-4 bg-white rounded-[2rem] border border-slate-200 shadow-sm">
          <div className="relative flex-1 w-full">
            <input
              className="w-full pl-12 pr-6 py-3.5 bg-slate-50 border border-slate-100 rounded-2xl text-slate-900 font-bold focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all shadow-inner"
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Поиск по TG ID, @username или коду..."
            />
            <Activity className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-300" />
          </div>
          <div className="flex gap-2 p-1.5 bg-slate-100 rounded-2xl w-full md:w-auto">
            {FILTERS.map((item) => (
              <button
                key={item.id}
                className={`flex-1 md:flex-none px-5 py-2 text-xs font-black uppercase tracking-wider rounded-xl transition-all ${
                  filter === item.id 
                    ? 'bg-white text-blue-600 shadow-sm' 
                    : 'text-slate-500 hover:text-slate-700'
                }`}
                onClick={() => setFilter(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
          {/* PARTNERS TABLE */}
          <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-xl shadow-slate-200/40 overflow-hidden flex flex-col">
            <div className="flex items-center justify-between p-8 border-b border-slate-100 bg-slate-50/30">
              <h3 className="text-xl font-black text-slate-900 flex items-center gap-3">
                <Users className="w-6 h-6 text-blue-500" />
                Партнеры
              </h3>
              <span className="px-4 py-1.5 bg-blue-50 text-blue-700 rounded-xl text-xs font-black uppercase tracking-wider border border-blue-100">
                {filteredPartners.length} показано
              </span>
            </div>

            {filteredPartners.length === 0 ? (
              <div className="p-20 text-center text-slate-400 font-bold">Никого не найдено</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="bg-slate-50/80 border-b border-slate-100">
                      <th className="px-8 py-4 font-black text-slate-400 uppercase tracking-widest text-[10px]">Партнер</th>
                      <th className="px-8 py-4 font-black text-slate-400 uppercase tracking-widest text-[10px] text-center">Лиды</th>
                      <th className="px-8 py-4 font-black text-slate-400 uppercase tracking-widest text-[10px]">Баланс</th>
                      <th className="px-8 py-4 font-black text-slate-400 uppercase tracking-widest text-[10px] text-right">Действия</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {filteredPartners.map((row) => {
                      const hasBalance = Number(row.balance_rub) > 0 || Number(row.balance_ton) > 0 || Number(row.balance_usdt) > 0;
                      return (
                        <tr key={row.tg_user_id} className="hover:bg-slate-50/50 transition-colors group">
                          <td className="px-8 py-6">
                            <div className="font-black text-slate-900 text-base mb-0.5">{row.display_name || row.username || row.tg_user_id}</div>
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-[10px] font-black uppercase text-slate-400 tracking-tight">ID: {row.tg_user_id}</span>
                              <span className="w-1 h-1 rounded-full bg-slate-200" />
                              <span className="font-mono text-[10px] text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md font-bold uppercase">{row.referral_code}</span>
                            </div>
                            <div className="flex flex-col gap-1">
                              {row.payout_wallet ? (
                                <div className="text-[10px] font-mono text-slate-400 truncate max-w-[150px]">{row.payout_wallet}</div>
                              ) : (
                                <div className="text-[10px] font-bold text-slate-300 italic uppercase">Кошелек не указан</div>
                              )}
                            </div>
                            {Number(row.pending_payout_ton || 0) > 0 && (
                              <div className="inline-flex px-2 py-0.5 rounded-md bg-orange-50 text-orange-600 border border-orange-100 text-[10px] font-black uppercase mt-2">
                                Ожидает: {formatTon(row.pending_payout_ton)}
                              </div>
                            )}
                          </td>
                          <td className="px-8 py-6 text-center">
                            <span className={`inline-flex w-10 h-10 items-center justify-center rounded-2xl font-black text-sm border shadow-sm ${
                              (row.total_referrals || 0) > 0 
                                ? 'bg-emerald-50 text-emerald-600 border-emerald-100' 
                                : 'bg-slate-50 text-slate-400 border-slate-200'
                            }`}>
                              {row.total_referrals || 0}
                            </span>
                          </td>
                          <td className="px-8 py-6">
                            <div className={`text-base font-black tracking-tight ${hasBalance ? 'text-slate-900' : 'text-slate-400'}`}>
                              {row.balance_rub || 0} RUB
                            </div>
                            <div className="text-[10px] font-bold text-slate-400 uppercase mt-0.5">
                              {row.balance_ton || 0} TON • {row.balance_usdt || 0} USDT
                            </div>
                          </td>
                          <td className="px-8 py-6 text-right">
                            <div className="flex justify-end gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button className="p-2 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all" onClick={() => sendMessagePrompt(row)} title="Написать">
                                <Bot className="w-4 h-4" />
                              </button>
                              <a className="p-2 !text-slate-400 hover:!text-purple-600 hover:bg-purple-50 rounded-lg transition-all" href={`/app/dossier?tg=${encodeURIComponent(row.tg_user_id)}`} target="_blank" rel="noreferrer" title="Досье">
                                <Activity className="w-4 h-4" />
                              </a>
                              {hasBalance && (
                                <button className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all" onClick={() => markPayout(row, 'TON')} title="Выплатить">
                                  <CreditCard className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* EVENTS TABLE */}
          <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-xl shadow-slate-200/40 overflow-hidden flex flex-col">
            <div className="flex items-center justify-between p-8 border-b border-slate-100 bg-slate-50/30">
              <h3 className="text-xl font-black text-slate-900 flex items-center gap-3">
                <Activity className="w-6 h-6 text-purple-500" />
                События
              </h3>
            </div>

            {filteredEvents.length === 0 ? (
              <div className="p-20 text-center text-slate-400 font-bold">Событий нет</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="bg-slate-50/80 border-b border-slate-100">
                      <th className="px-8 py-4 font-black text-slate-400 uppercase tracking-widest text-[10px]">Когда</th>
                      <th className="px-8 py-4 font-black text-slate-400 uppercase tracking-widest text-[10px]">Тип / Партнер</th>
                      <th className="px-8 py-4 font-black text-slate-400 uppercase tracking-widest text-[10px] text-right">Сумма</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {filteredEvents.slice(0, 30).map((event) => {
                      const badge = eventBadge(event);
                      const isReward = event.event_type === 'reward_granted';
                      return (
                        <tr key={event.id} className="hover:bg-slate-50/50 transition-colors group">
                          <td className="px-8 py-5">
                            <div className="text-xs font-bold text-slate-500">{formatWhen(event.created_at)}</div>
                          </td>
                          <td className="px-8 py-5">
                            <div className={`inline-flex px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wide border mb-1 ${
                              isReward ? 'bg-purple-50 text-purple-700 border-purple-100' : 'bg-blue-50 text-blue-700 border-blue-100'
                            }`}>
                              {badge.text}
                            </div>
                            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">ID: {event.referrer_tg_user_id}</div>
                          </td>
                          <td className="px-8 py-5 text-right">
                            <div className={`text-base font-black tracking-tight ${isReward ? 'text-emerald-600' : 'text-slate-900'}`}>
                              {event.reward_amount || 0} {event.reward_currency || ''}
                            </div>
                            {!isReward && <PayoutChainDetails row={event} />}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* LEADS TABLE (FULL WIDTH) */}
          <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-xl shadow-slate-200/40 overflow-hidden flex flex-col col-span-full">
            <div className="flex items-center justify-between p-8 border-b border-slate-100 bg-slate-50/30">
              <h3 className="text-xl font-black text-slate-900 flex items-center gap-3">
                <Users className="w-6 h-6 text-emerald-500" />
                Лиды
              </h3>
              <span className="px-4 py-1.5 bg-emerald-50 text-emerald-700 rounded-xl text-xs font-black uppercase tracking-wider border border-emerald-100">
                {filteredLeads.length} показано
              </span>
            </div>

            {filteredLeads.length === 0 ? (
              <div className="p-20 text-center text-slate-400 font-bold">Лидов не найдено</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="bg-slate-50/80 border-b border-slate-100">
                      <th className="px-8 py-4 font-black text-slate-400 uppercase tracking-widest text-[10px]">Лид</th>
                      <th className="px-8 py-4 font-black text-slate-400 uppercase tracking-widest text-[10px]">Партнер</th>
                      <th className="px-8 py-4 font-black text-slate-400 uppercase tracking-widest text-[10px]">Активность</th>
                      <th className="px-8 py-4 font-black text-slate-400 uppercase tracking-widest text-[10px] text-right">Статус / Награда</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {filteredLeads.slice(0, 50).map((lead) => {
                      const status = leadStatus(lead);
                      const rewardAmount = lead.reward_ton_amount || lead.reward_amount;
                      const rewardCurrency = lead.reward_ton_amount ? 'TON' : lead.reward_currency;
                      return (
                        <tr key={lead.id} className="hover:bg-slate-50/50 transition-colors group">
                          <td className="px-8 py-6">
                            <div className="font-black text-slate-900 text-base mb-0.5">{lead.referred_display_name || lead.referred_username || lead.referred_tg_user_id}</div>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-black uppercase text-slate-400 tracking-tight">ID: {lead.referred_tg_user_id}</span>
                              <a className="p-1 !text-slate-300 hover:!text-purple-600 transition-colors" href={`/app/dossier?tg=${encodeURIComponent(lead.referred_tg_user_id)}`} target="_blank" rel="noreferrer">
                                <Activity className="w-3.5 h-3.5" />
                              </a>
                            </div>
                          </td>
                          <td className="px-8 py-6">
                            <div className="font-bold text-slate-800 text-sm mb-0.5">{lead.referrer_display_name || lead.referrer_username || lead.referrer_tg_user_id}</div>
                            <div className="text-[10px] font-black uppercase text-slate-400 tracking-tight">
                              ID: {lead.referrer_tg_user_id} • <span className="text-blue-600 font-bold">{lead.referral_code || '—'}</span>
                            </div>
                          </td>
                          <td className="px-8 py-6">
                            <div className="text-[11px] font-bold text-slate-500 mb-1 flex items-center gap-2">
                              <div className="w-1 h-1 rounded-full bg-slate-300" />
                              Вход: {formatWhen(lead.first_seen_at)}
                            </div>
                            <div className="text-[11px] font-bold text-slate-500 flex items-center gap-2">
                              <div className="w-1 h-1 rounded-full bg-slate-300" />
                              Истекает: {formatWhen(lead.expires_at)}
                            </div>
                            {lead.converted_at && (
                              <div className="text-[11px] font-black text-emerald-600 mt-1 flex items-center gap-2 uppercase">
                                <CheckCircle2 className="w-3 h-3" />
                                Оплата: {formatWhen(lead.converted_at)}
                              </div>
                            )}
                          </td>
                          <td className="px-8 py-6 text-right">
                            <div className={`inline-flex px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-wide border mb-2 ${
                              status.tone === 'ok' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' :
                              status.tone === 'warning' ? 'bg-amber-50 text-amber-700 border-amber-100' :
                              'bg-slate-100 text-slate-500 border-slate-200'
                            }`}>{status.text}</div>
                            {rewardAmount ? (
                              <div className="font-black text-lg text-emerald-600 tracking-tight">
                                +{rewardAmount} <span className="text-xs uppercase ml-0.5 font-black">{rewardCurrency}</span>
                              </div>
                            ) : (
                              <div className="text-[10px] font-bold text-slate-300 uppercase tracking-widest italic">Без начисления</div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
