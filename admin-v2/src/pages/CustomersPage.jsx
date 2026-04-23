import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { LoadingState } from '../ui/LoadingState.jsx';
import { StatCard } from '../ui/StatCard.jsx';

const TABS = [
  { id: 'queue', label: 'Очередь' },
  { id: 'viewed', label: 'Смотрели тарифы' },
  { id: 'abandoned', label: 'Бросили счет' },
  { id: 'customers', label: 'Клиенты' },
  { id: 'orders', label: 'Заказы' },
  { id: 'access', label: 'Доступ' },
  { id: 'bases', label: 'Базы' }
];

const USERBOT_CENTER_HANDOFF_KEY = 'bullrun_userbot_center_handoff';

const ABANDONED_STATUS_LABELS = {
  awaiting_receipt: 'Ждет чек',
  reminded: 'Уже дожат',
  fresh: 'Свежий',
  queued: 'В очереди',
  stale: 'Протух'
};

function formatWhen(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value));
}

function getInvoiceStatus(inv) {
  const createdAt = new Date(inv.created_at).getTime();
  const ageHours = (Date.now() - createdAt) / (1000 * 60 * 60);

  if (inv.status === 'awaiting_receipt') return 'Ждет чек';
  if (inv.reminded) return 'Уже дожат';
  if (ageHours < 2) return 'Свежий';
  if (ageHours < 24) return 'В очереди';
  return 'Протух';
}

function openUserbotCenterHandoff(tgUserId, draftMessage = '') {
  if (!tgUserId) return;
  window.localStorage.setItem(USERBOT_CENTER_HANDOFF_KEY, JSON.stringify({
    tg_user_id: String(tgUserId),
    draft_message: String(draftMessage || '').trim()
  }));
  window.location.href = `/app/userbot-center?tg_user_id=${encodeURIComponent(tgUserId)}`;
}

function openBroadcastManualSelection(rows = [], title = 'Клиенты: ручной хвост') {
  const tgUserIds = Array.from(new Set(rows.map((row) => String(row.tg_user_id || '')).filter(Boolean)));
  if (!tgUserIds.length) {
    window.alert('В текущем хвосте нет TG ID.');
    return;
  }

  window.localStorage.setItem('broadcast_manual_selection', JSON.stringify({
    tg_user_ids: tgUserIds,
    members: rows.map((row) => ({
      tg_user_id: String(row.tg_user_id || ''),
      label: row.label || row.title || row.channel_title || `TG ${row.tg_user_id}`
    })),
    suggested_title: title,
    suggested_message: 'Привет. Пишу по доступу в BullRun. Если вопрос еще актуален, ответь одним сообщением.'
  }));

  window.location.href = '/app/broadcast';
}

function rowMatches(row, search) {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  return [
    row.tg_user_id,
    row.tg_username,
    row.id,
    row.title,
    row.label,
    row.channel_title,
    row.status,
    row.reason
  ].join(' ').toLowerCase().includes(needle);
}

function buildQueue({ abandoned, orders, access }) {
  const items = [];

  abandoned.forEach((row) => {
    items.push({
      id: `abandoned-${row.id}`,
      source: 'Бросил счет',
      priority: row.status === 'awaiting_receipt' ? 90 : 70,
      tg_user_id: row.tg_user_id,
      channel_id: row.channel_id,
      title: row.tariffs?.title || 'Тариф',
      status: getInvoiceStatus(row),
      reason: row.status === 'awaiting_receipt' ? 'Ждет чек' : 'Не завершил оплату',
      href: '/app/customers?tab=abandoned'
    });
  });

  orders
    .filter((row) => row.invoice_status === 'paid' && !row.joined)
    .forEach((row) => {
      items.push({
        id: `order-${row.id || row.invoice_id}`,
        source: 'Заказ',
        priority: 100,
        tg_user_id: row.tg_user_id,
        channel_id: row.channel_id,
        title: row.tariff_title,
        channel_title: row.channel_title,
        status: 'Вход не подтвержден',
        reason: 'Оплата есть, Telegram-вход не подтвержден',
        href: '/app/customers?tab=orders'
      });
    });

  access.forEach((row) => {
    items.push({
      id: `access-${row.id}`,
      source: 'Доступ',
      priority: row.status === 'expired' ? 95 : 85,
      tg_user_id: row.tg_user_id,
      channel_id: row.channel_id,
      channel_title: row.channel_title,
      status: row.status === 'expired' ? 'Сгорел и висит' : 'Вход не подтвержден',
      reason: row.last_access_event || row.access_note || 'Нужна проверка доступа',
      href: '/app/customers?tab=access'
    });
  });

  return items.sort((a, b) => b.priority - a.priority).slice(0, 100);
}

