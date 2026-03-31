import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { LoadingState } from '../ui/LoadingState.jsx';
import { PlanBanner } from '../ui/PlanBanner.jsx';
import { StatCard } from '../ui/StatCard.jsx';
import { UpgradeCallout } from '../ui/UpgradeCallout.jsx';

const FILTERS = [
  { id: 'all', label: 'Все' },
  { id: 'active', label: 'Активные' },
  { id: 'expired', label: 'Сгорели' },
  { id: 'missing_join', label: 'Оплатили, но не зашли' },
  { id: 'expired_in_group', label: 'Сгорели, но внутри' },
  { id: 'active_in_group', label: 'Платят и внутри' }
];

function formatDate(value) {
  if (!value) return 'Без срока';
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value));
}

function crmStatusText(row) {
  if (row.status === 'active' && row.in_group === false) return 'Оплатил, но не зашел';
  if (row.status === 'expired' && row.in_group === true) return 'Сгорел, но сидит';
  if (row.status === 'active' && row.in_group === true) return 'Живой и внутри';
  if (row.status === 'expired') return 'Истек';
  return row.status || 'Неизвестно';
}

function crmStatusClass(row) {
  if (row.status === 'active' && row.in_group === false) return 'pill pill--warning';
  if (row.status === 'expired' && row.in_group === true) return 'pill pill--danger';
  if (row.status === 'active' && row.in_group === true) return 'pill pill--ok';
  return 'pill';
}

const USERBOT_CENTER_HANDOFF_KEY = 'bullrun_userbot_center_handoff';

function openUserbotCenterHandoff({ tgUserId, draftMessage = '' }) {
  const params = new URLSearchParams();
  if (tgUserId) params.set('tg_user_id', String(tgUserId));

  window.localStorage.setItem(USERBOT_CENTER_HANDOFF_KEY, JSON.stringify({
    tg_user_id: String(tgUserId || ''),
    draft_message: String(draftMessage || '').trim()
  }));

  window.location.href = `/app/userbot-center${params.toString() ? `?${params.toString()}` : ''}`;
}

function openBroadcastManualSelection(rows = [], suggestedTitle = 'Ручной хвост', suggestedMessage = '') {
  const tgUserIds = Array.from(new Set(rows.map((row) => String(row.tg_user_id || '')).filter(Boolean)));
  if (!tgUserIds.length) {
    window.alert('В этом хвосте не нашли TG ID для отправки.');
    return;
  }

  window.localStorage.setItem('broadcast_manual_selection', JSON.stringify({
    tg_user_ids: tgUserIds,
    members: rows.map((row) => ({
      tg_user_id: String(row.tg_user_id || ''),
      label: row.channel_title || row.tg_username || `TG ${row.tg_user_id}`
    })),
    suggested_title: suggestedTitle,
    suggested_message: suggestedMessage
  }));

  window.location.href = '/app/broadcast';
}

