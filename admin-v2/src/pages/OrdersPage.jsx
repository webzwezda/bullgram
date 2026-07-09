import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { LoadingState } from '../ui/LoadingState.jsx';
import { StatCard } from '../ui/StatCard.jsx';

const FILTERS = [
  { id: 'all', label: 'Все' },
  { id: 'paid', label: 'Оплачено' },
  { id: 'access_pending', label: 'Вход не подтвержден' },
  { id: 'referrals', label: 'По рефке' },
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

function formatMoney(value, currency) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return `0 ${currency || ''}`.trim();
  return `${amount.toLocaleString('ru-RU', { maximumFractionDigits: currency === 'RUB' ? 2 : 6 })} ${currency || ''}`.trim();
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

  window.location.href = `/app/userbots${params.toString() ? `?${params.toString()}` : ''}`;
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
  const { accessToken } = useAuth();
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
      if (filter === 'referrals' && !(Number(row.referral_discount_percent || 0) > 0 || Number(row.referral_reward_ton || 0) > 0)) return false;
      if (filter === 'trial' && !row.is_trial) return false;
      if (filter === 'broken' && !(row.invoice_status === 'paid' && !row.access_invite_status && !row.last_access_event)) return false;

      if (!normalizedSearch) return true;

      return [
        row.tg_user_id || '',
        row.tariff_title || '',
        row.channel_title || '',
        row.referral_code || '',
        row.referral_referrer_tg_user_id || '',
        row.problem_reason || '',
        row.invoice_status || ''
      ].join(' ').toLowerCase().includes(normalizedSearch);
    });
  }, [filter, search, state.rows]);

  function handoffSingleOrder(row) {
    openUserbotCenterHandoff({
      tgUserId: row.tg_user_id,
      draftMessage: row.invoice_status === 'paid' && !row.joined
        ? 'Привет. Вижу оплату, но вход в группу у нас не подтвердился. Если доступ еще не открылся, ответь, и я быстро помогу.'
        : 'Привет. Пишу по твоему заказу в Bullgram. Напиши, что сейчас нужно: доступ, продление или проверка оплаты.'
    });
  }

  function handoffBulkOrders(rows) {
    openBroadcastManualSelection(
      rows,
      'Заказы: ручной хвост',
      'Привет. Пишу по твоему заказу в Bullgram. Если актуально, ответь одним сообщением, и я быстро доведу до оплаты или доступа.'
    );
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
        <div className="page__meta">
          <span>{state.refreshing ? 'Обновляем фон...' : 'Автообновление раз в минуту'}</span>
          <span>Каналов в контуре: {state.channels.length}</span>
          <span>Текущий хвост: {filteredRows.length}</span>
        </div>
      </div>

      <div className="grid">
        <StatCard title="Всего" value={state.summary.totalOrders || 0} />
        <StatCard title="Оплачено" value={state.summary.paidOrders || 0} />
        <StatCard title="Вход не подтвержден" value={state.summary.accessPending || 0} tone={(state.summary.accessPending || 0) > 0 ? 'warning' : 'default'} />
        <StatCard title="По рефке" value={state.summary.referralOrders || 0} />
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
          <a className="ghost-button" href="/app/customers?tab=customers">Открыть клиентов для продлений</a>
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
                    {Number(row.referral_discount_percent || 0) > 0 ? (
                      <div className="table-subtext">
                        Рефка: -{row.referral_discount_percent}% • было {formatMoney(row.referral_original_amount, row.currency)}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    <span className={invoiceBadgeClass(row)}>{row.invoice_status}</span>
                    <div className="table-subtext">{row.payment_event_type || 'Нет сигнала кассы'}</div>
                    {Number(row.referral_reward_ton || 0) > 0 ? (
                      <div className="table-subtext">
                        Партнеру: {formatMoney(row.referral_reward_ton, 'TON')} • {row.referral_reward_status || 'ждет'}
                      </div>
                    ) : Number(row.referral_discount_percent || 0) > 0 ? (
                      <div className="table-subtext">
                        Партнер: {row.referral_referrer_tg_user_id ? `TG ${row.referral_referrer_tg_user_id}` : row.referral_code || 'по коду'}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    <span className={accessBadgeClass(row)}>{row.joined ? 'Вход подтвержден' : 'Вход не подтвержден'}</span>
                    <div className="table-subtext">{row.last_access_event || row.access_invite_status || 'Нет движения'}</div>
                  </td>
                  <td>{row.problem_reason}</td>
                  <td>
                    <div className="table-actions">
                      <a href="/app/customers?tab=access" target="_blank" rel="noreferrer">Доступ</a>
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
                          <a href="/app/customers?tab=customers" target="_blank" rel="noreferrer">Клиенты</a>
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
