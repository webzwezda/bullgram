import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, Filter, X, Send, ChevronRight, Eye, Lock, Database, FileText, AlertCircle, Clock, CheckCircle2, Users } from 'lucide-react';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { supabase } from '../lib/supabase.js';
import { LoadingState } from '../ui/LoadingState.jsx';
import { StatCard } from '../ui/StatCard.jsx';

const TABS = [
  { id: 'started', label: 'Нажал старт' },
  { id: 'viewed', label: 'Смотрели тарифы' },
  { id: 'abandoned', label: 'Не смогли оплатить' },
  { id: 'customers-active', label: 'Активный доступ' },
  { id: 'customers-expired', label: 'Доступ закончился' },
  { id: 'access', label: 'Не смог войти' }
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
      label: sanitizeDemoLabel(row.label || row.title || row.channel_title || `TG ${row.tg_user_id}`)
    })),
    suggested_title: title,
    suggested_message: 'Привет. Пишу по доступу в BullRun. Если вопрос еще актуален, ответь одним сообщением.'
  }));

  window.location.href = '/app/broadcast';
}

function sanitizeDemoLabel(value) {
  return String(value || '')
    .replace(/^\[DEMO [^\]]+\]\s*/i, '')
    .trim();
}

function rowMatches(row, search) {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  return [
    row.tg_user_id,
    row.tg_username,
    row.display_name,
    row.first_name,
    row.last_name,
    row.id,
    row.title,
    row.label,
    row.channel_title,
    row.status,
    row.reason
  ].join(' ').toLowerCase().includes(needle);
}

function getClientDisplayName(row) {
  const fullName = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
  if (fullName) return sanitizeDemoLabel(fullName);
  return null;
}

