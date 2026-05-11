import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, Filter, X, Send, ChevronRight, Eye, Lock, Database, FileText, AlertCircle, Clock, CheckCircle2, MoreHorizontal, RefreshCw, ShieldCheck, Users, Megaphone, MessageCircle } from 'lucide-react';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { supabase } from '../lib/supabase.js';
import { LoadingState } from '../ui/LoadingState.jsx';
import { StatCard } from '../ui/StatCard.jsx';
import { toast } from 'sonner';

const TABS = [
  { id: 'bot', label: 'Официальный бот', icon: Database },
  { id: 'audience-paid-channel', label: 'Платный канал', icon: Users },
  { id: 'audience-paid-chat', label: 'Платный чат', icon: Lock },
  { id: 'audience-public-channel', label: 'Открытый канал', icon: Eye },
  { id: 'audience-public-chat', label: 'Открытый чат', icon: MessageCircle }
];

const BOT_SUBTABS = [
  { id: 'started', label: 'Нажал старт' },
  { id: 'viewed', label: 'Смотрели тарифы' },
  { id: 'abandoned', label: 'Не смогли оплатить' },
  { id: 'customers-active', label: 'Активный доступ' },
  { id: 'customers-expired', label: 'Доступ закончился' },
  { id: 'removed-admin', label: 'Удален админом' },
  { id: 'access', label: 'Не смог войти' }
];

const USERBOT_CENTER_HANDOFF_KEY = 'bullrun_userbot_center_handoff';

const ABANDONED_STATUS_LABELS = {
  awaiting_receipt: 'Ждет чек',
  reminded: 'Уже дожат',
  fresh: 'Счет без оплаты',
  queued: 'Счет без оплаты',
  stale: 'Счет без оплаты'
};

const VIEWED_EVENT_LABELS = {
  tariff_list_opened: 'Открыл тарифы',
  tariff_card_opened: 'Открыл тариф',
  payment_method_selected: 'Выбрал оплату',
  invoice_created: 'Создал счет',
  bot_started: 'Нажал /start'
};

const RECONCILIATION_ROLE_LABELS = {
  public_funnel_group: 'Публичная группа',
  public_chat: 'Публичный чат',
  private_paid_group: 'Закрытая платная группа',
  ignored: 'Не использовать'
};

const CUSTOMERS_TAB_LABELS = {
  started: 'Нажал старт',
  viewed: 'Смотрели тарифы',
  abandoned: 'Не смогли оплатить',
  'customers-active': 'Активный доступ',
  'customers-expired': 'Доступ закончился',
  'removed-admin': 'Удален админом',
  access: 'Не смог войти'
};

const CANDIDATE_ROLE_FILTERS = [
  { id: 'all', label: 'Все источники' },
  { id: 'public_funnel_group', label: 'В публичной группе' },
  { id: 'public_chat', label: 'В публичном чате' },
  { id: 'private_paid_group', label: 'Уже в закрытой группе' }
];

const CANDIDATE_MATCH_FILTERS = [
  { id: 'all', label: 'Все совпадения' },
  { id: 'unmatched', label: 'Не сопоставлены' },
  { id: 'matched', label: 'Похожи на учтенных' }
];

const CANDIDATE_PAYMENT_FILTERS = [
  { id: 'all', label: 'Все статусы' },
  { id: 'free_rider', label: 'Сидят внутри без оплаты' },
  { id: 'expired_paid_inside', label: 'Платили раньше, но теперь внутри без доступа' },
  { id: 'unpaid_lead', label: 'Счет без оплаты' },
  { id: 'no_payment_history', label: 'Просто не оформлены' }
];

const LARGE_SOURCE_MEMBER_COUNT = 1000;

const AUDIENCE_TAB_MAP = {
  'audience-public-channel': 'public_channel',
  'audience-paid-channel': 'paid_channel',
  'audience-public-chat': 'public_chat',
  'audience-paid-chat': 'paid_chat'
};


