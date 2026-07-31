import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Users, Database, CircleCheckBig, CircleAlert, AlertCircle,
  Send, ChevronRight, Rocket, RefreshCw, Plus, ArrowRight
} from 'lucide-react';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { LoadingState } from '../ui/LoadingState.jsx';
import { UpgradeCallout } from '../ui/UpgradeCallout.jsx';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from '../components/ui/dialog.jsx';

const MEMBER_FILTERS = [
  { id: 'humans', label: 'Люди' },
  { id: 'all', label: 'Все' },
  { id: 'active_paid', label: 'Активно платят' },
  { id: 'expired_paid', label: 'Сгорели' },
  { id: 'unpaid_leads', label: 'Не оплатили' },
  { id: 'free_riders', label: 'Без подписки' },
  { id: 'all_channels', label: 'Есть везде' },
  { id: 'partial_channels', label: 'Есть не везде' },
  { id: 'manual_only', label: 'Вбиты руками' },
  { id: 'synced_only', label: 'Из групп' }
];

function formatRelativeTime(iso) {
  if (!iso) return '—';
  const ts = new Date(iso).getTime();
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60_000) return 'только что';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} мин назад`;
  const d = new Date(iso);
  if (diff < 24 * 3600_000) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function coverageLabel(member) {
  if (member.coverage_status === 'all_channels') return 'Во всех местах';
  if (member.coverage_status === 'partial_channels') return 'Не во всех местах';
  if (member.coverage_status === 'missing_everywhere') return 'Не найден';
  return '—';
}

function paymentBadge(payment_status) {
  switch (payment_status) {
    case 'active_paid':
      return { text: 'Активно платит', cls: 'bg-emerald-50 text-emerald-700' };
    case 'expired_paid':
      return { text: 'Платил, сгорел', cls: 'bg-amber-50 text-amber-700' };
    case 'expired_paid_inside':
      return { text: 'Сгорел, сидит внутри', cls: 'bg-rose-50 text-rose-700' };
    case 'free_rider':
      return { text: 'Без подписки', cls: 'bg-rose-50 text-rose-700' };
    case 'unpaid_lead':
      return { text: 'Жал, не оплатил', cls: 'bg-slate-100 text-slate-600' };
    default:
      return { text: 'Нет истории', cls: 'bg-slate-100 text-slate-500' };
  }
}

function needsUserbotRecovery(message = '') {
  const value = String(message || '').toLowerCase();
  return value.includes('юзербот')
    || value.includes('сессия')
    || value.includes('прокси')
    || value.includes('expired')
    || value.includes('auth_key_unregistered');
}

export function CustomerBasesPage() {
  const { accessToken, profilePlan, trialEndsAt } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const botIdFromUrl = searchParams.get('bot') || '';
  const channelIdFromUrl = searchParams.get('channel') || '';
  const customBaseIdFromUrl = searchParams.get('custom') || '';

  const [bases, setBases] = useState([]);
  const [channels, setChannels] = useState([]);
  const [bots, setBots] = useState([]);
  const [userbots, setUserbots] = useState([]);
  const [metaLoading, setMetaLoading] = useState(true);
  const [metaError, setMetaError] = useState('');

  const [members, setMembers] = useState([]);
  const [memberSummary, setMemberSummary] = useState({});
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState('');

  const [filter, setFilter] = useState('humans');
  const [search, setSearch] = useState('');
  const [baseForm, setBaseForm] = useState({ id: '', name: '', description: '' });
  const [selectedUserbotId, setSelectedUserbotId] = useState('');
  const [manualImportText, setManualImportText] = useState('');
  const [isCreatingCustom, setIsCreatingCustom] = useState(false);
  const [actionState, setActionState] = useState({
    savingBase: false,
    syncing: false,
    manualAdding: false,
    creatingAudience: false
  });
  const [copyModal, setCopyModal] = useState({
    open: false,
    sourceMembers: [],
    targetMode: 'existing',
    targetBaseId: '',
    newBaseName: ''
  });

  const metaReqIdRef = useRef(0);
  const membersReqIdRef = useRef(0);

  const trialHoursLeft = useMemo(() => {
    if (!trialEndsAt) return null;
    const diffMs = new Date(trialEndsAt).getTime() - Date.now();
    if (diffMs <= 0) return 0;
    return Math.ceil(diffMs / (1000 * 60 * 60));
  }, [trialEndsAt]);
  const trialUpgradeUrgent = profilePlan === 'trial'
    && trialHoursLeft !== null
    && trialHoursLeft > 0
    && trialHoursLeft <= 72;

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;

    async function loadMeta({ silent = false } = {}) {
      const reqId = ++metaReqIdRef.current;
      if (!silent) setMetaLoading(true);
      try {
        const data = await apiRequest('/api/customer-bases', { accessToken });
        if (cancelled || reqId !== metaReqIdRef.current) return;
        setBases(data.bases || []);
        setChannels(data.channels || []);
        setUserbots(data.userbots || []);
        setBots(data.bots || []);
        setMetaError('');
        if (!searchParams.get('bot') && (data.bots || []).length > 0) {
          const next = new URLSearchParams(searchParams);
          next.set('bot', data.bots[0].id);
          setSearchParams(next, { replace: true });
        }
      } catch (err) {
        if (cancelled || reqId !== metaReqIdRef.current) return;
        setMetaError(err.message || 'Ошибка загрузки баз');
      } finally {
        if (!cancelled && reqId === metaReqIdRef.current) setMetaLoading(false);
      }
    }

    loadMeta();
    const intervalId = window.setInterval(() => loadMeta({ silent: true }), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [accessToken]);

  const channelsForBot = useMemo(
    () => channels.filter((c) => !botIdFromUrl || c.bot_id === botIdFromUrl),
    [channels, botIdFromUrl]
  );

  const customBases = useMemo(
    () => bases.filter((b) => (b.channels || []).length === 0),
    [bases]
  );

  const selectedChannel = useMemo(
    () => channels.find((c) => String(c.id) === String(channelIdFromUrl)) || null,
    [channels, channelIdFromUrl]
  );

  const selectedCustomBase = useMemo(
    () => bases.find((b) => String(b.id) === String(customBaseIdFromUrl)) || null,
    [bases, customBaseIdFromUrl]
  );

  // backend /members endpoint требует base_id — channel имеет приоритет над custom
  const activeBaseId = selectedChannel?.linked_base_id
    || customBaseIdFromUrl
    || '';

  const selectedBase = useMemo(
    () => bases.find((b) => String(b.id) === String(activeBaseId)) || null,
    [bases, activeBaseId]
  );

  // audience mode — выбран channel с базой
  const isAudienceMode = !!selectedChannel && !!selectedChannel.linked_base_id;
  // custom mode — выбрана кастомная база (не channel)
  const isCustomMode = !selectedChannel && !!selectedCustomBase;

  useEffect(() => {
    if (!accessToken || !activeBaseId) {
      setMembers([]);
      setMemberSummary({});
      return;
    }
    let cancelled = false;

    async function loadMembers({ silent = false } = {}) {
      const reqId = ++membersReqIdRef.current;
      if (!silent) setMembersLoading(true);
      try {
        const data = await apiRequest(`/api/customer-bases/${activeBaseId}/members`, { accessToken });
        if (cancelled || reqId !== membersReqIdRef.current) return;
        setMembers(data.members || []);
        setMemberSummary(data.summary || {});
        setMembersError('');
      } catch (err) {
        if (cancelled || reqId !== membersReqIdRef.current) return;
        setMembersError(err.message || 'Ошибка загрузки участников');
      } finally {
        if (!cancelled && reqId === membersReqIdRef.current) setMembersLoading(false);
      }
    }

    loadMembers();
    const intervalId = window.setInterval(() => loadMembers({ silent: true }), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [accessToken, activeBaseId]);

  // auto-select first channel of bot when bot changes
  useEffect(() => {
    if (!botIdFromUrl || channels.length === 0) return;
    const current = channels.find((c) => String(c.id) === String(channelIdFromUrl));
    if (current && current.bot_id === botIdFromUrl) return;
    const firstOfBot = channels.find((c) => c.bot_id === botIdFromUrl);
    const next = new URLSearchParams(searchParams);
    if (firstOfBot) next.set('channel', firstOfBot.id);
    else next.delete('channel');
    next.delete('custom');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botIdFromUrl, channels]);

  // sync base form with selected custom base (or creating-new state)
  useEffect(() => {
    if (isCreatingCustom) return; // не сбрасываем форму при создании новой
    if (!selectedCustomBase) {
      if (!isCustomMode) {
        setBaseForm({ id: '', name: '', description: '' });
      }
      return;
    }
    setBaseForm({
      id: selectedCustomBase.id,
      name: selectedCustomBase.name || '',
      description: selectedCustomBase.description || ''
    });
  }, [selectedCustomBase, isCreatingCustom, isCustomMode]);

  useEffect(() => {
    if (userbots.length === 0) {
      setSelectedUserbotId('');
      return;
    }
    if (!selectedUserbotId || !userbots.find((u) => String(u.id) === String(selectedUserbotId))) {
      setSelectedUserbotId(String(userbots[0].id));
    }
  }, [userbots, selectedUserbotId]);

  const filteredMembers = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return members.filter((member) => {
      if (filter === 'humans' && member.is_bot) return false;
      if (filter === 'active_paid' && member.payment_status !== 'active_paid') return false;
      if (filter === 'expired_paid' && !['expired_paid', 'expired_paid_inside'].includes(member.payment_status)) return false;
      if (filter === 'unpaid_leads' && member.payment_status !== 'unpaid_lead') return false;
      if (filter === 'free_riders' && !['free_rider', 'expired_paid_inside'].includes(member.payment_status)) return false;
      if (filter === 'all_channels' && member.coverage_status !== 'all_channels') return false;
      if (filter === 'partial_channels' && member.coverage_status !== 'partial_channels') return false;
      if (filter === 'manual_only' && member.source !== 'manual') return false;
      if (filter === 'synced_only' && member.source === 'manual') return false;

      if (!needle) return true;

      return [
        member.display_name || '',
        member.username ? `@${member.username}` : '',
        String(member.tg_user_id || ''),
        member.payment_status || '',
        coverageLabel(member)
      ].join(' ').toLowerCase().includes(needle);
    });
  }, [filter, search, members]);

  const coverageStats = useMemo(() => members.reduce((stats, member) => {
    stats.total += 1;
    if (member.coverage_status === 'all_channels') stats.all += 1;
    if (member.coverage_status === 'partial_channels') stats.partial += 1;
    if (member.coverage_status === 'missing_everywhere') stats.missing += 1;
    return stats;
  }, { total: 0, all: 0, partial: 0, missing: 0 }), [members]);

  const prioritySignals = useMemo(() => {
    const signals = [];
    if ((memberSummary.free_riders || 0) > 0) {
      signals.push({
        tone: 'danger',
        title: `Сидят без подписки: ${memberSummary.free_riders}`,
        text: 'Люди внутри контура без активной подписки. Разберите через CRM, Access или рассылку.'
      });
    }
    if (coverageStats.partial > 0) {
      signals.push({
        tone: 'warning',
        title: `Неполное покрытие: ${coverageStats.partial}`,
        text: 'Эти люди есть не во всех привязанных каналах и группах. Главный сегмент для ручной работы и дожима.'
      });
    }
    if (userbots.length === 0) {
      signals.push({
        tone: 'warning',
        title: 'Нет подключённого юзербота',
        text: 'Без юзербота синк из групп недоступен. Подключите аккаунт на странице «Юзерботы».'
      });
    }
    return signals;
  }, [coverageStats, memberSummary, userbots.length]);

  function changeBot(id) {
    const next = new URLSearchParams(searchParams);
    if (id) next.set('bot', id); else next.delete('bot');
    next.delete('channel');
    next.delete('custom');
    setSearchParams(next, { replace: true });
    setFilter('humans');
    setSearch('');
    setIsCreatingCustom(false);
  }

  function selectChannel(id) {
    const next = new URLSearchParams(searchParams);
    if (id) next.set('channel', id); else next.delete('channel');
    next.delete('custom');
    setSearchParams(next, { replace: true });
    setFilter('humans');
    setSearch('');
    setIsCreatingCustom(false);
  }

  function selectCustomBase(id) {
    const next = new URLSearchParams(searchParams);
    if (id) next.set('custom', id); else next.delete('custom');
    next.delete('channel');
    setSearchParams(next, { replace: true });
    setFilter('humans');
    setSearch('');
    setIsCreatingCustom(false);
  }

  function startNewCustomBase() {
    const next = new URLSearchParams(searchParams);
    next.delete('custom');
    next.delete('channel');
    setSearchParams(next, { replace: true });
    setBaseForm({ id: '', name: '', description: '' });
    setIsCreatingCustom(true);
    setFilter('humans');
    setSearch('');
  }

  function resetBaseForm() {
    if (selectedCustomBase) {
      setBaseForm({
        id: selectedCustomBase.id,
        name: selectedCustomBase.name || '',
        description: selectedCustomBase.description || ''
      });
    } else {
      setBaseForm({ id: '', name: '', description: '' });
      setIsCreatingCustom(false);
    }
  }

  async function reloadMeta() {
    const reqId = ++metaReqIdRef.current;
    try {
      const data = await apiRequest('/api/customer-bases', { accessToken });
      if (reqId !== metaReqIdRef.current) return;
      setBases(data.bases || []);
      setChannels(data.channels || []);
      setUserbots(data.userbots || []);
      setBots(data.bots || []);
    } catch (err) {
      if (reqId !== metaReqIdRef.current) return;
      setMetaError(err.message || 'Ошибка загрузки баз');
    }
  }

  async function reloadMembers() {
    if (!activeBaseId) return;
    const reqId = ++membersReqIdRef.current;
    try {
      const data = await apiRequest(`/api/customer-bases/${activeBaseId}/members`, { accessToken });
      if (reqId !== membersReqIdRef.current) return;
      setMembers(data.members || []);
      setMemberSummary(data.summary || {});
    } catch (err) {
      if (reqId !== membersReqIdRef.current) return;
      setMembersError(err.message || 'Ошибка загрузки участников');
    }
  }

  async function saveBase() {
    if (!baseForm.name.trim()) {
      toast.error('Укажите название базы');
      return;
    }
    setActionState((prev) => ({ ...prev, savingBase: true }));
    try {
      const result = await apiRequest('/api/customer-bases', {
        accessToken,
        method: 'POST',
        body: {
          id: baseForm.id || undefined,
          name: baseForm.name.trim(),
          description: baseForm.description.trim()
        }
      });
      await reloadMeta();
      setIsCreatingCustom(false);
      if (baseForm.id) {
        toast.success('База сохранена');
      } else if (result?.id) {
        selectCustomBase(result.id);
        toast.success('База создана');
      } else {
        toast.success('База создана');
      }
    } catch (err) {
      toast.error(err.message || 'Не удалось сохранить базу');
    } finally {
      setActionState((prev) => ({ ...prev, savingBase: false }));
    }
  }

  async function syncBase() {
    if (!activeBaseId) {
      toast.error('Сначала выберите канал');
      return;
    }
    if (!selectedUserbotId) {
      toast.error('Выберите юзербота для синка');
      return;
    }
    setActionState((prev) => ({ ...prev, syncing: true }));
    try {
      const data = await apiRequest(`/api/customer-bases/${activeBaseId}/sync`, {
        accessToken,
        method: 'POST',
        body: { userbot_id: selectedUserbotId }
      });
      await reloadMeta();
      await reloadMembers();
      toast.success(`Подняли ${data.synced_count || 0} человек из ${data.scanned_channels || 0} каналов`);
    } catch (err) {
      toast.error(err.message || 'Синк не удался');
    } finally {
      setActionState((prev) => ({ ...prev, syncing: false }));
    }
  }

  async function manualAddMembers() {
    if (!activeBaseId) {
      toast.error('Сначала выберите базу');
      return;
    }
    if (!manualImportText.trim()) {
      toast.error('Вставьте хотя бы один Telegram ID');
      return;
    }
    const entries = manualImportText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [tg_user_id = '', username = '', display_name = ''] = line.split(',').map((part) => part.trim());
        return { tg_user_id, username, display_name };
      });

    setActionState((prev) => ({ ...prev, manualAdding: true }));
    try {
      const data = await apiRequest(`/api/customer-bases/${activeBaseId}/actions/manual-add`, {
        accessToken,
        method: 'POST',
        body: { entries }
      });
      setManualImportText('');
      await reloadMembers();
      toast.success(`Разобрано ${data.received_count || 0} · новых ${data.inserted_count || 0} · обновлено ${data.updated_count || 0}`);
    } catch (err) {
      toast.error(err.message || 'Не удалось добавить людей');
    } finally {
      setActionState((prev) => ({ ...prev, manualAdding: false }));
    }
  }

  async function createAudienceForChannel() {
    if (!selectedChannel) return;
    setActionState((prev) => ({ ...prev, creatingAudience: true }));
    try {
      const created = await apiRequest('/api/customer-bases', {
        accessToken,
        method: 'POST',
        body: { name: selectedChannel.title || 'Аудитория канала' }
      });
      if (!created?.id) {
        throw new Error('Не получили id созданной базы');
      }
      await apiRequest(`/api/customer-bases/${created.id}/channels`, {
        accessToken,
        method: 'POST',
        body: { channel_ids: [selectedChannel.id] }
      });
      await reloadMeta();
      toast.success('База создана и привязана к каналу');
    } catch (err) {
      toast.error(err.message || 'Не удалось создать аудиторию');
    } finally {
      setActionState((prev) => ({ ...prev, creatingAudience: false }));
    }
  }

  function openCopyModalBulk() {
    if (filteredMembers.length === 0) {
      toast.error('Под текущий фильтр никто не попал');
      return;
    }
    setCopyModal({
      open: true,
      sourceMembers: filteredMembers,
      targetMode: 'existing',
      targetBaseId: customBases[0]?.id || '',
      newBaseName: ''
    });
  }

  function copyOne(member) {
    setCopyModal({
      open: true,
      sourceMembers: [member],
      targetMode: 'existing',
      targetBaseId: customBases[0]?.id || '',
      newBaseName: ''
    });
  }

  function handleCopied(createdBaseId) {
    reloadMeta();
    if (createdBaseId) {
      selectCustomBase(createdBaseId);
    }
  }

  function pushSegmentToBroadcast() {
    const tgUserIds = Array.from(new Set(
      filteredMembers.map((m) => String(m.tg_user_id)).filter(Boolean)
    ));
    if (tgUserIds.length === 0) {
      toast.error('Под текущий фильтр никто не попал');
      return;
    }
    const activeFilter = MEMBER_FILTERS.find((f) => f.id === filter);
    const baseName = isCustomMode
      ? (selectedCustomBase?.name || 'Кастомная база')
      : (selectedChannel?.title || 'Аудитория канала');
    window.localStorage.setItem('broadcast_manual_selection', JSON.stringify({
      source: 'admin_v2_customer_bases',
      tg_user_ids: tgUserIds,
      base_name: baseName,
      suggested_title: `Рассылка по сегменту «${activeFilter?.label || filter}»`,
      suggested_message: ''
    }));
    window.location.href = '/app/broadcast';
  }

  if (metaLoading && bases.length === 0 && channels.length === 0) {
    return <LoadingState text="Грузим базы аудитории..." />;
  }

  if (metaError && bases.length === 0 && channels.length === 0) {
    return (
      <section className="page page--flush space-y-6">
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
                <a
                  href="/app/userbots"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-700 transition-colors"
                >
                  Открыть Юзерботы <ChevronRight className="w-4 h-4" />
                </a>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    );
  }

  if (bots.length === 0) {
    return (
      <section className="page page--flush space-y-6">
        <div className="bg-white border border-slate-200/60 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
          <div className="p-16 text-center flex flex-col items-center">
            <div className="w-16 h-16 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-300 shadow-inner mb-4 border border-slate-100">
              <Rocket className="w-8 h-8" />
            </div>
            <h4 className="text-lg font-black text-slate-900 tracking-tight mb-2">Нет ботов продаж</h4>
            <p className="text-slate-500 font-medium text-sm mb-6 max-w-md">
              Создайте бота, чтобы собирать аудиторию из его каналов и групп и работать с сегментами.
            </p>
            <a
              href="/sales-bot"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-700 transition-colors"
            >
              Создать бота <ChevronRight className="w-4 h-4" />
            </a>
          </div>
        </div>
      </section>
    );
  }

  const statCards = [
    {
      label: 'Людей в базе',
      value: memberSummary.total || 0,
      color: 'text-slate-900',
      Icon: Users
    },
    {
      label: 'Активно платят',
      value: memberSummary.active_paid || 0,
      color: (memberSummary.active_paid || 0) > 0 ? 'text-emerald-600' : 'text-slate-400',
      Icon: CircleCheckBig
    },
    {
      label: 'Без подписки',
      value: memberSummary.free_riders || 0,
      color: (memberSummary.free_riders || 0) > 0 ? 'text-rose-600' : 'text-slate-400',
      Icon: CircleAlert
    },
    {
      label: 'Неполное покрытие',
      value: coverageStats.partial,
      color: coverageStats.partial > 0 ? 'text-amber-600' : 'text-slate-400',
      Icon: AlertCircle
    }
  ];

  return (
    <section className="page page--flush space-y-6">
      {/* === БЛОК 1: АУДИТОРИЯ БОТА === */}
      <div className="bg-white border border-slate-200/60 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">

        {(metaError || membersError) && (
          <div className="m-6 mb-0 p-5 rounded-2xl bg-red-50 border border-red-100 text-red-600 font-bold text-sm flex items-center gap-3 shadow-sm">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            {metaError || membersError}
          </div>
        )}

        {/* Header: bot selector */}
        <section className="p-6 md:p-8 border-b border-slate-100">
          <div className="flex items-center gap-2 mb-4">
            <Users className="w-5 h-5 text-slate-500" />
            <h2 className="text-sm font-black uppercase tracking-widest text-slate-400">Аудитория бота</h2>
          </div>
          <select
            value={botIdFromUrl}
            onChange={(event) => changeBot(event.target.value)}
            className="px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-sm font-bold text-slate-900 focus:outline-none focus:border-slate-400 max-w-[280px]"
          >
            {bots.map((bot) => (
              <option key={bot.id} value={bot.id}>
                {bot.custom_label || (bot.tg_username ? `@${bot.tg_username}` : 'Без имени')}
              </option>
            ))}
          </select>
        </section>

        {/* Channel cards */}
        <section className="p-6 md:p-8 border-b border-slate-100">
          <h3 className="text-sm font-black uppercase tracking-widest text-slate-400 mb-4">
            Каналы и группы
          </h3>
          {channelsForBot.length === 0 ? (
            <div className="p-4 rounded-2xl bg-slate-50/50 border border-slate-100 text-sm text-slate-500 font-medium">
              У этого бота пока нет каналов. Создайте канал на странице «Бот продаж».
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {channelsForBot.map((ch) => {
                const active = String(ch.id) === String(channelIdFromUrl);
                const base = bases.find((b) => b.id === ch.linked_base_id);
                const count = base?.stats?.humans || 0;
                const hasAudience = !!ch.linked_base_id;
                return (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => selectChannel(ch.id)}
                    className={`p-4 rounded-2xl border text-left transition-all ${
                      active
                        ? 'border-slate-900 bg-slate-50 shadow-sm'
                        : 'border-slate-200 bg-white hover:border-slate-300'
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

        {/* Selected channel content */}
        {selectedChannel ? (
          isAudienceMode ? (
            <Fragment>
              {profilePlan === 'trial' ? (
                <div className={`mx-6 md:mx-8 mt-6 p-4 rounded-2xl border ${trialUpgradeUrgent ? 'bg-amber-50/60 border-amber-200 text-amber-800' : 'bg-blue-50/60 border-blue-200 text-blue-800'}`}>
                  <div className="font-bold mb-1">
                    {trialUpgradeUrgent ? `Trial догорает: ${trialHoursLeft} ч` : 'База на Trial'}
                  </div>
                  <div className="text-sm opacity-90">
                    {trialUpgradeUrgent
                      ? 'Если уже собираете людей из групп и работаете с покрытием — переведите кабинет на Normal.'
                      : 'На Trial можно собрать первую базу и понять структуру аудитории. Для рабочего актива под CRM и рассылки нужен Normal.'}
                  </div>
                </div>
              ) : null}

              {/* Stat cards */}
              <section className="p-6 md:p-8 border-b border-slate-100">
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

                {prioritySignals.length > 0 ? (
                  <div className="mt-6 flex flex-col gap-2">
                    {prioritySignals.map((signal) => {
                      const cls = signal.tone === 'danger'
                        ? 'bg-rose-50/60 border-rose-200 text-rose-800'
                        : 'bg-amber-50/60 border-amber-200 text-amber-800';
                      return (
                        <div key={signal.title} className={`p-4 rounded-2xl border ${cls}`}>
                          <div className="font-bold mb-1">{signal.title}</div>
                          <div className="text-sm opacity-90">{signal.text}</div>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </section>

              {/* Filters + members table */}
              <section className="p-6 md:p-8 border-b border-slate-100">
                <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
                  <h3 className="text-sm font-black uppercase tracking-widest text-slate-400">
                    Участники канала
                  </h3>
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
                          active
                            ? 'border-slate-900 bg-slate-900 text-white'
                            : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
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
                  <button
                    type="button"
                    onClick={pushSegmentToBroadcast}
                    disabled={filteredMembers.length === 0}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <Send className="w-3.5 h-3.5" />
                    В рассылку ({filteredMembers.length})
                  </button>
                  <button
                    type="button"
                    onClick={openCopyModalBulk}
                    disabled={filteredMembers.length === 0}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <ArrowRight className="w-3.5 h-3.5" />
                    В кастомную базу ({filteredMembers.length})
                  </button>
                </div>

                {membersLoading && members.length === 0 ? (
                  <div className="p-4 rounded-2xl bg-slate-50/50 border border-slate-100 text-sm text-slate-500 font-medium">
                    Грузим участников...
                  </div>
                ) : filteredMembers.length === 0 ? (
                  <div className="p-4 rounded-2xl bg-slate-50/50 border border-slate-100 text-sm text-slate-500 font-medium">
                    Под текущий фильтр ничего не попало.
                  </div>
                ) : (
                  <div className="overflow-x-auto -mx-2">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-100 bg-slate-50/50">
                          <th className="px-4 py-3 text-left text-[11px] font-black uppercase tracking-widest text-slate-400">Кто</th>
                          <th className="px-4 py-3 text-left text-[11px] font-black uppercase tracking-widest text-slate-400">Деньги</th>
                          <th className="px-4 py-3 text-left text-[11px] font-black uppercase tracking-widest text-slate-400">Покрытие</th>
                          <th className="px-4 py-3 text-left text-[11px] font-black uppercase tracking-widest text-slate-400">Источник</th>
                          <th className="px-4 py-3 text-right text-[11px] font-black uppercase tracking-widest text-slate-400">Дальше</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredMembers.slice(0, 100).map((member) => (
                          <MemberRow
                            key={member.id || member.tg_user_id}
                            member={member}
                            onCopyOne={copyOne}
                          />
                        ))}
                      </tbody>
                    </table>
                    {filteredMembers.length > 100 ? (
                      <div className="px-4 py-3 text-xs font-medium text-slate-500">
                        Показываем первые 100 из {filteredMembers.length}. Уточните фильтр или поиск, чтобы увидеть остальных.
                      </div>
                    ) : null}
                  </div>
                )}
              </section>

              {/* Sync section — только для audience */}
              <section className="p-6 md:p-8">
                <h3 className="text-sm font-black uppercase tracking-widest text-slate-400 mb-4">
                  Синк из групп через юзербота
                </h3>

                {userbots.length === 0 ? (
                  <div className="p-4 rounded-2xl bg-amber-50/60 border border-amber-200 text-amber-800">
                    <div className="font-bold mb-1">Нет подключённого юзербота</div>
                    <div className="text-sm opacity-90 mb-3">
                      Без юзербота синк из групп недоступен. Подключите аккаунт на странице «Юзерботы».
                    </div>
                    <a
                      href="/app/userbots"
                      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-900 text-white hover:bg-slate-700 transition-colors"
                    >
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
                        disabled={!activeBaseId || actionState.syncing}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${actionState.syncing ? 'animate-spin' : ''}`} />
                        {actionState.syncing ? 'Синхронизация...' : 'Запустить синк'}
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
            /* Channel without linked_base_id — CTA создать аудиторию */
            <section className="p-6 md:p-8">
              <div className="p-5 rounded-2xl bg-amber-50/60 border border-amber-200">
                <div className="font-bold text-amber-800 mb-1">У этого канала ещё нет базы аудитории</div>
                <div className="text-sm text-amber-700 mb-4">
                  Создайте базу и привяжите канал, чтобы синкать участников через юзербота.
                </div>
                <button
                  type="button"
                  onClick={createAudienceForChannel}
                  disabled={actionState.creatingAudience}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {actionState.creatingAudience ? 'Создаём...' : 'Создать аудиторию для канала'}
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

      {/* === БЛОК 2: КАСТОМНЫЕ БАЗЫ === */}
      <div className="bg-slate-100/60 border-2 border-slate-200 rounded-3xl overflow-hidden">

        <div className="p-6 md:p-8 border-b-2 border-slate-200 bg-slate-100">
          <div className="flex items-center gap-2 mb-3">
            <Database className="w-5 h-5 text-slate-700" />
            <h2 className="text-sm font-black uppercase tracking-widest text-slate-600">Кастомные базы</h2>
          </div>
          <p className="text-sm text-slate-700 max-w-2xl">
            Ручные списки для точечных рассылок и дожима. Собирайте из аудитории бота кнопкой «В кастомную базу» или вбивайте руки.
          </p>
        </div>

        <div className="p-6 md:p-8">
          {customBases.length === 0 && !isCreatingCustom ? (
            <div className="p-4 rounded-2xl bg-white/60 border border-slate-200 text-sm text-slate-600 font-medium flex flex-wrap items-center justify-between gap-3">
              <span>Пока нет кастомных баз. Создайте первую или перекиньте людей из аудитории бота.</span>
              <button
                type="button"
                onClick={startNewCustomBase}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-900 text-white hover:bg-slate-700 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> Создать базу
              </button>
            </div>
          ) : (
            <Fragment>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
                {customBases.map((base) => {
                  const active = String(base.id) === String(customBaseIdFromUrl);
                  return (
                    <button
                      key={base.id}
                      type="button"
                      onClick={() => selectCustomBase(base.id)}
                      className={`p-4 rounded-2xl border text-left transition-all ${
                        active
                          ? 'border-slate-900 bg-white shadow-sm'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <div className="text-sm font-black text-slate-900 truncate mb-1">{base.name}</div>
                      <div className="text-xs text-slate-500 font-medium">{base.stats?.humans || 0} людей</div>
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={startNewCustomBase}
                  className="p-4 rounded-2xl border-2 border-dashed border-slate-300 text-slate-500 hover:border-slate-400 hover:text-slate-700 transition-colors text-sm font-bold flex items-center justify-center"
                >
                  + Создать базу
                </button>
              </div>

              {(selectedCustomBase || isCreatingCustom) ? (
                <Fragment>
                  {/* Base form */}
                  <section className="mb-6">
                    <h3 className="text-sm font-black uppercase tracking-widest text-slate-500 mb-3">
                      {isCreatingCustom ? 'Новая база' : 'Настройки базы'}
                    </h3>
                    <div className="flex flex-col gap-3 max-w-xl">
                      <input
                        type="text"
                        value={baseForm.name}
                        onChange={(event) => setBaseForm((prev) => ({ ...prev, name: event.target.value }))}
                        placeholder="Название базы"
                        className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm font-bold text-slate-900 focus:outline-none focus:border-slate-400"
                      />
                      <input
                        type="text"
                        value={baseForm.description}
                        onChange={(event) => setBaseForm((prev) => ({ ...prev, description: event.target.value }))}
                        placeholder="Описание (необязательно)"
                        className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm text-slate-700 focus:outline-none focus:border-slate-400"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={saveBase}
                          disabled={actionState.savingBase || !baseForm.name.trim()}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          {actionState.savingBase ? 'Сохраняем...' : (baseForm.id ? 'Сохранить' : 'Создать базу')}
                        </button>
                        <button
                          type="button"
                          onClick={resetBaseForm}
                          disabled={actionState.savingBase}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          Отменить
                        </button>
                      </div>
                    </div>
                  </section>

                  {selectedCustomBase ? (
                    <Fragment>
                      {/* Members table */}
                      <section className="mb-6">
                        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
                          <h3 className="text-sm font-black uppercase tracking-widest text-slate-500">
                            Участники базы
                          </h3>
                          <span className="text-xs font-bold text-slate-500">
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
                                  active
                                    ? 'border-slate-900 bg-slate-900 text-white'
                                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
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
                          <button
                            type="button"
                            onClick={pushSegmentToBroadcast}
                            disabled={filteredMembers.length === 0}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          >
                            <Send className="w-3.5 h-3.5" />
                            В рассылку ({filteredMembers.length})
                          </button>
                        </div>

                        {membersLoading && members.length === 0 ? (
                          <div className="p-4 rounded-2xl bg-white/60 border border-slate-200 text-sm text-slate-600 font-medium">
                            Грузим участников...
                          </div>
                        ) : filteredMembers.length === 0 ? (
                          <div className="p-4 rounded-2xl bg-white/60 border border-slate-200 text-sm text-slate-600 font-medium">
                            Под текущий фильтр ничего не попало. Добавьте людей через форму ниже.
                          </div>
                        ) : (
                          <div className="overflow-x-auto -mx-2">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="border-b border-slate-200 bg-white/60">
                                  <th className="px-4 py-3 text-left text-[11px] font-black uppercase tracking-widest text-slate-500">Кто</th>
                                  <th className="px-4 py-3 text-left text-[11px] font-black uppercase tracking-widest text-slate-500">Деньги</th>
                                  <th className="px-4 py-3 text-left text-[11px] font-black uppercase tracking-widest text-slate-500">Покрытие</th>
                                  <th className="px-4 py-3 text-left text-[11px] font-black uppercase tracking-widest text-slate-500">Источник</th>
                                  <th className="px-4 py-3 text-right text-[11px] font-black uppercase tracking-widest text-slate-500">Дальше</th>
                                </tr>
                              </thead>
                              <tbody>
                                {filteredMembers.slice(0, 100).map((member) => (
                                  <MemberRow key={member.id || member.tg_user_id} member={member} />
                                ))}
                              </tbody>
                            </table>
                            {filteredMembers.length > 100 ? (
                              <div className="px-4 py-3 text-xs font-medium text-slate-500">
                                Показываем первые 100 из {filteredMembers.length}. Уточните фильтр или поиск, чтобы увидеть остальных.
                              </div>
                            ) : null}
                          </div>
                        )}
                      </section>

                      {/* Manual add */}
                      <section>
                        <h3 className="text-sm font-black uppercase tracking-widest text-slate-500 mb-3">
                          Ручной импорт
                        </h3>
                        <textarea
                          rows={5}
                          value={manualImportText}
                          onChange={(event) => setManualImportText(event.target.value)}
                          placeholder={'TG_ID,@username,Имя\n488609412,@user,Иван\n123456789,,Петр'}
                          className="w-full p-3 rounded-xl bg-white border border-slate-200 text-sm text-slate-800 font-mono leading-relaxed focus:outline-none focus:border-slate-400"
                        />
                        <div className="flex flex-wrap items-center gap-2 mt-3">
                          <button
                            type="button"
                            onClick={manualAddMembers}
                            disabled={actionState.manualAdding}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          >
                            {actionState.manualAdding ? 'Разбираем...' : 'Добавить людей'}
                          </button>
                          <span className="text-xs text-slate-500">
                            Формат строки: <code className="px-1 bg-slate-200/60 rounded">TG_ID,@username,Имя</code> — по одной записи на строку. Username и имя необязательны.
                          </span>
                        </div>
                      </section>
                    </Fragment>
                  ) : null}
                </Fragment>
              ) : (
                <div className="p-4 rounded-2xl bg-white/60 border border-slate-200 text-sm text-slate-600 font-medium">
                  Выберите базу выше или создайте новую.
                </div>
              )}
            </Fragment>
          )}
        </div>
      </div>

      {profilePlan === 'trial' ? (
        <UpgradeCallout
          compact
          title="База стала рабочим активом — пора на Normal"
          text="Если здесь уже живут люди, сегменты и хвосты по покрытию — не ждите конца trial. Normal нужен, чтобы база стала основой для CRM, заказов и рассылок."
        />
      ) : null}

      {copyModal.open ? (
        <CopyToCustomBaseModal
          state={copyModal}
          customBases={customBases}
          onClose={() => setCopyModal((prev) => ({ ...prev, open: false }))}
          onCopied={handleCopied}
        />
      ) : null}
    </section>
  );
}

function MemberRow({ member, onCopyOne }) {
  const badge = paymentBadge(member.payment_status);
  const sourceBadge = member.source === 'manual'
    ? { text: 'Вбит руками', cls: 'bg-slate-100 text-slate-600' }
    : { text: 'Из групп', cls: 'bg-emerald-50 text-emerald-700' };

  return (
    <tr className="border-b border-slate-50 last:border-0 hover:bg-slate-50/30 transition-colors">
      <td className="px-4 py-3">
        <div className="text-sm font-bold text-slate-900">
          {member.display_name || `ID ${member.tg_user_id}`}
        </div>
        <div className="text-xs text-slate-500 font-mono">
          {member.username ? `@${member.username}` : 'без username'} · {member.tg_user_id}
        </div>
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex px-2 py-1 rounded-md text-[11px] font-black ${badge.cls}`}>
          {badge.text}
        </span>
        <div className="text-xs text-slate-500 font-medium mt-1">
          {member.active_subscription_count || 0} активн. · {member.expired_subscription_count || 0} истекш.
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="text-sm font-medium text-slate-700">{coverageLabel(member)}</div>
        <div className="text-xs text-slate-500 font-medium">
          {member.channels_count || 0} мест · {member.present_now ? 'сейчас найден' : 'сейчас не найден'}
        </div>
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex px-2 py-1 rounded-md text-[11px] font-bold ${sourceBadge.cls}`}>
          {sourceBadge.text}
        </span>
        <div className="text-xs text-slate-500 font-medium mt-1">
          {member.updated_at ? `обновлён ${formatRelativeTime(member.updated_at)}` : 'без даты'}
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap items-center justify-end gap-1">
          <a
            href={`/app/dossier?tg=${encodeURIComponent(member.tg_user_id)}`}
            target="_blank"
            rel="noreferrer"
            className="px-2 py-1 rounded-md text-[11px] font-bold border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors"
          >
            Досье
          </a>
          <a
            href="/app/customers?tab=customers"
            target="_blank"
            rel="noreferrer"
            className="px-2 py-1 rounded-md text-[11px] font-bold border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors"
          >
            Клиенты
          </a>
          <a
            href="/app/customers?tab=orders"
            target="_blank"
            rel="noreferrer"
            className="px-2 py-1 rounded-md text-[11px] font-bold border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors"
          >
            Заказы
          </a>
          <a
            href="/app/customers?tab=access"
            target="_blank"
            rel="noreferrer"
            className="px-2 py-1 rounded-md text-[11px] font-bold border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors"
          >
            Доступ
          </a>
          {onCopyOne ? (
            <button
              type="button"
              onClick={() => onCopyOne(member)}
              className="inline-flex items-center justify-center w-[26px] h-[26px] rounded-md text-[11px] font-bold border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors"
              title="В кастомную базу"
            >
              <ArrowRight className="w-3 h-3" />
            </button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

function CopyToCustomBaseModal({ state, customBases, onClose, onCopied }) {
  const { accessToken } = useAuth();
  const [mode, setMode] = useState(customBases.length === 0 ? 'new' : state.targetMode);
  const [targetBaseId, setTargetBaseId] = useState(state.targetBaseId || customBases[0]?.id || '');
  const [newBaseName, setNewBaseName] = useState(state.newBaseName || '');
  const [busy, setBusy] = useState(false);

  async function handleSubmit() {
    setBusy(true);
    try {
      let finalBaseId = targetBaseId;
      if (mode === 'new') {
        if (!newBaseName.trim()) {
          toast.error('Укажите название базы');
          setBusy(false);
          return;
        }
        const created = await apiRequest('/api/customer-bases', {
          accessToken,
          method: 'POST',
          body: { name: newBaseName.trim() }
        });
        finalBaseId = created?.id;
        if (!finalBaseId) throw new Error('Не удалось создать базу');
      } else if (!targetBaseId) {
        toast.error('Выберите базу');
        setBusy(false);
        return;
      }

      await apiRequest(`/api/customer-bases/${finalBaseId}/actions/manual-add`, {
        accessToken,
        method: 'POST',
        body: {
          entries: state.sourceMembers.map((m) => ({
            tg_user_id: String(m.tg_user_id),
            username: m.username || '',
            display_name: m.display_name || ''
          }))
        }
      });

      toast.success(`Добавлено ${state.sourceMembers.length} чел. в базу`);
      onCopied(mode === 'new' ? finalBaseId : null);
      onClose();
    } catch (err) {
      toast.error(err.message || 'Не удалось добавить');
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = !busy
    && (mode === 'existing' ? !!targetBaseId : !!newBaseName.trim());

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>В кастомную базу</DialogTitle>
          <DialogDescription>
            Добавить {state.sourceMembers.length} чел. в существующую базу или создать новую. Источник не меняется.
          </DialogDescription>
        </DialogHeader>

        {customBases.length > 0 ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMode('existing')}
              className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold border transition-colors ${
                mode === 'existing'
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              Существующая
            </button>
            <button
              type="button"
              onClick={() => setMode('new')}
              className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold border transition-colors ${
                mode === 'new'
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              Новая
            </button>
          </div>
        ) : null}

        {mode === 'existing' ? (
          <select
            value={targetBaseId}
            onChange={(e) => setTargetBaseId(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm font-bold text-slate-900 focus:outline-none focus:border-slate-400"
          >
            <option value="" disabled>Выберите базу</option>
            {customBases.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            value={newBaseName}
            onChange={(e) => setNewBaseName(e.target.value)}
            placeholder="Название базы"
            autoFocus
            className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm font-bold text-slate-900 focus:outline-none focus:border-slate-400"
          />
        )}

        <DialogFooter>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {busy ? 'Добавляем...' : 'Добавить'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
