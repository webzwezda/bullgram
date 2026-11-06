import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Send, Bot, Rocket, AlertCircle, ChevronRight, Bot as BotIcon } from 'lucide-react';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { supabase } from '../lib/supabase.js';
import { LoadingState } from '../ui/LoadingState.jsx';
import { RetentionHelpersSection } from './sections/RetentionHelpersSection.jsx';
import { RetentionMessageSection } from './sections/RetentionMessageSection.jsx';
import { RetentionExpiringSection } from './sections/RetentionExpiringSection.jsx';
import { RetentionHistorySection } from './sections/RetentionHistorySection.jsx';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const STANDARD_TEMPLATE = `⏰ *Привет!*

Твой доступ в закрытый канал «*{channel_name}*» закончится менее чем через 24 часа.

Чтобы не потерять доступ, продли в один клик:
👉 {renewal_link}

_Если уже оплатил — просто проигнорируй это сообщение._`;

function pluralSubscribers(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'подписчик';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'подписчика';
  return 'подписчиков';
}

export function RetentionPage() {
  const { user, accessToken } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedBotId = searchParams.get('bot') || '';

  const [bots, setBots] = useState([]);
  const [botChannels, setBotChannels] = useState([]);
  const [events, setEvents] = useState([]);
  const [expiring, setExpiring] = useState([]);
  const [helperBots, setHelperBots] = useState([]);
  const [contour, setContour] = useState(null);
  const [reminderDraft, setReminderDraft] = useState('');
  const [reminderOriginal, setReminderOriginal] = useState('');
  const [reminderSaving, setReminderSaving] = useState(false);
  const [reminderError, setReminderError] = useState('');
  const [reminderSaved, setReminderSaved] = useState(false);
  const [activeSubsCount, setActiveSubsCount] = useState(0);
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
      const filtered = (data || []);
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
        const [{ data: channelsData, error: channelsError }, { data: contourData, error: contourError }] = await Promise.all([
          supabase
            .from('channels')
            .select('id, title')
            .eq('bot_id', selectedBotId),
          supabase
            .from('sales_bot_contours')
            .select('bot_id, userbot_mode, selected_userbot_id, selected_userbot_ids, public_channel_id, paid_channel_id, public_chat_id, paid_chat_id')
            .eq('bot_id', selectedBotId)
            .eq('owner_id', user.id)
            .maybeSingle()
        ]);

        if (contourError && !(contourError.message || '').includes('No rows found')) throw contourError;

        if (channelsError) throw channelsError;
        const channelIds = (channelsData || []).map((c) => c.id);
        if (cancelled) return;
        setBotChannels(channelsData || []);

        const contourValue = contourData || null;
        setContour(contourValue);

        const helperIds = contourValue?.userbot_mode === 'single' && contourValue.selected_userbot_id
          ? [contourValue.selected_userbot_id]
          : Array.isArray(contourValue?.selected_userbot_ids) && contourValue.selected_userbot_ids.length > 0
            ? contourValue.selected_userbot_ids
            : [];

        let helpers = [];
        if (helperIds.length > 0) {
          const { data: helpersData, error: helpersError } = await supabase
            .from('tg_accounts')
            .select('id, tg_username, custom_label, runtime_status, runtime_error')
            .in('id', helperIds);
          if (helpersError) throw helpersError;
          helpers = helpersData || [];
        }
        if (cancelled) return;
        setHelperBots(helpers);

        if (channelIds.length === 0) {
          if (reqId !== reqIdRef.current) return;
          setEvents([]);
          setExpiring([]);
          setActiveSubsCount(0);
          setLoading(false);
          return;
        }

        const sinceIso = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();
        const [{ data: subsData, error: subsError }, { data: eventsData, error: eventsError }] = await Promise.all([
          supabase
            .from('subscriptions')
            .select('id, tg_user_id, tg_username, channel_id, status, expires_at')
            .in('channel_id', channelIds)
            .eq('status', 'active'),
          supabase
            .from('access_events')
            .select('id, created_at, channel_id, subscription_id, tg_user_id, payload')
            .eq('event_type', 'retention_reminder')
            .eq('owner_id', user.id)
            .in('channel_id', channelIds)
            .gte('created_at', sinceIso)
            .order('created_at', { ascending: false })
            .limit(500)
        ]);

        if (subsError) throw subsError;
        if (eventsError) throw eventsError;
        if (cancelled) return;
        if (reqId !== reqIdRef.current) return;

        const now = Date.now();
        const next24h = now + DAY_MS;
        const allSubs = subsData || [];
        const expiringNow = allSubs.filter((s) => {
          if (!s.expires_at) return false;
          const ts = new Date(s.expires_at).getTime();
          return ts >= now && ts <= next24h;
        });

        setExpiring(expiringNow);
        setActiveSubsCount(allSubs.length);
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

  const stats = useMemo(() => {
    const sevenDaysAgo = Date.now() - SEVEN_DAYS_MS;
    const recent = events.filter((e) => new Date(e.created_at).getTime() >= sevenDaysAgo);
    const byBot = recent.filter((e) => e.payload?.delivered_by === 'bot').length;
    const byUserbot = recent.filter((e) => e.payload?.delivered_by === 'userbot').length;
    const failed = recent.filter((e) => ['failed', 'skipped'].includes(e.payload?.delivered_by)).length;
    return {
      total: recent.length,
      byBot,
      byUserbot,
      failed
    };
  }, [events]);

  const helperStatsById = useMemo(() => {
    const sevenDaysAgo = Date.now() - SEVEN_DAYS_MS;
    const map = new Map();
    events.forEach((event) => {
      const ts = new Date(event.created_at).getTime();
      if (ts < sevenDaysAgo) return;
      const by = event.payload?.delivered_by;
      if (by !== 'userbot' && by !== 'failed') return;
      const uid = event.payload?.userbot_id;
      if (!uid) return;
      const entry = map.get(uid) || { delivered: 0, failed: 0 };
      if (by === 'userbot') entry.delivered += 1;
      else entry.failed += 1;
      map.set(uid, entry);
    });
    return map;
  }, [events]);

  // Загрузка reminder_text (один раз — это owner-level настройка, не зависит от бота)
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    async function loadReminder() {
      try {
        const { data, error } = await supabase
          .from('payment_settings')
          .select('reminder_text')
          .eq('owner_id', user.id)
          .maybeSingle();
        if (cancelled) return;
        if (error && !(error.message || '').includes('No rows found')) {
          setReminderError(error.message);
          return;
        }
        const text = data?.reminder_text?.trim() || STANDARD_TEMPLATE;
        setReminderDraft(text);
        setReminderOriginal(text);
      } catch (err) {
        if (!cancelled) setReminderError(err.message || 'Ошибка загрузки');
      }
    }

    loadReminder();
    return () => { cancelled = true; };
  }, [user?.id]);

  const previewChannelName = useMemo(() => {
    const paidChannelId = contour?.paid_channel_id;
    if (paidChannelId) {
      const ch = botChannels.find((c) => c.id === paidChannelId);
      if (ch?.title) return ch.title;
    }
    if (botChannels.length > 0) return botChannels[0].title;
    return 'название канала';
  }, [contour, botChannels]);

  const reminderDirty = reminderDraft !== reminderOriginal;

  function insertStandardTemplate() {
    setReminderDraft(STANDARD_TEMPLATE);
  }

  function resetReminder() {
    setReminderDraft(reminderOriginal);
  }

  async function saveReminder() {
    if (!user?.id) return;
    setReminderSaving(true);
    setReminderError('');
    setReminderSaved(false);
    try {
      const { error } = await supabase
        .from('payment_settings')
        .upsert({
          owner_id: user.id,
          reminder_text: reminderDraft
        }, { onConflict: 'owner_id' });
      if (error) throw error;
      setReminderOriginal(reminderDraft);
      setReminderSaving(false);
      setReminderSaved(true);
      window.setTimeout(() => setReminderSaved(false), 2500);
    } catch (err) {
      setReminderSaving(false);
      setReminderError(err.message || 'Ошибка сохранения');
    }
  }

  const channelTitleById = useMemo(() => {
    const map = new Map();
    botChannels.forEach((c) => map.set(c.id, c.title));
    return map;
  }, [botChannels]);

  function changeBot(id) {
    const next = new URLSearchParams(searchParams);
    next.set('bot', id);
    setSearchParams(next);
    setExpandedEventId(null);
  }

  if (loading && bots.length === 0) {
    return <LoadingState text="Грузим ботов..." />;
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
              Создайте бота на странице «Бот продаж», чтобы retention-напоминания начали уходить вашим подписчикам.
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

  const statCards = [
    { label: 'Отправлено за 7 дней', value: stats.total, color: stats.total > 0 ? 'text-slate-900' : 'text-slate-500', Icon: Send },
    { label: 'Ботом', value: stats.byBot, color: stats.byBot > 0 ? 'text-emerald-600' : 'text-slate-500', Icon: Bot },
    { label: 'Userbot\'ом', value: stats.byUserbot, color: stats.byUserbot > 0 ? 'text-blue-600' : 'text-slate-500', Icon: Rocket },
    { label: 'Сбой / пропуск', value: stats.failed, color: stats.failed > 0 ? 'text-rose-600' : 'text-slate-500', Icon: AlertCircle }
  ];

  return (
    <section className="page page--flush space-y-6">
      <div className="bg-white border border-slate-200/60 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden transition-all hover:border-slate-300/60">

        {error && (
          <div className="p-5 rounded-2xl bg-red-50 border border-red-100 text-red-600 font-bold text-sm flex items-center gap-3 shadow-sm m-6 mb-0">
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
              <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">
                {activeSubsCount} {pluralSubscribers(activeSubsCount)}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {statCards.map((card, idx) => {
              const Icon = card.Icon;
              return (
                <div
                  key={idx}
                  className="bg-slate-50/50 border border-slate-100 p-5 rounded-2xl"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-black uppercase tracking-widest text-slate-400">{card.label}</span>
                    <Icon className={`w-5 h-5 ${card.color} opacity-70`} />
                  </div>
                  <div className={`text-3xl font-black tracking-tighter ${card.color}`}>{card.value}</div>
                </div>
              );
            })}
          </div>
        </section>

        <RetentionHelpersSection
          helperBots={helperBots}
          helperStatsById={helperStatsById}
        />

        <RetentionMessageSection
          reminderDraft={reminderDraft}
          setReminderDraft={setReminderDraft}
          reminderDirty={reminderDirty}
          reminderSaving={reminderSaving}
          reminderSaved={reminderSaved}
          reminderError={reminderError}
          insertStandardTemplate={insertStandardTemplate}
          saveReminder={saveReminder}
          resetReminder={resetReminder}
          previewChannelName={previewChannelName}
        />

        <RetentionExpiringSection
          expiring={expiring}
          channelTitleById={channelTitleById}
        />

        <RetentionHistorySection
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
