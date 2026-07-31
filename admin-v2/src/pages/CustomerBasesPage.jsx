import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Database, Users, CircleCheckBig, CircleAlert, AlertCircle,
  Send, ChevronRight, Rocket, RefreshCw, Plus
} from 'lucide-react';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { LoadingState } from '../ui/LoadingState.jsx';
import { UpgradeCallout } from '../ui/UpgradeCallout.jsx';

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
  const baseIdFromUrl = searchParams.get('base') || '';

  const [bases, setBases] = useState([]);
  const [channels, setChannels] = useState([]);
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
  const [selectedChannelIds, setSelectedChannelIds] = useState([]);
  const [selectedUserbotId, setSelectedUserbotId] = useState('');
  const [manualImportText, setManualImportText] = useState('');
  const [actionState, setActionState] = useState({
    savingBase: false,
    savingChannels: false,
    syncing: false,
    manualAdding: false
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
        setMetaError('');
        if (!searchParams.get('base') && (data.bases || []).length > 0) {
          const next = new URLSearchParams(searchParams);
          next.set('base', data.bases[0].id);
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

  useEffect(() => {
    if (!accessToken || !baseIdFromUrl) {
      setMembers([]);
      setMemberSummary({});
      return;
    }
    let cancelled = false;

    async function loadMembers({ silent = false } = {}) {
      const reqId = ++membersReqIdRef.current;
      if (!silent) setMembersLoading(true);
      try {
        const data = await apiRequest(`/api/customer-bases/${baseIdFromUrl}/members`, { accessToken });
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
  }, [accessToken, baseIdFromUrl]);

  const selectedBase = useMemo(
    () => bases.find((b) => String(b.id) === String(baseIdFromUrl)) || null,
    [bases, baseIdFromUrl]
  );

  useEffect(() => {
    if (!selectedBase) {
      setBaseForm({ id: '', name: '', description: '' });
      setSelectedChannelIds([]);
      return;
    }
    setBaseForm({
      id: selectedBase.id,
      name: selectedBase.name || '',
      description: selectedBase.description || ''
    });
    setSelectedChannelIds((selectedBase.channels || []).map((ch) => String(ch.id)));
  }, [selectedBase]);

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

  function changeBase(id) {
    const next = new URLSearchParams(searchParams);
    if (id) next.set('base', id); else next.delete('base');
    setSearchParams(next, { replace: true });
    setFilter('humans');
    setSearch('');
  }

  async function reloadMeta() {
    const reqId = ++metaReqIdRef.current;
    try {
      const data = await apiRequest('/api/customer-bases', { accessToken });
      if (reqId !== metaReqIdRef.current) return;
      setBases(data.bases || []);
      setChannels(data.channels || []);
      setUserbots(data.userbots || []);
    } catch (err) {
      if (reqId !== metaReqIdRef.current) return;
      setMetaError(err.message || 'Ошибка загрузки баз');
    }
  }

  async function reloadMembers() {
    if (!baseIdFromUrl) return;
    const reqId = ++membersReqIdRef.current;
    try {
      const data = await apiRequest(`/api/customer-bases/${baseIdFromUrl}/members`, { accessToken });
      if (reqId !== membersReqIdRef.current) return;
      setMembers(data.members || []);
      setMemberSummary(data.summary || {});
    } catch (err) {
      if (reqId !== membersReqIdRef.current) return;
      setMembersError(err.message || 'Ошибка загрузки участников');
    }
  }

  function toggleChannel(id) {
    setSelectedChannelIds((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  }

  function resetBaseForm() {
    if (selectedBase) {
      setBaseForm({
        id: selectedBase.id,
        name: selectedBase.name || '',
        description: selectedBase.description || ''
      });
      setSelectedChannelIds((selectedBase.channels || []).map((ch) => String(ch.id)));
    } else {
      setBaseForm({ id: '', name: '', description: '' });
      setSelectedChannelIds([]);
    }
  }

  function startNewBase() {
    changeBase('');
    setBaseForm({ id: '', name: '', description: '' });
    setSelectedChannelIds([]);
  }

  async function saveBase() {
    if (!baseForm.name.trim()) {
      toast.error('Укажите название базы');
      return;
    }
    setActionState((prev) => ({ ...prev, savingBase: true }));
    try {
      await apiRequest('/api/customer-bases', {
        accessToken,
        method: 'POST',
        body: {
          id: baseForm.id || undefined,
          name: baseForm.name.trim(),
          description: baseForm.description.trim()
        }
      });
      await reloadMeta();
      if (baseForm.id) {
        toast.success('База сохранена');
      } else {
        toast.success('База создана');
      }
    } catch (err) {
      toast.error(err.message || 'Не удалось сохранить базу');
    } finally {
      setActionState((prev) => ({ ...prev, savingBase: false }));
    }
  }

  async function saveChannels() {
    if (!baseIdFromUrl) {
      toast.error('Сначала выберите базу');
      return;
    }
    setActionState((prev) => ({ ...prev, savingChannels: true }));
    try {
      await apiRequest(`/api/customer-bases/${baseIdFromUrl}/channels`, {
        accessToken,
        method: 'POST',
        body: { channel_ids: selectedChannelIds }
      });
      await reloadMeta();
      toast.success('Каналы и группы привязаны');
    } catch (err) {
      toast.error(err.message || 'Не удалось привязать каналы');
    } finally {
      setActionState((prev) => ({ ...prev, savingChannels: false }));
    }
  }

  async function syncBase() {
    if (!baseIdFromUrl) {
      toast.error('Сначала выберите базу');
      return;
    }
    if (!selectedUserbotId) {
      toast.error('Выберите юзербота для синка');
      return;
    }
    setActionState((prev) => ({ ...prev, syncing: true }));
    try {
      const data = await apiRequest(`/api/customer-bases/${baseIdFromUrl}/sync`, {
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
    if (!baseIdFromUrl) {
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
      const data = await apiRequest(`/api/customer-bases/${baseIdFromUrl}/actions/manual-add`, {
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

  function pushSegmentToBroadcast() {
    const tgUserIds = Array.from(new Set(
      filteredMembers.map((m) => String(m.tg_user_id)).filter(Boolean)
    ));
    if (tgUserIds.length === 0) {
      toast.error('Под текущий фильтр никто не попал');
      return;
    }
    const activeFilter = MEMBER_FILTERS.find((f) => f.id === filter);
    window.localStorage.setItem('broadcast_manual_selection', JSON.stringify({
      source: 'admin_v2_customer_bases',
      tg_user_ids: tgUserIds,
      base_name: selectedBase?.name || 'Сегмент базы',
      suggested_title: `Рассылка по сегменту «${activeFilter?.label || filter}»`,
      suggested_message: ''
    }));
    window.location.href = '/app/broadcast';
  }

  if (metaLoading && bases.length === 0) {
    return <LoadingState text="Грузим базы аудитории..." />;
  }

  if (metaError && bases.length === 0) {
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

  if (bases.length === 0) {
    return (
      <section className="page page--flush space-y-6">
        <div className="bg-white border border-slate-200/60 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
          <div className="p-16 text-center flex flex-col items-center">
            <div className="w-16 h-16 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-300 shadow-inner mb-4 border border-slate-100">
              <Database className="w-8 h-8" />
            </div>
            <h4 className="text-lg font-black text-slate-900 tracking-tight mb-2">Баз пока нет</h4>
            <p className="text-slate-500 font-medium text-sm mb-6 max-w-md">
              Создайте первую базу, чтобы собрать людей из ваших каналов и групп в один список и видеть покрытие аудитории.
            </p>
            <button
              type="button"
              onClick={startNewBase}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Создать базу
            </button>
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
      <div className="bg-white border border-slate-200/60 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden transition-all hover:border-slate-300/60">

        {(metaError || membersError) && (
          <div className="m-6 mb-0 p-5 rounded-2xl bg-red-50 border border-red-100 text-red-600 font-bold text-sm flex items-center gap-3 shadow-sm">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            {metaError || membersError}
          </div>
        )}

        <section className="p-6 md:p-8 border-b border-slate-100">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
            <div className="flex items-center gap-3">
              <select
                value={baseIdFromUrl}
                onChange={(event) => changeBase(event.target.value)}
                className="px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-sm font-bold text-slate-900 focus:outline-none focus:border-slate-400 max-w-[320px]"
              >
                {bases.map((base) => (
                  <option key={base.id} value={base.id}>
                    {base.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={startNewBase}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Новая база
              </button>
              <div className="text-xs font-bold text-slate-500">
                {memberSummary.total || 0} людей · {selectedBase?.channels?.length || 0} каналов
              </div>
            </div>
          </div>

          {profilePlan === 'trial' ? (
            <div className={`p-4 rounded-2xl border mb-6 ${trialUpgradeUrgent ? 'bg-amber-50/60 border-amber-200 text-amber-800' : 'bg-blue-50/60 border-blue-200 text-blue-800'}`}>
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

        <section className="p-6 md:p-8 border-b border-slate-100">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
            <h3 className="text-sm font-black uppercase tracking-widest text-slate-400">
              Участники базы
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
              Передать сегмент в рассылку
            </button>
          </div>

          {membersLoading && members.length === 0 ? (
            <div className="p-4 rounded-2xl bg-slate-50/50 border border-slate-100 text-sm text-slate-500 font-medium">
              Грузим участников...
            </div>
          ) : !baseIdFromUrl ? (
            <div className="p-4 rounded-2xl bg-slate-50/50 border border-slate-100 text-sm text-slate-500 font-medium">
              Выберите базу выше, чтобы увидеть участников.
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

        <section className="p-6 md:p-8 border-b border-slate-100">
          <h3 className="text-sm font-black uppercase tracking-widest text-slate-400 mb-4">
            Настройки базы
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

        <section className="p-6 md:p-8 border-b border-slate-100">
          <div className="flex items-baseline justify-between mb-4">
            <h3 className="text-sm font-black uppercase tracking-widest text-slate-400">
              Каналы и группы
            </h3>
            <span className="text-xs font-bold text-slate-400">
              {channels.length} доступно · {selectedChannelIds.length} привязано
            </span>
          </div>

          {channels.length === 0 ? (
            <div className="p-4 rounded-2xl bg-slate-50/50 border border-slate-100 text-sm text-slate-500 font-medium">
              У вас пока нет каналов. Создайте канал на странице «Бот продаж», чтобы привязать его к базе.
            </div>
          ) : (
            <Fragment>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-4">
                {channels.map((ch) => {
                  const checked = selectedChannelIds.includes(String(ch.id));
                  return (
                    <label
                      key={ch.id}
                      className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                        checked
                          ? 'bg-slate-50 border-slate-300'
                          : 'bg-slate-50/30 border-slate-100 hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleChannel(String(ch.id))}
                        className="w-4 h-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-bold text-slate-900 truncate">{ch.title}</div>
                        <div className="text-xs text-slate-500 font-mono truncate">{ch.tg_chat_id}</div>
                      </div>
                    </label>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={saveChannels}
                disabled={!baseIdFromUrl || actionState.savingChannels}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {actionState.savingChannels ? 'Сохраняем...' : 'Сохранить привязку'}
              </button>
            </Fragment>
          )}
        </section>

        <section className="p-6 md:p-8 border-b border-slate-100">
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
                  disabled={!baseIdFromUrl || actionState.syncing}
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

        <section className="p-6 md:p-8">
          <h3 className="text-sm font-black uppercase tracking-widest text-slate-400 mb-4">
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
              disabled={!baseIdFromUrl || actionState.manualAdding}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {actionState.manualAdding ? 'Разбираем...' : 'Добавить людей'}
            </button>
            <span className="text-xs text-slate-500">
              Формат строки: <code className="px-1 bg-slate-100 rounded">TG_ID,@username,Имя</code> — по одной записи на строку. Username и имя необязательны.
            </span>
          </div>
        </section>
      </div>

      {profilePlan === 'trial' ? (
        <UpgradeCallout
          compact
          title="База стала рабочим активом — пора на Normal"
          text="Если здесь уже живут люди, сегменты и хвосты по покрытию — не ждите конца trial. Normal нужен, чтобы база стала основой для CRM, заказов и рассылок."
        />
      ) : null}
    </section>
  );
}

function MemberRow({ member }) {
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
        </div>
      </td>
    </tr>
  );
}
