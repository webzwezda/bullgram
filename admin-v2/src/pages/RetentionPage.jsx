import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Hash, CheckCircle2, AlertCircle, XCircle, Clock } from 'lucide-react';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { supabase } from '../lib/supabase.js';
import { LoadingState } from '../ui/LoadingState.jsx';

const SUBTABS = [
  { id: 'all', label: 'Все' },
  { id: 'ready', label: 'Готовы' },
  { id: 'fallback_only', label: 'Только fallback' },
  { id: 'no_sender', label: 'Некому писать' },
  { id: 'expiring', label: 'Истекают 24ч' }
];

function focusChannel(row, key) {
  if (!row?.id) return false;
  window.localStorage.setItem(key, JSON.stringify({
    channel_id: String(row.id),
    channel_title: row.title || 'Без имени',
    source: 'admin_v2_retention'
  }));
  return true;
}

function openApp(href) {
  if (!href) return;
  window.location.href = href;
}

export function RetentionPage() {
  const { user, profileRole } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeSubtab = searchParams.get('subtab') || 'all';
  const [channelFilterId, setChannelFilterId] = useState('');
  const [state, setState] = useState({
    loading: true,
    refreshing: false,
    error: '',
    overview: {
      officialBotCount: 0,
      hasUserbot: false,
      channelCount: 0,
      readyChannels: 0,
      fallbackOnlyCount: 0,
      noSenderCount: 0,
      expiringSoonCount: 0,
      activeSubscriptionsCount: 0,
      channelRows: []
    }
  });

  function setActiveSubtab(id) {
    const next = new URLSearchParams(searchParams);
    next.set('subtab', id);
    setSearchParams(next);
  }

  useEffect(() => {
    let cancelled = false;

    async function loadRetention({ silent = false } = {}) {
      if (!user?.id) return;

      if (!silent) {
        setState((prev) => ({
          ...prev,
          loading: !prev.overview.channelRows.length,
          refreshing: !!prev.overview.channelRows.length,
          error: ''
        }));
      }

      try {
        const [{ data: channels }, { data: accounts }] = await Promise.all([
          supabase.from('channels').select('id, title, bot_id').eq('owner_id', user.id),
          supabase.from('tg_accounts').select('id, account_type, tg_username').eq('owner_id', user.id)
        ]);

        const channelList = channels || [];
        const accountList = accounts || [];
        const officialBots = accountList.filter((account) => account.account_type === 'bot');
        const userbot = accountList.find((account) => account.account_type === 'userbot');
        const channelIds = channelList.map((channel) => channel.id);

        let subscriptions = [];
        if (channelIds.length > 0) {
          const { data } = await supabase
            .from('subscriptions')
            .select('id, channel_id, status, expires_at')
            .in('channel_id', channelIds)
            .eq('status', 'active');
          subscriptions = data || [];
        }

        const now = Date.now();
        const next24h = now + (24 * 60 * 60 * 1000);
        const channelRows = channelList.map((channel) => {
          const channelSubscriptions = subscriptions.filter((subscription) => subscription.channel_id === channel.id);
          const expiringSoon = channelSubscriptions.filter((subscription) => {
            if (!subscription.expires_at) return false;
            const expiresAt = new Date(subscription.expires_at).getTime();
            return expiresAt >= now && expiresAt <= next24h;
          }).length;

          const bot = officialBots.find((item) => item.id === channel.bot_id);
          const hasOfficialBot = !!bot;
          const hasFallback = !!userbot;
          const readiness = hasOfficialBot || hasFallback;

          return {
            id: channel.id,
            title: channel.title || 'Без названия',
            activeSubscribers: channelSubscriptions.length,
            expiringSoon,
            officialBotUsername: bot?.tg_username || null,
            hasOfficialBot,
            hasFallback,
            readiness
          };
        });

        if (!cancelled) {
          setState({
            loading: false,
            refreshing: false,
            error: '',
            overview: {
              officialBotCount: officialBots.length,
              hasUserbot: !!userbot,
              channelCount: channelList.length,
              readyChannels: channelRows.filter((row) => row.readiness).length,
              fallbackOnlyCount: channelRows.filter((row) => row.hasFallback && !row.hasOfficialBot).length,
              noSenderCount: channelRows.filter((row) => !row.readiness).length,
              expiringSoonCount: channelRows.reduce((sum, row) => sum + row.expiringSoon, 0),
              activeSubscriptionsCount: subscriptions.length,
              channelRows
            }
          });
        }
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

    loadRetention();
    const intervalId = user?.id
      ? window.setInterval(() => {
          loadRetention({ silent: true });
        }, 60_000)
      : null;

    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [user?.id]);

  const filteredRows = useMemo(() => {
    return state.overview.channelRows.filter((row) => {
      if (channelFilterId && String(row.id) !== String(channelFilterId)) return false;
      if (activeSubtab === 'ready' && !row.readiness) return false;
      if (activeSubtab === 'fallback_only' && (row.hasOfficialBot || !row.hasFallback)) return false;
      if (activeSubtab === 'no_sender' && row.readiness) return false;
      if (activeSubtab === 'expiring' && row.expiringSoon <= 0) return false;
      return true;
    });
  }, [channelFilterId, activeSubtab, state.overview.channelRows]);

  if (state.loading) {
    return <LoadingState text="Грузим статус каналов..." />;
  }

  if (state.error) {
    return (
      <section className="page">
        <div className="error-card">{state.error}</div>
      </section>
    );
  }

  const stats = [
    { label: 'Каналы', value: state.overview.channelCount, icon: Hash, tab: 'all', color: 'text-slate-900' },
    { label: 'Готовы', value: state.overview.readyChannels, icon: CheckCircle2, tab: 'ready', color: state.overview.readyChannels > 0 ? 'text-emerald-500' : 'text-slate-400' },
    { label: 'Только fallback', value: state.overview.fallbackOnlyCount, icon: AlertCircle, tab: 'fallback_only', color: state.overview.fallbackOnlyCount > 0 ? 'text-amber-500' : 'text-slate-400' },
    { label: 'Некому писать', value: state.overview.noSenderCount, icon: XCircle, tab: 'no_sender', color: state.overview.noSenderCount > 0 ? 'text-red-500' : 'text-slate-400' },
    { label: 'Истекают 24ч', value: state.overview.expiringSoonCount, icon: Clock, tab: 'expiring', color: state.overview.expiringSoonCount > 0 ? 'text-amber-500' : 'text-slate-400' }
  ];

  return (
    <section className="page">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6 p-1.5 bg-slate-100 rounded-2xl">
        <div className="flex flex-wrap gap-1">
          {SUBTABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveSubtab(tab.id)}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${activeSubtab === tab.id ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-900'}`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <select
          value={channelFilterId}
          onChange={(event) => setChannelFilterId(event.target.value)}
          className="px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-700 focus:outline-none focus:border-slate-400 max-w-[260px] truncate"
        >
          <option value="">Все каналы</option>
          {state.overview.channelRows.map((row) => (
            <option key={row.id} value={row.id}>{row.title}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4 mb-8">
        {stats.map((item, idx) => {
          const Icon = item.icon;
          const isActive = activeSubtab === item.tab;
          return (
            <button
              key={idx}
              type="button"
              onClick={() => setActiveSubtab(item.tab)}
              className={`bg-slate-50/50 border p-6 rounded-3xl text-left transition-all hover:border-slate-200 hover:bg-slate-50 ${isActive ? 'border-slate-900 ring-1 ring-slate-900' : 'border-slate-100'}`}
            >
              <div className="flex items-center justify-between mb-4">
                <span className="text-[11px] font-black uppercase tracking-widest text-slate-400">{item.label}</span>
                <Icon className={`w-5 h-5 ${item.color} opacity-70`} />
              </div>
              <div className={`text-3xl font-black tracking-tighter ${item.color}`}>{item.value}</div>
            </button>
          );
        })}
      </div>

      <div className="bg-white border border-slate-100 rounded-3xl overflow-hidden">
        {filteredRows.length === 0 ? (
          <div className="p-16 text-center flex flex-col items-center">
            <div className="w-16 h-16 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-300 shadow-inner mb-4 border border-slate-100">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h4 className="text-lg font-black text-slate-900 tracking-tight mb-2">Ничего не нашлось</h4>
            <p className="text-slate-500 font-medium text-sm">Под текущий фильтр ничего не попало.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  <th className="px-6 py-3 text-left text-[11px] font-black uppercase tracking-widest text-slate-400">Канал</th>
                  <th className="px-6 py-3 text-left text-[11px] font-black uppercase tracking-widest text-slate-400">Оф. бот</th>
                  <th className="px-6 py-3 text-left text-[11px] font-black uppercase tracking-widest text-slate-400">Fallback</th>
                  <th className="px-6 py-3 text-left text-[11px] font-black uppercase tracking-widest text-slate-400">Истекают</th>
                  <th className="px-6 py-3 text-left text-[11px] font-black uppercase tracking-widest text-slate-400">Статус</th>
                  <th className="px-6 py-3 text-right text-[11px] font-black uppercase tracking-widest text-slate-400">Действия</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => {
                  const badge = row.hasOfficialBot
                    ? { text: 'Готово', cls: 'bg-emerald-50 text-emerald-700' }
                    : row.hasFallback
                      ? { text: 'Только fallback', cls: 'bg-amber-50 text-amber-700' }
                      : { text: 'Некому писать', cls: 'bg-rose-50 text-rose-700' };
                  return (
                    <tr key={row.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/30">
                      <td className="px-6 py-4">
                        <div className="font-bold text-slate-900 text-sm">{row.title}</div>
                        <div className="text-xs text-slate-400 font-medium mt-0.5">{row.activeSubscribers} активных</div>
                      </td>
                      <td className="px-6 py-4 text-sm font-mono text-slate-700">{row.officialBotUsername ? `@${row.officialBotUsername}` : '—'}</td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex px-2 py-1 rounded-md text-[11px] font-black ${row.hasFallback ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                          {row.hasFallback ? 'есть' : 'нет'}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`text-sm font-black ${row.expiringSoon > 0 ? 'text-amber-600' : 'text-slate-400'}`}>{row.expiringSoon}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex px-2 py-1 rounded-md text-[11px] font-black ${badge.cls}`}>{badge.text}</span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            className="px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors"
                            onClick={() => {
                              if (!focusChannel(row, 'crm_focus_channel')) return;
                              openApp(`/app/customers?tab=customers-active&channel=${encodeURIComponent(row.id)}`);
                            }}
                          >
                            CRM
                          </button>
                          <button
                            type="button"
                            className="px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors"
                            onClick={() => {
                              if (!focusChannel(row, 'orders_focus_channel')) return;
                              openApp(`/app/customers?tab=paid-orders&channel=${encodeURIComponent(row.id)}`);
                            }}
                          >
                            Заказы
                          </button>
                          {profileRole === 'admin' ? (
                            <button
                              type="button"
                              className="px-3 py-1.5 rounded-lg text-xs font-bold border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 transition-colors"
                              onClick={() => {
                                if (!row?.id) return;
                                window.localStorage.setItem('broadcast_manual_selection', JSON.stringify({
                                  source: 'admin_v2_retention_channel',
                                  base_name: `Удержание: ${row.title || 'без имени'}`,
                                  channel_id: row.id,
                                  suggested_title: `Удержание: ${row.title || 'без имени'}`,
                                  suggested_message: row.expiringSoon > 0
                                    ? `У тебя по каналу "${row.title || 'без имени'}" скоро истекает доступ. Если хочешь остаться внутри без вылета, продли подписку заранее.`
                                    : `Короткое напоминание по каналу "${row.title || 'без имени'}". Проверь доступ и продли подписку, если не хочешь потерять место.`
                                }));
                                openApp('/app/broadcast');
                              }}
                            >
                              Пнуть
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
