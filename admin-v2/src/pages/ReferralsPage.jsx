import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { LoadingState } from '../ui/LoadingState.jsx';
import { Button } from '@/components/ui/button';

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
  return { text: event?.event_type || '—', className: 'pill' };
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
    error: '',
    settings: null,
    summary: {},
    topPartners: [],
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
            error: '',
            settings: data.settings || null,
            summary: data.summary || {},
            topPartners: data.topPartners || [],
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
            error: error.message,
            settings: null,
            summary: {},
            topPartners: [],
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

  const filteredEvents = useMemo(() => {
    if (filter === 'rewards') {
      return state.recentEvents.filter((event) => event.event_type === 'reward_granted');
    }
    if (filter === 'payouts') {
      return state.recentEvents.filter((event) => event.event_type === 'payout_marked');
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
      {/* Reserve */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Партнерский резерв</div>
            <h3 className="mt-1 text-xl font-semibold text-slate-950">
              {state.reserve?.statusLabel || 'TON-резерв'}
            </h3>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              {state.reserve?.reason || 'Админ пополняет резерв, BullRun держит учет выплат, партнер получает деньги без ручной каши.'}
            </p>
          </div>
          <div className={`inline-flex w-fit items-center rounded-lg px-3 py-1 text-xs font-semibold ${
            state.reserve?.canEnableReferrals ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
          }`}>
            {state.reserve?.canEnableReferrals ? 'Можно включать' : 'Сначала депозит'}
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs text-slate-500">Минимум</div>
            <div className="mt-1 text-lg font-semibold text-slate-950">{formatTon(state.reserve?.minimumDepositTon || state.economics?.minimumDepositTon || 100)}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs text-slate-500">Пополнено</div>
            <div className="mt-1 text-lg font-semibold text-slate-950">{formatTon(state.reserve?.totalDepositedTon)}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs text-slate-500">Доступно</div>
            <div className="mt-1 text-lg font-semibold text-slate-950">{formatTon(state.reserve?.availableReserveTon)}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs text-slate-500">Долг админа</div>
            <div className={`mt-1 text-lg font-semibold ${Number(state.reserve?.adminDebtTon || 0) > 0 ? 'text-rose-600' : 'text-slate-950'}`}>
              {formatTon(state.reserve?.adminDebtTon)}
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          <div className="rounded-lg border border-slate-200 p-3">
            <div className="text-xs text-slate-500">Кошелек для депозита</div>
            <div className="mt-1 break-all font-mono text-sm text-slate-800">
              {state.reserve?.depositAddress || 'Кошелек еще не подключен в env'}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 p-3">
            <div className="text-xs text-slate-500">Комментарий / memo</div>
            <div className="mt-1 font-mono text-sm text-slate-800">{state.reserve?.depositMemo || '—'}</div>
          </div>
          <div className="rounded-lg border border-slate-200 p-3">
            <div className="text-xs text-slate-500">Лок депозита</div>
            <div className="mt-1 text-sm font-medium text-slate-800">{formatWhen(state.reserve?.lockedUntil)}</div>
          </div>
        </div>
      </section>

      {prioritySignals.length > 0 && (
        <section className="grid gap-3 md:grid-cols-3">
          {prioritySignals.slice(0, 3).map((signal) => (
            <div
              key={`${signal.title}-${signal.tone}`}
              className={`rounded-lg border p-3 text-sm ${
                signal.tone === 'danger'
                  ? 'border-rose-200 bg-rose-50 text-rose-800'
                  : signal.tone === 'ok'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border-amber-200 bg-amber-50 text-amber-800'
              }`}
            >
              <div className="font-semibold">{signal.title}</div>
              <div className="mt-1 text-xs opacity-80">{signal.text}</div>
            </div>
          ))}
        </section>
      )}

      {/* Settings */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-slate-950">Настройки партнерки</h3>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className="field-group">
              <span className="text-sm font-medium text-slate-700">Статус</span>
              <select
                className="field h-11 rounded-xl border-slate-200 bg-slate-50 text-[14px]"
                value={settingsDraft.referral_enabled ? 'yes' : 'no'}
                onChange={(event) => setSettingsDraft((prev) => ({ ...prev, referral_enabled: event.target.value === 'yes' }))}
              >
                <option value="no">Выключена</option>
                <option value="yes" disabled={!state.reserve?.canEnableReferrals}>Включена</option>
              </select>
              <p className="mt-1.5 text-xs text-slate-500">
                {settingsDraft.referral_enabled
                  ? 'Партнеры могут получать реферальные ссылки'
                  : 'Реферальная программа отключена'}
              </p>
            </label>
          </div>

          <div>
            <label className="field-group">
              <span className="text-sm font-medium text-slate-700">Награда партнера, %</span>
              <input
                className="field h-11 rounded-xl border-slate-200 bg-slate-50 text-[14px]"
                type="number"
                min="0"
                max="100"
                value={settingsDraft.referral_reward_percent}
                onChange={(event) => setSettingsDraft((prev) => ({ ...prev, referral_reward_percent: Number(event.target.value || 0) }))}
              />
              <p className="mt-1.5 text-xs text-slate-500">
                От первой оплаты каждого приглашенного
              </p>
            </label>
          </div>

          <div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Скидка клиенту</div>
              <div className="mt-1 text-lg font-semibold text-slate-950">{settingsDraft.referral_client_discount_percent || 10}%</div>
              <p className="mt-1 text-xs text-slate-500">Фиксируем в MVP, чтобы партнеру было легко продавать.</p>
            </div>
          </div>

          <div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs text-slate-500">BullRun fee</div>
              <div className="mt-1 text-lg font-semibold text-slate-950">{state.economics?.bullrunFeePercent || 1}%</div>
              <p className="mt-1 text-xs text-slate-500">С партнерского вознаграждения, сверху с админа.</p>
            </div>
          </div>

          <div className="sm:col-span-2">
            <label className="field-group">
              <span className="text-sm font-medium text-slate-700">Приветствие для партнеров</span>
              <textarea
                className="field min-h-[100px] rounded-xl border-slate-200 bg-slate-50 text-[14px] resize-y"
                value={settingsDraft.referral_welcome_text}
                onChange={(event) => setSettingsDraft((prev) => ({ ...prev, referral_welcome_text: event.target.value }))}
                placeholder="Добро пожаловать в партнерскую программу! Ваша реферальная ссылка готова..."
              />
              <p className="mt-1.5 text-xs text-slate-500">
                Этот текст увидит новый партнер после получения ссылки
              </p>
            </label>
          </div>
        </div>

        <div className="mt-5 flex justify-end border-t border-slate-100 pt-4">
          <Button
            className="h-11 rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white hover:bg-slate-800"
            onClick={saveSettings}
            disabled={state.savingSettings}
          >
            {state.savingSettings ? 'Сохраняем...' : 'Сохранить'}
          </Button>
        </div>
      </section>

      {/* Filters */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="flex-1">
            <input
              className="field h-11 w-full rounded-xl border-slate-200 bg-slate-50 text-[14px]"
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Поиск по TG ID, @username или коду"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((item) => (
              <button
                key={item.id}
                className={`h-9 rounded-lg px-3 text-xs font-medium transition-colors ${
                  filter === item.id
                    ? 'bg-slate-950 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
                onClick={() => setFilter(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Tables */}
      <div className="grid gap-5 lg:grid-cols-2">
        {/* Partners Table */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-950">Партнеры</h3>
            <span className="text-xs text-slate-500">{filteredPartners.length} показано</span>
          </div>

          {filteredPartners.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-8">По фильтру никого нет</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="pb-3 text-left font-medium text-slate-700">Партнер</th>
                    <th className="pb-3 text-left font-medium text-slate-700">Лидов</th>
                    <th className="pb-3 text-left font-medium text-slate-700">Баланс</th>
                    <th className="pb-3 text-right font-medium text-slate-700">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPartners.map((row) => {
                    const hasBalance = Number(row.balance_rub) > 0 || Number(row.balance_ton) > 0 || Number(row.balance_usdt) > 0;
                    return (
                      <tr key={row.tg_user_id} className="border-b border-slate-100 last:border-0">
                        <td className="py-3">
                          <div className="font-medium text-slate-950">{row.display_name || row.username || row.tg_user_id}</div>
                          <div className="text-xs text-slate-500">ID: {row.tg_user_id} • <span className="font-mono">{row.referral_code}</span></div>
                          <div className="mt-1 text-xs text-slate-500">
                            Кошелек: {row.payout_wallet ? <span className="font-mono">{row.payout_wallet}</span> : 'не указан'}
                          </div>
                          {Number(row.pending_payout_ton || 0) > 0 && (
                            <div className="mt-1 inline-flex rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                              Заявка: {formatTon(row.pending_payout_ton)}
                            </div>
                          )}
                        </td>
                        <td className="py-3">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            (row.total_referrals || 0) > 0 ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'
                          }`}>
                            {row.total_referrals || 0}
                          </span>
                        </td>
                        <td className="py-3">
                          <div className={`font-medium ${hasBalance ? 'text-green-600' : 'text-slate-400'}`}>
                            {row.balance_rub || 0} RUB
                          </div>
                          <div className="text-xs text-slate-500">
                            {row.balance_ton || 0} TON • {row.balance_usdt || 0} USDT
                          </div>
                        </td>
                        <td className="py-3 text-right">
                          <div className="flex justify-end gap-1.5">
                            <button
                              className="text-xs text-sky-600 hover:text-sky-700 font-medium px-2 py-1 rounded hover:bg-sky-50 transition-colors"
                              onClick={() => sendMessagePrompt(row)}
                            >
                              Написать
                            </button>
                            {Number(row.balance_rub) > 0 && (
                              <button
                                className="text-xs text-emerald-600 hover:text-emerald-700 font-medium px-2 py-1 rounded hover:bg-emerald-50 transition-colors"
                                onClick={() => markPayout(row, 'RUB')}
                                disabled={state.payouting}
                              >
                                RUB
                              </button>
                            )}
                            {Number(row.balance_ton) > 0 && (
                              <button
                                className="text-xs text-emerald-600 hover:text-emerald-700 font-medium px-2 py-1 rounded hover:bg-emerald-50 transition-colors"
                                onClick={() => markPayout(row, 'TON')}
                                disabled={state.payouting}
                              >
                                {Number(row.pending_payout_ton || 0) > 0 ? 'Заявка TON' : 'TON'}
                              </button>
                            )}
                            {Number(row.balance_usdt) > 0 && (
                              <button
                                className="text-xs text-emerald-600 hover:text-emerald-700 font-medium px-2 py-1 rounded hover:bg-emerald-50 transition-colors"
                                onClick={() => markPayout(row, 'USDT')}
                                disabled={state.payouting}
                              >
                                USDT
                              </button>
                            )}
                            <a
                              className="text-xs text-slate-600 hover:text-slate-700 font-medium px-2 py-1 rounded hover:bg-slate-100 transition-colors"
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
        </section>

        {/* Events Table */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-950">События</h3>
            <span className="text-xs text-slate-500">{filteredEvents.length} показано</span>
          </div>

          {filteredEvents.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-8">Событий нет</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="pb-3 text-left font-medium text-slate-700">Когда</th>
                    <th className="pb-3 text-left font-medium text-slate-700">Тип</th>
                    <th className="pb-3 text-left font-medium text-slate-700">Партнер</th>
                    <th className="pb-3 text-right font-medium text-slate-700">Сумма</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEvents.slice(0, 30).map((event) => {
                    const badge = eventBadge(event);
                    const isReward = badge.className === 'pill pill--ok';
                    return (
                      <tr key={event.id} className="border-b border-slate-100 last:border-0">
                        <td className="py-3 text-slate-600 whitespace-nowrap">{formatWhen(event.created_at)}</td>
                        <td className="py-3">
                          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            isReward ? 'bg-green-100 text-green-700' : 'bg-blue-50 text-blue-700'
                          }`}>
                            {badge.text}
                          </span>
                        </td>
                        <td className="py-3 text-slate-600">ID: {event.referrer_tg_user_id}</td>
                        <td className="py-3 text-right">
                          <span className={`font-medium ${isReward ? 'text-green-600' : 'text-slate-700'}`}>
                            {event.reward_amount || 0} {event.reward_currency || ''}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