export function CustomersPage() {
  const { accessToken } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = TABS.some((tab) => tab.id === searchParams.get('tab')) ? searchParams.get('tab') : 'queue';
  const focusChannelId = searchParams.get('channel') || '';
  const [search, setSearch] = useState('');
  const [handoff, setHandoff] = useState({
    abandonedFilter: '',
    orderTgUserIds: []
  });
  const [state, setState] = useState({
    loading: true,
    refreshing: false,
    error: '',
    updatedAt: null,
    abandoned: [],
    crm: [],
    orders: [],
    access: [],
    bases: [],
    viewed: []
  });

  useEffect(() => {
    try {
      const rawOrdersSearch = window.localStorage.getItem('orders_search_preset');
      const rawOrdersManualSelection = window.localStorage.getItem('orders_manual_selection');
      const rawAbandonedPreset = window.localStorage.getItem('abandoned_filter_preset');
      if (!rawOrdersSearch && !rawOrdersManualSelection && !rawAbandonedPreset) return;

      const next = new URLSearchParams(window.location.search);

      if (rawOrdersSearch) {
        const preset = JSON.parse(rawOrdersSearch);
        if (preset?.search) {
          setSearch(String(preset.search));
          next.set('tab', 'orders');
        }
        window.localStorage.removeItem('orders_search_preset');
      }

      if (rawOrdersManualSelection) {
        const preset = JSON.parse(rawOrdersManualSelection);
        const ids = Array.isArray(preset?.tg_user_ids)
          ? preset.tg_user_ids.map((id) => String(id)).filter(Boolean)
          : [];
        if (ids.length > 0) {
          setHandoff((prev) => ({ ...prev, orderTgUserIds: ids }));
          setSearch('');
          next.set('tab', 'orders');
        }
        window.localStorage.removeItem('orders_manual_selection');
      }

      if (rawAbandonedPreset) {
        const preset = JSON.parse(rawAbandonedPreset);
        if (preset?.filter) {
          setHandoff((prev) => ({ ...prev, abandonedFilter: String(preset.filter) }));
          next.set('tab', 'abandoned');
        }
        window.localStorage.removeItem('abandoned_filter_preset');
      }

      setSearchParams(next);
    } catch (error) {
      console.warn('Не удалось применить customer handoff preset:', error);
      window.localStorage.removeItem('orders_search_preset');
      window.localStorage.removeItem('orders_manual_selection');
      window.localStorage.removeItem('abandoned_filter_preset');
    }
  }, [setSearchParams]);

  useEffect(() => {
    let cancelled = false;

    async function loadCustomers({ silent = false } = {}) {
      if (!accessToken) return;

      if (!silent) {
        setState((prev) => ({
          ...prev,
          loading: !prev.updatedAt,
          refreshing: !!prev.updatedAt,
          error: ''
        }));
      }

      try {
        const data = await apiRequest('/api/customers/workbench', { accessToken });
        const segments = data.segments || {};

        if (cancelled) return;

        setState({
          loading: false,
          refreshing: false,
          error: '',
          updatedAt: data.updatedAt || new Date().toISOString(),
          abandoned: segments.abandonedInvoices || [],
          crm: [
            ...(segments.activeCustomers || []),
            ...(segments.expiredCustomers || [])
          ],
          orders: segments.recentOrders || [],
          access: [
            ...(segments.needsAccessCheck || []),
            ...(segments.inGroupLeaks || [])
          ],
          bases: segments.bases || [],
          viewed: segments.viewedTariffs || []
        });
      } catch (error) {
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            loading: false,
            refreshing: false,
            error: error.message
          }));
        }
      }
    }

    loadCustomers();
    const intervalId = accessToken
      ? window.setInterval(() => loadCustomers({ silent: true }), 60_000)
      : null;

    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [accessToken]);

  const queueRows = useMemo(() => buildQueue(state), [state]);
  const rowsByTab = useMemo(() => ({
    queue: queueRows,
    abandoned: state.abandoned.map((row) => ({
      id: row.id,
      tg_user_id: row.tg_user_id,
      channel_id: row.channel_id,
      title: row.tariffs?.title || 'Тариф',
      status: getInvoiceStatus(row),
      reason: row.status,
      abandoned_status: row.abandoned_status,
      created_at: row.created_at,
      href: '/app/customers?tab=abandoned'
    })),
    viewed: state.viewed.map((row) => ({
      id: row.id,
      tg_user_id: row.tg_user_id,
      channel_id: row.channel_id,
      title: row.tariff_title || 'Просмотр тарифа',
      channel_title: row.channel_title || '',
      status: row.event_type,
      reason: row.source || row.referral_code || 'Без счета',
      created_at: row.created_at,
      href: '/app/customers?tab=viewed'
    })),
    customers: state.crm.map((row) => ({
      id: row.id,
      tg_user_id: row.tg_user_id,
      channel_id: row.channel_id,
      tg_username: row.tg_username,
      channel_title: row.channel_title,
      title: row.channel_title,
      status: row.status === 'active' ? 'Активен' : 'Истек',
      reason: row.in_group === true ? 'Вход подтвержден' : row.in_group === false ? 'Вход не подтвержден' : 'Присутствие неизвестно',
      expires_at: row.expires_at,
      href: '/app/customers?tab=customers'
    })),
    orders: state.orders.map((row) => ({
      id: row.id || row.invoice_id,
      tg_user_id: row.tg_user_id,
      channel_id: row.channel_id,
      channel_title: row.channel_title,
      title: row.tariff_title,
      status: row.invoice_status,
      reason: row.joined ? 'Вход подтвержден' : 'Вход не подтвержден',
      created_at: row.created_at,
      href: '/app/customers?tab=orders'
    })),
    access: state.access.map((row) => ({
      id: row.id,
      tg_user_id: row.tg_user_id,
      channel_id: row.channel_id,
      channel_title: row.channel_title,
      status: row.status === 'expired' ? 'Сгорел и висит' : 'Вход не подтвержден',
      reason: row.last_access_event || row.access_note || 'Нет событий',
      expires_at: row.expires_at,
      href: '/app/customers?tab=access'
    })),
    bases: state.bases.map((row) => ({
      id: row.id,
      title: row.name,
      status: `${row.stats?.total || 0} участников`,
      reason: row.description || 'База клиентов',
      href: '/app/customers?tab=bases'
    }))
  }), [queueRows, state]);

  const activeRows = useMemo(
    () => (rowsByTab[activeTab] || [])
      .filter((row) => !focusChannelId || String(row.channel_id || '') === String(focusChannelId))
      .filter((row) => activeTab !== 'abandoned' || !handoff.abandonedFilter || row.abandoned_status === handoff.abandonedFilter)
      .filter((row) => activeTab !== 'orders' || handoff.orderTgUserIds.length === 0 || handoff.orderTgUserIds.includes(String(row.tg_user_id || '')))
      .filter((row) => rowMatches(row, search)),
    [activeTab, focusChannelId, handoff.abandonedFilter, handoff.orderTgUserIds, rowsByTab, search]
  );

  const stats = useMemo(() => ({
    viewed: state.viewed.length,
    abandoned: state.abandoned.length,
    activeCustomers: state.crm.filter((row) => row.status === 'active').length,
    expiredCustomers: state.crm.filter((row) => row.status === 'expired').length,
    access: state.access.length
  }), [state]);

  if (state.loading) {
    return <LoadingState text="Собираем клиентов..." />;
  }

  return (
    <section className="page">
      <div className="page__header">
      </div>

      {state.error ? <div className="error-card">{state.error}</div> : null}

      {handoff.abandonedFilter || handoff.orderTgUserIds.length > 0 || focusChannelId ? (
        <div className="table-card">
          <div className="table-card__title">Фильтр перехода</div>
          <div className="toolbar-card__body" style={{ padding: 0 }}>
            {focusChannelId ? <span className="pill">Канал {focusChannelId}</span> : null}
            {handoff.abandonedFilter ? <span className="pill">Неоплаты: {ABANDONED_STATUS_LABELS[handoff.abandonedFilter] || handoff.abandonedFilter}</span> : null}
            {handoff.orderTgUserIds.length > 0 ? <span className="pill">TG ID: {handoff.orderTgUserIds.length}</span> : null}
            <button
              className="inline-action"
              type="button"
              onClick={() => {
                setHandoff({ abandonedFilter: '', orderTgUserIds: [] });
                setSearchParams({ tab: activeTab });
              }}
            >
              Сбросить
            </button>
          </div>
        </div>
      ) : null}

      <div className="grid">
        <StatCard
          title="Посмотрели тариф, но не создали счет"
          value={stats.viewed}
          tone={stats.viewed > 0 ? 'warning' : 'default'}
        />
        <StatCard
          title="Создали счет, но не оплатили"
          value={stats.abandoned}
          tone={stats.abandoned > 0 ? 'warning' : 'default'}
        />
        <StatCard
          title="Активный доступ"
          value={stats.activeCustomers}
        />
        <StatCard
          title="Доступ истек"
          value={stats.expiredCustomers}
          tone={stats.expiredCustomers > 0 ? 'warning' : 'default'}
        />
        <StatCard
          title="Оплатили, но вход не подтвержден"
          value={stats.access}
          tone={stats.access > 0 ? 'warning' : 'default'}
        />
      </div>

      <div className="toolbar-card">
        <div className="toolbar-card__title">Рабочий список</div>
        <div className="toolbar-card__body">
          <input
            className="field"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="TG ID, @username, тариф, канал, статус"
          />
          <button className="ghost-button" type="button" onClick={() => openBroadcastManualSelection(activeRows)}>
            В рассылку
          </button>
          <a className="ghost-button" href="/app/dossier">Досье</a>
        </div>
        <div className="filter-strip">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`filter-chip${activeTab === tab.id ? ' filter-chip--active' : ''}`}
              onClick={() => setSearchParams(focusChannelId ? { tab: tab.id, channel: focusChannelId } : { tab: tab.id })}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="table-card">
        <div className="table-card__title">{TABS.find((tab) => tab.id === activeTab)?.label || 'Клиенты'}</div>
        {activeTab === 'viewed' && activeRows.length === 0 ? (
          <div className="empty-inline">Просмотров тарифов пока нет. Они появятся после включения `customer_funnel_events` в боте.</div>
        ) : activeRows.length === 0 ? (
          <div className="empty-inline">Под текущий фильтр ничего не попало.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Клиент</th>
                <th>Контекст</th>
                <th>Статус</th>
                <th>Причина</th>
                <th>Дальше</th>
              </tr>
            </thead>
            <tbody>
              {activeRows.slice(0, 80).map((row) => (
                <tr key={`${activeTab}-${row.id}`}>
                  <td>
                    <div>{row.tg_username ? `@${row.tg_username}` : row.tg_user_id ? `TG ID ${row.tg_user_id}` : '-'}</div>
                    <div className="table-subtext">{row.source || row.created_at ? formatWhen(row.created_at) : ''}</div>
                  </td>
                  <td>
                    <div>{row.title || row.channel_title || '-'}</div>
                    <div className="table-subtext">{row.channel_title || ''}</div>
                  </td>
                  <td><span className={row.priority >= 90 ? 'pill pill--warning' : 'pill'}>{row.status || '-'}</span></td>
                  <td>{row.reason || '-'}</td>
                  <td>
                    <div className="table-actions">
                      {row.tg_user_id ? (
                        <a href={`/app/dossier?tg=${encodeURIComponent(row.tg_user_id)}`} target="_blank" rel="noreferrer">Досье</a>
                      ) : null}
                      {row.tg_user_id ? (
                        <button className="inline-action" type="button" onClick={() => openUserbotCenterHandoff(row.tg_user_id)}>
                          Написать
                        </button>
                      ) : null}
                      <a href={row.href || '/app/customers'} target="_blank" rel="noreferrer">Источник</a>
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
