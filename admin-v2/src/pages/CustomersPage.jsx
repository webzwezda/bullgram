import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, Filter, Send, ChevronRight, Eye, Lock, Database, FileText, AlertCircle, Clock, CheckCircle2, MoreHorizontal, RefreshCw, Users, Megaphone, MessageCircle } from 'lucide-react';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { LoadingState } from '../ui/LoadingState.jsx';
import { toast } from 'sonner';

function formatTon(amount) {
  const n = Number(amount || 0);
  return `${n.toFixed(2)} TON`;
}

const TABS = [
  { id: 'bot', label: 'Официальный бот', icon: Database },
  { id: 'audience-paid-channel', label: 'Платный канал', icon: Users },
  { id: 'audience-paid-chat', label: 'Платный чат', icon: Lock },
  { id: 'audience-public-channel', label: 'Открытый канал', icon: Eye },
  { id: 'audience-public-chat', label: 'Открытый чат', icon: MessageCircle }
];

function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

const BOT_SUBTABS = [
  { id: 'started', label: 'Нажал старт', empty: { title: 'Никто ещё не нажал /start', text: 'Здесь появятся все, кто начал бота.' } },
  { id: 'viewed', label: 'Смотрели тарифы', empty: { title: 'Просмотров тарифов нет', text: 'Здесь появятся клиенты, открывшие тарифы в боте.' } },
  { id: 'invoice-created', label: 'Создали счет', empty: { title: 'Счетов еще нет', text: 'Здесь появятся клиенты, дошедшие до создания счета.' } },
  { id: 'customers-active', label: 'Активный доступ', empty: { title: 'Активных подписок нет', text: 'Здесь появятся клиенты с оплаченным доступом.' } },
  { id: 'customers-expired', label: 'Доступ закончился', empty: { title: 'Истёкших подписок нет', text: 'Здесь появятся клиенты с закончившимся доступом.' } }
];

const USERBOT_CENTER_HANDOFF_KEY = 'bullgram_userbot_center_handoff';

// caps из ответа workbench: какой ключ капа относится к какой под-вкладке бота.
// Все бот-воронки (start/viewed/invoice_created) — funnel-события; клиенты — подписки.
const CAPS_KEY_BY_SUBTAB = {
  started: 'funnel',
  viewed: 'funnel',
  'invoice-created': 'funnel',
  'customers-active': 'subscriptions',
  'customers-expired': 'subscriptions'
};

const VIEWED_EVENT_LABELS = {
  tariff_list_opened: 'Открыл тарифы',
  tariff_card_opened: 'Открыл тариф',
  payment_method_selected: 'Выбрал оплату',
  invoice_created: 'Создал счет',
  bot_started: 'Нажал /start'
};

// Нативный Popover API: light-dismiss, Esc и top-layer (не клиппится overflow'ом
// таблицы) делает браузер; позиционирование — anchor через popovertarget-инвокер.
const ROW_MENU_STYLE = {
  inset: 'auto',
  positionArea: 'block-end span-inline-start',
  positionTryFallbacks: 'flip-block, flip-inline',
  justifySelf: 'end',
  alignSelf: 'start',
  marginBlockStart: '8px'
};

function closeAllRowMenus() {
  for (const el of document.querySelectorAll('[popover]')) {
    try { el.hidePopover(); } catch { /* уже закрыт */ }
  }
}

