import { Database, Users, Lock, Eye, MessageCircle } from 'lucide-react';

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

function canManageRow(row) {
  return !!row?.tg_user_id;
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
  window.location.assign(`/userbot/accounts?tg_user_id=${encodeURIComponent(tgUserId)}`);
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

export {
  TABS,
  plural,
  BOT_SUBTABS,
  CAPS_KEY_BY_SUBTAB,
  ROW_MENU_STYLE,
  closeAllRowMenus,
  canManageRow,
  openUserbotCenterHandoff,
  rowMatches,
  getClientDisplayName,
  getViewedEventLabel,
  getCustomerReason,
  appendAccessSource,
  getContextDisplay,
  normalizeCustomersTab
};
