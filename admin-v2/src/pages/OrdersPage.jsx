import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { LoadingState } from '../ui/LoadingState.jsx';
import { PlanBanner } from '../ui/PlanBanner.jsx';
import { StatCard } from '../ui/StatCard.jsx';
import { UpgradeCallout } from '../ui/UpgradeCallout.jsx';

const FILTERS = [
  { id: 'all', label: 'Все' },
  { id: 'paid', label: 'Оплачено' },
  { id: 'access_pending', label: 'Оплатили, но не зашли' },
  { id: 'trial', label: 'Пробники' },
  { id: 'broken', label: 'Доступ мутный' }
];

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value));
}

function invoiceBadgeClass(row) {
  if (row.invoice_status === 'paid') return 'pill pill--ok';
  if (row.invoice_status === 'awaiting_receipt' || row.invoice_status === 'wait_admin') return 'pill pill--warning';
  if (row.invoice_status === 'rejected') return 'pill pill--danger';
  return 'pill';
}

function accessBadgeClass(row) {
  if (row.joined) return 'pill pill--ok';
  if (row.invoice_status === 'paid') return 'pill pill--warning';
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
    window.alert('В текущем хвосте нет TG ID.');
    return;
  }

  window.localStorage.setItem('broadcast_manual_selection', JSON.stringify({
    tg_user_ids: tgUserIds,
    members: rows.map((row) => ({
      tg_user_id: String(row.tg_user_id || ''),
      label: row.tariff_title || row.channel_title || `TG ${row.tg_user_id}`
    })),
    suggested_title: suggestedTitle,
    suggested_message: suggestedMessage
  }));

  window.location.href = '/app/broadcast';
}

