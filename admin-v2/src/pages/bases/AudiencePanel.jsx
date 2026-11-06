import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Users, ChevronRight, Rocket, AlertCircle } from 'lucide-react';
import { apiRequest } from '../../api/client.js';
import { filterAudienceMembers } from './shared.js';
import { ChannelsGrid } from './ChannelsGrid.jsx';
import { ChannelAudienceSection } from './ChannelAudienceSection.jsx';

function needsUserbotRecovery(message = '') {
  const value = String(message || '').toLowerCase();
  return value.includes('юзербот')
    || value.includes('сессия')
    || value.includes('прокси')
    || value.includes('expired')
    || value.includes('auth_key_unregistered');
}

export function AudiencePanel({ accessToken, onAddToBase, addToBaseDisabled, targetLabel }) {
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
  // Права всех акторов контура (официальный бот + юзерботы) в площадках:
  // channelId → { chips: [{ label, ok }], anyOk }. Не получили — чипы не рисуем.
  const [contourChipsByChannel, setContourChipsByChannel] = useState(null);

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
        setMetaError(err.message || 'Ошибка загрузки аудитории');
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

  // Права бота и юзерботов по площадкам контура (каналы/чаты с привязкой к базе видно здесь же).
  // Fail-soft: контура нет или запрос упал — чипы не показываем, без ошибок.
  useEffect(() => {
    if (!accessToken || !botId) {
      setContourChipsByChannel(null);
      return undefined;
    }
    let cancelled = false;
    apiRequest('/api/official-bot/contours', { accessToken })
      .then((data) => {
        if (cancelled) return;
        const entry = (data?.bots || []).find((bot) => String(bot.id) === String(botId));
        const contour = entry?.contour || null;
        if (!contour) {
          setContourChipsByChannel(null);
          return;
        }
        const rightsByTarget = entry?.rights_by_target || {};
        // actor_rights_by_target появился позже прав_by_target: до деплоя бэкенда его просто нет.
        const actorRightsByTarget = entry?.actor_rights_by_target || {};
        const labelById = new Map(
          (data?.userbot_options || []).map((u) => [
            String(u?.id || ''),
            u?.tg_username ? `@${u.tg_username}` : (u?.tg_account_id ? `ID ${u.tg_account_id}` : 'юзербот')
          ])
        );
        const isActorOk = (actor) => !!actor
          && (actor.state === 'ok' || actor.state === 'owner_appointed')
          && !!actor.is_admin;
        const slots = [
          ['public_channel_id', 'public_channel'],
          ['paid_channel_id', 'paid_channel'],
          ['public_chat_id', 'public_chat'],
          ['paid_chat_id', 'paid_chat']
        ];
        const byChannel = new Map();
        for (const [slotKey, targetKey] of slots) {
          const slotChannelId = contour[slotKey];
          if (!slotChannelId) continue;
          const rights = rightsByTarget[targetKey] || null;
          const actorRows = Array.isArray(actorRightsByTarget[targetKey]) ? actorRightsByTarget[targetKey] : [];
          if (!rights && actorRows.length === 0) continue;
          const officialActor = actorRows.find((actor) => actor?.actor_type === 'official_bot') || null;
          const officialOk = !!rights?.is_admin || isActorOk(officialActor);
          const chips = [];
          if (rights || officialActor) chips.push({ label: 'бот', ok: officialOk });
          for (const actor of actorRows) {
            if (actor?.actor_type !== 'userbot') continue;
            chips.push({ label: labelById.get(String(actor?.actor_id || '')) || 'юзербот', ok: isActorOk(actor) });
          }
          byChannel.set(String(rights?.channel_id || slotChannelId), {
            chips,
            anyOk: chips.some((chip) => chip.ok)
          });
        }
        setContourChipsByChannel(byChannel);
      })
      .catch(() => {
        if (!cancelled) setContourChipsByChannel(null);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, botId]);

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
        const summary = { ...(data.summary || {}) };
        // total_count — настоящая длина базы; summary.total считается по выборке (лимит 1000)
        if (typeof data.total_count === 'number') summary.total = data.total_count;
        setMembers(data.members || []);
        setMemberSummary(summary);
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
      // Новые поля бэкенда читаем защитно: до деплоя бэкенда их просто нет.
      // synced_count = сколько людей подняли, synced = сколько каналов опросили без ошибок.
      const failedChannels = Array.isArray(data.failed_channels) ? data.failed_channels : [];

      const refreshed = await apiRequest(`/api/channel-audiences/${activeBaseId}/members`, { accessToken });
      const summary = { ...(refreshed.summary || {}) };
      if (typeof refreshed.total_count === 'number') summary.total = refreshed.total_count;
      setMembers(refreshed.members || []);
      setMemberSummary(summary);

      if (failedChannels.length > 0) {
        toast.warning(`Синк прошёл частично: ${failedChannels.length} канал(ов) с ошибками — статусы присутствия этих участников не обновлены`);
      } else {
        toast.success(`Подняли ${data.synced_count || 0} человек из ${data.scanned_channels || 0} каналов`);
      }
      if (data.truncated) {
        toast('Показаны первые 5000 участников канала', { duration: 5000 });
      }
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
              <a href="/userbot/accounts" className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 !text-white text-xs font-bold hover:bg-slate-700 transition-colors">
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
          <a href="/paywall/sales-bot" className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 !text-white text-xs font-bold hover:bg-slate-700 transition-colors">
            Создать бота <ChevronRight className="w-4 h-4" />
          </a>
        </div>
      </div>
    );
  }

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
          <h2 className="text-sm font-black uppercase tracking-widest text-slate-500">Аудитория бота</h2>
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

      <ChannelsGrid
        channelsForBot={channelsForBot}
        bases={bases}
        channelId={channelId}
        contourChipsByChannel={contourChipsByChannel}
        onSelectChannel={(ch) => { setChannelId(ch.id); setFilter('humans'); setSearch(''); }}
      />

      <ChannelAudienceSection
        selectedChannel={selectedChannel}
        memberSummary={memberSummary}
        coverageStats={coverageStats}
        filteredMembers={filteredMembers}
        filter={filter}
        onFilterChange={setFilter}
        search={search}
        onSearchChange={setSearch}
        targetLabel={targetLabel}
        membersLoading={membersLoading}
        membersTotal={members.length}
        onAddToBase={onAddToBase}
        addToBaseDisabled={addToBaseDisabled}
        userbots={userbots}
        selectedUserbotId={selectedUserbotId}
        onUserbotChange={setSelectedUserbotId}
        syncing={syncing}
        activeBaseId={activeBaseId}
        onSync={syncBase}
        onCreateAudience={createAudienceForChannel}
      />
    </div>
  );
}
