import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Users, RefreshCw, ChevronRight, Rocket, AlertCircle, Plus, Send } from 'lucide-react';
import { apiRequest } from '../../api/client.js';
import { MEMBER_FILTERS, filterAudienceMembers } from './shared.js';
import { AudienceMembersTable } from './AudienceMembersTable.jsx';

function needsUserbotRecovery(message = '') {
  const value = String(message || '').toLowerCase();
  return value.includes('юзербот')
    || value.includes('сессия')
    || value.includes('прокси')
    || value.includes('expired')
    || value.includes('auth_key_unregistered');
}

export function AudiencePanel({ accessToken, onAddToBase, addToBaseDisabled }) {
  const [bots, setBots] = useState([]);
  const [channels, setChannels] = useState([]);
  const [bases, setBases] = useState([]);
  const [userbots, setUserbots] = useState([]);
  const [metaLoading, setMetaLoading] = useState(true);
  const [metaError, setMetaError] = useState('');
  const [botId, setBotId] = useState('');
  const [channelId, setChannelId] = useState('');

  const [members, setMembers] = useState([]);
  const [memberSummary, setMemberSummary] = useState({});
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState('');

  const [filter, setFilter] = useState('humans');
  const [search, setSearch] = useState('');
  const [selectedUserbotId, setSelectedUserbotId] = useState('');
  const [syncing, setSyncing] = useState(false);

  const metaReqRef = useRef(0);
  const membersReqRef = useRef(0);

  // Load meta (bots, channels, userbots) + base list for channel linkage
  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    async function loadMeta() {
      const reqId = ++metaReqRef.current;
      setMetaLoading(true);
      try {
        const data = await apiRequest('/api/channel-audiences', { accessToken });
        if (cancelled || reqId !== metaReqRef.current) return;
        setBases(data.bases || []);
        setChannels(data.channels || []);
        setUserbots(data.userbots || []);
        setBots(data.bots || []);
        setMetaError('');
        if (!botId && (data.bots || []).length > 0) {
          setBotId(data.bots[0].id);
        }
      } catch (err) {
        if (cancelled || reqId !== metaReqRef.current) return;
        setMetaError(err.message || 'Ошибка загрузки аудитии');
      } finally {
        if (!cancelled && reqId === metaReqRef.current) setMetaLoading(false);
      }
    }
    loadMeta();
    return () => { cancelled = true; };
  }, [accessToken]);

  // On focus re-fetch (lightweight, no polling)
  useEffect(() => {
    function handleFocus() {
      if (!accessToken) return;
      apiRequest('/api/channel-audiences', { accessToken })
        .then((data) => {
          setBases(data.bases || []);
          setChannels(data.channels || []);
          setUserbots(data.userbots || []);
          setBots(data.bots || []);
        })
        .catch(() => {});
    }
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [accessToken]);

  // Auto-pick first channel of selected bot
  useEffect(() => {
    if (!botId || channels.length === 0) return;
    const current = channels.find((c) => String(c.id) === String(channelId));
    if (current && current.bot_id === botId) return;
    const firstOfBot = channels.find((c) => c.bot_id === botId);
    setChannelId(firstOfBot ? firstOfBot.id : '');
    setFilter('humans');
    setSearch('');
  }, [botId, channels, channelId]);

  const selectedChannel = useMemo(
    () => channels.find((c) => String(c.id) === String(channelId)) || null,
    [channels, channelId]
  );

  const activeBaseId = selectedChannel?.linked_base_id || '';

  // Load members when channel/base changes
  useEffect(() => {
    if (!accessToken || !activeBaseId) {
      setMembers([]);
      setMemberSummary({});
      return;
    }
    let cancelled = false;
    async function loadMembers() {
      const reqId = ++membersReqRef.current;
      setMembersLoading(true);
      try {
        const data = await apiRequest(`/api/channel-audiences/${activeBaseId}/members`, { accessToken });
        if (cancelled || reqId !== membersReqRef.current) return;
        setMembers(data.members || []);
        setMemberSummary(data.summary || {});
        setMembersError('');
      } catch (err) {
        if (cancelled || reqId !== membersReqRef.current) return;
        setMembersError(err.message || 'Ошибка загрузки участников');
      } finally {
        if (!cancelled && reqId === membersReqRef.current) setMembersLoading(false);
      }
    }
    loadMembers();
    return () => { cancelled = true; };
  }, [accessToken, activeBaseId]);

  // Keep userbot selector in sync
  useEffect(() => {
    if (userbots.length === 0) {
      setSelectedUserbotId('');
      return;
    }
    if (!selectedUserbotId || !userbots.find((u) => String(u.id) === String(selectedUserbotId))) {
      setSelectedUserbotId(String(userbots[0].id));
    }
  }, [userbots, selectedUserbotId]);

  const filteredMembers = useMemo(
    () => filterAudienceMembers(members, filter, search),
    [members, filter, search]
  );

  const coverageStats = useMemo(() => members.reduce((stats, member) => {
    stats.total += 1;
    if (member.coverage_status === 'all_channels') stats.all += 1;
    if (member.coverage_status === 'partial_channels') stats.partial += 1;
    if (member.coverage_status === 'missing_everywhere') stats.missing += 1;
    return stats;
  }, { total: 0, all: 0, partial: 0, missing: 0 }), [members]);

  const channelsForBot = useMemo(
    () => channels.filter((c) => !botId || c.bot_id === botId),
    [channels, botId]
  );

  async function syncBase() {
    if (!activeBaseId) { toast.error('Сначала выберите канал'); return; }
    if (!selectedUserbotId) { toast.error('Выберите юзербота для синка'); return; }
    setSyncing(true);
    try {
      const data = await apiRequest(`/api/channel-audiences/${activeBaseId}/sync`, {
        accessToken,
        method: 'POST',
        body: { userbot_id: selectedUserbotId }
      });
      const refreshed = await apiRequest(`/api/channel-audiences/${activeBaseId}/members`, { accessToken });
      setMembers(refreshed.members || []);
      setMemberSummary(refreshed.summary || {});
      toast.success(`Подняли ${data.synced_count || 0} человек из ${data.scanned_channels || 0} каналов`);
    } catch (err) {
      toast.error(err.message || 'Синк не удался');
    } finally {
      setSyncing(false);
    }
  }

  async function createAudienceForChannel() {
    if (!selectedChannel) return;
    try {
      const created = await apiRequest('/api/channel-audiences', {
        accessToken,
        method: 'POST',
        body: { name: selectedChannel.title || 'Аудитория канала' }
      });
      if (!created?.id) throw new Error('Не получили id созданной базы');
      await apiRequest(`/api/channel-audiences/${created.id}/channels`, {
        accessToken,
        method: 'POST',
        body: { channel_ids: [selectedChannel.id] }
      });
      const refreshed = await apiRequest('/api/channel-audiences', { accessToken });
      setBases(refreshed.bases || []);
      setChannels(refreshed.channels || []);
      toast.success('База создана и привязана к каналу');
    } catch (err) {
      toast.error(err.message || 'Не удалось создать аудиторию');
    }
  }

  function changeBot(id) {
    setBotId(id);
    setChannelId('');
    setFilter('humans');
    setSearch('');
  }

  if (metaLoading && bases.length === 0 && channels.length === 0) {
    return (
      <div className="bg-white border border-slate-200/60 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
        <div className="p-6 md:p-8">
          <div className="p-4 rounded-2xl bg-slate-50/50 border border-slate-100 text-sm text-slate-500 font-medium">
            Грузим аудиторию…
          </div>
        </div>
      </div>
    );
  }

  if (metaError && bases.length === 0 && channels.length === 0) {
    return (
      <div className="bg-white border border-slate-200/60 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
        <div className="p-6 md:p-8">
          <div className="p-5 rounded-2xl bg-red-50 border border-red-100 text-red-600 font-bold text-sm flex items-center gap-3 mb-4">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            {metaError}
          </div>
          {needsUserbotRecovery(metaError) ? (
            <div className="p-5 rounded-2xl bg-amber-50/60 border border-amber-200">
              <div className="font-bold text-amber-800 mb-1">Нужен живой юзербот</div>
              <div className="text-sm text-amber-700 mb-4">
                Базы аудитории тянут людей через живого юзербота. Если сессия умерла или прокси недоступен — переподключите аккаунт.
              </div>
              <a href="/app/userbots" className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 !text-white text-xs font-bold hover:bg-slate-700 transition-colors">
                Открыть Юзерботы <ChevronRight className="w-4 h-4" />
              </a>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  if (bots.length === 0) {
    return (
      <div className="bg-white border border-slate-200/60 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
        <div className="p-16 text-center flex flex-col items-center">
          <div className="w-16 h-16 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-300 shadow-inner mb-4 border border-slate-100">
            <Rocket className="w-8 h-8" />
          </div>
          <h4 className="text-lg font-black text-slate-900 tracking-tight mb-2">Нет ботов продаж</h4>
          <p className="text-slate-500 font-medium text-sm mb-6 max-w-md">
            Создайте бота, чтобы собирать аудиторию из его каналов и групп и работать с сегментами.
          </p>
          <a href="/sales-bot" className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 !text-white text-xs font-bold hover:bg-slate-700 transition-colors">
            Создать бота <ChevronRight className="w-4 h-4" />
          </a>
        </div>
      </div>
    );
  }

  const statCards = [
    { label: 'Людей в базе', value: memberSummary.total || 0, color: 'text-slate-900' },
    { label: 'Активно платят', value: memberSummary.active_paid || 0, color: (memberSummary.active_paid || 0) > 0 ? 'text-emerald-600' : 'text-slate-400' },
    { label: 'Без подписки', value: memberSummary.free_riders || 0, color: (memberSummary.free_riders || 0) > 0 ? 'text-rose-600' : 'text-slate-400' },
    { label: 'Неполное покрытие', value: coverageStats.partial, color: coverageStats.partial > 0 ? 'text-amber-600' : 'text-slate-400' }
  ];

  return (
    <div className="bg-white border border-slate-200/60 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
      {(metaError || membersError) && (
        <div className="m-6 mb-0 p-5 rounded-2xl bg-red-50 border border-red-100 text-red-600 font-bold text-sm flex items-center gap-3 shadow-sm">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          {metaError || membersError}
        </div>
      )}

      <section className="p-6 md:p-8 border-b border-slate-100">
        <div className="flex items-center gap-2 mb-4">
          <Users className="w-5 h-5 text-slate-500" />
          <h2 className="text-sm font-black uppercase tracking-widest text-slate-400">Аудитория бота</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={botId}
            onChange={(event) => changeBot(event.target.value)}
            className="px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-sm font-bold text-slate-900 focus:outline-none focus:border-slate-400 max-w-[280px]"
          >
            {bots.map((bot) => (
              <option key={bot.id} value={bot.id}>
                {bot.custom_label || (bot.tg_username ? `@${bot.tg_username}` : 'Без имени')}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="p-6 md:p-8 border-b border-slate-100">
        <h3 className="text-sm font-black uppercase tracking-widest text-slate-400 mb-4">Каналы и группы</h3>
        {channelsForBot.length === 0 ? (
          <div className="p-4 rounded-2xl bg-slate-50/50 border border-slate-100 text-sm text-slate-500 font-medium">
            У этого бота пока нет каналов. Создайте канал на странице «Бот продаж».
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {channelsForBot.map((ch) => {
              const active = String(ch.id) === String(channelId);
              const base = bases.find((b) => b.id === ch.linked_base_id);
              const count = base?.stats?.humans || 0;
              const hasAudience = !!ch.linked_base_id;
              return (
                <button
                  key={ch.id}
                  type="button"
                  onClick={() => { setChannelId(ch.id); setFilter('humans'); setSearch(''); }}
                  className={`p-4 rounded-2xl border text-left transition-all ${
                    active ? 'border-slate-900 bg-slate-50 shadow-sm' : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="text-sm font-black text-slate-900 truncate mb-1">{ch.title}</div>
                  <div className="text-xs text-slate-500 font-medium">
                    {hasAudience ? `${count} людей` : 'База не создана'}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {selectedChannel ? (
        selectedChannel.linked_base_id ? (
          <Fragment>
            <section className="p-6 md:p-8 border-b border-slate-100">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {statCards.map((card, idx) => (
                  <div key={idx} className="bg-slate-50/50 border border-slate-100 p-6 rounded-3xl">
                    <div className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-2">{card.label}</div>
                    <div className={`text-3xl font-black tracking-tighter ${card.color}`}>{card.value}</div>
                  </div>
                ))}
              </div>
            </section>

            <section className="p-6 md:p-8 border-b border-slate-100">
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
                <h3 className="text-sm font-black uppercase tracking-widest text-slate-400">Участники канала</h3>
                <span className="text-xs font-bold text-slate-400">
                  {filteredMembers.length} показываем
                  {members.length > filteredMembers.length ? ` · ${members.length} всего` : ''}
                </span>
              </div>

              <div className="flex flex-wrap gap-1.5 mb-4">
                {MEMBER_FILTERS.map((item) => {
                  const active = filter === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setFilter(item.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                        active ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center gap-2 mb-4">
                <input
                  type="text"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Имя, @username или TG ID"
                  className="flex-1 min-w-[200px] px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm text-slate-900 focus:outline-none focus:border-slate-400"
                />
              </div>

              {membersLoading && members.length === 0 ? (
                <div className="p-4 rounded-2xl bg-slate-50/50 border border-slate-100 text-sm text-slate-500 font-medium">
                  Грузим участников...
                </div>
              ) : (
                <AudienceMembersTable
                  members={filteredMembers}
                  onCopyToBase={onAddToBase}
                  addToBaseDisabled={addToBaseDisabled}
                />
              )}
            </section>

            <section className="p-6 md:p-8">
              <h3 className="text-sm font-black uppercase tracking-widest text-slate-400 mb-4">Синк из групп через юзербота</h3>
              {userbots.length === 0 ? (
                <div className="p-4 rounded-2xl bg-amber-50/60 border border-amber-200 text-amber-800">
                  <div className="font-bold mb-1">Нет подключённого юзербота</div>
                  <div className="text-sm opacity-90 mb-3">
                    Без юзербота синк из групп недоступен. Подключите аккаунт на странице «Юзерботы».
                  </div>
                  <a href="/app/userbots" className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-900 !text-white hover:bg-slate-700 transition-colors">
                    Открыть Юзерботы <ChevronRight className="w-3.5 h-3.5" />
                  </a>
                </div>
              ) : (
                <Fragment>
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    <select
                      value={selectedUserbotId}
                      onChange={(event) => setSelectedUserbotId(event.target.value)}
                      className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm font-bold text-slate-900 focus:outline-none focus:border-slate-400 max-w-[320px]"
                    >
                      {userbots.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.tg_username ? `@${u.tg_username}` : `ID ${u.tg_account_id}`}
                          {u.proxy_country ? ` · ${u.proxy_country}` : ''}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={syncBase}
                      disabled={!activeBaseId || syncing}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
                      {syncing ? 'Синхронизация...' : 'Запустить синк'}
                    </button>
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed max-w-2xl">
                    Берёт актуальных участников из привязанных каналов и групп, сопоставляет с подписками и обновляет покрытие базы. Безопасно запускать повторно — старые записи не удаляются, только обновляется <code className="px-1 bg-slate-100 rounded">present_now</code>.
                  </p>
                </Fragment>
              )}
            </section>
          </Fragment>
        ) : (
          <section className="p-6 md:p-8">
            <div className="p-5 rounded-2xl bg-amber-50/60 border border-amber-200">
              <div className="font-bold text-amber-800 mb-1">У этого канала ещё нет базы аудитории</div>
              <div className="text-sm text-amber-700 mb-4">
                Создайте базу и привяжите канал, чтобы синкать участников через юзербота.
              </div>
              <button
                type="button"
                onClick={createAudienceForChannel}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-900 text-white hover:bg-slate-700 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Создать аудиторию для канала
              </button>
            </div>
          </section>
        )
      ) : (
        <section className="p-6 md:p-8">
          <div className="p-4 rounded-2xl bg-slate-50/50 border border-slate-100 text-sm text-slate-500 font-medium">
            Выберите канал выше, чтобы увидеть участников.
          </div>
        </section>
      )}
    </div>
  );
}
