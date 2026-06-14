import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { LoadingState } from '../ui/LoadingState.jsx';
import { StatCard } from '../ui/StatCard.jsx';

const FILTERS = [
  { id: 'all', label: 'Все' },
  { id: 'pending_join', label: 'Вход не подтвержден' },
  { id: 'expired', label: 'Сгорели и висят' }
];

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value));
}

function accessIssueClass(row) {
  if (row.status === 'active' && !row.last_join_approved_at) return 'pill pill--warning';
  if (row.status === 'expired') return 'pill pill--danger';
  return 'pill';
}

function accessIssueText(row) {
  if (row.status === 'active' && !row.last_join_approved_at) return 'Вход не подтвержден';
  if (row.status === 'expired') {
    if (row.kick_attempts >= 5) return 'Ошибка авто-кика';
    return 'Сгорел и не кикнут';
  }
  return row.status || 'Неизвестно';
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
      label: row.channel_title || `TG ${row.tg_user_id}`
    })),
    suggested_title: suggestedTitle,
    suggested_message: suggestedMessage
  }));

  window.location.href = '/app/broadcast';
}

export function AccessPage() {
  const { accessToken } = useAuth();
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [state, setState] = useState({
    loading: true,
    refreshing: false,
    mutating: false,
    error: '',
    summary: {},
    accessIssues: [],
    invites: [],
    events: []
  });

  useEffect(() => {
    let cancelled = false;

    async function loadAccess({ silent = false } = {}) {
      if (!silent) {
        setState((prev) => ({
          ...prev,
          loading: !prev.accessIssues.length && !prev.invites.length,
          refreshing: !!prev.accessIssues.length || !!prev.invites.length,
          error: ''
        }));
      }

      try {
        const data = await apiRequest('/api/access', { accessToken });
        if (!cancelled) {
          setState({
            loading: false,
            refreshing: false,
            error: '',
            summary: data.summary || {},
            accessIssues: data.accessIssues || [],
            invites: data.invites || [],
            events: data.events || []
          });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            loading: false,
            refreshing: false,
            error: error.message,
            summary: {},
            accessIssues: [],
            invites: [],
            events: []
          });
        }
      }
    }

    if (accessToken) {
      loadAccess();
    }

    const intervalId = accessToken
      ? window.setInterval(() => {
          loadAccess({ silent: true });
        }, 60_000)
      : null;

    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [accessToken]);

  const filteredIssues = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return state.accessIssues.filter((row) => {
      if (filter === 'pending_join' && !(row.status === 'active' && !row.last_join_approved_at)) return false;
      if (filter === 'expired' && row.status !== 'expired') return false;

      if (!normalizedSearch) return true;

      return [
        row.tg_user_id || '',
        row.channel_title || '',
        row.status || '',
        row.last_access_event || '',
        row.access_note || ''
      ].join(' ').toLowerCase().includes(normalizedSearch);
    });
  }, [filter, search, state.accessIssues]);

  function handoffSingleIssue(row) {
    openUserbotCenterHandoff({
      tgUserId: row.tg_user_id,
      draftMessage: row.status === 'active' && !row.last_join_approved_at
        ? 'Привет. Вижу оплату, но вход в группу еще не завершился. Напиши, если нужна помощь, и я быстро дотащу тебя до доступа.'
        : 'Привет. Пишу по доступу в BullRun. Напиши, что сейчас не сходится, и я быстро разберу ситуацию.'
    });
  }

  function handoffBulkIssues(rows) {
    openBroadcastManualSelection(
      rows,
      'Доступ: ручной хвост',
      'Привет. Пишу по доступу в BullRun. Если у тебя что-то зависло между оплатой и входом, ответь одним сообщением, и я быстро доведу до результата.'
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
    return <LoadingState text="Тянем живой журнал доступа..." />;
  }

  if (state.error) {
    return (
      <section className="page">
        <div className="page__header">
          <h1>Доступ</h1>
          <p>Этот экран уже должен сидеть на живом `/api/access`, но backend вернул ошибку.</p>
        </div>
        <div className="error-card">{state.error}</div>
      </section>
    );
  }

  return (
    <section className="page">
      <div className="page__header">
        <h1>Доступ</h1>
        <div className="page__meta">
          <span>{state.refreshing ? 'Обновляем фон...' : 'Автообновление раз в минуту'}</span>
          <span>Проблем по доступу: {filteredIssues.length}</span>
          <span>Инвайтов всего: {state.summary.totalInvites || 0}</span>
        </div>
      </div>

      <div className="grid">
        <StatCard title="Инвайтов" value={state.summary.totalInvites || 0} />
        <StatCard title="Выданы" value={state.summary.issuedInvites || 0} />
        <StatCard title="Вход не подтвержден" value={state.summary.pendingAccess || 0} tone={(state.summary.pendingAccess || 0) > 0 ? 'warning' : 'default'} />
        <StatCard title="Сгорели и висят" value={state.summary.staleExpired || 0} tone={(state.summary.staleExpired || 0) > 0 ? 'danger' : 'default'} />
      </div>

      <div className="toolbar-card">
        <div className="toolbar-card__title">Текущий хвост</div>
        <div className="toolbar-card__body">
          <input
            className="field"
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="TG ID, канал, событие, заметка"
          />
          <button className="ghost-button" type="button" onClick={() => handoffBulkIssues(filteredIssues)} disabled={state.mutating}>
            Вынести хвост в рассылку
          </button>
          <button className="ghost-button" type="button" onClick={() => extendSubscriptions(filteredIssues.map((row) => row.id), 5)} disabled={state.mutating}>
            +5 дней
          </button>
          <button className="ghost-button" type="button" onClick={() => extendSubscriptions(filteredIssues.map((row) => row.id), 30)} disabled={state.mutating}>
            +30 дней
          </button>
          <button className="ghost-button" type="button" onClick={() => kickSubscriptions(filteredIssues.map((row) => row.id))} disabled={state.mutating}>
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
        <div className="table-card__title">Проблемы доступа</div>
        {filteredIssues.length === 0 ? (
          <div className="empty-inline">Под текущий фильтр ничего не попало.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Клиент</th>
                <th>Канал</th>
                <th>Статус</th>
                <th>Последний след</th>
                <th>Дальше</th>
              </tr>
            </thead>
            <tbody>
              {filteredIssues.slice(0, 50).map((row) => (
                <tr key={row.id}>
                  <td>
                    <div>TG ID {row.tg_user_id}</div>
                    <div className="table-subtext">{row.access_note || 'Без заметки'}</div>
                    {row.kick_attempts >= 5 && (
                      <div className="table-subtext" style={{ color: '#ef4444', marginTop: '4px', fontWeight: 'bold' }}>
                        ⚠️ Превышен лимит попыток кика ({row.kick_attempts}/5). Ошибка: {row.kick_failed_reason || 'Неизвестная ошибка'}
                      </div>
                    )}
                  </td>
                  <td>{row.channel_title}</td>
                  <td>
                    <span className={accessIssueClass(row)}>{accessIssueText(row)}</span>
                  </td>
                  <td>{row.last_access_event || 'Нет событий'} • {formatDate(row.expires_at)}</td>
                  <td>
                    <div className="table-actions">
                      <a href="/app/customers?tab=orders" target="_blank" rel="noreferrer">Заказы</a>
                      <a href="/app/customers?tab=customers" target="_blank" rel="noreferrer">Клиенты</a>
                      <a
                        href={`/app/dossier?tg=${encodeURIComponent(row.tg_user_id)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Досье
                      </a>
                      <button className="inline-action" onClick={() => handoffSingleIssue(row)}>В центр юзербота</button>
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
