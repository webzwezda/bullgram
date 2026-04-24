import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, Filter, RefreshCcw, Activity, Users, X, Send, UserSquare2, ChevronRight, Eye, ShoppingCart, Lock, Database, UserX, UserPlus, FileText, AlertCircle, Clock } from 'lucide-react';
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
    <section className="page page--flush">
      {/* Main Content Card */}
      <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-xl shadow-slate-200/40 p-6 sm:p-10 lg:p-12 space-y-10">

        {state.error && (
          <div className="p-5 rounded-2xl bg-red-50 border border-red-100 text-red-600 font-bold text-sm flex items-center gap-3 shadow-sm">
            <AlertCircle className="w-5 h-5 shrink-0" />
            {state.error}
          </div>
        )}

        {/* Filter Handoff */}
        {(handoff.abandonedFilter || handoff.orderTgUserIds.length > 0 || focusChannelId) && (
          <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200/60 rounded-[2rem] p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-6 shadow-md shadow-amber-500/5">
            <div>
              <div className="text-xs font-black uppercase tracking-widest text-amber-600 mb-3 flex items-center gap-2">
                <Filter className="w-4 h-4" />
                Активный фильтр
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {focusChannelId && <span className="px-3 py-1.5 bg-white border border-amber-200 text-amber-700 rounded-xl text-sm font-bold shadow-sm">Канал {focusChannelId}</span>}
                {handoff.abandonedFilter && <span className="px-3 py-1.5 bg-white border border-amber-200 text-amber-700 rounded-xl text-sm font-bold shadow-sm">Неоплаты: {ABANDONED_STATUS_LABELS[handoff.abandonedFilter] || handoff.abandonedFilter}</span>}
                {handoff.orderTgUserIds.length > 0 && <span className="px-3 py-1.5 bg-white border border-amber-200 text-amber-700 rounded-xl text-sm font-bold shadow-sm">TG ID: {handoff.orderTgUserIds.length}</span>}
              </div>
            </div>
            <button
              className="shrink-0 px-6 py-3 bg-white border border-amber-200 text-amber-700 rounded-xl text-sm font-black shadow-sm hover:bg-amber-100 transition-all flex items-center gap-2"
              onClick={() => {
                setHandoff({ abandonedFilter: '', orderTgUserIds: [] });
                setSearchParams({ tab: activeTab });
              }}
            >
              <X className="w-4 h-4" /> Сбросить фильтр
            </button>
          </div>
        )}

        {/* Bento Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-6">
          
          {/* Primary Access Card (Span 2) */}
          <div className="bg-slate-900 border border-slate-800 p-8 rounded-[2rem] shadow-xl hover:shadow-2xl transition-shadow flex flex-col lg:col-span-2 relative overflow-hidden group">
            <div className="absolute -right-20 -top-20 w-64 h-64 bg-emerald-500/20 blur-3xl rounded-full group-hover:bg-emerald-500/30 transition-colors" />
            <div className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-6 flex items-center gap-2"><UserSquare2 className="w-4 h-4" /> Доступ к каналам</div>
            <div className="flex flex-col gap-6 mt-auto relative z-10">
              <div className="flex items-end gap-4">
                <div className="text-5xl font-black tracking-tighter text-white">{stats.activeCustomers}</div>
                <div className="text-xs font-bold uppercase tracking-wider text-emerald-400 mb-2 bg-emerald-500/10 px-2 py-1 rounded-md">Активен</div>
              </div>
              <div className="w-full h-px bg-slate-800" />
              <div className="flex items-end gap-4">
                <div className={`text-3xl font-black tracking-tighter ${stats.expiredCustomers > 0 ? 'text-red-400' : 'text-slate-500'}`}>{stats.expiredCustomers}</div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Истек</div>
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 p-8 rounded-[2rem] shadow-sm hover:shadow-md transition-shadow flex flex-col lg:col-span-2 group relative overflow-hidden">
            <div className="absolute -right-10 -bottom-10 w-40 h-40 bg-purple-500/10 blur-2xl rounded-full group-hover:bg-purple-500/20 transition-colors" />
            <div className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-6 flex items-center gap-2"><Lock className="w-4 h-4" /> Вход не подтвержден</div>
            <div className="mt-auto">
              <div className={`text-5xl font-black tracking-tighter ${stats.access > 0 ? 'text-purple-600' : 'text-slate-900'}`}>{stats.access}</div>
              <div className="text-sm font-medium text-slate-500 mt-2">Оплатили, но не вошли</div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 p-8 rounded-[2rem] shadow-sm hover:shadow-md transition-shadow flex flex-col group relative overflow-hidden">
            <div className="absolute -right-10 -bottom-10 w-32 h-32 bg-amber-500/10 blur-2xl rounded-full group-hover:bg-amber-500/20 transition-colors" />
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-4 flex items-center gap-2"><Eye className="w-3.5 h-3.5" /> Посмотрели</div>
            <div className={`text-4xl font-black tracking-tighter mt-auto ${stats.viewed > 0 ? 'text-amber-500' : 'text-slate-900'}`}>{stats.viewed}</div>
          </div>

          <div className="bg-white border border-slate-200 p-8 rounded-[2rem] shadow-sm hover:shadow-md transition-shadow flex flex-col group relative overflow-hidden">
            <div className="absolute -right-10 -bottom-10 w-32 h-32 bg-orange-500/10 blur-2xl rounded-full group-hover:bg-orange-500/20 transition-colors" />
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-4 flex items-center gap-2"><ShoppingCart className="w-3.5 h-3.5" /> Бросили</div>
            <div className={`text-4xl font-black tracking-tighter mt-auto ${stats.abandoned > 0 ? 'text-orange-500' : 'text-slate-900'}`}>{stats.abandoned}</div>
          </div>
        </div>

        {/* Workspace Toolbar */}
        <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] border border-slate-200 shadow-sm p-3 sm:p-4 flex flex-col xl:flex-row gap-4 items-center sticky top-4 z-40">
          
          {/* Segmented Control Tabs */}
          <div className="flex w-full xl:w-auto p-1.5 bg-slate-100 rounded-2xl overflow-x-auto hide-scrollbar">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`shrink-0 px-5 py-2.5 text-[11px] font-black uppercase tracking-widest rounded-xl transition-all ${
                  activeTab === tab.id 
                    ? 'bg-white text-slate-900 shadow-sm' 
                    : 'text-slate-500 hover:text-slate-800'
                }`}
                onClick={() => setSearchParams(focusChannelId ? { tab: tab.id, channel: focusChannelId } : { tab: tab.id })}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="w-px h-8 bg-slate-200 hidden xl:block mx-2" />

          {/* Search & Actions */}
          <div className="flex flex-col sm:flex-row w-full xl:flex-1 gap-3">
            <div className="relative w-full sm:flex-1">
              <input
                className="w-full pl-12 pr-6 py-3.5 bg-white border border-slate-200 rounded-2xl text-slate-900 font-bold focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all shadow-sm placeholder:text-slate-400 placeholder:font-medium text-sm"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Поиск по TG ID, @username, тарифу..."
              />
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            </div>
            
            <div className="flex gap-2 w-full sm:w-auto shrink-0">
              <button className="flex-1 sm:flex-none px-6 py-3.5 bg-blue-600 !text-white rounded-2xl text-sm font-black shadow-md shadow-blue-500/20 hover:bg-blue-700 hover:-translate-y-0.5 transition-all flex items-center justify-center gap-2" type="button" onClick={() => openBroadcastManualSelection(activeRows)}>
                <Send className="w-4 h-4" /> Рассылка
              </button>
              <a className="flex-1 sm:flex-none px-6 py-3.5 bg-white border border-slate-200 !text-slate-700 rounded-2xl text-sm font-black shadow-sm hover:bg-slate-50 hover:!text-slate-900 transition-all flex items-center justify-center gap-2" href="/app/dossier" target="_blank" rel="noreferrer">
                <Database className="w-4 h-4 text-slate-400" /> Досье
              </a>
            </div>
          </div>
        </div>

        {/* Data Table Card */}
        <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-xl shadow-slate-200/40 overflow-hidden flex flex-col">
          
          {/* Table Header Area */}
          <div className="flex items-center justify-between px-8 py-6 border-b border-slate-100 bg-slate-50/50">
            <h3 className="text-xl font-black text-slate-900 flex items-center gap-3">
              {TABS.find((tab) => tab.id === activeTab)?.label || 'Клиенты'}
            </h3>
            <span className="px-3 py-1 bg-white border border-slate-200 text-slate-600 rounded-lg text-[11px] font-black uppercase tracking-widest shadow-sm">
              {activeRows.length} записей
            </span>
          </div>

          {activeTab === 'viewed' && activeRows.length === 0 ? (
            <div className="p-24 text-center flex flex-col items-center">
              <div className="w-20 h-20 rounded-3xl bg-slate-50 flex items-center justify-center text-slate-300 shadow-inner mb-6 border border-slate-100">
                <Eye className="w-10 h-10" />
              </div>
              <h4 className="text-xl font-black text-slate-900 tracking-tight mb-2">Просмотров пока нет</h4>
              <p className="text-slate-500 font-medium max-w-sm">Они появятся здесь после включения параметра `customer_funnel_events` в боте.</p>
            </div>
          ) : activeRows.length === 0 ? (
            <div className="p-24 text-center flex flex-col items-center">
              <div className="w-20 h-20 rounded-3xl bg-slate-50 flex items-center justify-center text-slate-300 shadow-inner mb-6 border border-slate-100">
                <FileText className="w-10 h-10" />
              </div>
              <h4 className="text-xl font-black text-slate-900 tracking-tight mb-2">Ничего не найдено</h4>
              <p className="text-slate-500 font-medium">Под текущий фильтр или поиск не попало ни одной записи.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead>
                  <tr className="bg-slate-50/80 border-b border-slate-100">
                    <th className="px-8 py-5 font-black text-slate-400 uppercase tracking-widest text-[10px]">Клиент</th>
                    <th className="px-8 py-5 font-black text-slate-400 uppercase tracking-widest text-[10px]">Контекст</th>
                    <th className="px-8 py-5 font-black text-slate-400 uppercase tracking-widest text-[10px]">Статус</th>
                    <th className="px-8 py-5 font-black text-slate-400 uppercase tracking-widest text-[10px]">Причина</th>
                    <th className="px-8 py-5 font-black text-slate-400 uppercase tracking-widest text-[10px] text-right">Действия</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {activeRows.slice(0, 80).map((row) => (
                    <tr key={`${activeTab}-${row.id}`} className="hover:bg-slate-50/80 transition-colors group">
                      
                      {/* Client Col */}
                      <td className="px-8 py-6">
                        <div className="flex items-center gap-3 mb-1">
                          <div className="w-8 h-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center text-xs font-black">
                            {row.tg_username ? row.tg_username.charAt(0).toUpperCase() : <UserSquare2 className="w-4 h-4"/>}
                          </div>
                          <div>
                            <div className="font-black text-slate-900 text-base">{row.tg_username ? `@${row.tg_username}` : row.tg_user_id ? `ID: ${row.tg_user_id}` : 'Неизвестный'}</div>
                            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">
                              {row.source || row.created_at ? formatWhen(row.created_at) : ''}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Context Col */}
                      <td className="px-8 py-6">
                        <div className="font-bold text-slate-800 text-sm mb-1">{row.title || row.channel_title || '—'}</div>
                        <div className="text-[10px] font-black uppercase text-slate-400 bg-slate-100 px-2 py-0.5 rounded-md inline-block">
                          {row.channel_title || 'Без канала'}
                        </div>
                      </td>

                      {/* Status Col */}
                      <td className="px-8 py-6">
                        <div className={`inline-flex px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest border shadow-sm ${
                          row.priority >= 90 ? 'bg-amber-50 text-amber-700 border-amber-200' : 
                          row.status === 'Активен' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                          row.status === 'Истек' ? 'bg-red-50 text-red-700 border-red-200' :
                          'bg-slate-100 text-slate-600 border-slate-200'
                        }`}>
                          {row.status || '—'}
                        </div>
                      </td>

                      {/* Reason Col */}
                      <td className="px-8 py-6">
                        <div className="text-slate-600 font-medium text-sm truncate max-w-xs" title={row.reason || ''}>
                          {row.reason || '—'}
                        </div>
                      </td>

                      {/* Actions Col */}
                      <td className="px-8 py-6 text-right">
                        <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          {row.tg_user_id && (
                            <>
                              <button className="p-2.5 bg-white border border-slate-200 text-slate-400 hover:text-blue-600 hover:border-blue-200 hover:bg-blue-50 rounded-xl transition-all shadow-sm" onClick={() => openUserbotCenterHandoff(row.tg_user_id)} title="Написать (Userbot)">
                                <Send className="w-4 h-4" />
                              </button>
                              <a className="p-2.5 bg-white border border-slate-200 !text-slate-400 hover:!text-purple-600 hover:border-purple-200 hover:bg-purple-50 rounded-xl transition-all shadow-sm" href={`/app/dossier?tg=${encodeURIComponent(row.tg_user_id)}`} target="_blank" rel="noreferrer" title="Досье">
                                <Database className="w-4 h-4" />
                              </a>
                            </>
                          )}
                          <a className="p-2.5 bg-white border border-slate-200 !text-slate-400 hover:!text-slate-900 hover:bg-slate-50 hover:border-slate-300 rounded-xl transition-all shadow-sm" href={row.href || '/app/customers'} target="_blank" rel="noreferrer" title="Открыть источник">
                            <ChevronRight className="w-4 h-4" />
                          </a>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </section>
  );
}
