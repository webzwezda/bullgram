import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { LoadingState } from '../ui/LoadingState.jsx';
import { StatCard } from '../ui/StatCard.jsx';
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
    recentEvents: [],
    support: {},
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
            recentEvents: data.recentEvents || [],
            support: data.support || {},
            updatedAt: new Date().toISOString()
          });
          setSettingsDraft({
            referral_enabled: !!data.settings?.referral_enabled,
            referral_reward_percent: Number(data.settings?.referral_reward_percent ?? 20),
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
            recentEvents: [],
            support: {},
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
      rows = rows.filter((row) => Number(row.paid_out_rub) > 0 || Number(row.paid_out_ton) > 0 || Number(row.paid_out_usdt) > 0);
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
  }, [state.settings, state.summary]);

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

    if (currentBalance <= 0) {
      window.alert(`У партнера нет баланса в ${normalizedCurrency}.`);
      return;
    }

    const rawAmount = window.prompt(
      `Сколько выплатить ${row.display_name || row.username || row.tg_user_id}?\nБаланс: ${currentBalance} ${normalizedCurrency}`,
      String(currentBalance)
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
        recentEvents: data.recentEvents || prev.recentEvents,
        support: data.support || prev.support,
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
    <section className="page">
      <div className="page__header">
      </div>

      {/* Priority Signals */}
      {prioritySignals.length > 0 && (
        <div className="grid gap-3">
          {prioritySignals.map((signal) => (
            <article key={signal.title} className={`rounded-2xl border p-4 text-sm ${
              signal.tone === 'danger' ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'
            }`}>
              <p className={`font-semibold ${signal.tone === 'danger' ? 'text-red-900' : 'text-amber-900'}`}>
                {signal.title}
              </p>
              <p className={`mt-1 ${signal.tone === 'danger' ? 'text-red-700' : 'text-amber-700'}`}>
                {signal.text}
              </p>
            </article>
          ))}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard title="Партнеров" value={state.summary.partners || 0} />
        <StatCard title="Лидов" value={state.summary.leads || 0} />
        <StatCard title="Оплат" value={state.summary.paidReferrals || 0} />
        <StatCard
          title="К выплате"
          value={`${state.summary.outstandingRub || 0} RUB`}
          hint={`${state.summary.outstandingTon || 0} TON • ${state.summary.outstandingUsdt || 0} USDT`}
          tone={(state.summary.outstandingRub || state.summary.outstandingTon || state.summary.outstandingUsdt) ? 'warning' : 'default'}
        />
      </div>

      {/* Settings */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-950">Настройки партнерки</h3>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="field-group">
              <span className="text-sm">Статус</span>
              <select
                className="field h-11 rounded-xl border-slate-200 bg-slate-50 text-[14px]"
                value={settingsDraft.referral_enabled ? 'yes' : 'no'}
                onChange={(event) => setSettingsDraft((prev) => ({ ...prev, referral_enabled: event.target.value === 'yes' }))}
              >
                <option value="no">Выключена</option>
                <option value="yes">Включена</option>
              </select>
            </label>
          </div>

          <div>
            <label className="field-group">
              <span className="text-sm">Награда, %</span>
              <input
                className="field h-11 rounded-xl border-slate-200 bg-slate-50 text-[14px]"
                type="number"
                min="0"
                max="100"
                value={settingsDraft.referral_reward_percent}
                onChange={(event) => setSettingsDraft((prev) => ({ ...prev, referral_reward_percent: Number(event.target.value || 0) }))}
              />
            </label>
          </div>

          <div className="sm:col-span-2">
            <label className="field-group">
              <span className="text-sm">Приветствие для партнеров</span>
              <textarea
                className="field min-h-[80px] rounded-xl border-slate-200 bg-slate-50 text-[14px]"
                value={settingsDraft.referral_welcome_text}
                onChange={(event) => setSettingsDraft((prev) => ({ ...prev, referral_welcome_text: event.target.value }))}
                placeholder="Текст приветствия для новых партнеров..."
              />
            </label>
          </div>
        </div>

        <div className="mt-4 flex justify-end">
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
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <input
            className="field h-11 rounded-xl border-slate-200 bg-slate-50 text-[14px] flex-1"
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="TG ID, @username или код"
          />
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((item) => (
              <button
                key={item.id}
                className={`h-9 rounded-lg px-3 text-xs font-medium transition-colors ${
                  filter === item.id
                    ? 'bg-slate-950 text-white'
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
          <h3 className="text-lg font-semibold text-slate-950 mb-4">Партнеры</h3>

          {filteredPartners.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-8">По фильтру никого нет</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="pb-3 text-left font-medium text-slate-700">Партнер</th>
                    <th className="pb-3 text-left font-medium text-slate-700">Оплат</th>
                    <th className="pb-3 text-left font-medium text-slate-700">Баланс</th>
                    <th className="pb-3 text-right font-medium text-slate-700">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPartners.slice(0, 30).map((row) => (
                    <tr key={row.tg_user_id} className="border-b border-slate-100 last:border-0">
                      <td className="py-3">
                        <div className="font-medium text-slate-950">{row.display_name || row.username || row.tg_user_id}</div>
                        <div className="text-xs text-slate-500">ID: {row.tg_user_id} • {row.referral_code}</div>
                      </td>
                      <td className="py-3">{row.total_referrals || 0}</td>
                      <td className="py-3">
                        <div className="font-medium text-slate-950">{row.balance_rub || 0} RUB</div>
                        <div className="text-xs text-slate-500">{row.balance_ton || 0} TON • {row.balance_usdt || 0} USDT</div>
                      </td>
                      <td className="py-3 text-right">
                        <div className="flex justify-end gap-1">
                          <button
                            className="text-xs text-sky-600 hover:text-sky-700 font-medium px-2 py-1 rounded hover:bg-sky-50"
                            onClick={() => sendMessagePrompt(row)}
                          >
                            Написать
                          </button>
                          <button
                            className="text-xs text-slate-600 hover:text-slate-700 font-medium px-2 py-1 rounded hover:bg-slate-100"
                            onClick={() => markPayout(row, 'RUB')}
                            disabled={state.payouting}
                          >
                            RUB
                          </button>
                          <button
                            className="text-xs text-slate-600 hover:text-slate-700 font-medium px-2 py-1 rounded hover:bg-slate-100"
                            onClick={() => markPayout(row, 'TON')}
                            disabled={state.payouting}
                          >
                            TON
                          </button>
                          <a
                            className="text-xs text-sky-600 hover:text-sky-700 font-medium px-2 py-1 rounded hover:bg-sky-50"
                            href={`/app/dossier?tg=${encodeURIComponent(row.tg_user_id)}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Досье
                          </a>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Events Table */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-950 mb-4">События</h3>

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
                    return (
                      <tr key={event.id} className="border-b border-slate-100 last:border-0">
                        <td className="py-3 text-slate-600">{formatWhen(event.created_at)}</td>
                        <td className="py-3">
                          <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${
                            badge.className === 'pill pill--ok' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-700'
                          }`}>
                            {badge.text}
                          </span>
                        </td>
                        <td className="py-3 text-slate-600">{event.referrer_tg_user_id}</td>
                        <td className="py-3 text-right font-medium text-slate-950">
                          {event.reward_amount || 0} {event.reward_currency || ''}
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
