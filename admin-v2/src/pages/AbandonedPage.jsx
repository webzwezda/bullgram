import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ShoppingCart, Send, Tag, Clock, AlertCircle, Ban, ChevronRight, Bot as BotIcon, Save, RotateCcw, Inbox } from 'lucide-react';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { supabase } from '../lib/supabase.js';
import { LoadingState } from '../ui/LoadingState.jsx';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

const STANDARD_TEMPLATE = `🛒 **Привет!**

Я заметил, что ты хотел купить «**{tariff_name}**», но остановился.

🎁 Только сейчас я даю тебе **скидку {discount_percent}%**!
Новая цена: **{discount_price} {currency}** (вместо {old_price} {currency}).

👉 *Жми кнопку ниже, чтобы забрать доступ со скидкой.*`;

const TRIAL_TEMPLATE = `🧪 **Ты почти забрал пробник**

Ты нажал на «**{tariff_name}**», но не завершил оплату.

Если хочешь быстро посмотреть, что внутри — просто вернись в бота и забери пробный доступ.

👉 *Пробник нужен как быстрый вход. Не тяни, пока интерес горячий.*`;

function formatRelativeTime(iso) {
  if (!iso) return '—';
  const ts = new Date(iso).getTime();
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60_000) return 'только что';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} мин назад`;
  if (diff < 24 * 3600_000) {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  const hoursTotal = Math.floor(diff / 3600_000);
  if (hoursTotal < 48) return `${hoursTotal} ч назад`;
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function deliveryBadge(deliveredBy = '', payload = {}) {
  switch (deliveredBy) {
    case 'bot':
      return { text: 'Бот', cls: 'bg-emerald-50 text-emerald-700', Icon: Send };
    case 'skipped': {
      const reason = payload?.reason;
      const text = reason === 'already_subscribed'
        ? 'Пропущено: активная подписка'
        : reason === 'newer_invoice_exists'
          ? 'Пропущено: создан новый счёт'
          : 'Пропущено';
      return { text, cls: 'bg-slate-100 text-slate-600', Icon: Ban };
    }
    case 'failed':
      return { text: 'Не доставлено', cls: 'bg-rose-50 text-rose-700', Icon: AlertCircle };
    default:
      return { text: 'Неизвестно', cls: 'bg-slate-100 text-slate-600', Icon: AlertCircle };
  }
}

function downloadCsv(filename, header, rows) {
  const escapeCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const csv = [header, ...rows].map((line) => line.map(escapeCell).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function openApp(href) {
  if (!href) return;
  window.location.href = href;
}

export function AbandonedPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedBotId = searchParams.get('bot') || '';

  const [bots, setBots] = useState([]);
  const [botChannels, setBotChannels] = useState([]);
  const [events, setEvents] = useState([]);
  const [inWindow, setInWindow] = useState([]);
  const [stale, setStale] = useState([]);
  const [textDraft, setTextDraft] = useState('');
  const [textOriginal, setTextOriginal] = useState('');
  const [discountDraft, setDiscountDraft] = useState(0);
  const [discountOriginal, setDiscountOriginal] = useState(0);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedEventId, setExpandedEventId] = useState(null);
  const reqIdRef = useRef(0);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    async function loadBots() {
      const { data, error: botsError } = await supabase
        .from('tg_accounts')
        .select('id, tg_username, custom_label, bot_role')
        .eq('owner_id', user.id)
        .eq('account_type', 'bot')
        .neq('bot_role', 'ops')
        .order('created_at', { ascending: true });

      if (botsError) {
        setError(botsError.message);
        setBots([]);
        setLoading(false);
        return;
      }
      const filtered = data || [];
      if (cancelled) return;
      setBots(filtered);
      if (filtered.length > 0 && !selectedBotId) {
        const next = new URLSearchParams(searchParams);
        next.set('bot', filtered[0].id);
        setSearchParams(next);
      }
      if (filtered.length === 0) {
        setLoading(false);
      }
    }

    loadBots();
    return () => { cancelled = true; };
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id || !selectedBotId || bots.length === 0) return;
    if (!bots.some((b) => b.id === selectedBotId)) return;

    let cancelled = false;

    async function loadBotData({ silent = false } = {}) {
      const reqId = ++reqIdRef.current;
      if (!silent) {
        setLoading(true);
        setError('');
      }

      try {
        const { data: channelsData, error: channelsError } = await supabase
          .from('channels')
          .select('id, title')
          .eq('bot_id', selectedBotId);

        if (channelsError) throw channelsError;
        const channelIds = (channelsData || []).map((c) => c.id);
        if (cancelled) return;
        setBotChannels(channelsData || []);

        if (channelIds.length === 0) {
          if (reqId !== reqIdRef.current) return;
          setEvents([]);
          setInWindow([]);
          setStale([]);
          setLoading(false);
          return;
        }

        const [{ data: invoicesData, error: invoicesError }, { data: eventsData, error: eventsError }] = await Promise.all([
          supabase
            .from('invoices')
            .select('id, tg_user_id, amount, currency, status, created_at, tariff_id, channel_id, tariffs(title, is_trial, trial_label, price)')
            .in('channel_id', channelIds)
            .in('status', ['pending', 'awaiting_receipt'])
            .eq('reminded', false)
            .order('created_at', { ascending: false })
            .limit(200),
          supabase
            .from('access_events')
            .select('id, created_at, channel_id, invoice_id, tg_user_id, payload')
            .eq('event_type', 'abandoned_reminder')
            .in('channel_id', channelIds)
            .order('created_at', { ascending: false })
            .limit(50)
        ]);

        if (invoicesError) throw invoicesError;
        if (eventsError) throw eventsError;
        if (cancelled) return;
        if (reqId !== reqIdRef.current) return;

        const now = Date.now();
        const twoHoursAgoTs = now - TWO_HOURS_MS;
        const threeHoursAgoTs = now - THREE_HOURS_MS;

        const allInvoices = invoicesData || [];
        const inWindowList = [];
        const staleList = [];
        allInvoices.forEach((inv) => {
          const createdTs = new Date(inv.created_at).getTime();
          if (createdTs <= twoHoursAgoTs && createdTs >= threeHoursAgoTs) {
            inWindowList.push(inv);
          } else if (createdTs < threeHoursAgoTs) {
            staleList.push(inv);
          }
        });

        setInWindow(inWindowList);
        setStale(staleList);
        setEvents(eventsData || []);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        if (reqId !== reqIdRef.current) return;
        setError(err.message || 'Ошибка загрузки');
        setLoading(false);
      }
    }

    loadBotData();
    const intervalId = window.setInterval(() => {
      loadBotData({ silent: true });
    }, 60_000);

    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [user?.id, selectedBotId, bots.length]);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    async function loadSettings() {
      try {
        const { data, error: settingsError } = await supabase
          .from('payment_settings')
          .select('abandoned_text, abandoned_discount_percent')
          .eq('owner_id', user.id)
          .maybeSingle();
        if (cancelled) return;
        if (settingsError && !(settingsError.message || '').includes('No rows found')) {
          setSaveError(settingsError.message);
          return;
        }
        const text = data?.abandoned_text?.trim() || STANDARD_TEMPLATE;
        const discount = Number(data?.abandoned_discount_percent || 0);
        setTextDraft(text);
        setTextOriginal(text);
        setDiscountDraft(discount);
        setDiscountOriginal(discount);
      } catch (err) {
        if (!cancelled) setSaveError(err.message || 'Ошибка загрузки настроек');
      }
    }

    loadSettings();
    return () => { cancelled = true; };
  }, [user?.id]);

  const stats = useMemo(() => {
    const sevenDaysAgo = Date.now() - SEVEN_DAYS_MS;
    const recent = events.filter((e) => new Date(e.created_at).getTime() >= sevenDaysAgo);
    const withDiscount = recent.filter((e) => Number(e.payload?.discount_percent || 0) > 0).length;
    const failed = recent.filter((e) => ['failed', 'skipped'].includes(e.payload?.delivered_by)).length;
    return {
      total: recent.length,
      withDiscount,
      failed
    };
  }, [events]);

  const channelTitleById = useMemo(() => {
    const map = new Map();
    botChannels.forEach((c) => map.set(c.id, c.title));
    return map;
  }, [botChannels]);

  const dirty = textDraft !== textOriginal || Number(discountDraft) !== Number(discountOriginal);

  function insertStandardTemplate() {
    setTextDraft(STANDARD_TEMPLATE);
  }

  function insertTrialTemplate() {
    setTextDraft(TRIAL_TEMPLATE);
    setDiscountDraft(0);
  }

  function resetDraft() {
    setTextDraft(textOriginal);
    setDiscountDraft(discountOriginal);
  }

  async function saveSettings() {
    if (!user?.id) return;
    setSaving(true);
    setSaveError('');
    setSavedAt(false);
    try {
      const { error: upsertError } = await supabase
        .from('payment_settings')
        .upsert({
          owner_id: user.id,
          abandoned_text: textDraft,
          abandoned_discount_percent: Number(discountDraft || 0)
        }, { onConflict: 'owner_id' });
      if (upsertError) throw upsertError;
      setTextOriginal(textDraft);
      setDiscountOriginal(Number(discountDraft || 0));
      setSaving(false);
      setSavedAt(true);
      window.setTimeout(() => setSavedAt(false), 2500);
    } catch (err) {
      setSaving(false);
      setSaveError(err.message || 'Ошибка сохранения');
    }
  }

  function changeBot(id) {
    const next = new URLSearchParams(searchParams);
    next.set('bot', id);
    setSearchParams(next);
    setExpandedEventId(null);
  }

  function pushToBroadcast(tgUserIds, label) {
    if (!tgUserIds || tgUserIds.length === 0) return;
    window.localStorage.setItem('broadcast_manual_selection', JSON.stringify({
      source: 'admin_v2_abandoned',
      tg_user_ids: tgUserIds,
      base_name: label || 'Брошенные корзины',
      suggested_title: `Дожим: ${label || 'Брошенные корзины'}`,
      suggested_message: 'Ты уже почти купил, но не завершил оплату. Если ещё актуально — вернись и закрой платёж сейчас.'
    }));
    openApp('/app/broadcast');
  }

  function pushToOrders(tgUserIds) {
    if (!tgUserIds || tgUserIds.length === 0) return;
    window.localStorage.setItem('orders_manual_selection', JSON.stringify({
      source: 'admin_v2_abandoned',
      tg_user_ids: tgUserIds
    }));
    openApp('/app/customers?tab=orders');
  }

  if (loading && bots.length === 0) {
    return <LoadingState text="Грузим брошенные корзины..." />;
  }

  if (bots.length === 0) {
    return (
      <section className="page page--flush space-y-6">
        <div className="bg-white border border-slate-200/60 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
          <div className="p-16 text-center flex flex-col items-center">
            <div className="w-16 h-16 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-300 shadow-inner mb-4 border border-slate-100">
              <BotIcon className="w-8 h-8" />
            </div>
            <h4 className="text-lg font-black text-slate-900 tracking-tight mb-2">Нет ботов продаж</h4>
            <p className="text-slate-500 font-medium text-sm mb-6 max-w-md">
              Создайте бота на странице «Бот продаж», чтобы система могла отслеживать брошенные корзины и отправлять напоминания.
            </p>
            <a
              href="/sales-bot"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 !text-white text-xs font-bold hover:bg-slate-700 transition-colors"
            >
              Создать бота
              <ChevronRight className="w-4 h-4" />
            </a>
          </div>
        </div>
      </section>
    );
  }

  const selectedBot = bots.find((b) => b.id === selectedBotId) || bots[0];
  const selectedBotLabel = selectedBot?.custom_label || (selectedBot?.tg_username ? `@${selectedBot.tg_username}` : 'Без имени');

  const allPending = [...inWindow, ...stale];
  const allPendingTgIds = Array.from(new Set(allPending.map((inv) => String(inv.tg_user_id || '')).filter(Boolean)));
  const staleTgIds = Array.from(new Set(stale.map((inv) => String(inv.tg_user_id || '')).filter(Boolean)));

  const statCards = [
    { label: 'Отправлено за 7 дней', value: stats.total, color: 'text-slate-900', Icon: Send },
    { label: 'Со скидкой', value: stats.withDiscount, color: stats.withDiscount > 0 ? 'text-emerald-600' : 'text-slate-400', Icon: Tag },
    { label: 'В очереди отправки', value: inWindow.length, color: inWindow.length > 0 ? 'text-amber-600' : 'text-slate-400', Icon: Clock },
    { label: 'Не доставлено', value: stats.failed, color: stats.failed > 0 ? 'text-rose-600' : 'text-slate-400', Icon: AlertCircle }
  ];

  return (
    <section className="page page--flush space-y-6">
      <div className="bg-white border border-slate-200/60 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden transition-all hover:border-slate-300/60">

        {error && (
          <div className="m-6 mb-0 p-5 rounded-2xl bg-red-50 border border-red-100 text-red-600 font-bold text-sm flex items-center gap-3 shadow-sm">
            {error}
          </div>
        )}

        <section className="p-6 md:p-8 border-b border-slate-100">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
            <div className="flex items-center gap-3">
              <select
                value={selectedBotId}
                onChange={(event) => changeBot(event.target.value)}
                className="px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-sm font-bold text-slate-900 focus:outline-none focus:border-slate-400 max-w-[320px]"
              >
                {bots.map((bot) => (
                  <option key={bot.id} value={bot.id}>
                    {bot.custom_label || (bot.tg_username ? `@${bot.tg_username}` : 'Без имени')}
                  </option>
                ))}
              </select>
              <div className="text-xs font-bold text-slate-500">
                {inWindow.length} в очереди · {stale.length} требуют разбора
              </div>
            </div>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors"
              onClick={() => downloadCsv(
                `abandoned-${selectedBotLabel}-${new Date().toISOString().slice(0, 10)}.csv`,
                ['invoice_id', 'created_at', 'tg_user_id', 'tariff_title', 'is_trial', 'status', 'amount', 'currency', 'category'],
                allPending.map((inv) => [
                  inv.id,
                  inv.created_at,
                  inv.tg_user_id,
                  inv.tariffs?.title || '',
                  inv.tariffs?.is_trial ? 'yes' : 'no',
                  inv.status || '',
                  inv.amount,
                  inv.currency,
                  inWindow.includes(inv) ? 'in_window' : 'stale'
                ])
              )}
            >
              Выгрузить CSV
            </button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {statCards.map((card, idx) => {
              const Icon = card.Icon;
              return (
                <div
                  key={idx}
                  className="bg-slate-50/50 border border-slate-100 p-6 rounded-3xl"
                >
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-[11px] font-black uppercase tracking-widest text-slate-400">{card.label}</span>
                    <Icon className={`w-5 h-5 ${card.color} opacity-70`} />
                  </div>
                  <div className={`text-3xl font-black tracking-tighter ${card.color}`}>{card.value}</div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="p-6 md:p-8 border-b border-slate-100">
          <div className="flex items-baseline justify-between mb-4">
            <h3 className="text-sm font-black uppercase tracking-widest text-slate-400">
              В окне автоматического дожима
            </h3>
            <span className="text-xs font-bold text-slate-400">{inWindow.length}</span>
          </div>
          <p className="text-xs text-slate-500 leading-relaxed mb-4 max-w-2xl">
            Счета возрастом 2-3 часа без напоминания. Получат сообщение в ближайший запуск cron (каждые 15 минут).
          </p>

          {inWindow.length === 0 ? (
            <div className="p-4 rounded-2xl bg-slate-50/50 border border-slate-100 text-sm text-slate-500 font-medium">
              Сейчас никто не попадает в окно автоматического дожима.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {inWindow.map((inv) => (
                <InvoiceRow
                  key={inv.id}
                  inv={inv}
                  channelTitle={channelTitleById.get(inv.channel_id) || 'Канал'}
                  onPush={() => pushToBroadcast([String(inv.tg_user_id)], `В окне · ${inv.tg_user_id}`)}
                />
              ))}
            </div>
          )}
        </section>

        <section className="p-6 md:p-8 border-b border-slate-100">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
            <h3 className="text-sm font-black uppercase tracking-widest text-slate-400">
              Требуют ручного разбора
            </h3>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-400">{stale.length}</span>
              {staleTgIds.length > 0 ? (
                <>
                  <button
                    type="button"
                    className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
                    onClick={() => pushToOrders(staleTgIds)}
                  >
                    Открыть в Заказах
                  </button>
                  <button
                    type="button"
                    className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-slate-900 text-white hover:bg-slate-700 transition-colors"
                    onClick={() => pushToBroadcast(staleTgIds, 'Вне окна дожима')}
                  >
                    Передать список в рассылку
                  </button>
                </>
              ) : null}
            </div>
          </div>
          <p className="text-xs text-slate-500 leading-relaxed mb-4 max-w-2xl">
            Счета старше 3 часов. Автоматический дожим для них уже не сработает. Передайте подписчиков в рассылку.
          </p>

          {stale.length === 0 ? (
            <div className="p-4 rounded-2xl bg-slate-50/50 border border-slate-100 text-sm text-slate-500 font-medium">
              Счетов вне окна дожима нет.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {stale.slice(0, 50).map((inv) => (
                <InvoiceRow
                  key={inv.id}
                  inv={inv}
                  channelTitle={channelTitleById.get(inv.channel_id) || 'Канал'}
                  onPush={() => pushToBroadcast([String(inv.tg_user_id)], `Вне окна · ${inv.tg_user_id}`)}
                />
              ))}
            </div>
          )}
        </section>

        <section className="p-6 md:p-8 border-b border-slate-100">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
            <h3 className="text-sm font-black uppercase tracking-widest text-slate-400">
              Что отправляется подписчикам
            </h3>
            <span className="text-[11px] text-slate-400 font-medium">
              Сценарий <span className="font-bold text-slate-600">abandoned-cart</span>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3 mb-4">
            <div className="flex items-center gap-2">
              <Tag className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              <span className="text-sm font-bold text-slate-700">Скидка</span>
              <input
                type="number"
                min="0"
                max="99"
                value={discountDraft}
                onChange={(event) => setDiscountDraft(Number(event.target.value || 0))}
                className="w-20 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-sm font-bold text-slate-900 focus:outline-none focus:border-slate-400"
              />
              <span className="text-sm font-bold text-slate-500">%</span>
            </div>
            <div className="ml-auto flex gap-1.5">
              <button
                type="button"
                className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
                onClick={insertStandardTemplate}
              >
                Сбросить к стандарту
              </button>
              <button
                type="button"
                className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
                onClick={insertTrialTemplate}
              >
                Пробник (без скидки)
              </button>
            </div>
          </div>

          <textarea
            className="w-full p-3 rounded-xl bg-white border border-slate-200 text-sm text-slate-800 font-mono leading-relaxed focus:outline-none focus:border-slate-400 min-h-[180px]"
            value={textDraft}
            onChange={(event) => setTextDraft(event.target.value)}
            placeholder="Текст, который бот отправит подписчику с брошенной корзиной."
          />

          <div className="mt-3 text-[11px] text-slate-400 leading-relaxed">
            Теги автоматически заменятся при отправке: <code className="px-1 bg-slate-100 rounded">{`{tariff_name}`}</code> → название тарифа, <code className="px-1 bg-slate-100 rounded">{`{discount_percent}`}</code> → значение скидки, <code className="px-1 bg-slate-100 rounded">{`{discount_price}`}</code> → цена со скидкой, <code className="px-1 bg-slate-100 rounded">{`{old_price}`}</code> → исходная цена, <code className="px-1 bg-slate-100 rounded">{`{currency}`}</code> → валюта.
          </div>
          <div className="mt-2 text-[11px] text-slate-400 leading-relaxed">
            Этот текст и скидка также применяются в сценарии <span className="font-medium">browse-followup</span> (напоминание после просмотра тарифа).
          </div>

          <div className="flex flex-wrap items-center gap-2 mt-6">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              onClick={saveSettings}
              disabled={!dirty || saving}
            >
              <Save className="w-3.5 h-3.5" />
              {saving ? 'Сохраняю...' : 'Сохранить'}
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              onClick={resetDraft}
              disabled={!dirty || saving}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Отменить правки
            </button>
            {savedAt ? (
              <span className="text-xs font-bold text-emerald-600 ml-1">✓ Сохранено</span>
            ) : null}
            {dirty && !savedAt ? (
              <span className="text-xs font-medium text-amber-600 ml-1">есть несохранённые правки</span>
            ) : null}
            {saveError ? (
              <span className="text-xs font-bold text-rose-600 ml-1">{saveError}</span>
            ) : null}
          </div>
        </section>

        <div>
          <div className="px-6 md:px-8 pt-6 pb-3 flex items-baseline justify-between">
            <h3 className="text-sm font-black uppercase tracking-widest text-slate-400">
              История отправок
            </h3>
            <span className="text-xs font-bold text-slate-400">за последние ~7 дней</span>
          </div>

          {events.length === 0 ? (
            <div className="p-16 text-center flex flex-col items-center">
              <div className="w-16 h-16 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-300 shadow-inner mb-4 border border-slate-100">
                <Inbox className="w-8 h-8" />
              </div>
              <h4 className="text-lg font-black text-slate-900 tracking-tight mb-2">История пуста</h4>
              <p className="text-slate-500 font-medium text-sm max-w-md">
                Отправленных напоминаний пока нет. Записи появятся здесь автоматически после первого срабатывания cron-задачи «Брошенные корзины» для бота {selectedBotLabel}.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/50">
                    <th className="px-6 py-3 text-left text-[11px] font-black uppercase tracking-widest text-slate-400">Время</th>
                    <th className="px-6 py-3 text-left text-[11px] font-black uppercase tracking-widest text-slate-400">Подписчик</th>
                    <th className="px-6 py-3 text-left text-[11px] font-black uppercase tracking-widest text-slate-400">Канал</th>
                    <th className="px-6 py-3 text-left text-[11px] font-black uppercase tracking-widest text-slate-400">Сумма</th>
                    <th className="px-6 py-3 text-left text-[11px] font-black uppercase tracking-widest text-slate-400">Доставлено</th>
                    <th className="px-6 py-3 text-right text-[11px] font-black uppercase tracking-widest text-slate-400">Текст</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => {
                    const payload = event.payload || {};
                    const badge = deliveryBadge(payload.delivered_by, payload);
                    const Icon = badge.Icon;
                    const isExpanded = expandedEventId === event.id;
                    const discount = Number(payload.discount_percent || 0);
                    const amountCell = discount > 0
                      ? `${payload.original_amount}→${payload.discounted_amount} ${payload.currency || ''} (-${discount}%)`
                      : `${payload.original_amount || '—'} ${payload.currency || ''}`;
                    return (
                      <Fragment key={event.id}>
                        <tr
                          className={`border-b border-slate-50 last:border-0 hover:bg-slate-50/30 cursor-pointer transition-colors ${isExpanded ? 'bg-slate-50/50' : ''}`}
                          onClick={() => setExpandedEventId(isExpanded ? null : event.id)}
                        >
                          <td className="px-6 py-4 whitespace-nowrap text-xs font-medium text-slate-500">
                            {formatRelativeTime(event.created_at)}
                          </td>
                          <td className="px-6 py-4">
                            <div className="text-sm font-bold text-slate-900 font-mono">
                              {event.tg_user_id}
                            </div>
                          </td>
                          <td className="px-6 py-4 text-sm font-medium text-slate-700">
                            {channelTitleById.get(event.channel_id) || '—'}
                          </td>
                          <td className="px-6 py-4 text-xs font-medium text-slate-600">
                            {amountCell}
                          </td>
                          <td className="px-6 py-4">
                            <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-black ${badge.cls}`}>
                              <Icon className="w-3 h-3" />
                              {badge.text}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-slate-900 transition-colors"
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpandedEventId(isExpanded ? null : event.id);
                              }}
                            >
                              {isExpanded ? 'Скрыть' : 'Показать'}
                              <ChevronRight className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                            </button>
                          </td>
                        </tr>
                        {isExpanded ? (
                          <tr className="bg-slate-50/30">
                            <td colSpan={6} className="px-6 pb-5 pt-1">
                              <div className="ml-2 p-4 bg-white border border-slate-200 rounded-xl">
                                <div className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-2">
                                  Текст сообщения
                                </div>
                                <pre className="text-sm text-slate-800 whitespace-pre-wrap font-sans leading-relaxed max-h-[400px] overflow-y-auto">
                                  {payload.message_text || '— нет текста —'}
                                </pre>
                                {payload.error ? (
                                  <div className="mt-3 text-xs text-rose-600 font-medium">
                                    Ошибка: {payload.error}
                                  </div>
                                ) : null}
                                {payload.reason ? (
                                  <div className="mt-3 text-xs text-slate-500 font-medium">
                                    Причина: {payload.reason}
                                  </div>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function InvoiceRow({ inv, channelTitle, onPush }) {
  const originalPrice = Number(inv.tariffs?.price || 0);
  const hasDiscount = originalPrice > 0 && Number(inv.amount) < originalPrice;
  const discountPercent = hasDiscount ? Math.round(((originalPrice - inv.amount) / originalPrice) * 100) : 0;
  const isTrial = !!inv.tariffs?.is_trial;
  const tariffTitle = inv.tariffs?.trial_label || inv.tariffs?.title || 'Неизвестно';

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-slate-50/50 border border-slate-100">
      <div className="flex items-center gap-3 min-w-0">
        <ShoppingCart className="w-4 h-4 text-slate-500 flex-shrink-0" />
        <div className="min-w-0">
          <div className="text-sm font-bold text-slate-900 truncate font-mono">
            {inv.tg_user_id}
          </div>
          <div className="text-xs text-slate-500 font-medium truncate">
            {channelTitle} · {tariffTitle}{isTrial ? ' · пробник' : ''}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        <div className="text-right">
          <div className="text-sm font-bold text-slate-900">
            {inv.amount} {inv.currency}
          </div>
          {hasDiscount ? (
            <div className="text-[11px] text-emerald-600 font-bold">
              −{discountPercent}% (было {originalPrice} {inv.currency})
            </div>
          ) : null}
          <div className="text-[11px] text-slate-400 font-medium">
            {formatRelativeTime(inv.created_at)}
          </div>
        </div>
        <button
          type="button"
          className="px-2.5 py-1.5 rounded-md text-[11px] font-bold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
          onClick={onPush}
        >
          В рассылку
        </button>
      </div>
    </div>
  );
}
