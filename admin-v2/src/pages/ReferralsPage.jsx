import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { LoadingState } from '../ui/LoadingState.jsx';
import { StatCard } from '../ui/StatCard.jsx';

const FILTERS = [
  { id: 'all', label: 'Все' },
  { id: 'with_balance', label: 'Хвост к выплате' },
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
  if (event?.event_type === 'reward_granted') return { text: 'Начислили бонус', className: 'pill pill--ok' };
  if (event?.event_type === 'payout_marked') return { text: 'Пометили выплату', className: 'pill pill--info' };
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

  const segmentStats = useMemo(() => {
    return filteredPartners.reduce((acc, row) => {
      acc.count += 1;
      acc.balanceRub += Number(row.balance_rub || 0);
      acc.balanceTon += Number(row.balance_ton || 0);
      acc.balanceUsdt += Number(row.balance_usdt || 0);
      return acc;
    }, { count: 0, balanceRub: 0, balanceTon: 0, balanceUsdt: 0 });
  }, [filteredPartners]);

  const prioritySignals = useMemo(() => {
    const signals = [];
    if (!state.settings?.referral_enabled) {
      signals.push({
        tone: 'warning',
        title: 'Партнерка сейчас выключена',
        text: 'Пользователи не должны видеть ее в боте. Если канал продаж через рефку нужен, включай здесь и проверяй welcome-текст.'
      });
    }
    const totalOutstanding = Number(state.summary.outstandingRub || 0) + Number(state.summary.outstandingTon || 0) + Number(state.summary.outstandingUsdt || 0);
    if (totalOutstanding > 0) {
      signals.push({
        tone: 'danger',
        title: 'Есть хвост к выплате',
        text: 'По партнерке уже накопился долг. Закрывай выплаты, чтобы не копить токсичный хвост у активных партнеров.'
      });
    }
    if ((state.summary.paidReferrals || 0) === 0 && state.settings?.referral_enabled) {
      signals.push({
        tone: 'info',
        title: 'Рефка включена, но денег пока нет',
        text: 'Либо трафик еще не пришел, либо партнерский контур не прогрет. Проверь seller flow и bot UX.'
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
      window.alert('Настройки рефералки сохранены.');
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
      window.alert(`У этого партнера нет хвоста к выплате в ${normalizedCurrency}.`);
      return;
    }

    const rawAmount = window.prompt(
      `Сколько пометить как выплаченное для ${row.display_name || row.username || row.tg_user_id}?\nНа балансе сейчас ${currentBalance} ${normalizedCurrency}.`,
      String(currentBalance)
    );

    if (rawAmount === null) return;
    const amount = Number(String(rawAmount).replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0) {
      window.alert('Сумма должна быть больше нуля.');
      return;
    }

    const note = window.prompt('Можешь дописать примечание: карта, кошелек, дата, кто занес.', '') || '';
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
      window.alert(`Выплату пометили в ${normalizedCurrency}.`);
    } catch (error) {
      setState((prev) => ({ ...prev, payouting: false }));
      window.alert(error.message);
    }
  }

  async function sendMessagePrompt(row) {
    if (!row?.tg_user_id) {
      window.alert('У строки нет Telegram ID. Писать некому.');
      return;
    }
    const message = window.prompt(`Что написать ${row.display_name || row.username || row.tg_user_id}?\nСообщение уйдет от юзербота.`);
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
      window.alert('Сообщение отправлено.');
    } catch (error) {
      window.alert(`Ошибка отправки: ${error.message}`);
    }
  }

  if (state.loading) {
    return <LoadingState text="Тянем рефералку..." />;
  }

  if (state.error) {
    return (
      <section className="page">
        <div className="page__header">
          <h1>Рефералка</h1>
          <p>Экран уже сидит на живом backend, но загрузка партнерки вернула ошибку.</p>
        </div>
        <div className="error-card">{state.error}</div>
      </section>
    );
  }

  return (
    <section className="page">
      <div className="page__header">
        <h1>Рефералка</h1>
        <p>
          Read-first экран по партнерке. Здесь видно, кто реально приводит деньги, где висит хвост к выплате
          и какие начисления уже прошли. Выплаты и настройки уже можно править прямо тут.
        </p>
        <div className="page__meta">
          <span>Последнее обновление: {formatWhen(state.updatedAt)}</span>
          <span>{state.refreshing ? 'Обновляем фон...' : 'Экран обновляется сам раз в минуту.'}</span>
          <span>Партнерка: {state.settings?.referral_enabled ? 'включена' : 'выключена'}</span>
        </div>
      </div>

      <section className="hero-panel">
        <div>
          <span className="eyebrow">Referrals / Partner Ops</span>
          <h2>Кто реально приводит деньги и кому ты уже должен</h2>
          <p>
            Это не просто список партнеров. Здесь видно, где рефка тащит продажи, где копится хвост к выплате и кого
            надо закрывать первым, пока партнерка не стала токсичной.
          </p>
        </div>
        <div className="hero-actions">
          <button className="ghost-button ghost-button--primary" onClick={saveSettings} disabled={state.savingSettings}>
            {state.savingSettings ? 'Сохраняем...' : 'Сохранить реф-контур'}
          </button>
          <a className="ghost-button" href="/app/shop" target="_blank" rel="noreferrer">
            Открыть shop admin
          </a>
        </div>
      </section>

      {prioritySignals.length > 0 ? (
        <div className="priority-grid section">
          {prioritySignals.map((signal) => (
            <article key={signal.title} className={`priority-card priority-card--${signal.tone}`}>
              <h3>{signal.title}</h3>
              <p>{signal.text}</p>
            </article>
          ))}
        </div>
      ) : null}

      {!state.support.referralTables || !state.support.referralSettings ? (
        <div className="error-inline">SQL под рефералку не применен до конца. Этот экран будет полупустым.</div>
      ) : null}

      <div className="grid">
        <StatCard title="Партнеров" value={state.summary.partners || 0} hint="Сколько партнеров уже заведено в системе." />
        <StatCard title="Лидов" value={state.summary.leads || 0} hint="Сколько людей пришло по реф-ссылкам." />
        <StatCard title="Оплат по рефке" value={state.summary.paidReferrals || 0} hint="Сколько оплат реально закрыто по партнерке." />
        <StatCard title="Хвост к выплате" value={`${state.summary.outstandingRub || 0} RUB`} hint={`TON ${state.summary.outstandingTon || 0} • USDT ${state.summary.outstandingUsdt || 0}`} tone={(state.summary.outstandingRub || state.summary.outstandingTon || state.summary.outstandingUsdt) ? 'warning' : 'default'} />
      </div>

      <div className="grid grid--double">
        <div className="toolbar-card">
          <div className="toolbar-card__title">Настройки и контур</div>
          <div className="list-stack">
            <div className="list-item">
              <div className="list-item__title">Статус</div>
              <div className="list-item__meta">
                {state.settings?.referral_enabled
                  ? `Партнерка включена. Награда: ${state.settings?.referral_reward_percent || 20}%`
                  : 'Партнерка выключена. Пользователь не должен видеть ее в bot UI.'}
              </div>
            </div>
            <div className="list-item">
              <div className="list-item__title">Приветствие</div>
              <div className="list-item__meta">{state.settings?.referral_welcome_text || 'Отдельный welcome-текст не задан.'}</div>
            </div>
          </div>
          <div className="toolbar-card__body">
            <label className="field-group">
              <span>Партнерка включена</span>
              <select
                className="field"
                value={settingsDraft.referral_enabled ? 'yes' : 'no'}
                onChange={(event) => setSettingsDraft((prev) => ({ ...prev, referral_enabled: event.target.value === 'yes' }))}
              >
                <option value="no">Нет</option>
                <option value="yes">Да</option>
              </select>
            </label>
            <label className="field-group">
              <span>Награда, %</span>
              <input
                className="field"
                type="number"
                min="0"
                max="100"
                value={settingsDraft.referral_reward_percent}
                onChange={(event) => setSettingsDraft((prev) => ({ ...prev, referral_reward_percent: Number(event.target.value || 0) }))}
              />
            </label>
            <label className="field-group">
              <span>Welcome-текст</span>
              <textarea
                className="field"
                rows="4"
                value={settingsDraft.referral_welcome_text}
                onChange={(event) => setSettingsDraft((prev) => ({ ...prev, referral_welcome_text: event.target.value }))}
              />
            </label>
            <button className="ghost-button ghost-button--primary" onClick={saveSettings} disabled={state.savingSettings}>
              {state.savingSettings ? 'Сохраняем...' : 'Сохранить настройки'}
            </button>
            <a className="ghost-button" href="/app/shop" target="_blank" rel="noreferrer">
              Открыть shop admin
            </a>
          </div>
        </div>

        <div className="toolbar-card">
          <div className="toolbar-card__title">Текущий сегмент</div>
          <div className="grid">
            <StatCard title="Людей" value={segmentStats.count} hint="Сколько партнеров попало под текущий фильтр." />
            <StatCard title="RUB хвост" value={segmentStats.balanceRub} hint="Сколько еще висит к выплате." />
            <StatCard title="TON хвост" value={segmentStats.balanceTon} hint="Для крипто-выплат." />
            <StatCard title="USDT хвост" value={segmentStats.balanceUsdt} hint="Если закрываешь USDT." />
          </div>
        </div>
      </div>

      <div className="toolbar-card section">
        <div className="toolbar-card__title">Быстрый разбор</div>
        <div className="toolbar-card__body">
          <input
            className="field"
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="TG ID, @username или referral code"
          />
          <a className="ghost-button" href="/app/broadcast" target="_blank" rel="noreferrer">
            Пнуть сегмент
          </a>
        </div>
        <div className="filter-strip">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              className={`filter-chip${filter === item.id ? ' filter-chip--active' : ''}`}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid--double section">
        <div className="table-card">
          <div className="table-card__title">Кто реально приводит деньги</div>
          {filteredPartners.length === 0 ? (
            <div className="empty-inline">Под текущий фильтр никто не попал.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Партнер</th>
                  <th>Оплат</th>
                  <th>Баланс</th>
                  <th>Дальше</th>
                </tr>
              </thead>
              <tbody>
                {filteredPartners.slice(0, 30).map((row) => (
                  <tr key={row.tg_user_id}>
                    <td>
                      <div>{row.display_name || row.username || row.tg_user_id}</div>
                      <div className="table-subtext">TG ID {row.tg_user_id} • Код: {row.referral_code}</div>
                    </td>
                    <td>{row.total_referrals || 0}</td>
                    <td>
                      <div>RUB {row.balance_rub || 0}</div>
                      <div className="table-subtext">TON {row.balance_ton || 0} • USDT {row.balance_usdt || 0}</div>
                    </td>
                    <td>
                      <div className="table-actions">
                        <button className="inline-action" onClick={() => sendMessagePrompt(row)}>Написать</button>
                        <button className="inline-action" onClick={() => markPayout(row, 'RUB')} disabled={state.payouting}>RUB</button>
                        <button className="inline-action" onClick={() => markPayout(row, 'TON')} disabled={state.payouting}>TON</button>
                        <button className="inline-action" onClick={() => markPayout(row, 'USDT')} disabled={state.payouting}>USDT</button>
                        <a
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
          )}
        </div>

        <div className="table-card">
          <div className="table-card__title">Последние начисления</div>
          {filteredEvents.length === 0 ? (
            <div className="empty-inline">Событий по текущему фильтру нет.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Когда</th>
                  <th>Событие</th>
                  <th>Партнер</th>
                  <th>Сумма</th>
                </tr>
              </thead>
              <tbody>
                {filteredEvents.slice(0, 30).map((event) => {
                  const badge = eventBadge(event);
                  return (
                    <tr key={event.id}>
                      <td>{formatWhen(event.created_at)}</td>
                      <td><span className={badge.className}>{badge.text}</span></td>
                      <td>{event.referrer_tg_user_id}</td>
                      <td>{event.reward_amount || 0} {event.reward_currency || ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </section>
  );
}