function AudienceTable({ target, syncingType, onSync, crmMap, onAction, mutatingRowId }) {
  if (!target) {
    return (
      <div className="p-16 text-center flex flex-col items-center">
        <div className="w-16 h-16 rounded-2xl bg-surface-subtle flex items-center justify-center text-slate-300 shadow-inner mb-4 border border-slate-100">
          <Users className="w-8 h-8" />
        </div>
        <h4 className="text-lg font-black text-ink-strong tracking-tight mb-2">Группа не подключена</h4>
        <p className="text-ink-muted font-medium text-sm">Добавьте эту группу в контуре продаж на экране «Бот продаж»</p>
      </div>
    );
  }

  const members = target.members || [];
  const targetType = target.targetType;
  const isPaid = targetType === 'paid_channel' || targetType === 'paid_chat';
  const channelId = target.channelId;

  let paidCount = 0;
  let freeCount = 0;
  let expiredCount = 0;
  let enrichedRows = members;

  if (isPaid) {
    enrichedRows = members.map((m) => {
      const crm = crmMap.get(String(m.tg_user_id));
      let paymentStatus = 'free';
      if (crm?.status === 'active') { paymentStatus = 'paid'; paidCount++; }
      else if (crm?.status === 'expired') { paymentStatus = 'expired'; expiredCount++; }
      else { freeCount++; }
      return { ...m, crm, paymentStatus };
    });
  }

  return (
    <div className="overflow-hidden flex flex-col">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between px-8 py-6 border-b border-slate-100 bg-surface-subtle/30 gap-3">
        <div>
          <h3 className="text-xl font-black text-ink-strong">{target.channelTitle || TABS.find(t => t.id === `audience-${targetType}`)?.label || 'Группа'}</h3>
          <div className="text-sm text-ink-muted mt-0.5 flex flex-wrap gap-x-3">
            <span>{target.totalMembers} {plural(target.totalMembers, 'участник', 'участника', 'участников')}</span>
            {isPaid && paidCount > 0 && <span className="text-emerald-600">{paidCount} оплачено</span>}
            {isPaid && expiredCount > 0 && <span className="text-amber-600">{expiredCount} просрочено</span>}
            {isPaid && freeCount > 0 && <span className="text-red-500">{freeCount} без оплаты</span>}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => onSync(targetType)}
            disabled={!!syncingType}
            className="flex items-center gap-2 px-4 py-2.5 bg-white border border-border-default rounded-xl text-sm font-bold text-ink-body shadow-sm hover:bg-surface-subtle transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${syncingType === targetType ? 'animate-spin' : ''}`} />
            {syncingType === targetType ? 'Загружаем...' : 'Обновить список'}
          </button>
          {target.baseId && (
            <a
              href={`/app/broadcast?baseId=${target.baseId}`}
              className="flex items-center gap-2 px-4 py-2.5 bg-action-primary !text-action-primary-text rounded-xl text-sm font-bold shadow-md shadow-indigo-200 hover:bg-action-primary-hover transition-all"
            >
              <Megaphone className="w-4 h-4" />
              Рассылка
            </a>
          )}
        </div>
      </div>

      {!target.baseId ? (
        <div className="p-16 text-center flex flex-col items-center">
          <div className="w-16 h-16 rounded-2xl bg-surface-subtle flex items-center justify-center text-slate-300 shadow-inner mb-4 border border-slate-100">
            <Users className="w-8 h-8" />
          </div>
          <h4 className="text-lg font-black text-ink-strong tracking-tight mb-2">Участники еще не загружены</h4>
          <p className="text-ink-muted font-medium text-sm">Нажмите «Обновить список» чтобы загрузить участников из Telegram</p>
        </div>
      ) : members.length === 0 ? (
        <div className="p-16 text-center flex flex-col items-center">
          <div className="w-16 h-16 rounded-2xl bg-surface-subtle flex items-center justify-center text-slate-300 shadow-inner mb-4 border border-slate-100">
            <Users className="w-8 h-8" />
          </div>
          <h4 className="text-lg font-black text-ink-strong tracking-tight mb-2">Пусто</h4>
          <p className="text-ink-muted font-medium text-sm">В этой группе пока нет участников</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="bg-surface-subtle/80 border-b border-slate-100">
                <th className="px-6 py-4 font-black text-ink-muted uppercase tracking-widest text-[10px]">Имя</th>
                <th className="px-6 py-4 font-black text-ink-muted uppercase tracking-widest text-[10px] hidden md:table-cell">Username</th>
                <th className="px-6 py-4 font-black text-ink-muted uppercase tracking-widest text-[10px] hidden lg:table-cell">TG ID</th>
                {!isPaid && <th className="px-6 py-4 font-black text-ink-muted uppercase tracking-widest text-[10px]">Приватка</th>}
                {isPaid && (
                  <>
                    <th className="px-6 py-4 font-black text-ink-muted uppercase tracking-widest text-[10px]">Оплата</th>
                    <th className="px-6 py-4 font-black text-ink-muted uppercase tracking-widest text-[10px]">Доступ до</th>
                  </>
                )}
                <th className="px-6 py-4 font-black text-ink-muted uppercase tracking-widest text-[10px] text-right">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {enrichedRows.slice(0, 100).map((row) => {
                const rowId = row.tg_user_id;
                const actionRow = {
                  tg_user_id: String(row.tg_user_id),
                  tg_username: row.username,
                  display_name: row.display_name,
                  first_name: row.first_name,
                  last_name: row.last_name,
                  channel_id: channelId,
                  channel_title: target.channelTitle,
                  id: row.crm?.id || null,
                  _crmSubscription: !!row.crm?.id
                };
                const nameCell = (
                  <td className="px-6 py-4">
                    <div className="font-black text-ink-strong text-sm truncate">
                      {row.display_name || row.first_name || (row.username ? `@${row.username}` : 'Неизвестный')}
                    </div>
                  </td>
                );
                const usernameCell = (
                  <td className="px-6 py-4 hidden md:table-cell">
                    {row.username ? <span className="text-xs font-semibold text-ink-muted">@{row.username}</span> : <span className="text-slate-300">—</span>}
                  </td>
                );
                const idCell = (
                  <td className="px-6 py-4 hidden lg:table-cell">
                    {row.tg_user_id
                      ? <span className="font-mono text-xs text-ink-muted">{row.tg_user_id}</span>
                      : <span className="text-slate-300">—</span>}
                  </td>
                );
                // Для открытых групп: есть ли этот человек в платной приватке
                const crmRow = crmMap.get(String(row.tg_user_id));
                const privateCell = (
                  <td className="px-6 py-4">
                    {crmRow?.status === 'active' ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-lg bg-feedback-success-bg text-emerald-600 ring-1 ring-emerald-200">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        Активна
                      </span>
                    ) : crmRow?.status === 'expired' ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-lg bg-feedback-warning-bg text-amber-600 ring-1 ring-amber-200">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                        Истекла
                      </span>
                    ) : (
                      <span className="text-slate-300 text-sm">—</span>
                    )}
                  </td>
                );
                if (isPaid) {
                  const ps = row.paymentStatus;
                  const statusStyles = ps === 'paid'
                    ? 'bg-feedback-success-bg text-emerald-600 ring-1 ring-emerald-200'
                    : ps === 'expired'
                      ? 'bg-feedback-warning-bg text-amber-600 ring-1 ring-amber-200'
                      : 'bg-feedback-error-bg text-red-600 ring-1 ring-red-200';
                  const statusLabel = ps === 'paid' ? 'Оплачено' : ps === 'expired' ? 'Просрочен' : 'Без оплаты';
                  const dot = ps === 'paid' ? 'bg-emerald-500' : ps === 'expired' ? 'bg-amber-500' : 'bg-red-500';
                  return (
                    <tr key={rowId} className="hover:bg-surface-subtle/50 transition-colors">
                      {nameCell}
                      {usernameCell}
                      {idCell}
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-lg ${statusStyles}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
                          {statusLabel}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-slate-600 font-medium">
                        {row.crm?.expires_at
                          ? new Date(row.crm.expires_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
                          : row.paymentStatus === 'paid' ? 'Навсегда' : '—'}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            className="p-2 bg-white border border-border-default text-ink-muted hover:text-ink-strong hover:border-border-strong hover:bg-surface-subtle rounded-lg transition-all shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
                            popovertarget={`row-menu-aud-${targetType}-${rowId}`}
                            disabled={!!mutatingRowId}
                            title="Действия"
                          >
                            <MoreHorizontal className="w-3.5 h-3.5" />
                          </button>
                          <div
                            id={`row-menu-aud-${targetType}-${rowId}`}
                            popover="auto"
                            className="w-56 rounded-2xl border border-border-default bg-white shadow-xl shadow-slate-900/10 overflow-hidden p-0"
                            style={ROW_MENU_STYLE}
                          >
                            <button type="button" className="w-full px-4 py-3 text-left text-sm font-semibold text-ink-body hover:bg-surface-subtle transition-colors" onClick={() => { closeAllRowMenus(); onAction(actionRow, 'extend-5'); }}>Продлить на 5 дней</button>
                            <button type="button" className="w-full px-4 py-3 text-left text-sm font-semibold text-ink-body hover:bg-surface-subtle transition-colors" onClick={() => { closeAllRowMenus(); onAction(actionRow, 'extend-30'); }}>Продлить на 30 дней</button>
                            <button type="button" className="w-full px-4 py-3 text-left text-sm font-semibold text-ink-body hover:bg-surface-subtle transition-colors" onClick={() => { closeAllRowMenus(); onAction(actionRow, 'extend-forever'); }}>Выдать навсегда</button>
                            <div className="border-t border-slate-100" />
                            {actionRow._crmSubscription && (
                              <button type="button" className="w-full px-4 py-3 text-left text-sm font-semibold text-rose-600 hover:bg-rose-50 transition-colors" onClick={() => { closeAllRowMenus(); onAction(actionRow, 'kick'); }}>Удалить из группы</button>
                            )}
                          </div>
                          {row.tg_user_id && (
                            <>
                              <button className="p-2 bg-white border border-border-default text-ink-faint hover:text-action-primary hover:border-indigo-200 hover:bg-indigo-50 rounded-lg transition-all shadow-sm" onClick={() => openUserbotCenterHandoff(String(row.tg_user_id), '', target.tgChatId || '')} title="Написать через юзербота" aria-label="Написать через юзербота">
                                <Send className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={rowId} className="hover:bg-surface-subtle/50 transition-colors">
                    {nameCell}
                    {usernameCell}
                    {idCell}
                    {privateCell}
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        {row.tg_user_id && (
                          <>
                            <button className="p-2 bg-white border border-border-default text-ink-faint hover:text-action-primary hover:border-indigo-200 hover:bg-indigo-50 rounded-lg transition-all shadow-sm" onClick={() => openUserbotCenterHandoff(String(row.tg_user_id), '', target.tgChatId || '')} title="Написать через юзербота" aria-label="Написать через юзербота">
                              <Send className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {enrichedRows.length > 100 && (
            <div className="px-6 py-3 text-sm text-ink-muted font-medium border-t border-slate-100 bg-surface-subtle/50">
              Показано 100 из {enrichedRows.length}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function openUserbotCenterHandoff(tgUserId, draftMessage = '', commonChatId = '') {
  if (!tgUserId) return;
  window.localStorage.setItem(USERBOT_CENTER_HANDOFF_KEY, JSON.stringify({
    tg_user_id: String(tgUserId),
    draft_message: String(draftMessage || '').trim(),
    common_chat_id: String(commonChatId || '').trim()
  }));
  // Центр юзерботов живёт в отдельном приложении /userbot — полный переход с query.
  // Черновик передаётся через localStorage (общий origin), его читает UserbotCenter в /userbot.
  window.location.assign(`/userbot/userbots?tg_user_id=${encodeURIComponent(tgUserId)}`);
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
  if (fullName) return fullName;
  return null;
}

function getViewedEventLabel(eventType) {
  return VIEWED_EVENT_LABELS[eventType] || eventType || 'Событие';
}

function getCustomerReason(row) {
  if (row.status === 'active') {
    if (row.in_group === true) return 'Вход подтвержден';
    if (row.in_group === false) return 'Оплата есть, но вход не подтвержден';
    return 'Состояние входа неизвестно';
  }

  if (row.in_group === true) return 'Доступ закончился, но человек внутри';
  if (row.in_group === false) return 'Доступ закончился, вход не подтвержден';
  return 'Доступ закончился';
}

function appendAccessSource(reason, sourceLabel) {
  if (!sourceLabel) return reason;
  return `${reason} • ${sourceLabel}`;
}

function getContextDisplay(row) {
  const tariffTitle = row.title || '';
  const channelTitle = row.channel_title || '';

  return {
    primary: tariffTitle || channelTitle || '—',
    secondary: tariffTitle && channelTitle && tariffTitle !== channelTitle ? channelTitle : null
  };
}

function normalizeCustomersTab(searchParams) {
  const tab = searchParams.get('tab') || '';
  const segment = searchParams.get('segment') || '';

  if (tab === 'customers' && segment === 'active') return 'customers-active';
  if (tab === 'customers' && segment === 'expired') return 'customers-expired';
  if (tab === 'customers') return 'customers-active';
  if (tab === 'orders') return 'bot';
  if (tab === 'abandoned') return 'invoice-created';
  return tab;
}

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

  // Защита от гонки: ответ поллинга, пришедший позже свежей загрузки (например,
  // после действия над строкой), не должен перезаписывать свежий стейт —
  // тот же паттерн, что в loadBotAnalytics и loadAudience
  const customersReqIdRef = useRef(0);
  const loadCustomers = useCallback(async ({ silent = false, shouldCancel = () => false } = {}) => {
    if (!accessToken) return;
    const reqId = ++customersReqIdRef.current;

    if (!silent) {
      setState((prev) => ({
        ...prev,
        loading: !prev.updatedAt,
        error: ''
      }));
    }

    try {
      const params = new URLSearchParams();
      if (selectedBotId) params.set('bot_id', selectedBotId);
      const data = await apiRequest(`/api/customers/workbench${params.toString() ? `?${params.toString()}` : ''}`, { accessToken });
      const segments = data.segments || {};

      if (shouldCancel()) return;
      if (reqId !== customersReqIdRef.current) return;

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
        error: '',
        updatedAt: data.updatedAt || new Date().toISOString(),
        bots: botOptions,
        channels: data.channels || [],
        started: segments.startedContacts || [],
        crm: [
          ...(segments.activeCustomers || []),
          ...(segments.expiredCustomers || [])
        ],
        viewed: segments.viewedTariffs || [],
        invoiceCreated: segments.invoiceCreated || [],
        caps: data.caps || null
      });
    } catch (error) {
      if (shouldCancel() || reqId !== customersReqIdRef.current) return;
      setState((prev) => ({
        ...prev,
        loading: false,
        error: error.message
      }));
    }
  }, [accessToken, selectedBotId, setSearchParams]);

  const analyticsReqIdRef = useRef(0);
  const audienceReqIdRef = useRef(0);
  const loadBotAnalytics = useCallback(async () => {
    if (!selectedBotId || !accessToken) {
      setBotAnalytics({ loading: false, error: '', data: null });
      return;
    }
    const reqId = ++analyticsReqIdRef.current;
    // Функциональная форма: не читаем стейт из замыкания (он может быть протухшим)
    setBotAnalytics((prev) => (prev.data ? prev : { ...prev, loading: true, error: '' }));
    try {
      const data = await apiRequest(`/api/analytics?bot_id=${encodeURIComponent(selectedBotId)}&period=${encodeURIComponent(moneyPeriod)}`, { accessToken });
      if (reqId !== analyticsReqIdRef.current) return;
      setBotAnalytics({ loading: false, error: '', data });
    } catch (error) {
      if (reqId !== analyticsReqIdRef.current) return;
      setBotAnalytics((prev) => ({ loading: false, error: error.message || 'Ошибка аналитики', data: prev.data }));
    }
  }, [accessToken, selectedBotId, moneyPeriod]);

  useEffect(() => {
    let cancelled = false;

    loadCustomers({ shouldCancel: () => cancelled });
    loadBotAnalytics();
    const intervalId = accessToken
      ? window.setInterval(() => {
          loadCustomers({ silent: true, shouldCancel: () => cancelled });
          loadBotAnalytics();
        }, 60_000)
      : null;

    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [accessToken, loadCustomers, loadBotAnalytics]);

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
      href: '/app/customers?tab=started'
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
      href: '/app/customers?tab=viewed'
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
        href: '/app/customers?tab=invoice-created'
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
      href: '/app/customers?tab=customers-active'
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
      href: '/app/customers?tab=customers-expired'
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
  const selectableChannels = useMemo(
    () => (state.channels || []).filter((channel) => !selectedBotId || String(channel.bot_id || '') === String(selectedBotId)),
    [state.channels, selectedBotId]
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

  // Audience loading
  const loadAudience = useCallback(async () => {
    if (!accessToken) return;
    // Защита от гонки: устаревший ответ не перезаписывает свежий (тот же паттерн, что в loadBotAnalytics)
    const reqId = ++audienceReqIdRef.current;
    try {
      setAudienceState((prev) => ({ ...prev, loading: true, error: '' }));
      const params = new URLSearchParams();
      if (selectedBotId) params.set('contourId', selectedBotId);
      const data = await apiRequest(`/api/audience${params.toString() ? `?${params.toString()}` : ''}`, { accessToken });
      if (reqId !== audienceReqIdRef.current) return;
      setAudienceState((prev) => ({
        ...prev,
        loading: false,
        contourId: data.contourId || null,
        targets: data.targets || [],
        error: ''
      }));
    } catch (err) {
      if (reqId !== audienceReqIdRef.current) return;
      setAudienceState((prev) => ({ ...prev, loading: false, error: err.message }));
    }
  }, [accessToken, selectedBotId]);

  useEffect(() => { loadAudience(); }, [loadAudience]);

  async function syncAudience(targetType) {
    const cid = audienceState.contourId;
    if (!cid) return;
    try {
      setAudienceState((prev) => ({ ...prev, syncingType: targetType }));
      const result = await apiRequest('/api/audience/sync', {
        accessToken,
        method: 'POST',
        body: { contourId: cid, targetType }
      });
      // Бэкенд /api/audience/sync возвращает synced_count (+ truncated при урезании лимитом)
      const countText = `Загружено ${result.synced_count} ${plural(result.synced_count, 'участника', 'участников', 'участников')}`;
      if (result.truncated) {
        toast.warning(`${countText} — в группе всего ${result.total_in_group}, выгрузка остановлена лимитом`);
      } else {
        toast.success(countText);
      }
      await loadAudience();
    } catch (err) {
      toast.error(err.message || 'Ошибка обновления');
    } finally {
      setAudienceState((prev) => ({ ...prev, syncingType: null }));
    }
  }

  function canManageRow(row) {
    return !!row?.tg_user_id;
  }

  function resolveActionChannelId(row) {
    if (row.channel_id) return String(row.channel_id);

    if (selectableChannels.length === 1) {
      return String(selectableChannels[0].id);
    }

    if (!selectableChannels.length) {
      window.alert('Для этого бота нет доступных каналов. Сначала подключи канал в BotFather.');
      return null;
    }

    const optionsText = selectableChannels
      .map((channel, index) => `${index + 1}. ${channel.title || `Канал ${index + 1}`}`)
      .join('\n');
    const input = window.prompt(`Выбери канал для выдачи доступа:\n${optionsText}\n\nВведи номер канала.`);
    if (!input) return null;

    const pickedIndex = Number(input) - 1;
    if (!Number.isInteger(pickedIndex) || pickedIndex < 0 || pickedIndex >= selectableChannels.length) {
      window.alert('Некорректный номер канала.');
      return null;
    }

    return String(selectableChannels[pickedIndex].id);
  }

  async function runSubscriptionAction(row, action) {
    if (!canManageRow(row)) return;

    const rowId = row.id ? String(row.id) : null;
    const clientLabel = getClientDisplayName(row) || (row.tg_username ? `@${row.tg_username}` : `TG ${row.tg_user_id}`);
    const contextLabel = row.channel_title || row.title || '';

    closeAllRowMenus();
    setMutatingRowId(rowId);

    try {
      const channelId = resolveActionChannelId(row);
      if (!channelId) {
        setMutatingRowId(null);
        return;
      }

      if (action === 'extend-5' || action === 'extend-30' || action === 'extend-forever') {
        const days = action === 'extend-5' ? 5 : action === 'extend-30' ? 30 : 'forever';

        // CRM-действия только для строк-подписок (id = id подписки); funnel-строки осознанно идут в direct-access
        const hasCrmSub = !!row.id && !!row._crmSubscription;

        if (hasCrmSub) {
          await apiRequest('/api/userbot/crm/subscribers/batch-add-days', {
            accessToken,
            method: 'POST',
            body: {
              subscription_ids: [rowId],
              days
            }
          });
        } else {
          const result = await apiRequest('/api/customers/direct-access', {
            accessToken,
            method: 'POST',
            body: {
              tg_user_id: String(row.tg_user_id),
              channel_id: channelId,
              duration_days: days
            }
          });

          if (result.dm_sent) {
            window.alert(
              action === 'extend-forever'
                ? 'Доступ выдан навсегда. Бот уже отправил человеку ссылку в личку.'
                : `Доступ выдан на ${days} дней. Бот уже отправил человеку ссылку в личку.`
            );
          } else if (result.invite_link) {
            window.prompt(
              'Доступ создан, но бот не смог отправить ссылку в личку. Скопируй и перешли ее вручную:',
              result.invite_link
            );
          } else {
            window.alert('Доступ создан, но бот не смог отправить ссылку в личку.');
          }
        }

        if (hasCrmSub) {
          window.alert(
            action === 'extend-forever'
              ? 'Доступ выдан навсегда. Таблица обновится.'
              : `Доступ продлен на ${days} дней. Таблица обновится.`
          );
        }
      }

      if (action === 'kick') {
        if (!rowId || !row._crmSubscription) {
          window.alert('Эту строку нельзя удалить из группы, потому что подписка еще не создана.');
          setMutatingRowId(null);
          return;
        }
        const prompt = contextLabel
          ? `Удалить ${clientLabel} из «${contextLabel}»?`
          : `Удалить ${clientLabel} из группы?`;
        if (!window.confirm(prompt)) {
          setMutatingRowId(null);
          return;
        }

        const result = await apiRequest('/api/userbot/crm/subscribers/batch-kick', {
          accessToken,
          method: 'POST',
          body: {
            subscription_ids: [rowId],
            action_source: 'customers'
          }
        });

        window.alert(`Удаление завершено. Кикнули: ${result.kicked || 0}.`);
      }

      await loadCustomers();
    } catch (error) {
      window.alert(error.message);
    } finally {
      setMutatingRowId(null);
    }
  }

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

        {/* Metrics Section */}
        <section className="p-6 md:p-8 border-b border-slate-100">
          {/* Фуннельные карточки. [display:grid] вместо grid — legacy .grid из app.css перебивает Tailwind-колонки */}
          <div className="[display:grid] grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              { label: 'Активный доступ', value: stats.activeCustomers, icon: CheckCircle2, color: 'text-emerald-600' },
              { label: 'Доступ закончился', value: stats.expiredCustomers, icon: Clock, color: stats.expiredCustomers > 0 ? 'text-ink-strong' : 'text-ink-muted' }
            ].map((item, idx) => (
              <div
                key={idx}
                className="bg-surface-subtle/50 border border-slate-100 p-6 rounded-2xl"
              >
                <div className="flex items-center justify-between mb-4">
                  <span className="text-xs font-black uppercase tracking-widest text-ink-muted">{item.label}</span>
                  <item.icon className={`w-5 h-5 ${item.color} opacity-70`} />
                </div>
                <div
                  className={`text-3xl font-black tracking-tighter ${item.color}`}
                  title={subscriptionCaps?.truncated ? `Показаны последние ${subscriptionCaps.limit} ${plural(subscriptionCaps.limit, 'запись', 'записи', 'записей')}` : undefined}
                >
                  {item.value}{subscriptionCaps?.truncated ? '+' : ''}
                </div>
              </div>
            ))}
          </div>

          {selectedBotId ? (
            <>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-6 mb-3">
                <div className="text-xs font-black uppercase tracking-widest text-ink-muted">Выручка TON</div>
                <div className="flex rounded-xl border border-border-default overflow-hidden">
                  {[
                    { id: '7', label: '7 дней' },
                    { id: '30', label: '30 дней' },
                    { id: 'all', label: 'За всё время' }
                  ].map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setMoneyPeriod(p.id)}
                      className={`px-3 py-1.5 text-xs font-bold transition-colors ${
                        moneyPeriod === p.id ? 'bg-action-primary text-action-primary-text' : 'bg-white text-slate-600 hover:bg-surface-subtle'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="bg-white border border-slate-100 border-l-4 border-l-indigo-400 p-6 rounded-2xl">
                <div className="text-3xl font-black tracking-tighter text-ink-strong tabular-nums">
                  {botAnalytics.data ? formatTon(moneyPeriod === 'all' ? botAnalytics.data.revenueTON : (botAnalytics.data.revenuePeriodTON ?? 0)) : '—'}
                </div>
                <div className="text-xs font-medium mt-1">
                  {botAnalytics.error && !botAnalytics.data
                    ? <span className="text-red-500">{botAnalytics.error}</span>
                    : botAnalytics.data && Number(moneyPeriod === 'all' ? botAnalytics.data.revenueTON : (botAnalytics.data.revenuePeriodTON ?? 0)) > 0
                      ? <span className="text-ink-muted">{moneyPeriod === '7' ? 'За 7 дней' : moneyPeriod === '30' ? 'За 30 дней' : 'За всё время'}</span>
                      : <span className="text-ink-strong">За период платежей нет</span>}
                </div>
              </div>
            </>
          ) : null}
        </section>

        {/* Filter & Search Section */}
        <section className="p-6 md:p-8 bg-surface-subtle/50 border-t border-border-default/60">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/20 text-white shrink-0">
              <Filter className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-xl font-black text-ink-strong tracking-tight">Фильтры и поиск</h3>
              <p className="text-sm text-ink-muted font-medium mt-0.5">Выберите сегмент клиентов</p>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 overflow-x-auto border-b border-slate-100 mb-6">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isAudience = tab.id.startsWith('audience-');
              const targetType = isAudience ? tab.id.replace('audience-', '').replace(/-/g, '_') : null;
              const audienceTarget = isAudience ? audienceState.targets.find((t) => t.targetType === targetType) : null;
              const count = isAudience
                ? (audienceTarget?.totalMembers || 0)
                : tab.id === 'bot' ? stats.started : null;
              const isDisabled = isAudience && !audienceState.loading && audienceTarget && !audienceTarget.channelId;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  title={isDisabled ? 'Группа не в контуре продаж — подключите её на экране «Бот продаж»' : undefined}
                  className={`flex items-center gap-2 px-4 py-3 text-sm font-bold whitespace-nowrap border-b-2 transition-all ${
                    isActive
                      ? 'border-indigo-600 text-action-primary'
                      : isDisabled
                        ? 'border-transparent text-ink-muted opacity-50 cursor-not-allowed'
                        : 'border-transparent text-ink-muted hover:text-ink-body hover:border-border-strong'
                  }`}
                  onClick={() => !isDisabled && setTabState(tab.id)}
                  disabled={!!isDisabled}
                >
                  {Icon && <Icon className="w-4 h-4" />}
                  {tab.label}
                  {count !== null && count > 0 && (
                    <span className={`text-xs px-1.5 py-0.5 rounded-md ${isActive ? 'bg-indigo-100 text-action-primary' : 'bg-surface-subtle-strong text-ink-muted'}`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Search & Actions */}
          <div className="flex flex-col md:flex-row items-center gap-4">
            <div className="relative flex-1 w-full">
              <input
                className="w-full pl-12 pr-6 py-3.5 bg-white border border-border-default rounded-xl text-ink-strong font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all shadow-sm text-sm"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={activeTab.startsWith('audience-') ? 'Поиск по TG ID, @username…' : 'Поиск по TG ID, @username, тарифу…'}
              />
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-300" />
            </div>
            <div className="w-full md:w-[280px] shrink-0">
              <select
                className="w-full px-4 py-3.5 bg-white border border-border-default rounded-xl text-ink-strong font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all shadow-sm text-sm"
                value={selectedBotId}
                onChange={(event) => {
                  const next = new URLSearchParams(window.location.search);
                  // Страница per-bot: мёртвый «Все боты» убрали, всегда фиксируем bot_id
                  next.set('bot_id', event.target.value);
                  setSearchParams(next);
                }}
              >
                {state.bots.map((bot) => (
                  <option key={bot.id} value={bot.id}>
                    {bot.label}{bot.status === 'deleted' ? ' • удален' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

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
        <>
          {isBotTab && (
            <div className="relative mx-8 mt-4">
              <div className="flex gap-2 p-1.5 bg-surface-subtle-strong rounded-2xl overflow-x-auto">
                {BOT_SUBTABS.map((sub) => {
                  const count = subtabCounts[sub.id] || 0;
                  const subCap = state.caps ? (state.caps[CAPS_KEY_BY_SUBTAB[sub.id]] || null) : null;
                  return (
                    <button
                      key={sub.id}
                      type="button"
                      className={`shrink-0 px-4 py-2 text-xs font-black uppercase tracking-wider rounded-xl transition-all flex items-center gap-1.5 ${
                        activeBotSubtab === sub.id
                          ? 'bg-white text-action-primary shadow-sm'
                          : 'text-slate-600 hover:text-ink-body'
                      }`}
                      onClick={() => setBotSubtab(sub.id)}
                    >
                      {sub.label}
                      {count > 0 && (
                        <span
                          className={`text-[11px] px-1.5 py-0.5 rounded-md ${activeBotSubtab === sub.id ? 'bg-indigo-100 text-action-primary' : 'bg-white text-ink-muted'}`}
                          title={subCap?.truncated ? `Показаны последние ${subCap.limit} ${plural(subCap.limit, 'запись', 'записи', 'записей')}` : undefined}
                        >
                          {subCap?.truncated ? `${count}+` : count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <div className="pointer-events-none absolute inset-y-0 right-0 w-10 rounded-r-2xl bg-gradient-to-l from-slate-100 via-slate-100/70 to-transparent" />
            </div>
          )}
        <div className="overflow-hidden flex flex-col">

          {/* Table Header Area */}
          <div className="flex items-center justify-between px-8 py-6 border-b border-slate-100 bg-surface-subtle/30">
            <h3 className="text-xl font-black text-ink-strong flex items-center gap-3">
              {isBotTab
                ? (BOT_SUBTABS.find((sub) => sub.id === activeBotSubtab)?.label || 'Клиенты')
                : (TABS.find((tab) => tab.id === activeTab)?.label || 'Клиенты')}
            </h3>
            <div className="flex items-center gap-3">
              <span className="px-4 py-1.5 bg-surface-subtle text-slate-600 rounded-xl text-xs font-black uppercase tracking-wider border border-slate-100">
                {/* total из caps — размер всего среза таблицы, а вкладка показывает
                    подмножество (статусы, дедуп по контактам), поэтому честная
                    нижняя граница — «N+ показанных», не total */}
                {activeCaps?.truncated
                  ? `${activeRows.length}+ ${plural(activeRows.length, 'запись', 'записи', 'записей')} · показаны последние ${activeCaps.limit}`
                  : `${activeRows.length} ${plural(activeRows.length, 'запись', 'записи', 'записей')}`}
              </span>
            </div>
          </div>

          {activeRows.length === 0 ? (
            (() => {
              const searching = search.trim().length > 0;
              const subMeta = BOT_SUBTABS.find((s) => s.id === (effectiveTab || activeBotSubtab));
              const emptyMeta = searching || !subMeta?.empty
                ? { title: 'Ничего не найдено', text: 'Попробуйте изменить фильтры или поиск' }
                : subMeta.empty;
              return (
                <div className="p-16 text-center flex flex-col items-center">
                  <div className="w-16 h-16 rounded-2xl bg-surface-subtle flex items-center justify-center text-slate-300 shadow-inner mb-4 border border-slate-100">
                    <FileText className="w-8 h-8" />
                  </div>
                  <h4 className="text-lg font-black text-ink-strong tracking-tight mb-2">{emptyMeta.title}</h4>
                  <p className="text-ink-muted font-medium text-sm">{emptyMeta.text}</p>
                </div>
              );
            })()
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="bg-surface-subtle/80 border-b border-slate-100">
                      <th className="px-6 py-4 font-black text-ink-muted uppercase tracking-widest text-[10px]">Клиент</th>
                      <th className="px-6 py-4 font-black text-ink-muted uppercase tracking-widest text-[10px] hidden md:table-cell">Тариф / канал</th>
                      <th className="px-6 py-4 font-black text-ink-muted uppercase tracking-widest text-[10px]">Статус</th>
                      <th className="px-6 py-4 font-black text-ink-muted uppercase tracking-widest text-[10px] hidden lg:table-cell">Причина</th>
                      <th className="px-6 py-4 font-black text-ink-muted uppercase tracking-widest text-[10px] text-right">Действия</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {activeRows.slice(0, limit).map((row) => {
                      const statusConfig = (() => {
                        if (row.status === 'Доступ активен') return { bg: 'bg-feedback-success-bg', text: 'text-feedback-success-text', border: 'border-emerald-200', icon: CheckCircle2 };
                        if (row.status === 'Доступ закончился') return { bg: 'bg-feedback-error-bg', text: 'text-feedback-error-text', border: 'border-red-200', icon: Clock };
                        return { bg: 'bg-surface-subtle-strong', text: 'text-slate-600', border: 'border-border-default', icon: null };
                      })();
                      const contextDisplay = getContextDisplay(row);

                      const StatusIcon = statusConfig.icon;

                      return (
                        <tr key={`${activeTab}-${row.id}`} className="hover:bg-surface-subtle/80 transition-colors">

                          {/* Client Col */}
                          <td className="px-6 py-4">
                            <div className="min-w-0">
                                <div className="font-black text-ink-strong text-sm truncate flex items-center gap-1.5">
                                  <span>
                                    {getClientDisplayName(row) || (row.tg_username ? `@${row.tg_username}` : row.tg_user_id ? `ID: ${row.tg_user_id}` : 'Неизвестный')}
                                  </span>
                                </div>
                                {row.tg_user_id ? (
                                  <div className="text-[10px] font-bold text-ink-muted uppercase tracking-tight">
                                    ID: {row.tg_user_id}
                                  </div>
                                ) : null}
                                {row.tg_username ? (
                                  <div className="text-xs font-semibold text-ink-muted truncate">
                                    @{row.tg_username}
                                  </div>
                                ) : null}
                            </div>
                          </td>

                          {/* Context Col */}
                          <td className="px-6 py-4 hidden md:table-cell">
                            <div className="font-bold text-slate-800 text-sm truncate">
                              {contextDisplay.primary}
                            </div>
                            {contextDisplay.secondary ? (
                              <div className="text-xs text-ink-muted truncate mt-1">
                                {contextDisplay.secondary}
                              </div>
                            ) : null}
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
                            <div className="text-slate-600 font-medium text-sm line-clamp-2" title={row.reason || ''}>
                              {row.reason || '—'}
                            </div>
                          </td>

                          {/* Actions Col */}
                          <td className="px-6 py-4 text-right">
                            <div className="flex justify-end gap-2">
                              {canManageRow(row) ? (
                                <>
                                  <button
                                    type="button"
                                    className="p-2 bg-white border border-border-default text-ink-muted hover:text-ink-strong hover:border-border-strong hover:bg-surface-subtle rounded-lg transition-all shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
                                    popovertarget={`row-menu-${row.id}`}
                                    disabled={mutatingRowId === String(row.id)}
                                    title="Действия"
                                  >
                                    <MoreHorizontal className="w-3.5 h-3.5" />
                                  </button>

                                  <div
                                    id={`row-menu-${row.id}`}
                                    popover="auto"
                                    className="w-56 rounded-2xl border border-border-default bg-white shadow-xl shadow-slate-900/10 overflow-hidden p-0"
                                    style={ROW_MENU_STYLE}
                                  >
                                    <button
                                      type="button"
                                      className="w-full px-4 py-3 text-left text-sm font-semibold text-ink-body hover:bg-surface-subtle transition-colors"
                                      onClick={() => runSubscriptionAction(row, 'extend-5')}
                                    >
                                      Продлить на 5 дней
                                    </button>
                                    <button
                                      type="button"
                                      className="w-full px-4 py-3 text-left text-sm font-semibold text-ink-body hover:bg-surface-subtle transition-colors"
                                      onClick={() => runSubscriptionAction(row, 'extend-30')}
                                    >
                                      Продлить на 30 дней
                                    </button>
                                    <button
                                      type="button"
                                      className="w-full px-4 py-3 text-left text-sm font-semibold text-ink-body hover:bg-surface-subtle transition-colors"
                                      onClick={() => runSubscriptionAction(row, 'extend-forever')}
                                    >
                                      Выдать навсегда
                                    </button>
                                    <div className="border-t border-slate-100" />
                                    {row.id && row._crmSubscription ? (
                                      <button
                                        type="button"
                                        className="w-full px-4 py-3 text-left text-sm font-semibold text-rose-600 hover:bg-rose-50 transition-colors"
                                        onClick={() => runSubscriptionAction(row, 'kick')}
                                      >
                                        Удалить из группы
                                      </button>
                                    ) : null}
                                  </div>
                                </>
                              ) : null}
                              {row.tg_user_id && (
                                <>
                                  <button className="p-2 bg-white border border-border-default text-ink-faint hover:text-action-primary hover:border-indigo-200 hover:bg-indigo-50 rounded-lg transition-all shadow-sm" onClick={() => openUserbotCenterHandoff(row.tg_user_id, '', '')} title="Написать через юзербота" aria-label="Написать через юзербота">
                                    <Send className="w-3.5 h-3.5" />
                                  </button>
                                </>
                              )}
                              <a className="p-2 bg-white border border-border-default text-ink-faint hover:text-ink-strong hover:bg-surface-subtle hover:border-border-strong rounded-lg transition-all shadow-sm" href={row.href || '/app/customers'} target="_blank" rel="noreferrer" title="Открыть источник">
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

              <div className="px-8 py-4 border-t border-slate-100 bg-surface-subtle/30 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="flex-1">
                  {activeRows.length > limit ? (
                    <button
                      className="w-full md:w-auto px-6 py-3 bg-white border border-border-default text-ink-body rounded-xl text-sm font-bold shadow-sm hover:bg-surface-subtle hover:border-border-strong transition-all flex items-center justify-center gap-2"
                      onClick={() => setLimit((prev) => prev + 80)}
                    >
                      Показать еще {Math.min(80, activeRows.length - limit)} из {activeRows.length - limit}
                    </button>
                  ) : null}
                </div>
                <div className="flex justify-end">
                  <a
                    href="/app/broadcast"
                    className="w-full md:w-auto px-6 py-3 bg-action-primary !text-action-primary-text rounded-xl text-sm font-bold shadow-md shadow-indigo-200 hover:bg-action-primary-hover transition-all flex items-center justify-center gap-2"
                  >
                    <Send className="w-4 h-4" />
                    Рассылка
                  </a>
                </div>
              </div>
            </>
          )}
        </div>
        </>
        )}

        </div>
      </div>
    </section>
  );
}