export function CrmPage() {
  const { accessToken, profilePlan, trialEndsAt } = useAuth();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [state, setState] = useState({
    loading: true,
    refreshing: false,
    mutating: false,
    error: '',
    rows: []
  });

  useEffect(() => {
    let cancelled = false;

    async function loadRows({ silent = false } = {}) {
      if (!silent) {
        setState((prev) => ({
          ...prev,
          loading: !prev.rows.length,
          refreshing: !!prev.rows.length,
          error: ''
        }));
      }

      try {
        const data = await apiRequest('/api/userbot/crm/subscribers', { accessToken });
        if (!cancelled) {
          setState({
            loading: false,
            refreshing: false,
            error: '',
            rows: data.subscribers || []
          });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            loading: false,
            refreshing: false,
            error: error.message,
            rows: []
          });
        }
      }
    }

    if (accessToken) {
      loadRows();
    }

    const intervalId = accessToken
      ? window.setInterval(() => {
          loadRows({ silent: true });
        }, 60_000)
      : null;

    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [accessToken]);

  const filteredRows = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return state.rows.filter((row) => {
      if (filter === 'active' && row.status !== 'active') return false;
      if (filter === 'expired' && row.status !== 'expired') return false;
      if (filter === 'missing_join' && !(row.status === 'active' && row.in_group === false)) return false;
      if (filter === 'expired_in_group' && !(row.status === 'expired' && row.in_group === true)) return false;
      if (filter === 'active_in_group' && !(row.status === 'active' && row.in_group === true)) return false;

      if (!normalizedSearch) return true;

      return [
        row.tg_user_id || '',
        row.tg_username || '',
        row.channel_title || '',
        row.status || ''
      ].join(' ').toLowerCase().includes(normalizedSearch);
    });
  }, [filter, search, state.rows]);

  const stats = useMemo(() => state.rows.reduce((acc, row) => {
    acc.total += 1;
    if (row.status === 'active') acc.active += 1;
    if (row.status === 'expired') acc.expired += 1;
    if (row.status === 'active' && row.in_group === false) acc.missingJoin += 1;
    if (row.status === 'expired' && row.in_group === true) acc.expiredInside += 1;
    return acc;
  }, {
    total: 0,
    active: 0,
    expired: 0,
    missingJoin: 0,
    expiredInside: 0
  }), [state.rows]);
  const trialHoursLeft = useMemo(() => {
    if (!trialEndsAt) return null;
    const diffMs = new Date(trialEndsAt).getTime() - Date.now();
    if (diffMs <= 0) return 0;
    return Math.ceil(diffMs / (1000 * 60 * 60));
  }, [trialEndsAt]);
  const trialUpgradeUrgent = profilePlan === 'trial' && trialHoursLeft !== null && trialHoursLeft > 0 && trialHoursLeft <= 72;

  const prioritySignals = useMemo(() => ([
    {
      title: 'Живые подписки',
      value: stats.active,
      tone: stats.active > 0 ? 'ok' : 'default',
      hint: `Всего записей в CRM: ${stats.total}`
    },
    {
      title: 'Оплатили, но не зашли',
      value: stats.missingJoin,
      tone: stats.missingJoin > 0 ? 'warning' : 'ok',
      hint: 'Это самый теплый хвост на дожим или ручной завод'
    },
    {
      title: 'Сгорели, но сидят',
      value: stats.expiredInside,
      tone: stats.expiredInside > 0 ? 'danger' : 'ok',
      hint: 'Прямой денежный leak: доступ висит, деньги уже не живые'
    },
    {
      title: 'Истекшие',
      value: stats.expired,
      tone: stats.expired > 0 ? 'warning' : 'default',
      hint: 'Хвост на удержание, возврат и ручные решения'
    }
  ]), [stats]);

  function handoffSingleSubscriber(row) {
    openUserbotCenterHandoff({
      tgUserId: row.tg_user_id,
      draftMessage: row.status === 'active' && row.in_group === false
        ? 'Привет. Вижу оплату, но ты еще не дошел до группы. Если актуально, отвечай, и я быстро доведу до доступа.'
        : 'Привет. Пишу по твоей подписке в BullRun. Напиши, что сейчас нужно: доступ, продление или проверка статуса.'
    });
  }

  function handoffBulkSubscribers(rows) {
    openBroadcastManualSelection(
      rows,
      'CRM: ручной хвост',
      'Привет. Пишу по подписке в BullRun. Если вопрос еще актуален, ответь одним сообщением, и я быстро разберу доступ или продление.'
    );
  }

  async function extendSubscriptions(subscriptionIds, days) {
    const ids = Array.from(new Set((subscriptionIds || []).map(String).filter(Boolean)));
    if (!ids.length) {
      window.alert('В этом хвосте нет подписок для продления.');
      return;
    }

    setState((prev) => ({ ...prev, mutating: true }));
    try {
      await apiRequest('/api/userbot/crm/subscribers/batch-add-days', {
        accessToken,
        method: 'POST',
        body: { subscription_ids: ids, days }
      });
      window.alert(`Продление прошло. Хвост обновится сам.`);
    } catch (error) {
      window.alert(error.message);
    } finally {
      setState((prev) => ({ ...prev, mutating: false }));
    }
  }

  async function kickSubscriptions(subscriptionIds) {
    const ids = Array.from(new Set((subscriptionIds || []).map(String).filter(Boolean)));
    if (!ids.length) {
      window.alert('В этом хвосте нет подписок для кика.');
      return;
    }
    if (!window.confirm(`Кикнуть хвост из ${ids.length} подписок?`)) return;

    setState((prev) => ({ ...prev, mutating: true }));
    try {
      const result = await apiRequest('/api/userbot/crm/subscribers/batch-kick', {
        accessToken,
        method: 'POST',
        body: { subscription_ids: ids }
      });
      window.alert(`Кик завершен. Кикнули: ${result.kicked || 0} из ${ids.length}.`);
    } catch (error) {
      window.alert(error.message);
    } finally {
      setState((prev) => ({ ...prev, mutating: false }));
    }
  }

  if (state.loading) {
    return <LoadingState text="Тянем живой CRM..." />;
  }

  if (state.error) {
    return (
      <section className="page">
        <div className="page__header">
          <h1>CRM</h1>
          <p>Этот экран уже должен сидеть на живом `/api/userbot/crm/subscribers`, но backend вернул ошибку.</p>
        </div>
        <div className="error-card">{state.error}</div>
      </section>
    );
  }

  return (
    <section className="page">
      <div className="page__header">
        <h1>CRM</h1>
        <p>
          Живой CRM-контур: фильтры, triage и быстрые мосты. Здесь уже можно разбирать хвост без леса из
          inline-блоков и прыжков по старому кабинету.
        </p>
      <div className="page__meta">
          <span>{state.refreshing ? 'Обновляем фон...' : 'Экран обновляется сам раз в минуту.'}</span>
          <span>Всего записей: {state.rows.length}</span>
          <span>Текущий хвост: {filteredRows.length}</span>
        </div>
      </div>
      {profilePlan === 'trial' ? (
        <>
          <PlanBanner
            tone={trialUpgradeUrgent ? 'warning' : 'info'}
            title={trialUpgradeUrgent ? 'Trial скоро закончится: CRM пора переводить на Normal' : 'CRM на Trial нужен как стартовый контур'}
            text={trialUpgradeUrgent
              ? `До конца trial осталось около ${trialHoursLeft} ч. Если уже ведешь хвост по оплатам, доступу и дожиму, не тяни с апгрейдом: на Normal этот контур должен жить как основной.`
              : 'На Trial можно быстро понять, где клиенты, где подвисший доступ и что нужно дожимать. Как только CRM становится ежедневным инструментом, переводи кабинет на Normal.'}
          />
          <UpgradeCallout
            compact
            title="CRM уже включился в работу. Дальше логичнее идти на Normal."
            text="Если здесь уже живут платники, сгоревшие и хвосты на дожим, не оставляй этот контур в ознакомительном режиме. Normal нужен, чтобы вести его без продуктовых стопоров."
          />
        </>
      ) : null}

      <div className="hero-panel">
        <div className="hero-panel__body">
          <div className="hero-panel__eyebrow">Подписки и клиенты</div>
          <div className="hero-panel__title">Здесь видно, кто платит, кто тупит на входе и где у тебя уже течет доступ.</div>
          <div className="hero-panel__text">
            CRM в новом кабинете нужен не как архив, а как рабочий triage: быстро отрезать хвосты, дожимать тех,
            кто оплатил, но не зашел, и сразу бить по просрочке, которая еще сидит внутри.
          </div>
          <div className="hero-panel__actions">
            <a className="hero-link" href="/app/orders">Разобрать деньги</a>
            <a className="hero-link" href="/app/access">Разобрать доступ</a>
            <a className="hero-link" href="/app/broadcast">Пульнуть рассылку</a>
            <a className="hero-link" href="/app/userbot-center">Открыть юзерботов</a>
          </div>
        </div>
        <div className="hero-panel__grid">
          {prioritySignals.map((item) => (
            <div key={item.title} className={`priority-chip priority-chip--${item.tone}`}>
              <div className="priority-chip__title">{item.title}</div>
              <div className="priority-chip__value">{item.value}</div>
              <div className="priority-chip__hint">{item.hint}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid">
        <StatCard title="Всего" value={stats.total} hint="Все CRM-записи по своим каналам." />
        <StatCard title="Активные" value={stats.active} hint="Живые подписки." />
        <StatCard title="Сгорели" value={stats.expired} hint="Истекшие подписки." />
        <StatCard title="Оплатили, но не зашли" value={stats.missingJoin} hint="Им уже надо писать или вручную заводить." />
        <StatCard title="Сгорели, но сидят" value={stats.expiredInside} hint="Это прямой денежный leak." />
      </div>

      <div className="toolbar-card">
        <div className="toolbar-card__title">Текущий хвост</div>
        <div className="toolbar-card__body">
          <input
            className="field"
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="TG ID, @username, канал, статус"
          />
          <button className="ghost-button" type="button" onClick={() => handoffBulkSubscribers(filteredRows)} disabled={state.mutating}>
            Вынести хвост в рассылку
          </button>
          <button className="ghost-button" type="button" onClick={() => extendSubscriptions(filteredRows.map((row) => row.id), 5)} disabled={state.mutating}>
            +5 дней
          </button>
          <button className="ghost-button" type="button" onClick={() => extendSubscriptions(filteredRows.map((row) => row.id), 30)} disabled={state.mutating}>
            +30 дней
          </button>
          <button className="ghost-button" type="button" onClick={() => kickSubscriptions(filteredRows.map((row) => row.id))} disabled={state.mutating}>
            Кикнуть хвост
          </button>
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

      <div className="table-card">
        <div className="table-card__title">Подписки и доступ</div>
        {filteredRows.length === 0 ? (
          <div className="empty-inline">Под текущий фильтр ничего не попало.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Клиент</th>
                <th>Канал</th>
                <th>Статус</th>
                <th>До какого числа</th>
                <th>Дальше</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.slice(0, 50).map((row) => (
                <tr key={row.id}>
                  <td>
                    <div>{row.tg_username ? `@${row.tg_username}` : `TG ID ${row.tg_user_id}`}</div>
                    <div className="table-subtext">{row.tg_user_id}</div>
                  </td>
                  <td>{row.channel_title || 'Без канала'}</td>
                  <td>
                    <span className={crmStatusClass(row)}>{crmStatusText(row)}</span>
                  </td>
                  <td>{formatDate(row.expires_at)}</td>
                  <td>
                    <div className="table-actions">
                      <a href="/app/orders" target="_blank" rel="noreferrer">Заказы</a>
                      <a href="/app/access" target="_blank" rel="noreferrer">Доступ</a>
                      <a
                        href={`/app/dossier?tg=${encodeURIComponent(row.tg_user_id)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Досье
                      </a>
                      <button className="inline-action" onClick={() => handoffSingleSubscriber(row)}>В центр юзербота</button>
                      <button className="inline-action" onClick={() => extendSubscriptions([row.id], 5)}>+5</button>
                      <button className="inline-action" onClick={() => extendSubscriptions([row.id], 30)}>+30</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