export function OrdersPage() {
  const { accessToken, profilePlan, trialEndsAt } = useAuth();
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [state, setState] = useState({
    loading: true,
    refreshing: false,
    mutating: false,
    error: '',
    rows: [],
    summary: {},
    channels: []
  });

  useEffect(() => {
    let cancelled = false;

    async function loadOrders({ silent = false } = {}) {
      if (!silent) {
        setState((prev) => ({
          ...prev,
          loading: !prev.rows.length,
          refreshing: !!prev.rows.length,
          error: ''
        }));
      }

      try {
        const data = await apiRequest('/api/orders', { accessToken });
        if (!cancelled) {
          setState({
            loading: false,
            refreshing: false,
            error: '',
            rows: data.orders || [],
            summary: data.summary || {},
            channels: data.channels || []
          });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            loading: false,
            refreshing: false,
            error: error.message,
            rows: [],
            summary: {},
            channels: []
          });
        }
      }
    }

    if (accessToken) {
      loadOrders();
    }

    const intervalId = accessToken
      ? window.setInterval(() => {
          loadOrders({ silent: true });
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
      if (filter === 'paid' && row.invoice_status !== 'paid') return false;
      if (filter === 'access_pending' && !(row.invoice_status === 'paid' && !row.joined)) return false;
      if (filter === 'trial' && !row.is_trial) return false;
      if (filter === 'broken' && !(row.invoice_status === 'paid' && !row.access_invite_status && !row.last_access_event)) return false;

      if (!normalizedSearch) return true;

      return [
        row.tg_user_id || '',
        row.tariff_title || '',
        row.channel_title || '',
        row.problem_reason || '',
        row.invoice_status || ''
      ].join(' ').toLowerCase().includes(normalizedSearch);
    });
  }, [filter, search, state.rows]);

  const prioritySignals = useMemo(() => ([
    {
      title: 'Оплачено',
      value: state.summary.paidOrders || 0,
      tone: (state.summary.paidOrders || 0) > 0 ? 'ok' : 'default',
      hint: `Всего заказов: ${state.summary.totalOrders || 0}`
    },
    {
      title: 'Доступ висит',
      value: state.summary.accessPending || 0,
      tone: (state.summary.accessPending || 0) > 0 ? 'warning' : 'ok',
      hint: 'Деньги уже есть, а пользователь еще не зашел'
    },
    {
      title: 'Сломанные',
      value: state.summary.brokenOrders || 0,
      tone: (state.summary.brokenOrders || 0) > 0 ? 'danger' : 'ok',
      hint: 'Оплата есть, а по доступу нет внятного движения'
    },
    {
      title: 'Пробники',
      value: state.summary.trialOrders || 0,
      tone: (state.summary.trialOrders || 0) > 0 ? 'warning' : 'default',
      hint: 'Отдельный хвост под апселл и дожим'
    }
  ]), [state.summary]);
  const trialHoursLeft = useMemo(() => {
    if (!trialEndsAt) return null;
    const diffMs = new Date(trialEndsAt).getTime() - Date.now();
    if (diffMs <= 0) return 0;
    return Math.ceil(diffMs / (1000 * 60 * 60));
  }, [trialEndsAt]);
  const trialUpgradeUrgent = profilePlan === 'trial' && trialHoursLeft !== null && trialHoursLeft > 0 && trialHoursLeft <= 72;

  function handoffSingleOrder(row) {
    openUserbotCenterHandoff({
      tgUserId: row.tg_user_id,
      draftMessage: row.invoice_status === 'paid' && !row.joined
        ? 'Привет. Вижу оплату, но вход в группу еще не завершился. Давай быстро дотащу тебя до доступа.'
        : 'Привет. Пишу по твоему заказу в BullRun. Напиши, что сейчас нужно: доступ, продление или проверка оплаты.'
    });
  }

  function handoffBulkOrders(rows) {
    openBroadcastManualSelection(
      rows,
      'Заказы: ручной хвост',
      'Привет. Пишу по твоему заказу в BullRun. Если актуально, ответь одним сообщением, и я быстро доведу до оплаты или доступа.'
    );
  }

  async function extendSubscriptions(subscriptionIds, days) {
    const ids = Array.from(new Set((subscriptionIds || []).map(String).filter(Boolean)));
    if (!ids.length) {
      window.alert('В текущем хвосте нет подписок для продления.');
      return;
    }

    setState((prev) => ({ ...prev, mutating: true }));
    try {
      await apiRequest('/api/userbot/crm/subscribers/batch-add-days', {
        accessToken,
        method: 'POST',
        body: { subscription_ids: ids, days }
      });
      window.alert('Продление прошло. Экран обновится сам.');
    } catch (error) {
      window.alert(error.message);
    } finally {
      setState((prev) => ({ ...prev, mutating: false }));
    }
  }

  async function kickSubscriptions(subscriptionIds) {
    const ids = Array.from(new Set((subscriptionIds || []).map(String).filter(Boolean)));
    if (!ids.length) {
      window.alert('В текущем хвосте нет подписок для кика.');
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
    return <LoadingState text="Тянем живые заказы..." />;
  }

  if (state.error) {
    return (
      <section className="page">
        <div className="page__header">
          <h1>Заказы</h1>
          <p>Этот экран уже должен сидеть на живом `/api/orders`, но backend вернул ошибку.</p>
        </div>
        <div className="error-card">{state.error}</div>
      </section>
    );
  }

  return (
    <section className="page">
      <div className="page__header">
        <h1>Заказы</h1>
        <p>
          Здесь уже видно, где деньги есть, а где доступ не добит. Заказы в новом кабинете нужны как triage по
          деньгам, а не как архив счетов.
        </p>
      <div className="page__meta">
          <span>{state.refreshing ? 'Обновляем фон...' : 'Экран обновляется сам раз в минуту.'}</span>
          <span>Каналов в контуре: {state.channels.length}</span>
          <span>Текущий хвост: {filteredRows.length}</span>
        </div>
      </div>
      {profilePlan === 'trial' ? (
        <>
          <PlanBanner
            tone={trialUpgradeUrgent ? 'warning' : 'info'}
            title={trialUpgradeUrgent ? 'Trial догорает: заказы пора вести на Normal' : 'Заказы на Trial — это стартовый checkout-контур'}
            text={trialUpgradeUrgent
              ? `До конца trial осталось около ${trialHoursLeft} ч. Если здесь уже есть оплаченные, подвисшие доступы и пробники, переводись на Normal, пока checkout не уперся в trial-потолок.`
              : 'На Trial можно закрыть первые сделки и увидеть, как работает checkout. Как только заказы становятся регулярными, переходи на Normal и веди деньги уже как основной контур.'}
          />
          <UpgradeCallout
            compact
            title="Деньги уже пошли — пора вытаскивать checkout из Trial."
            text="Если в заказах уже есть оплаченные счета и подвисшие доступы, дальше нужен не ознакомительный, а рабочий тариф. Normal должен взять этот контур на себя."
          />
        </>
      ) : null}

      <div className="hero-panel">
        <div className="hero-panel__body">
          <div className="hero-panel__eyebrow">Деньги и вход</div>
          <div className="hero-panel__title">Здесь видно, кто уже заплатил, где висит доступ и какие счета прямо сейчас пахнут потерей денег.</div>
          <div className="hero-panel__text">
            Это не просто список заказов. Здесь режешь хвосты по оплатам, дожимаешь людей, у которых деньги уже есть,
            но вход не добит, и сразу перекидываешься в доступ, CRM или досье без леса старых экранов.
          </div>
          <div className="hero-panel__actions">
            <a className="hero-link" href="/app/access">Разобрать доступ</a>
            <a className="hero-link" href="/app/crm">Открыть CRM</a>
            <a className="hero-link" href="/app/broadcast">Пульнуть рассылку</a>
            <a className="hero-link" href="/app/shop">Shop seller ops</a>
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
        <StatCard title="Всего заказов" value={state.summary.totalOrders || 0} hint="Все текущие заказы и счета." />
        <StatCard title="Оплачено" value={state.summary.paidOrders || 0} hint="Уже занесли деньги." />
        <StatCard title="Пробники" value={state.summary.trialOrders || 0} hint="Отдельный хвост для дожима в апселл." />
        <StatCard title="Доступ висит" value={state.summary.accessPending || 0} hint="Оплата есть, а входа в группу еще нет." />
        <StatCard title="Сломанные" value={state.summary.brokenOrders || 0} hint="Оплата есть, а по доступу нет никакого движения." />
      </div>

      <div className="toolbar-card">
        <div className="toolbar-card__title">Текущий хвост</div>
        <div className="toolbar-card__body">
          <input
            className="field"
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="TG ID, тариф, канал, проблема"
          />
          <button className="ghost-button" type="button" onClick={() => handoffBulkOrders(filteredRows)} disabled={state.mutating}>
            Вынести хвост в рассылку
          </button>
          <button className="ghost-button" type="button" onClick={() => extendSubscriptions(filteredRows.map((row) => row.subscription_id), 5)} disabled={state.mutating}>
            +5 дней
          </button>
          <button className="ghost-button" type="button" onClick={() => extendSubscriptions(filteredRows.map((row) => row.subscription_id), 30)} disabled={state.mutating}>
            +30 дней
          </button>
          <button className="ghost-button" type="button" onClick={() => kickSubscriptions(filteredRows.map((row) => row.subscription_id))} disabled={state.mutating}>
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
        <div className="table-card__title">Заказы и доступ</div>
        {filteredRows.length === 0 ? (
          <div className="empty-inline">Под текущий фильтр ничего не попало.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Клиент</th>
                <th>Тариф</th>
                <th>Счет</th>
                <th>Доступ</th>
                <th>Проблема</th>
                <th>Дальше</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.slice(0, 50).map((row) => (
                <tr key={row.id}>
                  <td>
                    <div>TG ID {row.tg_user_id}</div>
                    <div className="table-subtext">{row.channel_title}</div>
                  </td>
                  <td>
                    <div>{row.tariff_title}</div>
                    <div className="table-subtext">{row.is_trial ? (row.trial_label || 'Пробник') : 'Обычный тариф'}</div>
                  </td>
                  <td>
                    <span className={invoiceBadgeClass(row)}>{row.invoice_status}</span>
                    <div className="table-subtext">{row.payment_event_type || 'Нет сигнала кассы'}</div>
                  </td>
                  <td>
                    <span className={accessBadgeClass(row)}>{row.joined ? 'Зашел' : 'Не зашел'}</span>
                    <div className="table-subtext">{row.last_access_event || row.access_invite_status || 'Нет движения'}</div>
                  </td>
                  <td>{row.problem_reason}</td>
                  <td>
                    <div className="table-actions">
                      <a href="/app/access" target="_blank" rel="noreferrer">Доступ</a>
                      <a
                        href={`/app/dossier?tg=${encodeURIComponent(row.tg_user_id)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Досье
                      </a>
                      <button className="inline-action" onClick={() => handoffSingleOrder(row)}>В центр юзербота</button>
                      {row.subscription_id ? (
                        <>
                          <button className="inline-action" onClick={() => extendSubscriptions([row.subscription_id], 5)}>+5</button>
                          <button className="inline-action" onClick={() => extendSubscriptions([row.subscription_id], 30)}>+30</button>
                        </>
                      ) : null}
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