function getClientInitial(row) {
  const displayName = getClientDisplayName(row);
  if (displayName) return displayName.charAt(0).toUpperCase();
  if (row.tg_username) return row.tg_username.charAt(0).toUpperCase();
  return '?';
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

function normalizeCustomersTab(searchParams) {
  const tab = searchParams.get('tab') || '';
  const segment = searchParams.get('segment') || '';

  if (tab === 'customers' && segment === 'active') return 'customers-active';
  if (tab === 'customers' && segment === 'expired') return 'customers-expired';
  if (tab === 'customers') return 'customers-active';
  if (tab === 'orders') return 'access';
  return tab;
}

function buildQuickBroadcastTitle(activeTab) {
  if (activeTab === 'started') return 'Нажал старт';
  if (activeTab === 'customers-active') return 'Активный доступ';
  if (activeTab === 'customers-expired') return 'Доступ закончился';
  if (activeTab === 'viewed') return 'Смотрели тариф, но не создали счет';
  if (activeTab === 'abandoned') return 'Не смогли оплатить';
  if (activeTab === 'access') return 'Оплатили, но вход не подтвержден';
  return 'Текущий сегмент клиентов';
}

export function CustomersPage() {
  const { accessToken, user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const normalizedTab = normalizeCustomersTab(searchParams);
  const activeTab = TABS.some((tab) => tab.id === normalizedTab) ? normalizedTab : 'viewed';
  const focusChannelId = searchParams.get('channel') || '';
  const selectedBotId = searchParams.get('bot_id') || '';
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(80);
  const [broadcastSupport, setBroadcastSupport] = useState({
    loading: false,
    userbots: []
  });
  const [quickBroadcast, setQuickBroadcast] = useState({
    open: false,
    sending: false,
    messageText: '',
    senderType: 'official_only',
    senderUserbotIds: [],
    error: ''
  });
  const quickBroadcastRef = useRef(null);
  const [handoff, setHandoff] = useState({
    abandonedFilter: '',
    orderTgUserIds: []
  });
  const [state, setState] = useState({
    loading: true,
    refreshing: false,
    error: '',
    updatedAt: null,
    bots: [],
    started: [],
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
          next.set('tab', 'access');
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
          next.set('tab', 'access');
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

    async function loadBroadcastSupport() {
      if (!accessToken || !user?.id) return;

      setBroadcastSupport((prev) => ({ ...prev, loading: true }));
      try {
        const [{ data: rawUserbots }, reserved] = await Promise.all([
          supabase
            .from('tg_accounts')
            .select('id, tg_username, tg_account_id')
            .eq('owner_id', user.id)
            .eq('account_type', 'userbot')
            .order('created_at', { ascending: false }),
          apiRequest('/api/shop/seller/reserved-assets', { accessToken })
        ]);

        if (cancelled) return;

        const reservedIds = new Set((reserved.userbot_ids || []).map(String));
        const userbots = (rawUserbots || []).filter((row) => !reservedIds.has(String(row.id)));

        setBroadcastSupport({
          loading: false,
          userbots
        });

        setQuickBroadcast((prev) => ({
          ...prev,
          senderUserbotIds: prev.senderUserbotIds.length
            ? prev.senderUserbotIds.filter((id) => userbots.some((row) => String(row.id) === String(id)))
            : userbots.map((row) => row.id)
        }));
      } catch (error) {
        if (!cancelled) {
          setBroadcastSupport({
            loading: false,
            userbots: []
          });
        }
      }
    }

    loadBroadcastSupport();
    return () => {
      cancelled = true;
    };
  }, [accessToken, user?.id]);

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
        const params = new URLSearchParams();
        if (selectedBotId) params.set('bot_id', selectedBotId);
        const data = await apiRequest(`/api/customers/workbench${params.toString() ? `?${params.toString()}` : ''}`, { accessToken });
        const segments = data.segments || {};

        if (cancelled) return;

        const botOptions = data.bots || [];
        const activeBotOptions = botOptions.filter((item) => item.status !== 'deleted');
        if (!selectedBotId && activeBotOptions.length > 0) {
          const next = new URLSearchParams(window.location.search);
          next.set('bot_id', String(activeBotOptions[0].id));
          setSearchParams(next);
          return;
        }

        setState({
          loading: false,
          refreshing: false,
          error: '',
          updatedAt: data.updatedAt || new Date().toISOString(),
          bots: botOptions,
          started: segments.startedContacts || [],
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
  }, [accessToken, selectedBotId, setSearchParams]);

  const rowsByTab = useMemo(() => ({
    started: state.started.map((row) => ({
      id: row.id,
      tg_user_id: row.tg_user_id,
      tg_username: row.tg_username,
      display_name: row.display_name,
      first_name: row.first_name,
      last_name: row.last_name,
      status: row.status || 'Нажал /start',
      reason: row.reason || 'Первое касание с ботом',
      created_at: row.created_at,
      href: '/app/customers?tab=started'
    })),
    abandoned: state.abandoned.map((row) => ({
      id: row.id,
      tg_user_id: row.tg_user_id,
      tg_username: row.tg_username,
      display_name: row.display_name,
      first_name: row.first_name,
      last_name: row.last_name,
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
      tg_username: row.tg_username,
      display_name: row.display_name,
      first_name: row.first_name,
      last_name: row.last_name,
      channel_id: row.channel_id,
      title: row.tariff_title || 'Просмотр тарифа',
      channel_title: row.channel_title || '',
      status: row.event_type,
      reason: row.source || row.referral_code || 'Без счета',
      created_at: row.created_at,
      href: '/app/customers?tab=viewed'
    })),
    'customers-active': state.crm.filter((row) => row.status === 'active').map((row) => ({
      id: row.id,
      tg_user_id: row.tg_user_id,
      channel_id: row.channel_id,
      tg_username: row.tg_username,
      display_name: row.display_name,
      first_name: row.first_name,
      last_name: row.last_name,
      channel_title: row.channel_title,
      title: row.channel_title,
      status: 'Активен',
      reason: row.in_group === true ? 'Вход подтвержден' : row.in_group === false ? 'Вход не подтвержден' : 'Присутствие неизвестно',
      expires_at: row.expires_at,
      href: '/app/customers?tab=customers-active'
    })),
    'customers-expired': state.crm.filter((row) => row.status === 'expired').map((row) => ({
      id: row.id,
      tg_user_id: row.tg_user_id,
      channel_id: row.channel_id,
      tg_username: row.tg_username,
      display_name: row.display_name,
      first_name: row.first_name,
      last_name: row.last_name,
      channel_title: row.channel_title,
      title: row.channel_title,
      status: 'Истек',
      reason: row.in_group === true ? 'Вход подтвержден' : row.in_group === false ? 'Вход не подтвержден' : 'Присутствие неизвестно',
      expires_at: row.expires_at,
      href: '/app/customers?tab=customers-expired'
    })),
    access: state.access.map((row) => ({
      id: row.id,
      tg_user_id: row.tg_user_id,
      tg_username: row.tg_username,
      display_name: row.display_name,
      first_name: row.first_name,
      last_name: row.last_name,
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
  }), [state]);

  const activeRows = useMemo(
    () => (rowsByTab[activeTab] || [])
      .filter((row) => !focusChannelId || String(row.channel_id || '') === String(focusChannelId))
      .filter((row) => activeTab !== 'abandoned' || !handoff.abandonedFilter || row.abandoned_status === handoff.abandonedFilter)
      .filter((row) => activeTab !== 'access' || handoff.orderTgUserIds.length === 0 || handoff.orderTgUserIds.includes(String(row.tg_user_id || '')))
      .filter((row) => rowMatches(row, search)),
    [activeTab, focusChannelId, handoff.abandonedFilter, handoff.orderTgUserIds, rowsByTab, search]
  );

  const stats = useMemo(() => ({
    started: state.started.length,
    viewed: state.viewed.length,
    abandoned: state.abandoned.length,
    activeCustomers: state.crm.filter((row) => row.status === 'active').length,
    expiredCustomers: state.crm.filter((row) => row.status === 'expired').length,
    access: state.access.length
  }), [state]);
  const selectedBot = useMemo(
    () => state.bots.find((item) => String(item.id) === String(selectedBotId)) || null,
    [state.bots, selectedBotId]
  );

  function setTabState(tab, extra = {}) {
    const next = new URLSearchParams();
    next.set('tab', tab);
    if (focusChannelId) next.set('channel', focusChannelId);
    if (selectedBotId) next.set('bot_id', selectedBotId);
    Object.entries(extra).forEach(([key, value]) => {
      if (value) next.set(key, value);
    });
    setSearchParams(next);
  }

  const quickBroadcastRows = useMemo(
    () => activeRows.filter((row) => row.tg_user_id),
    [activeRows]
  );

  const quickBroadcastTitle = useMemo(
    () => buildQuickBroadcastTitle(activeTab),
    [activeTab]
  );

  function openQuickBroadcast() {
    if (!quickBroadcastRows.length) {
      window.alert('В текущем сегменте нет получателей для рассылки.');
      return;
    }

    setQuickBroadcast((prev) => ({
      ...prev,
      open: true,
      error: '',
      senderType: broadcastSupport.userbots.length ? prev.senderType : 'official_only'
    }));
  }

  function closeQuickBroadcast() {
    setQuickBroadcast((prev) => ({
      ...prev,
      open: false,
      sending: false,
      error: ''
    }));
  }

  useEffect(() => {
    if (!quickBroadcast.open || !quickBroadcastRef.current) return;
    quickBroadcastRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [quickBroadcast.open]);

  function toggleQuickBroadcastUserbot(id) {
    setQuickBroadcast((prev) => {
      const next = new Set((prev.senderUserbotIds || []).map(String));
      if (next.has(String(id))) next.delete(String(id));
      else next.add(String(id));
      return {
        ...prev,
        senderUserbotIds: Array.from(next)
      };
    });
  }

  async function sendQuickBroadcast() {
    if (!quickBroadcast.messageText.trim()) {
      setQuickBroadcast((prev) => ({ ...prev, error: 'Напиши текст сообщения.' }));
      return;
    }

    if (quickBroadcast.senderType === 'official_then_userbot_pool' && quickBroadcast.senderUserbotIds.length === 0) {
      setQuickBroadcast((prev) => ({ ...prev, error: 'Выбери хотя бы одного юзербота для fallback.' }));
      return;
    }

    setQuickBroadcast((prev) => ({ ...prev, sending: true, error: '' }));
    try {
      await apiRequest('/api/broadcast/send', {
        accessToken,
        method: 'POST',
        body: {
          title: quickBroadcastTitle,
          audience_type: 'manual_list',
          manual_tg_user_ids: quickBroadcastRows.map((row) => String(row.tg_user_id)),
          manual_members: quickBroadcastRows.map((row) => ({
            tg_user_id: String(row.tg_user_id),
            username: row.tg_username || null,
            display_name: row.title || row.channel_title || null
          })),
          sender_type: quickBroadcast.senderType,
          sender_userbot_ids: quickBroadcast.senderUserbotIds,
          delay_ms: quickBroadcast.senderType === 'official_then_userbot_pool' ? 5000 : 1500,
          message_text: quickBroadcast.messageText.trim(),
          manual_confirmed_userbot_risk: quickBroadcast.senderType === 'official_then_userbot_pool'
        }
      });

      window.alert('Рассылка запущена.');
      setQuickBroadcast((prev) => ({
        ...prev,
        open: false,
        sending: false,
        error: ''
      }));
    } catch (error) {
      setQuickBroadcast((prev) => ({
        ...prev,
        sending: false,
        error: error.message
      }));
    }
  }

  if (state.loading) {
    return <LoadingState text="Собираем клиентов..." />;
  }

  return (
    <section className="page page--flush space-y-6">
      {/* Main Content Card */}
      <div className="bg-white border border-slate-200/60 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden transition-all hover:border-slate-300/60">

        {state.error && (
          <div className="p-5 rounded-2xl bg-red-50 border border-red-100 text-red-600 font-bold text-sm flex items-center gap-3 shadow-sm">
            <AlertCircle className="w-5 h-5 shrink-0" />
            {state.error}
          </div>
        )}

        {/* Metrics Section */}
        <section className="p-6 md:p-8 border-b border-slate-100">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/20 text-white shrink-0">
              <Users className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-xl font-black text-slate-900 tracking-tight">Сегменты клиентов</h3>
              <p className="text-sm text-slate-500 font-medium mt-0.5">Быстрый переход к данным</p>
            </div>
          </div>

          {/* Metrics Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
            {[
              { label: 'Активный доступ', value: stats.activeCustomers, icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-50', border: 'border-emerald-200', tab: 'customers-active' },
              { label: 'Доступ закончился', value: stats.expiredCustomers, icon: Clock, color: stats.expiredCustomers > 0 ? 'text-red-500' : 'text-slate-400', bg: stats.expiredCustomers > 0 ? 'bg-red-50' : 'bg-slate-50', border: stats.expiredCustomers > 0 ? 'border-red-200' : 'border-slate-200', tab: 'customers-expired' },
              { label: 'Оплатили, но вход не подтвержден', value: stats.access, icon: Lock, color: stats.access > 0 ? 'text-purple-500' : 'text-slate-400', bg: stats.access > 0 ? 'bg-purple-50' : 'bg-slate-50', border: stats.access > 0 ? 'border-purple-200' : 'border-slate-200', tab: 'access' },
              { label: 'Смотрели тариф, но не создали счет', value: stats.viewed, icon: Eye, color: stats.viewed > 0 ? 'text-amber-500' : 'text-slate-400', bg: stats.viewed > 0 ? 'bg-amber-50' : 'bg-slate-50', border: stats.viewed > 0 ? 'border-amber-200' : 'border-slate-200', tab: 'viewed' },
              { label: 'Не смогли оплатить', value: stats.abandoned, icon: FileText, color: stats.abandoned > 0 ? 'text-blue-500' : 'text-slate-400', bg: stats.abandoned > 0 ? 'bg-blue-50' : 'bg-slate-50', border: stats.abandoned > 0 ? 'border-blue-200' : 'border-slate-200', tab: 'abandoned' },
            ].map((item, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => setTabState(item.tab)}
                className={`${item.bg} ${item.border} border p-4 rounded-2xl text-left transition-all hover:border-slate-300 hover:shadow-sm`}
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">{item.label}</span>
                  <item.icon className={`w-4 h-4 ${item.color} opacity-70`} />
                </div>
                <div className={`text-2xl font-black tracking-tight ${item.color}`}>{item.value}</div>
              </button>
            ))}
          </div>
        </section>

        {/* Filter & Search Section */}
        <section className="p-6 md:p-8 bg-slate-50/50">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/20 text-white shrink-0">
              <Filter className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-xl font-black text-slate-900 tracking-tight">Фильтры и поиск</h3>
              <p className="text-sm text-slate-500 font-medium mt-0.5">Выберите сегмент клиентов</p>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-2 p-1.5 bg-slate-100 rounded-2xl overflow-x-auto mb-4">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`shrink-0 px-5 py-2 text-xs font-black uppercase tracking-wider rounded-xl transition-all ${
                  activeTab === tab.id
                    ? 'bg-white text-blue-600 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
                onClick={() => setTabState(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Search & Actions */}
          <div className="flex flex-col md:flex-row items-center gap-4">
            <div className="relative flex-1 w-full">
              <input
                className="w-full pl-12 pr-6 py-3.5 bg-white border border-slate-200 rounded-xl text-slate-900 font-bold focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm text-sm"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Поиск по TG ID, @username, тарифу..."
              />
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-300" />
            </div>
            <div className="w-full md:w-[280px] shrink-0">
              <select
                className="w-full px-4 py-3.5 bg-white border border-slate-200 rounded-xl text-slate-900 font-bold focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm text-sm"
                value={selectedBotId}
                onChange={(event) => {
                  const next = new URLSearchParams(window.location.search);
                  if (event.target.value) next.set('bot_id', event.target.value);
                  else next.delete('bot_id');
                  setSearchParams(next);
                }}
              >
                <option value="">Все боты</option>
                {state.bots.map((bot) => (
                  <option key={bot.id} value={bot.id}>
                    {bot.label}{bot.status === 'deleted' ? ' • удален' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2 w-full md:w-auto shrink-0">
              <a className="flex-1 md:flex-none px-6 py-3.5 bg-white border border-slate-200 text-slate-700 rounded-xl text-sm font-bold shadow-sm hover:bg-slate-50 transition-all flex items-center justify-center gap-2" href="/app/dossier" target="_blank" rel="noreferrer">
                <Database className="w-4 h-4 text-slate-400" /> Досье
              </a>
            </div>
          </div>
        </section>

        {/* Data Table Card */}
        <div className="overflow-hidden flex flex-col">

          {/* Table Header Area */}
          <div className="flex items-center justify-between px-8 py-6 border-b border-slate-100 bg-slate-50/30">
            <h3 className="text-xl font-black text-slate-900 flex items-center gap-3">
              {TABS.find((tab) => tab.id === activeTab)?.label || 'Клиенты'}
            </h3>
            <span className="px-4 py-1.5 bg-slate-50 text-slate-600 rounded-xl text-xs font-black uppercase tracking-wider border border-slate-100">
              {activeRows.length} записей
            </span>
          </div>

          {activeTab === 'viewed' && activeRows.length === 0 ? (
            <div className="p-16 text-center flex flex-col items-center">
              <div className="w-16 h-16 rounded-2xl bg-amber-50 flex items-center justify-center text-amber-400 shadow-inner mb-4 border border-amber-100">
                <Eye className="w-8 h-8" />
              </div>
              <h4 className="text-lg font-black text-slate-900 tracking-tight mb-2">Просмотров пока нет</h4>
              <p className="text-slate-500 font-medium text-sm max-w-sm mb-4">Включите параметр <code className="px-1.5 py-0.5 bg-slate-100 rounded text-amber-600">customer_funnel_events</code> в боте для отслеживания.</p>
            </div>
          ) : activeRows.length === 0 ? (
            <div className="p-16 text-center flex flex-col items-center">
              <div className="w-16 h-16 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-300 shadow-inner mb-4 border border-slate-100">
                <FileText className="w-8 h-8" />
              </div>
              <h4 className="text-lg font-black text-slate-900 tracking-tight mb-2">Ничего не найдено</h4>
              <p className="text-slate-500 font-medium text-sm">Попробуйте изменить фильтры или поиск</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="bg-slate-50/80 border-b border-slate-100">
                      <th className="px-6 py-4 font-black text-slate-400 uppercase tracking-widest text-[10px]">Клиент</th>
                      <th className="px-6 py-4 font-black text-slate-400 uppercase tracking-widest text-[10px] hidden md:table-cell">Контекст</th>
                      <th className="px-6 py-4 font-black text-slate-400 uppercase tracking-widest text-[10px]">Статус</th>
                      <th className="px-6 py-4 font-black text-slate-400 uppercase tracking-widest text-[10px] hidden lg:table-cell">Причина</th>
                      <th className="px-6 py-4 font-black text-slate-400 uppercase tracking-widest text-[10px] text-right">Действия</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {activeRows.slice(0, limit).map((row) => {
                      const statusConfig = (() => {
                        if (row.priority >= 90) return { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', icon: AlertCircle };
                        if (row.status === 'Активен') return { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', icon: CheckCircle2 };
                        if (row.status === 'Истек') return { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', icon: Clock };
                        return { bg: 'bg-slate-100', text: 'text-slate-600', border: 'border-slate-200', icon: null };
                      })();

                      const StatusIcon = statusConfig.icon;

                      return (
                        <tr key={`${activeTab}-${row.id}`} className="hover:bg-slate-50/80 transition-colors">

                          {/* Client Col */}
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center text-xs font-black shrink-0">
                                {getClientInitial(row)}
                              </div>
                              <div className="min-w-0">
                                <div className="font-black text-slate-900 text-sm truncate">
                                  {getClientDisplayName(row) || (row.tg_username ? `@${row.tg_username}` : row.tg_user_id ? `ID: ${row.tg_user_id}` : 'Неизвестный')}
                                </div>
                                {row.tg_user_id ? (
                                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">
                                    ID: {row.tg_user_id}
                                  </div>
                                ) : null}
                                {row.tg_username ? (
                                  <div className="text-xs font-semibold text-slate-500 truncate">
                                    @{row.tg_username}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </td>

                          {/* Context Col */}
                          <td className="px-6 py-4 hidden md:table-cell">
                            <div className="font-bold text-slate-800 text-sm mb-1 truncate">{sanitizeDemoLabel(row.title || row.channel_title || '—')}</div>
                            {row.channel_title && (
                              <div className="text-[10px] font-black uppercase text-slate-400 bg-slate-100 px-2 py-0.5 rounded-md inline-block">
                                {sanitizeDemoLabel(row.channel_title)}
                              </div>
                            )}
                          </td>

                          {/* Status Col */}
                          <td className="px-6 py-4">
                            <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest border shadow-sm ${statusConfig.bg} ${statusConfig.text} ${statusConfig.border}`}>
                              {StatusIcon && <StatusIcon className="w-3 h-3" />}
                              {row.status || '—'}
                            </div>
                          </td>

                          {/* Reason Col */}
                          <td className="px-6 py-4 hidden lg:table-cell">
                            <div className="text-slate-600 font-medium text-sm truncate max-w-xs" title={row.reason || ''}>
                              {row.reason || '—'}
                            </div>
                          </td>

                          {/* Actions Col */}
                          <td className="px-6 py-4 text-right">
                            <div className="flex justify-end gap-2">
                              {row.tg_user_id && (
                                <>
                                  <button className="p-2 bg-white border border-slate-200 text-slate-400 hover:text-blue-600 hover:border-blue-200 hover:bg-blue-50 rounded-lg transition-all shadow-sm" onClick={() => openUserbotCenterHandoff(row.tg_user_id)} title="Написать">
                                    <Send className="w-3.5 h-3.5" />
                                  </button>
                                  <a className="p-2 bg-white border border-slate-200 text-slate-400 hover:text-purple-600 hover:border-purple-200 hover:bg-purple-50 rounded-lg transition-all shadow-sm" href={`/app/dossier?tg=${encodeURIComponent(row.tg_user_id)}`} target="_blank" rel="noreferrer" title="Досье">
                                    <Database className="w-3.5 h-3.5" />
                                  </a>
                                </>
                              )}
                              <a className="p-2 bg-white border border-slate-200 text-slate-400 hover:text-slate-900 hover:bg-slate-50 hover:border-slate-300 rounded-lg transition-all shadow-sm" href={row.href || '/app/customers'} target="_blank" rel="noreferrer" title="Открыть источник">
                                <ChevronRight className="w-3.5 h-3.5" />
                              </a>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="px-8 py-4 border-t border-slate-100 bg-slate-50/30 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="flex-1">
                  {activeRows.length > limit ? (
                    <button
                      className="w-full md:w-auto px-6 py-3 bg-white border border-slate-200 text-slate-700 rounded-xl text-sm font-bold shadow-sm hover:bg-slate-50 hover:border-slate-300 transition-all flex items-center justify-center gap-2"
                      onClick={() => setLimit((prev) => prev + 80)}
                    >
                      Показать еще {Math.min(80, activeRows.length - limit)} из {activeRows.length - limit}
                    </button>
                  ) : null}
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    className="w-full md:w-auto px-6 py-3 bg-blue-600 text-white rounded-xl text-sm font-bold shadow-md shadow-blue-500/20 hover:bg-blue-700 transition-all flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                    onClick={openQuickBroadcast}
                    disabled={!quickBroadcastRows.length}
                  >
                    <Send className="w-4 h-4" />
                    Рассылка по выбранному фильтру
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

      </div>

      {quickBroadcast.open && (
        <div ref={quickBroadcastRef} className="mt-6 bg-white border border-slate-100 rounded-[2rem] shadow-sm overflow-hidden">
          <div className="px-8 py-6 border-b border-slate-100 flex items-center justify-between gap-4">
            <div>
              <div className="text-xs font-black uppercase tracking-widest text-slate-400 mb-2">Быстрая рассылка</div>
              <div className="text-2xl font-black tracking-tight text-slate-900">{quickBroadcastTitle}</div>
            </div>
            <button
              type="button"
              className="p-2 rounded-xl border border-slate-200 text-slate-400 hover:text-slate-700 hover:bg-slate-50 transition-all"
              onClick={closeQuickBroadcast}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-8 space-y-8">
            {quickBroadcast.error ? (
              <div className="p-4 rounded-2xl bg-red-50 border border-red-100 text-red-600 text-sm font-bold">
                {quickBroadcast.error}
              </div>
            ) : null}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-slate-50/70 border border-slate-100 rounded-2xl p-5">
                <div className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-2">Получатели</div>
                <div className="text-lg font-black text-slate-900">{quickBroadcastRows.length}</div>
              </div>
              <div className="bg-slate-50/70 border border-slate-100 rounded-2xl p-5">
                <div className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-2">Режим</div>
                <div className="text-sm font-black text-slate-900">
                  {quickBroadcast.senderType === 'official_then_userbot_pool'
                    ? 'Официальный бот -> fallback юзербот'
                    : 'Только официальный бот'}
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="text-xs font-black uppercase tracking-widest text-slate-400">Кто пишет людям</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <button
                  type="button"
                  className={`p-5 rounded-2xl border text-left transition-all ${quickBroadcast.senderType === 'official_only' ? 'border-blue-200 bg-blue-50/70' : 'border-slate-200 bg-white'}`}
                  onClick={() => setQuickBroadcast((prev) => ({ ...prev, senderType: 'official_only', error: '' }))}
                >
                  <div className="font-black text-slate-900 mb-1">Только официальный бот</div>
                  <div className="text-sm text-slate-500">Безопасный режим для массового возврата.</div>
                </button>
                <button
                  type="button"
                  disabled={!broadcastSupport.userbots.length}
                  className={`p-5 rounded-2xl border text-left transition-all ${quickBroadcast.senderType === 'official_then_userbot_pool' ? 'border-purple-200 bg-purple-50/70' : 'border-slate-200 bg-white'} ${!broadcastSupport.userbots.length ? 'opacity-50 cursor-not-allowed' : ''}`}
                  onClick={() => {
                    if (!broadcastSupport.userbots.length) return;
                    setQuickBroadcast((prev) => ({ ...prev, senderType: 'official_then_userbot_pool', error: '' }));
                  }}
                >
                  <div className="font-black text-slate-900 mb-1">Официальный бот, потом юзербот</div>
                  <div className="text-sm text-slate-500">Сначала safe-контур, затем fallback по тем, кто не доставился.</div>
                </button>
              </div>
            </div>

            {quickBroadcast.senderType === 'official_then_userbot_pool' ? (
              <div className="space-y-3">
                <div className="text-xs font-black uppercase tracking-widest text-slate-400">Юзерботы для fallback</div>
                <div className="space-y-2 max-h-56 overflow-y-auto">
                  {broadcastSupport.userbots.map((row) => (
                    <label key={row.id} className="flex items-center justify-between gap-4 p-4 rounded-2xl border border-slate-100 bg-slate-50/60 cursor-pointer">
                      <div>
                        <div className="font-black text-slate-900">@{row.tg_username || row.tg_account_id}</div>
                        <div className="text-xs text-slate-500">Использовать только если официальный бот не достучался.</div>
                      </div>
                      <input
                        type="checkbox"
                        checked={quickBroadcast.senderUserbotIds.map(String).includes(String(row.id))}
                        onChange={() => toggleQuickBroadcastUserbot(row.id)}
                      />
                    </label>
                  ))}
                </div>
                <div className="text-xs text-amber-700 font-bold">
                  Рискованный режим: Telegram может ограничить sender-аккаунт. Включай только для теплого хвоста.
                </div>
              </div>
            ) : null}

            <div className="space-y-3">
              <div className="text-xs font-black uppercase tracking-widest text-slate-400">Сообщение</div>
              <textarea
                className="w-full min-h-[180px] px-5 py-4 bg-slate-50 border border-slate-100 rounded-2xl text-slate-900 font-medium focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all shadow-inner resize-y"
                value={quickBroadcast.messageText}
                onChange={(event) => setQuickBroadcast((prev) => ({ ...prev, messageText: event.target.value, error: '' }))}
                placeholder="Напиши сообщение для возврата или дожима."
              />
            </div>

            <div className="space-y-3">
              <div className="text-xs font-black uppercase tracking-widest text-slate-400">Первые получатели</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {quickBroadcastRows.slice(0, 6).map((row) => (
                  <div key={`quick-broadcast-${row.id}`} className="px-4 py-3 rounded-2xl border border-slate-100 bg-slate-50/60">
                    <div className="font-black text-slate-900 text-sm">{row.tg_username ? `@${row.tg_username}` : `ID: ${row.tg_user_id}`}</div>
                    <div className="text-xs text-slate-500 truncate">{sanitizeDemoLabel(row.title || row.channel_title || 'Без контекста')}</div>
                  </div>
                ))}
              </div>
              {quickBroadcastRows.length > 6 ? (
                <div className="text-xs text-slate-500 font-bold">И еще {quickBroadcastRows.length - 6}</div>
              ) : null}
            </div>
          </div>

          <div className="px-8 py-6 border-t border-slate-100 bg-slate-50/40 flex flex-col-reverse md:flex-row md:items-center md:justify-between gap-3">
            <button
              type="button"
              className="px-6 py-3 bg-white border border-slate-200 text-slate-700 rounded-2xl text-sm font-bold shadow-sm hover:bg-slate-50 transition-all"
              onClick={() => openBroadcastManualSelection(quickBroadcastRows, quickBroadcastTitle)}
            >
              Открыть полную рассылку
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                className="px-6 py-3 bg-white border border-slate-200 text-slate-700 rounded-2xl text-sm font-bold shadow-sm hover:bg-slate-50 transition-all"
                onClick={closeQuickBroadcast}
              >
                Скрыть
              </button>
              <button
                type="button"
                className="px-6 py-3 bg-blue-600 text-white rounded-2xl text-sm font-bold shadow-md shadow-blue-500/20 hover:bg-blue-700 transition-all"
                onClick={sendQuickBroadcast}
                disabled={quickBroadcast.sending || !quickBroadcastRows.length}
              >
                {quickBroadcast.sending ? 'Отправляем...' : 'Отправить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