function AudienceTable({ target, syncingType, onSync, loading, crmMap, onAction, openActionsRowId, setOpenActionsRowId }) {
  const navigate = useNavigate();
  if (!target) {
    return (
      <div className="p-16 text-center flex flex-col items-center">
        <div className="w-16 h-16 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-300 shadow-inner mb-4 border border-slate-100">
          <Users className="w-8 h-8" />
        </div>
        <h4 className="text-lg font-black text-slate-900 tracking-tight mb-2">Группа не подключена</h4>
        <p className="text-slate-500 font-medium text-sm">Добавьте эту группу в контуре продаж на странице Бот-отец</p>
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between px-8 py-6 border-b border-slate-100 bg-slate-50/30 gap-3">
        <div>
          <h3 className="text-xl font-black text-slate-900">{target.channelTitle || TABS.find(t => t.id === `audience-${targetType}`)?.label || 'Группа'}</h3>
          <div className="text-sm text-slate-500 mt-0.5 flex flex-wrap gap-x-3">
            <span>{target.totalMembers} участников</span>
            {isPaid && paidCount > 0 && <span className="text-emerald-600">{paidCount} оплачено</span>}
            {isPaid && expiredCount > 0 && <span className="text-amber-600">{expiredCount} просрочено</span>}
            {isPaid && freeCount > 0 && <span className="text-red-500">{freeCount} без оплаты</span>}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => onSync(targetType)}
            disabled={!!syncingType}
            className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50 transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${syncingType === targetType ? 'animate-spin' : ''}`} />
            {syncingType === targetType ? 'Загружаем...' : 'Обновить список'}
          </button>
          {target.baseId && (
            <a
              href={`/app/broadcast?baseId=${target.baseId}`}
              className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-bold shadow-md shadow-indigo-200 hover:bg-indigo-700 transition-all"
            >
              <Megaphone className="w-4 h-4" />
              Рассылка
            </a>
          )}
        </div>
      </div>

      {!target.baseId ? (
        <div className="p-16 text-center flex flex-col items-center">
          <div className="w-16 h-16 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-300 shadow-inner mb-4 border border-slate-100">
            <Users className="w-8 h-8" />
          </div>
          <h4 className="text-lg font-black text-slate-900 tracking-tight mb-2">Участники еще не загружены</h4>
          <p className="text-slate-500 font-medium text-sm">Нажмите «Обновить список» чтобы загрузить участников из Telegram</p>
        </div>
      ) : members.length === 0 ? (
        <div className="p-16 text-center flex flex-col items-center">
          <div className="w-16 h-16 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-300 shadow-inner mb-4 border border-slate-100">
            <Users className="w-8 h-8" />
          </div>
          <h4 className="text-lg font-black text-slate-900 tracking-tight mb-2">Пусто</h4>
          <p className="text-slate-500 font-medium text-sm">В этой группе пока нет участников</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-100">
                <th className="px-6 py-4 font-black text-slate-400 uppercase tracking-widest text-[10px]">Клиент</th>
                {isPaid && (
                  <>
                    <th className="px-6 py-4 font-black text-slate-400 uppercase tracking-widest text-[10px]">Оплата</th>
                    <th className="px-6 py-4 font-black text-slate-400 uppercase tracking-widest text-[10px]">Доступ до</th>
                  </>
                )}
                <th className="px-6 py-4 font-black text-slate-400 uppercase tracking-widest text-[10px] text-right">Действия</th>
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
                const clientCell = (
                  <td className="px-6 py-4">
                    <div className="min-w-0">
                        <div className="font-black text-slate-900 text-sm truncate">
                          {row.display_name || row.first_name || (row.username ? `@${row.username}` : 'Неизвестный')}
                        </div>
                        {row.tg_user_id && (
                          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">ID: {row.tg_user_id}</div>
                        )}
                        {row.username && (
                          <div className="text-xs font-semibold text-slate-500 truncate">@{row.username}</div>
                        )}
                      </div>
                  </td>
                );
                if (isPaid) {
                  const ps = row.paymentStatus;
                  const statusStyles = ps === 'paid'
                    ? 'bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200'
                    : ps === 'expired'
                      ? 'bg-amber-50 text-amber-600 ring-1 ring-amber-200'
                      : 'bg-red-50 text-red-600 ring-1 ring-red-200';
                  const statusLabel = ps === 'paid' ? 'Оплачено' : ps === 'expired' ? 'Просрочен' : 'Без оплаты';
                  const dot = ps === 'paid' ? 'bg-emerald-500' : ps === 'expired' ? 'bg-amber-500' : 'bg-red-500';
                  return (
                    <tr key={rowId} className="hover:bg-slate-50/50 transition-colors">
                      {clientCell}
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
                          <div className="relative" data-row-actions-root="true">
                            <button
                              type="button"
                              className="p-2 bg-white border border-slate-200 text-slate-500 hover:text-slate-900 hover:border-slate-300 hover:bg-slate-50 rounded-lg transition-all shadow-sm"
                              onClick={() => setOpenActionsRowId((prev) => (prev === rowId ? null : rowId))}
                              title="Действия"
                            >
                              <MoreHorizontal className="w-3.5 h-3.5" />
                            </button>
                            {openActionsRowId === rowId && (
                              <div className="absolute right-0 top-full mt-2 w-56 rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10 z-20 overflow-hidden">
                                <button type="button" className="w-full px-4 py-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors" onClick={() => { setOpenActionsRowId(null); onAction(actionRow, 'extend-5'); }}>Продлить на 5 дней</button>
                                <button type="button" className="w-full px-4 py-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors" onClick={() => { setOpenActionsRowId(null); onAction(actionRow, 'extend-30'); }}>Продлить на 30 дней</button>
                                <button type="button" className="w-full px-4 py-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors" onClick={() => { setOpenActionsRowId(null); onAction(actionRow, 'extend-forever'); }}>Выдать навсегда</button>
                                <div className="border-t border-slate-100" />
                                <button type="button" className="w-full px-4 py-3 text-left text-sm font-semibold text-rose-600 hover:bg-rose-50 transition-colors" onClick={() => { setOpenActionsRowId(null); onAction(actionRow, 'kick'); }}>Удалить из группы</button>
                              </div>
                            )}
                          </div>
                          {row.tg_user_id && (
                            <>
                              <button className="p-2 bg-white border border-slate-200 text-slate-400 hover:text-blue-600 hover:border-blue-200 hover:bg-blue-50 rounded-lg transition-all shadow-sm" onClick={() => openUserbotCenterHandoff(String(row.tg_user_id), '', target.tgChatId || '', navigate)} title="Написать">
                                <Send className="w-3.5 h-3.5" />
                              </button>
                              <a className="p-2 bg-white border border-slate-200 text-slate-400 hover:text-purple-600 hover:border-purple-200 hover:bg-purple-50 rounded-lg transition-all shadow-sm" href={`/app/dossier?tg=${encodeURIComponent(row.tg_user_id)}`} target="_blank" rel="noreferrer" title="Досье">
                                <Database className="w-3.5 h-3.5" />
                              </a>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={rowId} className="hover:bg-slate-50/50 transition-colors">
                    {clientCell}
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        {row.tg_user_id && (
                          <>
                            <button className="p-2 bg-white border border-slate-200 text-slate-400 hover:text-blue-600 hover:border-blue-200 hover:bg-blue-50 rounded-lg transition-all shadow-sm" onClick={() => openUserbotCenterHandoff(String(row.tg_user_id), '', target.tgChatId || '', navigate)} title="Написать">
                              <Send className="w-3.5 h-3.5" />
                            </button>
                            <a className="p-2 bg-white border border-slate-200 text-slate-400 hover:text-purple-600 hover:border-purple-200 hover:bg-purple-50 rounded-lg transition-all shadow-sm" href={`/app/dossier?tg=${encodeURIComponent(row.tg_user_id)}`} target="_blank" rel="noreferrer" title="Досье">
                              <Database className="w-3.5 h-3.5" />
                            </a>
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
            <div className="px-6 py-3 text-sm text-slate-500 font-medium border-t border-slate-100 bg-slate-50/50">
              Показано 100 из {enrichedRows.length}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function getReconciliationUserbotOptionLabel(userbot) {
  const baseLabel = userbot.tg_username ? `@${userbot.tg_username}` : `Аккаунт ${userbot.tg_account_id || userbot.id}`;
  if (userbot.availability_status === 'pending_activation') return `${baseLabel} • safe mode`;
  if (userbot.availability_status === 'reserved_in_shop') return `${baseLabel} • занят в shop`;
  if (userbot.availability_status === 'proxy_dead') return `${baseLabel} • мертвый прокси`;
  return `${baseLabel} • боевой`;
}

function getReconciliationUserbotStatusMeta(userbot) {
  if (userbot?.availability_status === 'pending_activation') {
    return {
      title: 'Этот аккаунт сейчас в safe mode',
      body: userbot.availability_reason || 'Сначала выведи аккаунт из safe mode и только потом используй его для контура.',
      toneClass: 'bg-amber-50 border-amber-100 text-amber-700'
    };
  }

  if (userbot?.availability_status === 'reserved_in_shop') {
    return {
      title: 'Этот аккаунт сейчас занят в shop',
      body: userbot.availability_reason || 'Выберите другой аккаунт или освободи этот из shop.',
      toneClass: 'bg-amber-50 border-amber-100 text-amber-700'
    };
  }

  if (userbot?.availability_status === 'proxy_dead') {
    return {
      title: 'У этого аккаунта мертвый прокси',
      body: userbot.availability_reason || 'Почини прокси или выбери другой аккаунт.',
      toneClass: 'bg-rose-50 border-rose-100 text-rose-700'
    };
  }

  return {
    title: 'Аккаунт боевой',
    body: 'Можно использовать для ручной проверки и синка в contour.',
    toneClass: 'bg-emerald-50 border-emerald-100 text-emerald-700'
  };
}

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
  if (inv.reminded) return 'Счет без оплаты';
  if (ageHours < 2) return 'Счет без оплаты';
  if (ageHours < 24) return 'Счет без оплаты';
  return 'Счет без оплаты';
}

function openUserbotCenterHandoff(tgUserId, draftMessage = '', commonChatId = '', navigate = null) {
  if (!tgUserId) return;
  window.localStorage.setItem(USERBOT_CENTER_HANDOFF_KEY, JSON.stringify({
    tg_user_id: String(tgUserId),
    draft_message: String(draftMessage || '').trim(),
    common_chat_id: String(commonChatId || '').trim()
  }));
  const url = `/userbot-center?tg_user_id=${encodeURIComponent(tgUserId)}`;
  if (navigate) {
    navigate(url);
  } else {
    window.location.href = `/app${url}`;
  }
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

function getViewedEventLabel(eventType) {
  return VIEWED_EVENT_LABELS[eventType] || eventType || 'Событие';
}

function getStartedReason() {
  return 'Первое касание с ботом';
}

function getAbandonedReason(row) {
  if (row.status === 'awaiting_receipt') return 'Клиент нажал «я оплатил», но чек еще не загрузил';
  return 'Счет создан, оплаты пока нет';
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

function getAccessReason(row) {
  if (row.status === 'expired') {
    return row.access_source_label
      ? `Доступ закончился, но человек все еще внутри • ${row.access_source_label}`
      : 'Доступ закончился, но человек все еще внутри';
  }
  return row.access_source_label
    ? `После выдачи доступа вход не подтвердился • ${row.access_source_label}`
    : 'После выдачи доступа вход не подтвердился';
}

function getRemovedAdminReason(row) {
  return row.reason || 'Админ вручную удалил человека из группы';
}

function appendAccessSource(reason, sourceLabel) {
  if (!sourceLabel) return reason;
  return `${reason} • ${sourceLabel}`;
}

function getContextDisplay(row, activeTab) {
  const tariffTitle = sanitizeDemoLabel(row.title || '');
  const channelTitle = sanitizeDemoLabel(row.channel_title || '');

  if (activeTab === 'viewed' || activeTab === 'abandoned') {
    return {
      primary: tariffTitle ? `Тариф: ${tariffTitle}` : channelTitle ? `Канал: ${channelTitle}` : '—',
      secondary: channelTitle ? `Канал: ${channelTitle}` : null
    };
  }

  if (activeTab === 'customers-active' || activeTab === 'customers-expired' || activeTab === 'removed-admin' || activeTab === 'access') {
    return {
      primary: channelTitle ? `Канал: ${channelTitle}` : tariffTitle ? `Тариф: ${tariffTitle}` : '—',
      secondary: null
    };
  }

  if (activeTab === 'started') {
    return {
      primary: 'Первый вход в бота',
      secondary: null
    };
  }

  return {
    primary: tariffTitle || channelTitle || '—',
    secondary: tariffTitle && channelTitle && tariffTitle !== channelTitle ? channelTitle : null
  };
}

function getCandidateStatusLabel(paymentStatus) {
  if (paymentStatus === 'free_rider') return 'Сидит зайцем';
  if (paymentStatus === 'expired_paid_inside') return 'Оплата сгорела, но человек внутри';
  if (paymentStatus === 'unpaid_lead') return 'Счет без оплаты';
  if (paymentStatus === 'expired_paid') return 'Раньше платил';
  return 'Не оформлен';
}

function getCandidateReason(row) {
  if (row.payment_status === 'free_rider') return 'Есть в платной группе, но активной оплаты нет';
  if (row.payment_status === 'expired_paid_inside') return 'Раньше платил, срок сгорел, но человек все еще внутри';
  if (row.payment_status === 'unpaid_lead') return 'Счет уже создавался, но до оплаты не дошло';
  if (row.payment_status === 'expired_paid') return 'Оплата в истории была, но сейчас активного доступа нет';
  return 'Человек найден в контуре, но в учтенную клиентскую базу еще не попал';
}

function getCandidateMatchingClass(state) {
  if (state === 'removed_admin') return 'bg-rose-50 text-rose-700 border-rose-200';
  if (state === 'paid_history') return 'bg-violet-50 text-violet-700 border-violet-200';
  if (state === 'invoice_pending') return 'bg-amber-50 text-amber-700 border-amber-200';
  if (state === 'started' || state === 'funnel_known') return 'bg-blue-50 text-blue-700 border-blue-200';
  return 'bg-slate-100 text-slate-600 border-slate-200';
}

function getCustomersTabLabel(tabId) {
  return CUSTOMERS_TAB_LABELS[tabId] || 'Учтенный сегмент';
}

function getMatchingOptionDisplay(option) {
  const target = option?.target_label ? ` • ${sanitizeDemoLabel(option.target_label)}` : '';
  return `${getCustomersTabLabel(option?.tab)}${target}`;
}

function getCandidateNextStep(row) {
  if (row.matching_is_ambiguous) {
    return {
      label: 'Проверить вручную',
      className: 'bg-amber-50 text-amber-700 border-amber-200'
    };
  }

  if (row.matching_tab) {
    return {
      label: 'Связать с учтенным',
      className: 'bg-blue-50 text-blue-700 border-blue-200'
    };
  }

  if (row.source_role === 'private_paid_group' && row.present_now) {
    return {
      label: 'Перенести в учтенные',
      className: 'bg-emerald-50 text-emerald-700 border-emerald-200'
    };
  }

  if (row.payment_status === 'unpaid_lead') {
    return {
      label: 'Написать',
      className: 'bg-amber-50 text-amber-700 border-amber-200'
    };
  }

  if (row.payment_status === 'no_payment_history' && row.source_role !== 'private_paid_group') {
    return {
      label: 'Проверить вручную',
      className: 'bg-slate-100 text-slate-600 border-slate-200'
    };
  }

  return {
    label: 'Решить вручную',
    className: 'bg-slate-100 text-slate-600 border-slate-200'
  };
}

function pickCandidateMatchingOption(row, { title = 'Выбери совпадение' } = {}) {
  const options = Array.isArray(row?.matching_options) && row.matching_options.length
    ? row.matching_options
    : (row?.matching_tab ? [{
        state: row.matching_state,
        label: row.matching_label,
        tab: row.matching_tab,
        target_label: row.matching_target_label || '',
        target_id: row.matching_target_id || ''
      }] : []);

  if (!options.length) return null;
  if (options.length === 1) return options[0];

  const list = options.map((option, index) => `${index + 1}. ${getMatchingOptionDisplay(option)}${option.label ? ` — ${option.label}` : ''}`).join('\n');
  const raw = window.prompt(`${title}\n\n${list}\n\nВведи номер варианта.`, '1');
  if (raw === null) return null;

  const index = Number(raw);
  if (!Number.isInteger(index) || index < 1 || index > options.length) {
    window.alert('Нужно ввести номер одного из вариантов.');
    return null;
  }

  return options[index - 1];
}

function parseReconciliationResolutionNote(note) {
  const tokens = String(note || '')
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean);

  const meta = {
    linkedTab: null,
    linkedTargetId: null,
    linkedTargetLabel: null,
    comment: ''
  };

  const commentParts = [];
  for (const token of tokens) {
    if (token.startsWith('linked_tab:')) meta.linkedTab = token.slice('linked_tab:'.length).trim();
    else if (token.startsWith('linked_target_id:')) meta.linkedTargetId = token.slice('linked_target_id:'.length).trim();
    else if (token.startsWith('linked_target_label:')) meta.linkedTargetLabel = token.slice('linked_target_label:'.length).trim();
    else commentParts.push(token);
  }

  meta.comment = commentParts.join(' • ');
  return meta;
}

function getResolutionTypeLabel(type) {
  if (type === 'linked_accounted') return 'Связан с учтенным';
  if (type === 'ignore_candidate') return 'Не трогать';
  return type || 'Решение';
}

function getSourceMemberCount(source) {
  const numeric = Number(source?.member_count_snapshot);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function isLargeReconciliationSource(source) {
  const memberCount = getSourceMemberCount(source);
  return memberCount !== null && memberCount >= LARGE_SOURCE_MEMBER_COUNT;
}

function isSourceOnCooldown(source) {
  if (!source?.cooldown_until) return false;
  return new Date(source.cooldown_until).getTime() > Date.now();
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

function getReconciliationRoleOptions(rawRoles = []) {
  return rawRoles.map((role) => ({
    id: String(role),
    label: RECONCILIATION_ROLE_LABELS[String(role)] || String(role)
  }));
}

function mapReconciliationDiscoveryStatus(row) {
  if (row.error) return 'error';
  if (row.admin_rights_status === 'admin') return row.is_configured ? 'success' : 'partial';
  if (row.admin_rights_status === 'member') return 'partial';
  return 'never';
}

function reconciliationStatusMeta(status) {
  if (status === 'success' || status === 'ok') return { label: 'Готов', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  if (status === 'partial' || status === 'needs_recheck' || status === 'queued') return { label: 'Нужно перепроверить', className: 'bg-amber-50 text-amber-700 border-amber-200' };
  if (status === 'running') return { label: 'Сканируется', className: 'bg-blue-50 text-blue-700 border-blue-200' };
  if (status === 'cooldown') return { label: 'На паузе', className: 'bg-violet-50 text-violet-700 border-violet-200' };
  if (status === 'failed' || status === 'error') return { label: 'Ошибка', className: 'bg-rose-50 text-rose-700 border-rose-200' };
  return { label: 'Ждет ручного скана', className: 'bg-slate-100 text-slate-600 border-slate-200' };
}

export function CustomersPage() {
  const { accessToken, user, profileRole } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const normalizedTab = normalizeCustomersTab(searchParams);
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
  const [openActionsRowId, setOpenActionsRowId] = useState(null);
  const [mutatingRowId, setMutatingRowId] = useState(null);
  const [handoff, setHandoff] = useState({
    abandonedFilter: '',
    orderTgUserIds: []
  });
  const [reconciliation, setReconciliation] = useState({
    loading: true,
    discovering: false,
    saving: false,
    scanningSourceId: '',
    syncingSourceId: '',
    error: '',
    scanStatuses: [],
    selectedUserbotId: '',
    userbots: [],
    roles: [],
    sources: [],
    discovered: []
  });
  const [candidateState, setCandidateState] = useState({
    loading: profileRole === 'admin',
    error: '',
    updatedAt: null,
    summary: {
      total: 0,
      free_rider: 0,
      unpaid_lead: 0,
      expired_paid_inside: 0,
      no_payment_history: 0
    },
    rows: [],
    recentResolutions: []
  });
  const [candidateLimit, setCandidateLimit] = useState(120);
  const [candidateFilters, setCandidateFilters] = useState({
    sourceRole: 'all',
    match: 'all',
    payment: 'all'
  });
  const [state, setState] = useState({
    loading: true,
    refreshing: false,
    error: '',
    updatedAt: null,
    bots: [],
    channels: [],
    started: [],
    abandoned: [],
    crm: [],
    removedAdmin: [],
    orders: [],
    access: [],
    bases: [],
    viewed: []
  });
  const [audienceState, setAudienceState] = useState({
    loading: false,
    contourId: null,
    targets: [],
    syncingType: null,
    error: ''
  });

  const loadCandidates = useCallback(async ({ silent = false, shouldCancel = () => false } = {}) => {
    if (!accessToken || profileRole !== 'admin') return;

    if (!silent) {
      setCandidateState((prev) => ({ ...prev, loading: true, error: '' }));
    }

    try {
      const params = new URLSearchParams();
      if (selectedBotId) params.set('bot_id', selectedBotId);
      const data = await apiRequest(`/api/customers/reconciliation-candidates${params.toString() ? `?${params.toString()}` : ''}`, { accessToken });
      if (shouldCancel()) return;

      setCandidateState({
        loading: false,
        error: '',
        updatedAt: data.updatedAt || new Date().toISOString(),
        summary: data.summary || {
          total: 0,
          free_rider: 0,
          unpaid_lead: 0,
          expired_paid_inside: 0,
          no_payment_history: 0
        },
        rows: data.candidates || [],
        recentResolutions: data.recent_resolutions || []
      });
    } catch (error) {
      if (shouldCancel()) return;
      setCandidateState((prev) => ({
        ...prev,
        loading: false,
        error: error.message
      }));
    }
  }, [accessToken, profileRole, selectedBotId]);

  useEffect(() => {
    let cancelled = false;

    async function loadReconciliation() {
      if (!accessToken || profileRole !== 'admin') return;

      setReconciliation((prev) => ({ ...prev, loading: true, error: '' }));
      try {
        const data = await apiRequest('/api/customers/reconciliation-sources', { accessToken });
        if (cancelled) return;

        setReconciliation((prev) => ({
          ...prev,
          loading: false,
          error: '',
          scanStatuses: data.scan_statuses || [],
          selectedUserbotId: data.contour?.selected_userbot_id || data.userbots?.[0]?.id || '',
          userbots: data.userbots || [],
          roles: data.roles || [],
          sources: data.contour?.sources || [],
          discovered: prev.discovered.length ? prev.discovered : []
        }));
      } catch (error) {
        if (cancelled) return;
        setReconciliation((prev) => ({
          ...prev,
          loading: false,
          error: error.message
        }));
      }
    }

    loadReconciliation();
    return () => {
      cancelled = true;
    };
  }, [accessToken, profileRole]);

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

  const loadCustomers = useCallback(async ({ silent = false, shouldCancel = () => false } = {}) => {
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

      if (shouldCancel()) return;

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
        channels: data.channels || [],
        started: segments.startedContacts || [],
        abandoned: segments.abandonedInvoices || [],
        crm: [
          ...(segments.activeCustomers || []),
          ...(segments.expiredCustomers || [])
        ],
        removedAdmin: segments.removedByAdmin || [],
        orders: segments.recentOrders || [],
        access: [
          ...(segments.needsAccessCheck || []),
          ...(segments.inGroupLeaks || [])
        ],
        bases: segments.bases || [],
        viewed: segments.viewedTariffs || []
      });
    } catch (error) {
      if (!shouldCancel()) {
        setState((prev) => ({
          ...prev,
          loading: false,
          refreshing: false,
          error: error.message
        }));
      }
    }
  }, [accessToken, selectedBotId, setSearchParams]);

  useEffect(() => {
    let cancelled = false;

    loadCustomers({ shouldCancel: () => cancelled });
    const intervalId = accessToken
      ? window.setInterval(() => loadCustomers({ silent: true, shouldCancel: () => cancelled }), 60_000)
      : null;

    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [accessToken, loadCustomers]);

  useEffect(() => {
    let cancelled = false;

    loadCandidates({ shouldCancel: () => cancelled });
    const intervalId = window.setInterval(() => loadCandidates({ silent: true, shouldCancel: () => cancelled }), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [loadCandidates]);

  const rowsByTab = useMemo(() => ({
    started: state.started.map((row) => ({
      id: row.id,
      tg_user_id: row.tg_user_id,
      tg_username: row.tg_username,
      display_name: row.display_name,
      first_name: row.first_name,
      last_name: row.last_name,
      status: row.status || 'Нажал /start',
      reason: getStartedReason(),
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
      reason: getAbandonedReason(row),
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
      status: getViewedEventLabel(row.event_type),
      reason: 'Счет еще не создан',
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
      status: 'Доступ активен',
      reason: appendAccessSource(getCustomerReason(row), row.access_source_label),
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
      status: 'Доступ закончился',
      reason: appendAccessSource(getCustomerReason(row), row.access_source_label),
      expires_at: row.expires_at,
      href: '/app/customers?tab=customers-expired'
    })),
    'removed-admin': state.removedAdmin.map((row) => ({
      id: row.id,
      tg_user_id: row.tg_user_id,
      channel_id: row.channel_id,
      tg_username: row.tg_username,
      display_name: row.display_name,
      first_name: row.first_name,
      last_name: row.last_name,
      channel_title: row.channel_title,
      title: row.channel_title,
      status: 'Удален админом',
      reason: getRemovedAdminReason(row),
      expires_at: row.expires_at,
      href: '/app/customers?tab=removed-admin'
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
      in_group: row.in_group,
      access_source_label: row.access_source_label,
      status: row.status === 'expired' && row.in_group === true ? 'Доступ закончился, но человек внутри' : 'Вход не подтвержден',
      reason: getAccessReason(row),
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

  const audienceTargetType = isAudienceTab ? activeTab.replace('audience-', '').replace(/-/g, '_') : null;
  const currentAudienceTarget = isAudienceTab
    ? audienceState.targets.find((t) => t.targetType === audienceTargetType)
    : null;

  const effectiveTab = isBotTab ? activeBotSubtab : activeTab;
  const activeRows = useMemo(
    () => (rowsByTab[effectiveTab] || [])
      .filter((row) => !focusChannelId || String(row.channel_id || '') === String(focusChannelId))
      .filter((row) => effectiveTab !== 'abandoned' || !handoff.abandonedFilter || row.abandoned_status === handoff.abandonedFilter)
      .filter((row) => effectiveTab !== 'access' || handoff.orderTgUserIds.length === 0 || handoff.orderTgUserIds.includes(String(row.tg_user_id || '')))
      .filter((row) => rowMatches(row, search)),
    [effectiveTab, focusChannelId, handoff.abandonedFilter, handoff.orderTgUserIds, rowsByTab, search]
  );

  const stats = useMemo(() => ({
    started: state.started.length,
    viewed: state.viewed.length,
    abandoned: state.abandoned.length,
    activeCustomers: state.crm.filter((row) => row.status === 'active').length,
    expiredCustomers: state.crm.filter((row) => row.status === 'expired').length,
    removedAdmin: state.removedAdmin.length,
    access: state.access.length
  }), [state]);
  const selectedBot = useMemo(
    () => state.bots.find((item) => String(item.id) === String(selectedBotId)) || null,
    [state.bots, selectedBotId]
  );
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

  const filteredCandidateRows = useMemo(
    () => candidateState.rows.filter((row) => {
      if (candidateFilters.sourceRole !== 'all' && row.source_role !== candidateFilters.sourceRole) {
        return false;
      }

      if (candidateFilters.match === 'matched' && !row.matching_tab) {
        return false;
      }

      if (candidateFilters.match === 'unmatched' && row.matching_tab) {
        return false;
      }

      if (candidateFilters.payment !== 'all' && row.payment_status !== candidateFilters.payment) {
        return false;
      }

      return rowMatches(row, search);
    }),
    [candidateFilters.match, candidateFilters.payment, candidateFilters.sourceRole, candidateState.rows, search]
  );
  const visibleCandidateRows = useMemo(
    () => filteredCandidateRows.slice(0, candidateLimit),
    [candidateLimit, filteredCandidateRows]
  );
  const savedSourceRoleMap = useMemo(
    () => new Map((reconciliation.sources || []).map((row) => [String(row.chat_id), row.role])),
    [reconciliation.sources]
  );
  const reconciliationRoleOptions = useMemo(
    () => getReconciliationRoleOptions(reconciliation.roles),
    [reconciliation.roles]
  );

  async function discoverReconciliationSources() {
    if (!reconciliation.selectedUserbotId) {
      window.alert('Сначала выбери юзербота для контура.');
      return;
    }

      setReconciliation((prev) => ({ ...prev, discovering: true, error: '' }));
    try {
      const data = await apiRequest('/api/customers/reconciliation-sources/discover', {
        accessToken,
        method: 'POST',
        body: { userbot_id: reconciliation.selectedUserbotId }
      });
      const discovered = (data.discovered_sources || []).map((row) => ({
        ...row,
        role: savedSourceRoleMap.get(String(row.chat_id)) || row.configured_role || 'ignored'
      }));
      setReconciliation((prev) => ({
        ...prev,
        discovering: false,
        selectedUserbotId: data.selected_userbot_id || prev.selectedUserbotId,
        userbots: data.userbots || prev.userbots,
        discovered
      }));
    } catch (error) {
      setReconciliation((prev) => ({
        ...prev,
        discovering: false,
        error: error.message
      }));
    }
  }

  function updateDiscoveredRole(chatId, role) {
    setReconciliation((prev) => ({
      ...prev,
      discovered: prev.discovered.map((row) => (
        String(row.chat_id) === String(chatId)
          ? { ...row, role }
          : row
      ))
    }));
  }

  async function saveReconciliationContour() {
    if (!reconciliation.selectedUserbotId) {
      window.alert('Сначала выбери юзербота.');
      return;
    }

    const activeSources = reconciliation.discovered
      .filter((row) => row.role && row.role !== 'ignored')
      .map((row) => {
        const checkedAt = new Date().toISOString();
        return {
        chat_id: String(row.chat_id),
        chat_type: row.telegram_type || row.chat_type || 'unknown',
        title_snapshot: row.title || '',
        username_snapshot: row.username || null,
        role: row.role,
        bot_id: row.already_bound_bot_id || row.linked_bot_id || null,
        is_active: true,
        scan_enabled: true,
        admin_verified: row.admin_rights_status === 'admin',
        member_count_snapshot: row.member_count ?? null,
        admin_rights_snapshot: {
          status: row.admin_rights_status || 'unknown',
          checked_at: checkedAt,
          source: 'customers_manual_discovery'
        },
        visibility_snapshot: {
          status: row.visibility_status || 'visible_now',
          checked_at: checkedAt,
          source: 'customers_manual_discovery'
        }
      };
      });

    setReconciliation((prev) => ({ ...prev, saving: true, error: '' }));
    try {
      const data = await apiRequest('/api/customers/reconciliation-sources', {
        accessToken,
        method: 'POST',
        body: {
          userbot_id: reconciliation.selectedUserbotId,
          sources: activeSources
        }
      });

      setReconciliation((prev) => ({
        ...prev,
        saving: false,
        selectedUserbotId: data.contour?.selected_userbot_id || prev.selectedUserbotId,
        scanStatuses: data.scan_statuses || prev.scanStatuses,
        roles: data.roles || prev.roles,
        userbots: data.userbots || prev.userbots,
        sources: data.contour?.sources || [],
        discovered: prev.discovered.map((row) => {
          const saved = (data.contour?.sources || []).find((source) => String(source.chat_id) === String(row.chat_id));
          return saved ? { ...row, role: saved.role || row.role, is_configured: true } : row;
        })
      }));

      await loadCandidates({ silent: true });

      window.alert(`Контур сохранен. Источников в работе: ${data.contour?.summary?.active_sources ?? activeSources.length}.`);
    } catch (error) {
      setReconciliation((prev) => ({
        ...prev,
        saving: false,
        error: error.message
      }));
    }
  }

  async function scanReconciliationSource(sourceId) {
    if (!sourceId) return;

    setReconciliation((prev) => ({
      ...prev,
      scanningSourceId: String(sourceId),
      error: ''
    }));
    try {
      const data = await apiRequest(`/api/customers/reconciliation-sources/${sourceId}/scan`, {
        accessToken,
        method: 'POST'
      });

      setReconciliation((prev) => ({
        ...prev,
        scanningSourceId: '',
        scanStatuses: data.scan_statuses || prev.scanStatuses,
        roles: data.roles || prev.roles,
        userbots: data.userbots || prev.userbots,
        selectedUserbotId: data.contour?.selected_userbot_id || prev.selectedUserbotId,
        sources: data.contour?.sources || prev.sources
      }));
    } catch (error) {
      setReconciliation((prev) => ({
        ...prev,
        scanningSourceId: '',
        error: error.message
      }));
    }
  }

  async function syncReconciliationSourceMembers(source) {
    if (!source?.id) return;

    const sourceLabel = sanitizeDemoLabel(source.title_snapshot || source.already_bound_channel_title || source.chat_id);
    const memberCount = getSourceMemberCount(source);
    const isLargeSource = isLargeReconciliationSource(source);
    const confirmationText = isLargeSource
      ? `Источник «${sourceLabel}» выглядит большим${memberCount ? `: около ${memberCount} участников` : ''}.\n\nТакой синк лучше запускать только когда он реально нужен. Продолжить ручной синк именно сейчас?`
      : `Синкнуть участников только из «${sourceLabel}» в связанные базы?`;
    const confirmed = window.confirm(confirmationText);
    if (!confirmed) return;

    setReconciliation((prev) => ({
      ...prev,
      syncingSourceId: String(source.id),
      error: ''
    }));
    try {
      const data = await apiRequest(`/api/customers/reconciliation-sources/${source.id}/sync-members`, {
        accessToken,
        method: 'POST',
        body: {
          confirm_large_source: isLargeSource
        }
      });

      setReconciliation((prev) => ({
        ...prev,
        syncingSourceId: '',
        sources: prev.sources.map((row) => (
          String(row.id) === String(source.id)
            ? {
                ...row,
                last_scan_status: 'success',
                last_scan_error: null,
                last_scan_at: new Date().toISOString(),
                cooldown_until: data.cooldown_until || row.cooldown_until,
                next_scan_after: data.cooldown_until || row.next_scan_after
              }
            : row
        ))
      }));

      await loadCandidates({ silent: true });

      const delaySeconds = data.sync_pre_delay_ms ? Math.round(Number(data.sync_pre_delay_ms) / 1000) : null;
      window.alert(`Синк завершен. Источник: ${data.scanned_channel_title || sourceLabel}. Участников подняли: ${data.synced_members || 0}.${delaySeconds ? ` Перед Telegram-запросом система ждала около ${delaySeconds} сек.` : ''} Источник поставлен на паузу до следующего ручного запуска.`);
    } catch (error) {
      setReconciliation((prev) => ({
        ...prev,
        syncingSourceId: '',
        error: error.message
      }));
    }
  }

  useEffect(() => {
    setOpenActionsRowId(null);
  }, [activeTab, search, focusChannelId, selectedBotId]);

  useEffect(() => {
    setCandidateLimit(120);
  }, [candidateFilters.match, candidateFilters.payment, candidateFilters.sourceRole, search, selectedBotId]);

  useEffect(() => {
    function handlePointerDown(event) {
      if (!event.target.closest('[data-row-actions-root="true"]')) {
        setOpenActionsRowId(null);
      }
    }

    window.addEventListener('mousedown', handlePointerDown);
    return () => window.removeEventListener('mousedown', handlePointerDown);
  }, []);

  // Audience loading
  const loadAudience = useCallback(async () => {
    if (!accessToken) return;
    try {
      setAudienceState((prev) => ({ ...prev, loading: true, error: '' }));
      const data = await apiRequest('/api/audience', { accessToken });
      setAudienceState((prev) => ({
        ...prev,
        loading: false,
        contourId: data.contourId || null,
        targets: data.targets || [],
        error: ''
      }));
    } catch (err) {
      setAudienceState((prev) => ({ ...prev, loading: false, error: err.message }));
    }
  }, [accessToken]);

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
      toast.success(`Загружено ${result.synced_count} участников, из них ${result.active_count} активных`);
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
    const contextLabel = sanitizeDemoLabel(row.channel_title || row.title || '');

    setOpenActionsRowId(null);
    setMutatingRowId(rowId);

    try {
      const channelId = resolveActionChannelId(row);
      if (!channelId) {
        setMutatingRowId(null);
        return;
      }

      if (action === 'extend-5' || action === 'extend-30' || action === 'extend-forever') {
        const days = action === 'extend-5' ? 5 : action === 'extend-30' ? 30 : 'forever';

        const hasCrmSub = row.id && (['customers-active', 'customers-expired', 'removed-admin', 'access'].includes(activeTab) || row._crmSubscription);

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
        if (!rowId) {
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

  async function runCandidateImport(row, duration = 'forever') {
    if (!canManageRow(row)) return;

    const rowId = row.id ? String(row.id) : null;
    const clientLabel = getClientDisplayName(row) || (row.tg_username ? `@${row.tg_username}` : `TG ${row.tg_user_id}`);
    const durationLabel = duration === 'forever' ? 'навсегда' : `${duration} дней`;

    setOpenActionsRowId(null);
    setMutatingRowId(rowId);

    try {
      const channelId = resolveActionChannelId(row);
      if (!channelId) {
        setMutatingRowId(null);
        return;
      }

      const confirmed = window.confirm(`Перенести ${clientLabel} в учтенную базу и оформить доступ на ${durationLabel}?`);
      if (!confirmed) {
        setMutatingRowId(null);
        return;
      }

      await apiRequest('/api/customers/reconciliation-candidates/import', {
        accessToken,
        method: 'POST',
        body: {
          source_id: row.source_id,
          tg_user_id: String(row.tg_user_id),
          channel_id: channelId,
          duration_days: duration
        }
      });

      setCandidateState((prev) => ({
        ...prev,
        rows: prev.rows.filter((item) => String(item.id) !== String(row.id)),
        summary: {
          ...prev.summary,
          total: Math.max(0, (prev.summary.total || 0) - 1),
          [row.payment_status]: Math.max(0, (prev.summary[row.payment_status] || 0) - 1)
        }
      }));

      await loadCustomers();
      window.alert(
        duration === 'forever'
          ? 'Кандидат перенесен в учтенную базу с бессрочным доступом. Если нужно, срок потом можно поправить вручную.'
          : `Кандидат перенесен в учтенную базу и получил доступ на ${duration} дней.`
      );
    } catch (error) {
      window.alert(error.message);
    } finally {
      setMutatingRowId(null);
    }
  }

  async function resolveCandidate(row, resolutionType) {
    if (!row?.source_id || !row?.tg_user_id) return;

    const rowId = row.id ? String(row.id) : null;
    const clientLabel = getClientDisplayName(row) || (row.tg_username ? `@${row.tg_username}` : `TG ${row.tg_user_id}`);
    const promptText = resolutionType === 'linked_accounted'
      ? `Пометить ${clientLabel} как уже учтенного в BullRun и убрать из нижней таблицы?`
      : `Убрать ${clientLabel} из нижней таблицы как неактуального кандидата?`;

    if (!window.confirm(promptText)) return;

    setOpenActionsRowId(null);
    setMutatingRowId(rowId);
    try {
      await apiRequest('/api/customers/reconciliation-candidates/resolve', {
        accessToken,
        method: 'POST',
        body: {
          source_id: row.source_id,
          tg_user_id: String(row.tg_user_id),
          resolution_type: resolutionType
        }
      });

      setCandidateState((prev) => ({
        ...prev,
        rows: prev.rows.filter((item) => String(item.id) !== String(row.id)),
        summary: {
          ...prev.summary,
          total: Math.max(0, (prev.summary.total || 0) - 1),
          [row.payment_status]: Math.max(0, (prev.summary[row.payment_status] || 0) - 1)
        }
      }));
    } catch (error) {
      window.alert(error.message);
    } finally {
      setMutatingRowId(null);
    }
  }

  async function linkCandidateToAccounted(row) {
    if (!row?.source_id || !row?.tg_user_id || !row?.matching_tab) return;

    const selectedMatch = pickCandidateMatchingOption(row, { title: 'С каким учтенным сегментом связываем кандидата?' });
    if (!selectedMatch) return;

    const clientLabel = getClientDisplayName(row) || (row.tg_username ? `@${row.tg_username}` : `TG ${row.tg_user_id}`);
    const targetLabel = getCustomersTabLabel(selectedMatch.tab);
    const targetContext = selectedMatch.target_label ? `\nЦель: ${selectedMatch.target_label}` : '';
    const operatorNote = window.prompt(
      `Связать ${clientLabel} с сегментом «${targetLabel}»?${targetContext}\n\nЕсли нужно, оставь короткий комментарий для истории.`,
      selectedMatch.label ? `Автоподсказка: ${selectedMatch.label}` : ''
    );

    if (operatorNote === null) return;

    setOpenActionsRowId(null);
    setMutatingRowId(String(row.id));
    try {
      await apiRequest('/api/customers/reconciliation-candidates/resolve', {
        accessToken,
        method: 'POST',
        body: {
          source_id: row.source_id,
          tg_user_id: String(row.tg_user_id),
          resolution_type: 'linked_accounted',
          linked_tab: selectedMatch.tab,
          linked_target_label: selectedMatch.target_label || '',
          linked_target_id: selectedMatch.target_id || '',
          note: operatorNote.trim()
        }
      });

      setCandidateState((prev) => ({
        ...prev,
        rows: prev.rows.filter((item) => String(item.id) !== String(row.id)),
        summary: {
          ...prev.summary,
          total: Math.max(0, (prev.summary.total || 0) - 1),
          [row.payment_status]: Math.max(0, (prev.summary[row.payment_status] || 0) - 1)
        }
      }));
    } catch (error) {
      window.alert(error.message);
    } finally {
      setMutatingRowId(null);
    }
  }

  async function undoCandidateResolution(row) {
    if (!row?.source_id || !row?.tg_user_id) return;

    const confirmed = window.confirm(`Вернуть TG ${row.tg_user_id} обратно в нижнюю таблицу кандидатов?`);
    if (!confirmed) return;

    try {
      await apiRequest('/api/customers/reconciliation-candidates/resolve', {
        accessToken,
        method: 'DELETE',
        body: {
          source_id: row.source_id,
          tg_user_id: String(row.tg_user_id)
        }
      });

      await loadCandidates({ silent: true });
    } catch (error) {
      window.alert(error.message);
    }
  }

  function jumpToCandidateMatch(row) {
    if (!row?.matching_tab || !row?.tg_user_id) return;
    const selectedMatch = pickCandidateMatchingOption(row, { title: 'Какое совпадение открыть?' });
    if (!selectedMatch) return;
    setSearch(String(row.tg_user_id));
    setTabState(selectedMatch.tab);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  if (state.loading) {
    return <LoadingState text="Собираем клиентов..." />;
  }

  return (
    <section className="page page--flush space-y-6">
      {/* Main Content Card */}
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
          {/* Metrics Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
            {[
              { label: 'Активный доступ', value: stats.activeCustomers, icon: CheckCircle2, color: 'text-emerald-500', tab: 'customers-active' },
              { label: 'Доступ закончился', value: stats.expiredCustomers, icon: Clock, color: stats.expiredCustomers > 0 ? 'text-red-500' : 'text-slate-400', tab: 'customers-expired' },
              { label: 'Оплатили, но вход не подтвержден', value: stats.access, icon: Lock, color: stats.access > 0 ? 'text-purple-500' : 'text-slate-400', tab: 'access' },
              { label: 'Смотрели тариф, но не создали счет', value: stats.viewed, icon: Eye, color: stats.viewed > 0 ? 'text-amber-500' : 'text-slate-400', tab: 'viewed' },
              { label: 'Не смогли оплатить', value: stats.abandoned, icon: FileText, color: stats.abandoned > 0 ? 'text-blue-500' : 'text-slate-400', tab: 'abandoned' },
            ].map((item, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => setBotSubtab(item.tab)}
                className="bg-slate-50/50 border border-slate-100 p-6 rounded-3xl text-left transition-all hover:border-slate-200 hover:bg-slate-50"
              >
                <div className="flex items-center justify-between mb-4">
                  <span className="text-xs font-black uppercase tracking-widest text-slate-400">{item.label}</span>
                  <item.icon className={`w-5 h-5 ${item.color} opacity-70`} />
                </div>
                <div className={`text-3xl font-black tracking-tighter ${item.color}`}>{item.value}</div>
              </button>
            ))}
          </div>
        </section>

        {/* Filter & Search Section */}
        <section className="p-6 md:p-8 bg-slate-50/50 border-t border-slate-200/60">
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
                  className={`flex items-center gap-2 px-4 py-3 text-sm font-bold whitespace-nowrap border-b-2 transition-all ${
                    isActive
                      ? 'border-indigo-600 text-indigo-600'
                      : isDisabled
                        ? 'border-transparent text-slate-300 cursor-not-allowed'
                        : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                  }`}
                  onClick={() => !isDisabled && setTabState(tab.id)}
                  disabled={!!isDisabled}
                >
                  {Icon && <Icon className="w-4 h-4" />}
                  {tab.label}
                  {count !== null && count > 0 && (
                    <span className={`text-xs px-1.5 py-0.5 rounded-md ${isActive ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-500'}`}>
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
        <div className="border-t border-slate-200/60">
        {isAudienceTab ? (
          <AudienceTable
            target={currentAudienceTarget}
            syncingType={audienceState.syncingState}
            onSync={syncAudience}
            loading={audienceState.loading}
            crmMap={crmMap}
            onAction={runSubscriptionAction}
            openActionsRowId={openActionsRowId}
            setOpenActionsRowId={setOpenActionsRowId}
          />
        ) : (
        <>
          {isBotTab && (
            <div className="flex gap-2 p-1.5 bg-slate-100 rounded-2xl overflow-x-auto mx-8 mt-4">
              {BOT_SUBTABS.map((sub) => (
                <button
                  key={sub.id}
                  type="button"
                  className={`shrink-0 px-4 py-2 text-xs font-black uppercase tracking-wider rounded-xl transition-all ${
                    activeBotSubtab === sub.id
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                  onClick={() => setBotSubtab(sub.id)}
                >
                  {sub.label}
                </button>
              ))}
            </div>
          )}
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
                      <th className="px-6 py-4 font-black text-slate-400 uppercase tracking-widest text-[10px] hidden md:table-cell">Тариф / канал</th>
                      <th className="px-6 py-4 font-black text-slate-400 uppercase tracking-widest text-[10px]">Статус</th>
                      <th className="px-6 py-4 font-black text-slate-400 uppercase tracking-widest text-[10px] hidden lg:table-cell">Причина</th>
                      <th className="px-6 py-4 font-black text-slate-400 uppercase tracking-widest text-[10px] text-right">Действия</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {activeRows.slice(0, limit).map((row) => {
                      const statusConfig = (() => {
                        if (row.priority >= 90) return { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', icon: AlertCircle };
                        if (row.status === 'Доступ активен') return { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', icon: CheckCircle2 };
                        if (row.status === 'Удален админом') return { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200', icon: AlertCircle };
                        if (row.status === 'Доступ закончился' || row.status === 'Доступ закончился, но человек внутри') return { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', icon: Clock };
                        return { bg: 'bg-slate-100', text: 'text-slate-600', border: 'border-slate-200', icon: null };
                      })();
                      const contextDisplay = getContextDisplay(row, activeTab);

                      const StatusIcon = statusConfig.icon;

                      return (
                        <tr key={`${activeTab}-${row.id}`} className="hover:bg-slate-50/80 transition-colors">

                          {/* Client Col */}
                          <td className="px-6 py-4">
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
                          </td>

                          {/* Context Col */}
                          <td className="px-6 py-4 hidden md:table-cell">
                            <div className="font-bold text-slate-800 text-sm truncate">
                              {contextDisplay.primary}
                            </div>
                            {contextDisplay.secondary ? (
                              <div className="text-xs text-slate-500 truncate mt-1">
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
                            <div className="text-slate-600 font-medium text-sm truncate max-w-xs" title={row.reason || ''}>
                              {row.reason || '—'}
                            </div>
                          </td>

                          {/* Actions Col */}
                          <td className="px-6 py-4 text-right">
                            <div className="flex justify-end gap-2">
                              {canManageRow(row) ? (
                                <div className="relative" data-row-actions-root="true">
                                  <button
                                    type="button"
                                    className="p-2 bg-white border border-slate-200 text-slate-500 hover:text-slate-900 hover:border-slate-300 hover:bg-slate-50 rounded-lg transition-all shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
                                    onClick={() => setOpenActionsRowId((prev) => (prev === row.id ? null : row.id))}
                                    disabled={mutatingRowId === String(row.id)}
                                    title="Действия"
                                  >
                                    <MoreHorizontal className="w-3.5 h-3.5" />
                                  </button>

                                  {openActionsRowId === row.id ? (
                                    <div className="absolute right-0 top-full mt-2 w-56 rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10 z-20 overflow-hidden">
                                      <button
                                        type="button"
                                        className="w-full px-4 py-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                                        onClick={() => runSubscriptionAction(row, 'extend-5')}
                                      >
                                        Продлить на 5 дней
                                      </button>
                                      <button
                                        type="button"
                                        className="w-full px-4 py-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                                        onClick={() => runSubscriptionAction(row, 'extend-30')}
                                      >
                                        Продлить на 30 дней
                                      </button>
                                      <button
                                        type="button"
                                        className="w-full px-4 py-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                                        onClick={() => runSubscriptionAction(row, 'extend-forever')}
                                      >
                                        Выдать навсегда
                                      </button>
                                      <div className="border-t border-slate-100" />
                                      {row.id ? (
                                        <button
                                          type="button"
                                          className="w-full px-4 py-3 text-left text-sm font-semibold text-rose-600 hover:bg-rose-50 transition-colors"
                                          onClick={() => runSubscriptionAction(row, 'kick')}
                                        >
                                          Удалить из группы
                                        </button>
                                      ) : null}
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}
                              {row.tg_user_id && (
                                <>
                                  <button className="p-2 bg-white border border-slate-200 text-slate-400 hover:text-blue-600 hover:border-blue-200 hover:bg-blue-50 rounded-lg transition-all shadow-sm" onClick={() => openUserbotCenterHandoff(row.tg_user_id, '', '', navigate)} title="Написать">
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
                  <a
                    href="/app/broadcast"
                    className="w-full md:w-auto px-6 py-3 bg-blue-600 text-white rounded-xl text-sm font-bold shadow-md shadow-blue-500/20 hover:bg-blue-700 transition-all flex items-center justify-center gap-2"
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
