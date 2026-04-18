import { useEffect, useMemo, useState } from 'react';
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
    <div className="referrals-payout-chain">
      {networkFeeTon !== null && (
        <div className="referrals-payout-chain__item">Комиссия сети: {formatTon(networkFeeTon)}</div>
      )}
      {txHash && (
        <div className="referrals-payout-chain__item">
          Tx: <span className="referrals-payout-chain__hash" title={String(txHash)}>{shortTxHash(txHash)}</span>
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
    <div className="referrals-payout-transfer">
      {qr && <img className="referrals-payout-transfer__qr" src={qr} alt="QR для TON-выплаты" />}
      <div className="referrals-payout-transfer__body">
        <div className="referrals-payout-transfer__title">Оплата через кошелек</div>
        {memo && (
          <div className="referrals-payout-transfer__memo">
            Memo: <span>{memo}</span>
          </div>
        )}
        <div className="referrals-payout-transfer__actions">
          {uri && (
            <a className="referrals-action-btn referrals-action-btn--payout" href={uri}>
              Открыть
            </a>
          )}
          {memo && (
            <button
              type="button"
              className="referrals-action-btn"
              onClick={() => copyValue(memo, 'Memo')}
            >
              Memo
            </button>
          )}
          {uri && (
            <button
              type="button"
              className="referrals-action-btn"
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
    <div className="referrals-payout-transfer referrals-refund-transfer">
      {qr && <img className="referrals-payout-transfer__qr" src={qr} alt="QR для возврата TON-резерва" />}
      <div className="referrals-payout-transfer__body">
        <div className="referrals-payout-transfer__title">Возврат через TON-кошелек</div>
        {wallet && (
          <div className="referrals-payout-transfer__memo">
            Кошелек: <span>{wallet}</span>
          </div>
        )}
        {memo && (
          <div className="referrals-payout-transfer__memo">
            Memo: <span>{memo}</span>
          </div>
        )}
        <div className="referrals-payout-transfer__actions">
          {uri && (
            <a className="referrals-action-btn referrals-action-btn--payout" href={uri}>
              Открыть
            </a>
          )}
          {wallet && (
            <button type="button" className="referrals-action-btn" onClick={() => copyValue(wallet, 'Кошелек')}>
              Кошелек
            </button>
          )}
          {memo && (
            <button type="button" className="referrals-action-btn" onClick={() => copyValue(memo, 'Memo')}>
              Memo
            </button>
          )}
          {uri && (
            <button type="button" className="referrals-action-btn" onClick={() => copyValue(uri, 'TON-ссылка')}>
              Ссылка
            </button>
          )}
        </div>
      </div>
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
    if (!state.reserve?.lockExpired) {
      window.alert('Депозит еще в локе. Возврат доступен после 30 дней.');
      return;
    }
    if (refundableTon <= 0) {
      window.alert('Свободного резерва для возврата нет.');
      return;
    }
    const confirmed = window.confirm(`Запросить возврат ${formatTon(refundableTon)}? Новые партнеры будут на паузе.`);
    if (!confirmed) return;
    const rawWallet = window.prompt('TON-кошелек, куда вернуть свободный резерв:', state.reserve?.refundWallet || '');
    if (rawWallet === null) return;
    const refundWallet = rawWallet.trim();
    if (!refundWallet) {
      window.alert('Нужен TON-кошелек для возврата.');
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
      await refreshReferralState({ refunding: false });
    } catch (error) {
      setState((prev) => ({ ...prev, refunding: false }));
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
      <section className="page">
        <div className="page__header">
        </div>
        <div className="error-card">{state.error}</div>
      </section>
    );
  }

  return (
    <section className="page space-y-5">
      <section className="referrals-control-window">
        <div className="referrals-window__header">
          <div className="referrals-window__title">Партнерская программа</div>
          <div className="referrals-window__subtitle">Резерв, настройки, управление выплатами</div>
        </div>

        <div className="referrals-window__sections">
          <div className="referrals-section">
            <div className="referrals-section__header">
              <div className="referrals-section__title">
                <span className="referrals-section__number">1</span>
                Резервный фонд
              </div>
              <div className="referrals-section__hint">TON-резерв для защищенных выплат</div>
            </div>
            <div className="referrals-section__body">
              <div className="referrals-status-badge">
                <div className={`referrals-status-dot ${state.reserve?.canEnableReferrals ? 'referrals-status-dot--ok' : 'referrals-status-dot--warning'}`} />
                <span className="referrals-status-label">
                  {state.reserve?.statusLabel || (state.reserve?.canEnableReferrals ? 'Резерв готов' : 'Резерв не готов')}
                </span>
              </div>

              <div className="referrals-metrics-grid">
                <div className="referrals-metric">
                  <div className="referrals-metric__label">Минимум</div>
                  <div className="referrals-metric__value">{formatTon(state.reserve?.minimumDepositTon || state.economics?.minimumDepositTon || 100)}</div>
                </div>
                <div className="referrals-metric">
                  <div className="referrals-metric__label">Пополнено</div>
                  <div className="referrals-metric__value">{formatTon(state.reserve?.totalDepositedTon)}</div>
                </div>
                <div className="referrals-metric">
                  <div className="referrals-metric__label">Доступно</div>
                  <div className="referrals-metric__value referrals-metric__value--highlight">{formatTon(state.reserve?.availableReserveTon)}</div>
                </div>
                <div className="referrals-metric">
                  <div className="referrals-metric__label">Долг админа</div>
                  <div className={`referrals-metric__value ${Number(state.reserve?.adminDebtTon || 0) > 0 ? 'referrals-metric__value--danger' : ''}`}>
                    {formatTon(state.reserve?.adminDebtTon)}
                  </div>
                </div>
              </div>

              <div className="referrals-deposit-grid">
                <div className="referrals-deposit-field">
                  <div className="referrals-deposit-field__label">Кошелёк для депозита</div>
                  <div className="referrals-deposit-field__value referrals-deposit-field__value--mono">
                    {state.reserve?.depositAddress || 'Кошелёк ещё не подключен в env'}
                  </div>
                </div>
                <div className="referrals-deposit-field">
                  <div className="referrals-deposit-field__label">Комментарий / memo</div>
                  <div className="referrals-deposit-field__value referrals-deposit-field__value--mono">
                    {state.reserve?.depositMemo || '—'}
                  </div>
                </div>
                <div className="referrals-deposit-field">
                  <div className="referrals-deposit-field__label">Лок депозита</div>
                  <div className="referrals-deposit-field__value">{formatWhen(state.reserve?.lockedUntil)}</div>
                </div>
              </div>

              <div className="referrals-refund-box">
                <div>
                  <div className="referrals-refund-box__title">Возврат депозита</div>
                  <div className="referrals-refund-box__text">
                    {state.reserve?.status === 'refund_requested'
                      ? `Запрошен возврат ${formatTon(state.reserve?.refundRequestedTon)}. Новые партнеры на паузе до закрытия.`
                      : state.reserve?.lockExpired
                        ? `Можно вернуть свободный остаток: ${formatTon(state.reserve?.refundableTon)}. Обязательства и комиссии останутся в резерве.`
                        : `Возврат откроется после лока: ${formatWhen(state.reserve?.lockedUntil)}.`}
                  </div>
                  <RefundTransferBox reserve={state.reserve} />
                </div>
                <div className="referrals-refund-box__actions">
                  {state.reserve?.status === 'refund_requested' ? (
                    <button
                      className="referrals-action-btn referrals-action-btn--warning"
                      onClick={markReserveRefundSent}
                      disabled={state.refunding}
                    >
                      {state.refunding ? 'Закрываем...' : 'Отметить отправленным'}
                    </button>
                  ) : (
                    <button
                      className="referrals-action-btn referrals-action-btn--payout"
                      onClick={requestReserveRefund}
                      disabled={state.refunding || !state.reserve?.lockExpired || Number(state.reserve?.refundableTon || 0) <= 0}
                    >
                      {state.refunding ? 'Запрашиваем...' : 'Запросить возврат'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="referrals-divider" />

          <div className="referrals-section">
            <div className="referrals-section__header">
              <div className="referrals-section__title">
                <span className="referrals-section__number">2</span>
                Настройки партнерки
              </div>
              <div className="referrals-section__hint">Включение и экономика</div>
            </div>
            <div className="referrals-section__body">
              <div className="form-grid referrals-settings-grid">
                <div className="field-group">
                  <label className="field-label">Статус</label>
                  <select
                    className="field"
                    value={settingsDraft.referral_enabled ? 'yes' : 'no'}
                    onChange={(event) => setSettingsDraft((prev) => ({ ...prev, referral_enabled: event.target.value === 'yes' }))}
                  >
                    <option value="no">Выключена</option>
                    <option value="yes" disabled={!state.reserve?.canEnableReferrals}>Включена</option>
                  </select>
                </div>

                <div className="field-group">
                  <label className="field-label">Награда партнера, %</label>
                  <input
                    className="field"
                    type="number"
                    min="0"
                    max="100"
                    value={settingsDraft.referral_reward_percent}
                    onChange={(event) => setSettingsDraft((prev) => ({ ...prev, referral_reward_percent: Number(event.target.value || 0) }))}
                  />
                </div>

                <div className="field-group">
                  <label className="field-label">Скидка клиенту</label>
                  <div className="field field--readonly">
                    {settingsDraft.referral_client_discount_percent || 10}%
                  </div>
                </div>

                <div className="field-group">
                  <label className="field-label">BullRun fee</label>
                  <div className="field field--readonly">
                    {state.economics?.bullrunFeePercent || 1}%
                  </div>
                </div>
              </div>

              <div className="field-group referrals-settings-welcome">
                <label className="field-label">Приветствие для партнеров</label>
                <textarea
                  className="field textarea-field"
                  value={settingsDraft.referral_welcome_text}
                  onChange={(event) => setSettingsDraft((prev) => ({ ...prev, referral_welcome_text: event.target.value }))}
                  placeholder="Добро пожаловать в партнерскую программу! Ваша реферальная ссылка готова..."
                  rows={3}
                />
              </div>
            </div>
          </div>

          {prioritySignals.length > 0 && (
            <>
              <div className="referrals-divider" />
              <div className="referrals-section">
                <div className="referrals-section__header">
                  <div className="referrals-section__title">
                    <span className="referrals-section__number">3</span>
                    Уведомления
                  </div>
                  <div className="referrals-section__hint">Требует внимания</div>
                </div>
                <div className="referrals-section__body">
                  <div className="referrals-signals-grid">
                    {prioritySignals.slice(0, 3).map((signal) => (
                      <div
                        key={`${signal.title}-${signal.tone}`}
                        className={`referrals-signal-card referrals-signal-card--${signal.tone}`}
                      >
                        <div className="referrals-signal-card__title">{signal.title}</div>
                        <div className="referrals-signal-card__text">{signal.text}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="referrals-window__footer">
          <button
            type="button"
            className="button button--primary button--large"
            onClick={saveSettings}
            disabled={state.savingSettings}
          >
            {state.savingSettings ? 'Сохраняем...' : 'Сохранить настройки'}
          </button>
        </div>
      </section>

      <div className="referrals-data-section">
        <div className="referrals-table-card referrals-payout-queue">
          <div className="referrals-table-card__header">
            <div>
              <h3 className="referrals-table-card__title">Заявки на выплату</h3>
              <div className="referrals-table-card__count">Пока отправка TON ручная, этот блок держит очередь под будущий sender.</div>
            </div>
            <span className="referrals-table-card__count">{state.pendingPayouts.length} активных</span>
          </div>

          {state.pendingPayouts.length === 0 ? (
            <p className="referrals-table-card__empty">Активных заявок на выплату нет</p>
          ) : (
            <div className="referrals-table-card__body">
              <table className="referrals-table">
                <thead>
                  <tr className="referrals-table__head">
                    <th className="referrals-table__th">Партнер</th>
                    <th className="referrals-table__th">Кошелек</th>
                    <th className="referrals-table__th">Заявка</th>
                    <th className="referrals-table__th referrals-table__th--right">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {state.pendingPayouts.map((row) => {
                    const payoutStatus = row.pending_payout_status || 'requested';
                    const canQueue = payoutStatus === 'requested';
                    const canStartSending = ['requested', 'queued'].includes(payoutStatus);
                    const canAutoSend = state.support?.automaticPayoutSender && ['requested', 'queued'].includes(payoutStatus);
                    const canMarkSent = ['requested', 'queued', 'sending'].includes(payoutStatus);
                    const canFail = ['requested', 'queued', 'sending'].includes(payoutStatus);
                    const canCancel = ['requested', 'queued'].includes(payoutStatus);

                    return (
                      <tr key={row.pending_payout_id || row.tg_user_id} className="referrals-table__row">
                        <td className="referrals-table__cell">
                          <div className="referrals-partner-name">{row.display_name || row.username || row.tg_user_id}</div>
                          <div className="referrals-partner-meta">ID: {row.tg_user_id}</div>
                        </td>
                        <td className="referrals-table__cell">
                          <div className="referrals-partner-wallet-value">{row.pending_payout_wallet || row.payout_wallet || 'кошелек не указан'}</div>
                          <PayoutTransferBox row={row} />
                          <PayoutChainDetails row={row} />
                        </td>
                        <td className="referrals-table__cell">
                          <div className="referrals-balance referrals-balance--active">{formatTon(row.pending_payout_ton)}</div>
                          <div className={`referrals-payout-status referrals-payout-status--${payoutStatusTone(payoutStatus)}`}>
                            {payoutStatusLabel(payoutStatus)}
                          </div>
                          <div className="referrals-balance-secondary">
                            {formatWhen(row.pending_payout_requested_at)}
                          </div>
                        </td>
                        <td className="referrals-table__cell referrals-table__cell--right">
                          <div className="referrals-actions">
                            {canQueue && (
                              <button
                                className="referrals-action-btn referrals-action-btn--payout"
                                onClick={() => updatePayoutRequest(row, 'queued')}
                                disabled={state.payouting}
                              >
                                В очередь
                              </button>
                            )}
                            {canStartSending && (
                              <button
                                className="referrals-action-btn referrals-action-btn--payout"
                                onClick={() => updatePayoutRequest(row, 'sending')}
                                disabled={state.payouting}
                              >
                                Отправляю
                              </button>
                            )}
                            {canAutoSend && (
                              <button
                                className="referrals-action-btn referrals-action-btn--payout"
                                onClick={() => sendPayoutAutomatically(row)}
                                disabled={state.payouting}
                              >
                                Авто TON
                              </button>
                            )}
                            {canMarkSent && (
                              <button
                                className="referrals-action-btn referrals-action-btn--payout"
                                onClick={() => markPayout(row, 'TON')}
                                disabled={state.payouting}
                              >
                                Отправлено
                              </button>
                            )}
                            {canFail && (
                              <button
                                className="referrals-action-btn referrals-action-btn--warning"
                                onClick={() => updatePayoutRequest(row, 'failed')}
                                disabled={state.payouting}
                              >
                                Ошибка
                              </button>
                            )}
                            {canCancel && (
                              <button
                                className="referrals-action-btn referrals-action-btn--danger"
                                onClick={() => updatePayoutRequest(row, 'cancelled')}
                                disabled={state.payouting}
                              >
                                Отклонить
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

        <div className="referrals-filters-bar">
          <input
            className="field referrals-filters-bar__search"
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Поиск по TG ID, @username или коду"
          />
          <div className="referrals-filters-bar__filters">
            {FILTERS.map((item) => (
              <button
                key={item.id}
                className={`referrals-filter-btn ${filter === item.id ? 'referrals-filter-btn--active' : ''}`}
                onClick={() => setFilter(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="referrals-tables-grid">
          <div className="referrals-table-card">
            <div className="referrals-table-card__header">
              <h3 className="referrals-table-card__title">Партнеры</h3>
              <span className="referrals-table-card__count">{filteredPartners.length} показано</span>
            </div>

            {filteredPartners.length === 0 ? (
              <p className="referrals-table-card__empty">По фильтру никого нет</p>
            ) : (
              <div className="referrals-table-card__body">
                <table className="referrals-table">
                  <thead>
                    <tr className="referrals-table__head">
                      <th className="referrals-table__th">Партнер</th>
                      <th className="referrals-table__th">Лидов</th>
                      <th className="referrals-table__th">Баланс</th>
                      <th className="referrals-table__th referrals-table__th--right">Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPartners.map((row) => {
                      const hasBalance = Number(row.balance_rub) > 0 || Number(row.balance_ton) > 0 || Number(row.balance_usdt) > 0;
                      return (
                        <tr key={row.tg_user_id} className="referrals-table__row">
                          <td className="referrals-table__cell">
                            <div className="referrals-partner-name">{row.display_name || row.username || row.tg_user_id}</div>
                            <div className="referrals-partner-meta">ID: {row.tg_user_id} • <span className="referrals-partner-code">{row.referral_code}</span></div>
                            <div className="referrals-partner-wallet">
                              Кошелёк: {row.payout_wallet ? <span className="referrals-partner-wallet-value">{row.payout_wallet}</span> : 'не указан'}
                            </div>
                            {Number(row.pending_payout_ton || 0) > 0 && (
                              <div className="referrals-partner-pending">
                                Заявка: {formatTon(row.pending_payout_ton)} • {payoutStatusLabel(row.pending_payout_status)}
                              </div>
                            )}
                            {Number(row.pending_payout_ton || 0) <= 0 && row.latest_payout_status && (
                              <div className={`referrals-payout-status referrals-payout-status--${payoutStatusTone(row.latest_payout_status)}`}>
                                Последняя выплата: {payoutStatusLabel(row.latest_payout_status)}
                              </div>
                            )}
                            <PayoutChainDetails row={row} />
                          </td>
                          <td className="referrals-table__cell">
                            <span className={`referrals-count-badge ${(row.total_referrals || 0) > 0 ? 'referrals-count-badge--positive' : ''}`}>
                              {row.total_referrals || 0}
                            </span>
                          </td>
                          <td className="referrals-table__cell">
                            <div className={`referrals-balance ${hasBalance ? 'referrals-balance--active' : ''}`}>
                              {row.balance_rub || 0} RUB
                            </div>
                            <div className="referrals-balance-secondary">
                              {row.balance_ton || 0} TON • {row.balance_usdt || 0} USDT
                            </div>
                          </td>
                          <td className="referrals-table__cell referrals-table__cell--right">
                            <div className="referrals-actions">
                              <button
                                className="referrals-action-btn referrals-action-btn--message"
                                onClick={() => sendMessagePrompt(row)}
                              >
                                Написать
                              </button>
                              {Number(row.balance_rub) > 0 && (
                                <button
                                  className="referrals-action-btn referrals-action-btn--payout"
                                  onClick={() => markPayout(row, 'RUB')}
                                  disabled={state.payouting}
                                >
                                  RUB
                                </button>
                              )}
                              {Number(row.balance_ton) > 0 && (
                                <button
                                  className="referrals-action-btn referrals-action-btn--payout"
                                  onClick={() => markPayout(row, 'TON')}
                                  disabled={state.payouting}
                                >
                                  {Number(row.pending_payout_ton || 0) > 0 ? 'Заявка TON' : 'TON'}
                                </button>
                              )}
                              {Number(row.balance_usdt) > 0 && (
                                <button
                                  className="referrals-action-btn referrals-action-btn--payout"
                                  onClick={() => markPayout(row, 'USDT')}
                                  disabled={state.payouting}
                                >
                                  USDT
                                </button>
                              )}
                              <a
                                className="referrals-action-btn referrals-action-btn--dossier"
                                href={`/app/dossier?tg=${encodeURIComponent(row.tg_user_id)}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Досье
                              </a>
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

          <div className="referrals-table-card referrals-table-card--wide">
            <div className="referrals-table-card__header">
              <h3 className="referrals-table-card__title">Лиды</h3>
              <span className="referrals-table-card__count">{filteredLeads.length} показано</span>
            </div>

            {filteredLeads.length === 0 ? (
              <p className="referrals-table-card__empty">Лидов по фильтру нет</p>
            ) : (
              <div className="referrals-table-card__body">
                <table className="referrals-table">
                  <thead>
                    <tr className="referrals-table__head">
                      <th className="referrals-table__th">Лид</th>
                      <th className="referrals-table__th">Партнер</th>
                      <th className="referrals-table__th">Атрибуция</th>
                      <th className="referrals-table__th referrals-table__th--right">Условия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLeads.slice(0, 80).map((lead) => {
                      const status = leadStatus(lead);
                      const rewardAmount = lead.reward_ton_amount || lead.reward_amount;
                      const rewardCurrency = lead.reward_ton_amount ? 'TON' : lead.reward_currency;
                      return (
                        <tr key={lead.id} className="referrals-table__row">
                          <td className="referrals-table__cell">
                            <div className="referrals-partner-name">{lead.referred_display_name || lead.referred_username || lead.referred_tg_user_id}</div>
                            <div className="referrals-partner-meta">ID: {lead.referred_tg_user_id}</div>
                            <a
                              className="referrals-action-btn referrals-action-btn--dossier referrals-lead-dossier"
                              href={`/app/dossier?tg=${encodeURIComponent(lead.referred_tg_user_id)}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Досье
                            </a>
                          </td>
                          <td className="referrals-table__cell">
                            <div className="referrals-partner-name">{lead.referrer_display_name || lead.referrer_username || lead.referrer_tg_user_id}</div>
                            <div className="referrals-partner-meta">
                              ID: {lead.referrer_tg_user_id} • <span className="referrals-partner-code">{lead.referral_code || '—'}</span>
                            </div>
                          </td>
                          <td className="referrals-table__cell referrals-table__cell--secondary">
                            <div>Первый вход: {formatWhen(lead.first_seen_at)}</div>
                            <div>Истекает: {formatWhen(lead.expires_at)}</div>
                            {lead.converted_at && <div>Оплатил: {formatWhen(lead.converted_at)}</div>}
                          </td>
                          <td className="referrals-table__cell referrals-table__cell--right">
                            <div className={`referrals-lead-status referrals-lead-status--${status.tone}`}>{status.text}</div>
                            <div className="referrals-balance-secondary">
                              скидка {lead.client_discount_percent_snapshot ?? state.economics?.clientDiscountPercent ?? 10}% • награда {lead.reward_percent_snapshot ?? state.settings?.referral_reward_percent ?? 0}%
                            </div>
                            {rewardAmount ? (
                              <div className="referrals-event-amount referrals-event-amount--reward">
                                {rewardAmount} {rewardCurrency || ''}
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="referrals-table-card">
            <div className="referrals-table-card__header">
              <h3 className="referrals-table-card__title">События</h3>
              <span className="referrals-table-card__count">{filteredEvents.length} показано</span>
            </div>

            {filteredEvents.length === 0 ? (
              <p className="referrals-table-card__empty">Событий нет</p>
            ) : (
              <div className="referrals-table-card__body">
                <table className="referrals-table">
                  <thead>
                    <tr className="referrals-table__head">
                      <th className="referrals-table__th">Когда</th>
                      <th className="referrals-table__th">Тип</th>
                      <th className="referrals-table__th">Партнер</th>
                      <th className="referrals-table__th referrals-table__th--right">Сумма</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEvents.slice(0, 30).map((event) => {
                      const badge = eventBadge(event);
                      const isReward = event.event_type === 'reward_granted';
                      return (
                        <tr key={event.id} className="referrals-table__row">
                          <td className="referrals-table__cell referrals-table__cell--secondary">
                            {formatWhen(event.created_at)}
                          </td>
                          <td className="referrals-table__cell">
                            <span className={`referrals-event-badge ${isReward ? 'referrals-event-badge--reward' : 'referrals-event-badge--payout'}`}>
                              {badge.text}
                            </span>
                          </td>
                          <td className="referrals-table__cell referrals-table__cell--secondary">
                            ID: {event.referrer_tg_user_id}
                          </td>
                          <td className="referrals-table__cell referrals-table__cell--right">
                            <span className={`referrals-event-amount ${isReward ? 'referrals-event-amount--reward' : ''}`}>
                              {event.reward_amount || 0} {event.reward_currency || ''}
                            </span>
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
        </div>
      </div>
    </section>
  );
}
