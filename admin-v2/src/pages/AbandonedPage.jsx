import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Send, Tag, Clock, AlertCircle, ChevronRight, Bot as BotIcon } from 'lucide-react';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { supabase } from '../lib/supabase.js';
import { LoadingState } from '../ui/LoadingState.jsx';
import { AbandonedHistorySection } from './sections/AbandonedHistorySection.jsx';
import { AbandonedMessageSection } from './sections/AbandonedMessageSection.jsx';
import { AbandonedInWindowSection, AbandonedStaleSection } from './sections/AbandonedQueueSections.jsx';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

// Синхронизировано с дефолтом бэкенд-джобы брошенных корзин (одинарная * разметка)
const STANDARD_TEMPLATE = `🛒 *Привет!*

Я заметил, что ты хотел купить «*{tariff_name}*», но остановился.

🎁 Только сейчас я даю тебе *скидку {discount_percent}%*!
Новая цена: *{discount_price} {currency}* (вместо {old_price} {currency}).

👉 *Жми кнопку ниже, чтобы забрать доступ!*`;

const TRIAL_TEMPLATE = `🧪 *Ты почти забрал пробник*

Я увидел, что ты хотел зайти через «*{tariff_name}*», но не добил оплату.

Если хочешь быстро посмотреть, что внутри, просто вернись в бота и закончи оплату.

👉 *Пробник нужен, чтобы быстро зайти и принять решение. Не тяни.*`;

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
  const [discountError, setDiscountError] = useState('');
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

        const sinceIso = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();
        const [{ data: invoicesData, error: invoicesError }, { data: eventsData, error: eventsError }] = await Promise.all([
          supabase
            .from('invoices')
            .select('id, tg_user_id, amount, currency, status, created_at, tariff_id, channel_id, tariffs(title, is_trial, trial_label, price)')
            .in('channel_id', channelIds)
            .in('status', ['pending', 'awaiting_receipt'])
            .eq('reminded', false)
            .order('created_at', { ascending: false })
            .limit(500),
          supabase
            .from('access_events')
            .select('id, created_at, channel_id, invoice_id, tg_user_id, payload')
            .in('event_type', ['abandoned_reminder', 'browse_reminder'])
            .eq('owner_id', user.id)
            .gte('created_at', sinceIso)
            .order('created_at', { ascending: false })
            .limit(500)
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
          // В очереди — только то, что джоба реально отправляет: pending в окне 2-3ч.
          // awaiting_receipt джоба пропускает (клиент уже в оплате) — это «требуют разбора».
          if (inv.status === 'pending' && createdTs <= twoHoursAgoTs && createdTs >= threeHoursAgoTs) {
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
    const failed = recent.filter((e) => e.payload?.delivered_by === 'failed').length;
    const skipped = recent.filter((e) => e.payload?.delivered_by === 'skipped').length;
    return {
      total: recent.length,
      withDiscount,
      failed,
      skipped,
      problems: failed + skipped
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
    // Паритет с бэкендом: скидка клэмпится в 0-99, на фронте валидируем и не сохраняем вне диапазона
    const discountValue = Number(discountDraft || 0);
    if (!Number.isFinite(discountValue) || discountValue < 0 || discountValue > 99) {
      setDiscountError('Скидка — число от 0 до 99');
      return;
    }
    setDiscountError('');
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
    openApp('/paywall/broadcast');
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

  const staleTgIds = Array.from(new Set(stale.map((inv) => String(inv.tg_user_id || '')).filter(Boolean)));

  // Выборка инвойсов ограничена лимитом 500: если счётчик упёрся в лимит — показываем «500+»
  const queueLabel = inWindow.length >= 500 ? '500+' : inWindow.length;
  const staleLabel = stale.length >= 500 ? '500+' : stale.length;

  const statCards = [
    { label: 'Отправлено за 7 дней', value: stats.total, color: stats.total > 0 ? 'text-slate-900' : 'text-slate-500', Icon: Send },
    { label: 'Со скидкой', value: stats.withDiscount, color: stats.withDiscount > 0 ? 'text-emerald-600' : 'text-slate-500', Icon: Tag },
    { label: 'В очереди отправки', value: queueLabel, color: inWindow.length > 0 ? 'text-amber-600' : 'text-slate-500', Icon: Clock },
    { label: 'Сбой / пропуск', value: stats.problems, color: stats.problems > 0 ? 'text-rose-600' : 'text-slate-500', Icon: AlertCircle }
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
              <div className="flex items-center gap-2">
                <span className="text-xs font-black text-slate-900">Брошенные корзины</span>
                <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">
                  {queueLabel} в очереди
                </span>
                <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">
                  {staleLabel} требуют разбора
                </span>
              </div>
            </div>
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

        <AbandonedInWindowSection
          queueLabel={queueLabel}
          inWindow={inWindow}
          channelTitleById={channelTitleById}
          pushToBroadcast={pushToBroadcast}
        />

        <AbandonedStaleSection
          staleLabel={staleLabel}
          stale={stale}
          staleTgIds={staleTgIds}
          channelTitleById={channelTitleById}
          pushToBroadcast={pushToBroadcast}
        />

        <AbandonedMessageSection
          textDraft={textDraft}
          setTextDraft={setTextDraft}
          discountDraft={discountDraft}
          setDiscountDraft={setDiscountDraft}
          discountError={discountError}
          setDiscountError={setDiscountError}
          insertStandardTemplate={insertStandardTemplate}
          insertTrialTemplate={insertTrialTemplate}
          saveSettings={saveSettings}
          resetDraft={resetDraft}
          dirty={dirty}
          saving={saving}
          savedAt={savedAt}
          saveError={saveError}
        />

        <AbandonedHistorySection
          events={events}
          channelTitleById={channelTitleById}
          expandedEventId={expandedEventId}
          setExpandedEventId={setExpandedEventId}
          selectedBotLabel={selectedBotLabel}
        />
      </div>
    </section>
  );
}
