import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Send, Bot, Rocket, AlertCircle, Ban, Clock, ChevronRight, Bot as BotIcon, CircleCheckBig, CircleAlert, Hash, MessagesSquare } from 'lucide-react';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { supabase } from '../lib/supabase.js';
import { apiRequest } from '../api/client.js';
import { LoadingState } from '../ui/LoadingState.jsx';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function formatRelativeTime(iso) {
  if (!iso) return '—';
  const ts = new Date(iso).getTime();
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60_000) return 'только что';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} мин назад`;
  if (diff < DAY_MS) {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  if (diff < 2 * DAY_MS) {
    const d = new Date(iso);
    return `вчера, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatExpiresIn(iso) {
  if (!iso) return '—';
  const ts = new Date(iso).getTime();
  const diff = ts - Date.now();
  if (diff <= 0) return 'истекло';
  const hours = Math.floor(diff / 3600_000);
  if (hours >= 1) return `истекает через ${hours} ч`;
  const mins = Math.floor(diff / 60_000);
  return `истекает через ${mins} мин`;
}

function deliveryBadge(deliveredBy = '', payload = {}) {
  switch (deliveredBy) {
    case 'bot':
      return { text: `Бот${payload?.bot_id ? '' : ''}`, cls: 'bg-emerald-50 text-emerald-700', Icon: Bot };
    case 'userbot':
      return { text: `Userbot${payload?.userbot_username ? ` @${payload.userbot_username}` : ''}`, cls: 'bg-blue-50 text-blue-700', Icon: Rocket };
    case 'failed':
      return { text: 'Сбой доставки', cls: 'bg-rose-50 text-rose-700', Icon: AlertCircle };
    case 'skipped':
      return { text: 'Пропуск', cls: 'bg-slate-100 text-slate-600', Icon: Ban };
    default:
      return { text: 'Неизвестно', cls: 'bg-slate-100 text-slate-600', Icon: AlertCircle };
  }
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
  const [audienceTargets, setAudienceTargets] = useState([]);
  const [paidCountsByChannel, setPaidCountsByChannel] = useState({});
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

        const paidChannelIds = ['paid_channel_id', 'paid_chat_id']
          .map((field) => contourValue?.[field])
          .filter(Boolean);

        let nextPaidCounts = {};
        if (paidChannelIds.length > 0) {
          const { data: paidSubs, error: paidSubsError } = await supabase
            .from('subscriptions')
            .select('id, channel_id')
            .in('channel_id', paidChannelIds)
            .eq('status', 'active');
          if (paidSubsError) throw paidSubsError;
          (paidSubs || []).forEach((s) => {
            nextPaidCounts[s.channel_id] = (nextPaidCounts[s.channel_id] || 0) + 1;
          });
        }
        if (cancelled) return;
        setPaidCountsByChannel(nextPaidCounts);

        if (accessToken) {
          try {
            const audienceData = await apiRequest(`/api/audience?contourId=${encodeURIComponent(selectedBotId)}`, { accessToken });
            if (cancelled) return;
            setAudienceTargets(audienceData?.targets || []);
          } catch (audErr) {
            if (cancelled) return;
            setAudienceTargets([]);
          }
        }

        if (channelIds.length === 0) {
          if (reqId !== reqIdRef.current) return;
          setEvents([]);
          setExpiring([]);
          setActiveSubsCount(0);
          setLoading(false);
          return;
        }

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
            .in('channel_id', channelIds)
            .order('created_at', { ascending: false })
            .limit(50)
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
  }, [user?.id, selectedBotId, bots.length, accessToken]);

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

  function statusBadge(status) {
    const normalized = String(status || '').toLowerCase();
    if (normalized === 'online') return { text: 'online', cls: 'bg-emerald-50 text-emerald-700' };
    if (normalized === 'pending_activation') return { text: 'ожидает активации', cls: 'bg-amber-50 text-amber-700' };
    if (normalized === 'offline' || normalized === 'restricted' || normalized === 'session_revoked') return { text: normalized, cls: 'bg-rose-50 text-rose-700' };
    return { text: normalized || 'неизвестно', cls: 'bg-slate-100 text-slate-600' };
  }

  const audienceCards = useMemo(() => {
    if (!contour) return [];
    const audienceByType = new Map();
    (audienceTargets || []).forEach((t) => {
      audienceByType.set(t.targetType, t);
    });

    const cards = [
      { field: 'public_channel_id', targetType: 'public_channel', label: 'Витрина', Icon: Hash, kind: 'public' },
      { field: 'paid_channel_id', targetType: 'paid_channel', label: 'Платный канал', Icon: Hash, kind: 'paid' },
      { field: 'public_chat_id', targetType: 'public_chat', label: 'Публичный чат', Icon: MessagesSquare, kind: 'public' },
      { field: 'paid_chat_id', targetType: 'paid_chat', label: 'Приватный чат', Icon: MessagesSquare, kind: 'paid' }
    ];

    return cards.map((def) => {
      const channelId = contour[def.field] || null;
      if (!channelId) {
        return { ...def, channelId: null, title: null, value: null, hint: 'не привязан' };
      }
      const audience = audienceByType.get(def.targetType);
      const title = audience?.channelTitle || botChannels.find((c) => c.id === channelId)?.title || 'Без названия';
      let value;
      let hint;
      if (def.kind === 'paid') {
        value = paidCountsByChannel[channelId] ?? 0;
        hint = 'активных';
      } else {
        value = audience?.totalMembers ?? null;
        hint = typeof value === 'number' ? 'участников' : 'нет sync';
      }
      return { ...def, channelId, title, value, hint };
    });
  }, [contour, audienceTargets, botChannels, paidCountsByChannel]);

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
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-700 transition-colors"
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
    { label: 'Отправлено 7д', value: stats.total, color: 'text-slate-900', Icon: Send },
    { label: 'Ботом', value: stats.byBot, color: stats.byBot > 0 ? 'text-emerald-600' : 'text-slate-400', Icon: Bot },
    { label: 'Userbot\'ом', value: stats.byUserbot, color: stats.byUserbot > 0 ? 'text-blue-600' : 'text-slate-400', Icon: Rocket },
    { label: 'Сбой / пропуск', value: stats.failed, color: stats.failed > 0 ? 'text-rose-600' : 'text-slate-400', Icon: AlertCircle }
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
              <div className="text-xs font-bold text-slate-500">
                {activeSubsCount} активн.
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

        <section className="p-6 md:p-8 border-b border-slate-100">
          <div className="flex items-baseline justify-between mb-4">
            <h3 className="text-sm font-black uppercase tracking-widest text-slate-400">
              Помощник-юзербот
            </h3>
          </div>

          {helperBots.length === 0 ? (
            <div className="p-4 rounded-2xl bg-amber-50/50 border border-amber-100 text-sm text-amber-800">
              <div className="font-bold mb-1">Не привязан</div>
              <div className="text-xs text-amber-700">
                Если бот заблокирован у подписчика, напоминание уйдёт в сбой. Привяжите userbot в настройках sales-бота.
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {helperBots.map((helper) => {
                const status = statusBadge(helper.runtime_status);
                const label = helper.custom_label || (helper.tg_username ? `@${helper.tg_username}` : 'Без имени');
                const hs = helperStatsById.get(helper.id) || { delivered: 0, failed: 0 };
                return (
                  <div
                    key={helper.id}
                    className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl bg-slate-50/50 border border-slate-100"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 flex-shrink-0">
                        <Rocket className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-black text-slate-900 truncate">{label}</div>
                        {helper.tg_username && helper.custom_label ? (
                          <div className="text-xs text-slate-500 font-mono truncate">@{helper.tg_username}</div>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
                      <span className={`inline-flex px-2 py-1 rounded-md text-[11px] font-black ${status.cls}`}>
                        {status.text}
                      </span>
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold bg-emerald-50 text-emerald-700">
                        <CircleCheckBig className="w-3 h-3" />
                        {hs.delivered} доставлено
                      </span>
                      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold ${hs.failed > 0 ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-500'}`}>
                        <CircleAlert className="w-3 h-3" />
                        {hs.failed} сбой
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {audienceCards.length > 0 ? (
          <section className="p-6 md:p-8 border-b border-slate-100">
            <div className="flex items-baseline justify-between mb-4">
              <h3 className="text-sm font-black uppercase tracking-widest text-slate-400">
                Аудитория
              </h3>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {audienceCards.map((card, idx) => {
                const Icon = card.Icon;
                const isUnbound = !card.channelId;
                const isMissing = card.channelId && card.value === null;
                return (
                  <div
                    key={idx}
                    className={`p-5 rounded-2xl border ${isUnbound ? 'bg-slate-50/30 border-dashed border-slate-200' : 'bg-slate-50/50 border-slate-100'}`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-[11px] font-black uppercase tracking-widest text-slate-400">{card.label}</span>
                      <Icon className={`w-4 h-4 ${isUnbound ? 'text-slate-300' : card.kind === 'paid' ? 'text-emerald-600' : 'text-slate-500'}`} />
                    </div>
                    {isUnbound ? (
                      <div className="text-2xl font-black tracking-tighter text-slate-300">—</div>
                    ) : (
                      <>
                        <div className={`text-2xl font-black tracking-tighter ${card.kind === 'paid' ? 'text-emerald-600' : 'text-slate-900'}`}>
                          {isMissing ? '—' : card.value}
                        </div>
                        <div className="text-xs font-medium text-slate-500 mt-1 truncate" title={card.title}>
                          {card.hint}
                        </div>
                      </>
                    )}
                    {card.title && !isUnbound ? (
                      <div className="text-[11px] text-slate-400 mt-1 truncate" title={card.title}>{card.title}</div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        <section className="p-6 md:p-8 border-b border-slate-100">
          <div className="flex items-baseline justify-between mb-4">
            <h3 className="text-sm font-black uppercase tracking-widest text-slate-400">
              Истекают в ближайшие 24ч
            </h3>
            <span className="text-xs font-bold text-slate-400">{expiring.length}</span>
          </div>

          {expiring.length === 0 ? (
            <div className="text-sm text-slate-500 font-medium py-4">
              Никто не истекает — всё спокойно.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {expiring.map((sub) => (
                <div
                  key={sub.id}
                  className="flex items-center justify-between p-3 rounded-xl bg-amber-50/50 border border-amber-100"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Clock className="w-4 h-4 text-amber-600 flex-shrink-0" />
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-slate-900 truncate">
                        {sub.tg_username ? `@${sub.tg_username}` : `ID ${sub.tg_user_id}`}
                      </div>
                      <div className="text-xs text-slate-500 font-medium">
                        {channelTitleById.get(sub.channel_id) || 'Канал'}
                      </div>
                    </div>
                  </div>
                  <div className="text-xs font-black text-amber-700 flex-shrink-0 ml-3">
                    {formatExpiresIn(sub.expires_at)}
                  </div>
                </div>
              ))}
            </div>
          )}
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
                <Send className="w-8 h-8" />
              </div>
              <h4 className="text-lg font-black text-slate-900 tracking-tight mb-2">Еще ничего не отправлено</h4>
              <p className="text-slate-500 font-medium text-sm max-w-md">
                Первое напоминание появится здесь, когда у подписчика бота {selectedBotLabel} будет <span className="font-bold">expires_at</span> в ближайшие 24 часа.
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
                            <div className="text-sm font-bold text-slate-900">
                              {event.tg_username ? `@${event.tg_username}` : ''}
                            </div>
                            <div className="text-xs text-slate-400 font-mono">{event.tg_user_id}</div>
                          </td>
                          <td className="px-6 py-4 text-sm font-medium text-slate-700">
                            {channelTitleById.get(event.channel_id) || '—'}
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
                            <td colSpan={5} className="px-6 pb-5 pt-1">
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
