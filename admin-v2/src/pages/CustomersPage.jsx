import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { LoadingState } from '../ui/LoadingState.jsx';
import { AudienceTable } from './customers/components/AudienceTable.jsx';
import { CustomersHeader } from './customers/sections/CustomersHeader.jsx';
import { CustomersTable } from './customers/sections/CustomersTable.jsx';
import { useCustomersData } from './customers/hooks/useCustomersData.js';
import { useCustomersActions } from './customers/hooks/useCustomersActions.js';
import {
  TABS,
  BOT_SUBTABS,
  CAPS_KEY_BY_SUBTAB,
  normalizeCustomersTab,
  rowMatches,
  closeAllRowMenus,
  getViewedEventLabel,
  getCustomerReason,
  appendAccessSource
} from './customers/utils/customersRows.js';

export function CustomersPage() {
  const { accessToken } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  // Без tab в URL — дефолтимся на «Официальный бот»: иначе '' даёт isBotTab=false
  // (нет под-сегментов, нет строк) и «эффективная» вкладка не матчится с под-сегментами.
  const normalizedTab = normalizeCustomersTab(searchParams) || 'bot';
  const isAudienceTab = normalizedTab.startsWith('audience-');
  const isBotTab = normalizedTab === 'bot' || BOT_SUBTABS.some((s) => s.id === normalizedTab);
  const activeTab = TABS.some((tab) => tab.id === normalizedTab) ? normalizedTab
    : isBotTab ? 'bot'
    : 'bot';
  const activeBotSubtab = isBotTab && normalizedTab !== 'bot'
    ? normalizedTab
    : (isBotTab ? (searchParams.get('subtab') || 'started') : 'started');
  const focusChannelId = searchParams.get('channel') || '';
  const selectedBotId = searchParams.get('bot_id') || '';
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(80);
  const [mutatingRowId, setMutatingRowId] = useState(null);
  const [botAnalytics, setBotAnalytics] = useState({ loading: false, error: '', data: null });
  const [moneyPeriod, setMoneyPeriod] = useState('all');
  const [state, setState] = useState({
    loading: true,
    error: '',
    updatedAt: null,
    bots: [],
    channels: [],
    started: [],
    crm: [],
    viewed: [],
    invoiceCreated: [],
    caps: null
  });
  const [audienceState, setAudienceState] = useState({
    loading: false,
    contourId: null,
    targets: [],
    syncingType: null,
    error: ''
  });
  const { loadCustomers, syncAudience } = useCustomersData({
    accessToken,
    selectedBotId,
    setSearchParams,
    moneyPeriod,
    setMoneyPeriod,
    state,
    setState,
    botAnalytics,
    setBotAnalytics,
    audienceState,
    setAudienceState
  });
  const { runSubscriptionAction } = useCustomersActions({
    accessToken,
    selectedBotId,
    state,
    loadCustomers,
    setMutatingRowId
  });

  const rowsByTab = useMemo(() => ({
    started: state.started.map((row) => ({
      id: row.id,
      tg_user_id: row.tg_user_id,
      tg_username: row.tg_username,
      display_name: row.display_name,
      first_name: row.first_name,
      last_name: row.last_name,
      status: row.status || 'Нажал /start',
      reason: 'Первое касание с ботом',
      created_at: row.created_at,
      href: '/paywall/customers?tab=started'
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
      status: getViewedEventLabel(row.event_type),
      reason: 'Счет еще не создан',
      created_at: row.created_at,
      href: '/paywall/customers?tab=viewed'
    })),
    'invoice-created': state.invoiceCreated
      .map((row) => ({
        id: row.id,
        tg_user_id: row.tg_user_id,
        tg_username: row.tg_username,
        display_name: row.display_name,
        first_name: row.first_name,
        last_name: row.last_name,
        channel_id: row.channel_id,
        title: row.tariff_title || 'Счет',
        channel_title: row.channel_title || '',
        status: 'Создал счет',
        reason: 'Счет создан — ждем оплату',
        created_at: row.created_at,
        href: '/paywall/customers?tab=invoice-created'
      })),
    'customers-active': state.crm.filter((row) => row.status === 'active').map((row) => ({
      id: row.id,
      _crmSubscription: true,
      tg_user_id: row.tg_user_id,
      channel_id: row.channel_id,
      tg_username: row.tg_username,
      display_name: row.display_name,
      first_name: row.first_name,
      last_name: row.last_name,
      channel_title: row.channel_title,
      title: row.channel_title,
      status: 'Доступ активен',
      reason: appendAccessSource(getCustomerReason(row), row.access_source_label),
      expires_at: row.expires_at,
      href: '/paywall/customers?tab=customers-active'
    })),
    'customers-expired': state.crm.filter((row) => row.status === 'expired').map((row) => ({
      id: row.id,
      _crmSubscription: true,
      tg_user_id: row.tg_user_id,
      channel_id: row.channel_id,
      tg_username: row.tg_username,
      display_name: row.display_name,
      first_name: row.first_name,
      last_name: row.last_name,
      channel_title: row.channel_title,
      title: row.channel_title,
      status: 'Доступ закончился',
      reason: appendAccessSource(getCustomerReason(row), row.access_source_label),
      expires_at: row.expires_at,
      href: '/paywall/customers?tab=customers-expired'
    }))
  }), [state]);

  const audienceTargetType = isAudienceTab ? activeTab.replace('audience-', '').replace(/-/g, '_') : null;
  const currentAudienceTarget = isAudienceTab
    ? audienceState.targets.find((t) => t.targetType === audienceTargetType)
    : null;

  const effectiveTab = isBotTab ? activeBotSubtab : activeTab;
  // Счётчики по под-сегментам для бейджей в полосе вкладок.
  const subtabCounts = useMemo(() => Object.fromEntries(
    BOT_SUBTABS.map((sub) => [sub.id, (rowsByTab[sub.id] || []).length])
  ), [rowsByTab]);

  const activeRows = useMemo(
    () => (rowsByTab[effectiveTab] || [])
      .filter((row) => !focusChannelId || String(row.channel_id || '') === String(focusChannelId))
      .filter((row) => rowMatches(row, search)),
    [effectiveTab, focusChannelId, rowsByTab, search]
  );

  // Честные капы: если бэкенд прислал caps — выборка упёрлась в лимит и все счётчики
  // нижняя граница («+»). Для отфильтрованного вида (поиск/канал) капы не применяем:
  // total посчитан без фильтра, подпись начинала бы врать.
  const isRowViewFiltered = search.trim().length > 0 || !!focusChannelId;
  const activeCaps = !isRowViewFiltered && state.caps
    ? (state.caps[CAPS_KEY_BY_SUBTAB[effectiveTab]] || null)
    : null;
  const subscriptionCaps = state.caps?.subscriptions || null;

  const stats = useMemo(() => ({
    started: state.started.length,
    activeCustomers: state.crm.filter((row) => row.status === 'active').length,
    expiredCustomers: state.crm.filter((row) => row.status === 'expired').length
  }), [state]);

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

  function setBotSubtab(subtab) {
    const next = new URLSearchParams(searchParams);
    next.set('tab', 'bot');
    next.set('subtab', subtab);
    setSearchParams(next);
  }

  const crmMap = useMemo(
    () => {
      const map = new Map();
      for (const row of state.crm) {
        if (row.tg_user_id) map.set(String(row.tg_user_id), row);
      }
      return map;
    },
    [state.crm]
  );

  // Открытие/закрытие меню действий — нативный popover: light-dismiss и Esc
  // обрабатывает браузер. Страховка на смену вкладки/бота: при back/forward
  // строка может быть переиспользована React по совпавшему ключу, и открытое
  // меню оказалось бы переанкорено на чужую строку.
  useEffect(() => {
    closeAllRowMenus();
  }, [activeTab, activeBotSubtab, focusChannelId, selectedBotId]);

  if (state.loading) {
    return <LoadingState text="Собираем клиентов..." />;
  }

  return (
    <section className="page page--flush space-y-6">
      {/* Main Content Card */}
      <div className="bg-white border border-border-default/60 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden transition-all hover:border-border-strong/60">

        {state.error && (
          <div className="p-5 rounded-2xl bg-feedback-error-bg border border-red-100 text-red-600 font-bold text-sm flex items-center gap-3 shadow-sm">
            <AlertCircle className="w-5 h-5 shrink-0" />
            {state.error}
          </div>
        )}
        {/* Metrics + Filters */}
        <CustomersHeader
          state={state}
          stats={stats}
          subscriptionCaps={subscriptionCaps}
          selectedBotId={selectedBotId}
          moneyPeriod={moneyPeriod}
          setMoneyPeriod={setMoneyPeriod}
          botAnalytics={botAnalytics}
          activeTab={activeTab}
          audienceState={audienceState}
          setTabState={setTabState}
          setSearchParams={setSearchParams}
          search={search}
          setSearch={setSearch}
        />
        {/* Data Table Card */}
        <div className="border-t border-border-default/60">
        {isAudienceTab ? (
          <>
            {audienceState.error && (
              <div className="p-5 rounded-2xl bg-feedback-error-bg border border-red-100 text-red-600 font-bold text-sm flex items-center gap-3 shadow-sm">
                <AlertCircle className="w-5 h-5 shrink-0" />
                {audienceState.error}
              </div>
            )}
            <AudienceTable
              target={currentAudienceTarget}
              syncingType={audienceState.syncingType}
              onSync={syncAudience}
              crmMap={crmMap}
              onAction={runSubscriptionAction}
              mutatingRowId={mutatingRowId}
            />
          </>
        ) : (
        <CustomersTable
          state={state}
          isBotTab={isBotTab}
          activeBotSubtab={activeBotSubtab}
          setBotSubtab={setBotSubtab}
          subtabCounts={subtabCounts}
          activeTab={activeTab}
          effectiveTab={effectiveTab}
          activeRows={activeRows}
          activeCaps={activeCaps}
          search={search}
          limit={limit}
          setLimit={setLimit}
          mutatingRowId={mutatingRowId}
          runSubscriptionAction={runSubscriptionAction}
        />
        )}

        </div>
      </div>
    </section>
  );
}
