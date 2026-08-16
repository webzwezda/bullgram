import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Users, Bot, MessageSquare, ListChecks, Loader2, Check } from 'lucide-react';
import { apiRequest } from '../api/client.js';
import { fetchClientBaseMembers } from '../api/client-bases.js';
import { memberDisplayName, paymentBadge, coverageLabel, coverageChannels } from './bases/shared.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { getProductTierRules } from '../app/productTier.js';
import { supabase } from '../lib/supabase.js';
import { LoadingState } from '../ui/LoadingState.jsx';
import { PlanBanner } from '../ui/PlanBanner.jsx';
import { UpgradeCallout } from '../ui/UpgradeCallout.jsx';
import { PreparationRunner } from './broadcast/PreparationRunner.jsx';
import { ReadinessDashboard } from './broadcast/ReadinessDashboard.jsx';
import {
  Card, Section, SectionTitle, EmptyNote, ErrorNote, StatusBadge,
  TableShell, Th, Td, Tr, inputCls, btnPrimary, btnGhost
} from './broadcast/ui.jsx';

const STEPS = [
  { id: 'base', label: 'База' },
  { id: 'userbots', label: 'Юзерботы' },
  { id: 'prepare', label: 'Подготовка' },
  { id: 'send', label: 'Отправка' }
];

const ACTIVE_PREPARATION_STATUSES = new Set(['pending', 'scanning', 'joining', 'recomputing']);

const MEMBERS_PAGE_SIZE = 25;

const AUDIENCE_LABELS = {
  client_base_members: 'База клиентов',
  channel_audience_members: 'База по каналам',
  manual_list: 'Ручная выборка'
};

function formatWhen(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value));
}

function senderLabel(campaign) {
  if (campaign?.meta?.sender_usernames?.length) {
    return campaign.meta.sender_usernames.map((name) => `@${name}`).join(', ');
  }
  if (campaign?.meta?.sender_username) {
    return `@${campaign.meta.sender_username}`;
  }
  return 'Официальный бот';
}

function loadManualSelection() {
  try {
    const raw = window.localStorage.getItem('broadcast_manual_selection');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function consumeManualSelection() {
  const selection = loadManualSelection();
  if (selection) {
    window.localStorage.removeItem('broadcast_manual_selection');
  }
  return selection;
}

function loadDraft() {
  try {
    const raw = window.localStorage.getItem('broadcast_draft');
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object') {
      return {
        title: typeof parsed.title === 'string' ? parsed.title : '',
        base: typeof parsed.base === 'string' ? parsed.base : '',
        message_text: typeof parsed.message_text === 'string' ? parsed.message_text : ''
      };
    }
  } catch {
    // черновик испорчен — игнорируем
  }
  return null;
}

function baseValueFromPreparation(prep) {
  if (!prep) return '';
  if (prep.audience_type === 'client_base_members' && prep.base_id) return `client:${prep.base_id}`;
  if (prep.audience_type === 'channel_audience_members' && prep.base_id) return `aud:${prep.base_id}`;
  if (prep.audience_type === 'manual_list') return 'manual';
  return '';
}

export function BroadcastPage() {
  const { accessToken, user, profilePlan, trialEndsAt } = useAuth();
  const [state, setState] = useState({
    loading: true,
    error: '',
    clientBases: [],
    userbots: [],
    campaigns: [],
    failures: []
  });
  const [step, setStep] = useState('base');
  const [form, setForm] = useState({ title: '', base: '', message_text: '' });
  const [manual, setManual] = useState({ tg_user_ids: [], members: [] });
  const [selectedIds, setSelectedIds] = useState([]);
  const [membersPage, setMembersPage] = useState(0);
  const [poolIds, setPoolIds] = useState([]);
  const [preparation, setPreparation] = useState(null);
  const [preparing, setPreparing] = useState(false);
  const [sending, setSending] = useState(false);
  const [members, setMembers] = useState({ rows: [], total: 0, loading: false });
  const pollRef = useRef(null);
  const memberIndexRef = useRef(new Map());

  const planRules = useMemo(() => getProductTierRules(profilePlan), [profilePlan]);
  const trialHoursLeft = useMemo(() => {
    if (!trialEndsAt) return null;
    const diffMs = new Date(trialEndsAt).getTime() - Date.now();
    if (diffMs <= 0) return 0;
    return Math.ceil(diffMs / (1000 * 60 * 60));
  }, [trialEndsAt]);
  const trialUpgradeUrgent = profilePlan === 'trial' && trialHoursLeft !== null && trialHoursLeft > 0 && trialHoursLeft <= 72;

  const clientSelectionActive = form.base.startsWith('client:') && (selectedIds || []).length > 0;
  const audienceType = form.base === 'manual' || clientSelectionActive
    ? 'manual_list'
    : form.base.startsWith('client:')
      ? 'client_base_members'
      : form.base.startsWith('aud:')
        ? 'channel_audience_members'
        : '';
  const baseId = form.base.includes(':') ? form.base.split(':')[1] : null;
  const baseSelected = Boolean(form.base);
  const apiBaseId = audienceType === 'client_base_members' ? baseId : null;
  const manualPayload = clientSelectionActive
    ? {
        tg_user_ids: selectedIds,
        members: selectedIds.map((id) => {
          const row = memberIndexRef.current.get(String(id));
          return { tg_user_id: id, username: row?.username || '', display_name: row?.display_name || '' };
        })
      }
    : { tg_user_ids: manual.tg_user_ids || [], members: manual.members || [] };
  const manualIdsKey = useMemo(
    () => [...(manualPayload.tg_user_ids || [])].map(String).sort().join(','),
    [manualPayload.tg_user_ids]
  );

  const baseMatchesPreparation = useMemo(() => {
    if (!preparation) return false;
    if (preparation.audience_type !== audienceType) return false;
    if (audienceType === 'manual_list') {
      const prepKey = [...(preparation.manual_tg_user_ids || [])].map(String).sort().join(',');
      return prepKey === manualIdsKey;
    }
    return String(preparation.base_id || '') === String(baseId || '');
  }, [preparation, audienceType, baseId, manualIdsKey]);

  const poolMatchesPreparation = useMemo(() => {
    if (!preparation) return false;
    const key = (list) => [...(list || [])].map(String).sort().join(',');
    return key(preparation.userbot_ids) === key(poolIds);
  }, [preparation, poolIds]);
  const selectionMatchesPreparation = Boolean(preparation && baseMatchesPreparation && poolMatchesPreparation);

  const baseOptions = useMemo(() => {
    const options = state.clientBases.map((b) => ({
      value: `client:${b.id}`, id: b.id, name: b.name,
      count: b.stats?.total ?? null
    }));
    if ((manual.tg_user_ids || []).length > 0) {
      options.unshift({ value: 'manual', id: null, name: 'Ручная выборка', count: manual.tg_user_ids.length });
    }
    if (baseSelected && form.base !== 'manual' && !options.some((o) => o.value === form.base)) {
      options.unshift({ value: form.base, id: baseId, name: 'База (возможно, удалена)', count: null });
    }
    return options;
  }, [state.clientBases, manual.tg_user_ids, form.base, baseSelected, baseId]);

  useEffect(() => {
    let cancelled = false;

    async function loadAll() {
      if (!accessToken || !user?.id) return;
      try {
        const draft = loadDraft();
        if (draft) {
          setForm((prev) => ({ ...prev, ...draft, base: prev.base || draft.base }));
        }
        const manualSelection = consumeManualSelection();
        const urlParams = new URLSearchParams(window.location.search);
        const queryBaseId = urlParams.get('base_id');
        const queryAudienceType = urlParams.get('audience_type');
        const [{ data: rawUserbots }, reserved, clientBases, campaigns, preparations] = await Promise.all([
          supabase
            .from('tg_accounts')
            .select('id, tg_username, tg_account_id, runtime_status, proxy_id, proxies(id, name, is_working, last_check_country, host, port)')
            .eq('owner_id', user.id)
            .eq('account_type', 'userbot')
            .order('created_at', { ascending: false }),
          apiRequest('/api/shop/seller/reserved-assets', { accessToken }),
          apiRequest('/api/client-bases', { accessToken }),
          apiRequest('/api/broadcast/campaigns', { accessToken }),
          apiRequest('/api/broadcast/preparations', { accessToken })
        ]);

        const reservedIds = new Set((reserved.userbot_ids || []).map(String));
        const userbots = (rawUserbots || []).filter((row) => !reservedIds.has(String(row.id)));

        if (cancelled) return;
        setState((prev) => ({
          ...prev,
          loading: false,
          error: '',
          clientBases: clientBases.bases || [],
          userbots,
          campaigns: campaigns.campaigns || [],
          failures: campaigns.failures || []
        }));

        setPoolIds((prev) => (prev.length ? prev : (userbots[0] ? [userbots[0].id] : [])));

        const activePrep = preparations.active;
        const readyPrep = activePrep ? null : (preparations.preparations || []).find((row) => {
          if (row.status !== 'ready') return false;
          return Date.now() - new Date(row.updated_at || row.created_at).getTime() < 24 * 60 * 60 * 1000;
        });
        const restored = activePrep || readyPrep;
        if (restored?.id) {
          let full = restored;
          try {
            const data = await apiRequest(`/api/broadcast/preparations/${restored.id}`, { accessToken });
            full = data.preparation || restored;
          } catch {
            // список уже дал основное
          }
          if (cancelled) return;
          setPreparation(full);
          if ((full.userbot_ids || []).length) {
            const existing = new Set(userbots.map((row) => String(row.id)));
            setPoolIds(full.userbot_ids.filter((id) => existing.has(String(id))));
          }
          const value = baseValueFromPreparation(full);
          if (value) {
            setForm((prev) => ({ ...prev, base: prev.base || value }));
          }
          if (full.audience_type === 'manual_list' && (full.manual_tg_user_ids || []).length) {
            setManual({ tg_user_ids: full.manual_tg_user_ids, members: [] });
          }
        }

        if (manualSelection?.tg_user_ids?.length) {
          setManual({ tg_user_ids: manualSelection.tg_user_ids || [], members: manualSelection.members || [] });
          setForm((prev) => ({
            ...prev,
            base: 'manual',
            title: prev.title || manualSelection.suggested_title || '',
            message_text: prev.message_text || manualSelection.suggested_message || ''
          }));
        }

        if (queryBaseId && queryAudienceType === 'client_base_members') {
          setForm((prev) => {
            const next = { ...prev, base: `client:${queryBaseId}` };
            const suggested = (clientBases.bases || []).find((b) => b.id === queryBaseId);
            if (suggested && !prev.title) {
              next.title = `Рассылка по базе «${suggested.name}»`;
            }
            window.history.replaceState({}, '', window.location.pathname);
            return next;
          });
        }
      } catch (error) {
        if (!cancelled) {
          setState((prev) => ({ ...prev, loading: false, error: error.message }));
        }
      }
    }

    loadAll();
    return () => {
      cancelled = true;
    };
  }, [accessToken, user?.id]);

  // Состав выбранной базы (постранично)
  useEffect(() => {
    if (!accessToken || !form.base.startsWith('client:')) {
      setMembers({ rows: [], total: 0, loading: false });
      return;
    }
    let cancelled = false;
    async function loadMembers() {
      setMembers((prev) => ({ ...prev, loading: true }));
      try {
        const data = await fetchClientBaseMembers(accessToken, form.base.slice('client:'.length), {
          limit: MEMBERS_PAGE_SIZE,
          offset: membersPage * MEMBERS_PAGE_SIZE
        });
        if (!cancelled) {
          const rows = data.members || [];
          for (const row of rows) {
            memberIndexRef.current.set(String(row.tg_user_id), row);
          }
          setMembers({ rows, total: data.summary?.total || 0, loading: false });
        }
      } catch {
        if (!cancelled) {
          setMembers({ rows: [], total: 0, loading: false });
        }
      }
    }
    loadMembers();
    return () => {
      cancelled = true;
    };
  }, [accessToken, form.base, membersPage]);

  // Смена базы сбрасывает отметки получателей и страницу
  useEffect(() => {
    setSelectedIds([]);
    setMembersPage(0);
  }, [form.base]);

  // Черновик формы переживает перезагрузку
  useEffect(() => {
    if (state.loading) return;
    try {
      window.localStorage.setItem('broadcast_draft', JSON.stringify(form));
    } catch {
      // localStorage недоступен — не критично
    }
  }, [form, state.loading]);

  // Поллинг активной подготовки
  useEffect(() => {
    if (!accessToken || !preparation?.id || !ACTIVE_PREPARATION_STATUSES.has(preparation.status)) {
      if (pollRef.current) {
        window.clearTimeout(pollRef.current);
        pollRef.current = null;
      }
      return;
    }

    const preparationId = preparation.id;
    async function poll() {
      try {
        const data = await apiRequest(`/api/broadcast/preparations/${preparationId}`, { accessToken });
        setPreparation(data.preparation || null);
      } catch {
        // следующая итерация попробует снова
      }
      pollRef.current = window.setTimeout(poll, 3000);
    }
    pollRef.current = window.setTimeout(poll, 3000);
    return () => {
      if (pollRef.current) {
        window.clearTimeout(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [accessToken, preparation?.id, preparation?.status]);

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function togglePoolUserbot(id) {
    const update = (list) => {
      const current = new Set((list || []).map(String));
      if (current.has(String(id))) current.delete(String(id));
      else current.add(String(id));
      return Array.from(current);
    };
    setPoolIds((prev) => update(prev));
  }

  function toggleRecipient(id) {
    setSelectedIds((prev) => (
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    ));
  }

  function toggleAllVisibleRecipients() {
    const visibleIds = (members.rows || []).map((r) => String(r.tg_user_id));
    if (visibleIds.length === 0) return;
    const allVisible = visibleIds.every((id) => selectedIds.includes(id));
    setSelectedIds((prev) => (
      allVisible
        ? prev.filter((id) => !visibleIds.includes(id))
        : Array.from(new Set([...prev, ...visibleIds]))
    ));
  }

  async function startPreparation() {
    if (!baseSelected) {
      toast.error('Выбери базу.');
      return;
    }
    if (poolIds.length === 0) {
      toast.error('Выбери юзерботов.');
      return;
    }

    setPreparing(true);
    try {
      const data = await apiRequest('/api/broadcast/preparations', {
        accessToken,
        method: 'POST',
        body: {
          audience_type: audienceType,
          base_id: apiBaseId,
          manual_tg_user_ids: manualPayload.tg_user_ids,
          manual_members: manualPayload.members,
          userbot_ids: poolIds
        }
      });
      setPreparation({
        id: data.id,
        status: 'pending',
        phase_detail: {},
        audience_type: audienceType,
        base_id: apiBaseId,
        manual_tg_user_ids: manualPayload.tg_user_ids,
        userbot_ids: poolIds
      });
      setStep('prepare');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setPreparing(false);
    }
  }

  async function cancelPreparation() {
    if (!preparation?.id) return;
    try {
      await apiRequest(`/api/broadcast/preparations/${preparation.id}`, { accessToken, method: 'DELETE' });
      setPreparation(null);
      setStep('userbots');
    } catch (error) {
      toast.error(error.message);
    }
  }

  async function recheckPreparation() {
    if (!preparation?.id) return;
    try {
      await apiRequest(`/api/broadcast/preparations/${preparation.id}/recheck`, { accessToken, method: 'POST' });
      setPreparation((prev) => (prev ? { ...prev, status: 'scanning' } : prev));
    } catch (error) {
      toast.error(error.message);
    }
  }

  async function addJoinTargets(targets) {
    if (!preparation?.id) return;
    try {
      await apiRequest(`/api/broadcast/preparations/${preparation.id}/join-targets`, {
        accessToken,
        method: 'POST',
        body: { targets }
      });
      setPreparation((prev) => (prev ? { ...prev, status: 'joining' } : prev));
    } catch (error) {
      toast.error(error.message);
    }
  }

  async function sendCampaign() {
    if (!planRules.canSendBroadcasts) {
      toast.error(`На тарифе ${planRules.label} отправка рассылок закрыта.`);
      return;
    }
    if (!baseSelected) {
      toast.error('Выбери базу.');
      return;
    }
    if (poolIds.length === 0) {
      toast.error('Выбери юзерботов.');
      return;
    }
    if (!form.message_text.trim()) {
      toast.error('Напиши текст сообщения.');
      return;
    }
    if (!preparation) {
      toast.error('Сначала прогони подготовку.');
      return;
    }
    if (ACTIVE_PREPARATION_STATUSES.has(preparation.status)) {
      toast.error('Подготовка ещё идёт — дождись готовности.');
      return;
    }
    if (preparation.status !== 'ready' || !selectionMatchesPreparation) {
      toast.error('База или юзерботы изменились — запусти подготовку заново.');
      return;
    }
    const confirmed = window.confirm(
      'Рассылка пойдёт от выбранных юзерботов. Telegram может ограничить аккаунты, если получатели на них жалуются. Запускаем?'
    );
    if (!confirmed) return;

    setSending(true);
    try {
      await apiRequest('/api/broadcast/send', {
        accessToken,
        method: 'POST',
        body: {
          title: form.title,
          audience_type: audienceType,
          base_id: apiBaseId,
          manual_tg_user_ids: manualPayload.tg_user_ids,
          manual_members: manualPayload.members,
          sender_type: 'userbot_pool_round_robin',
          sender_userbot_ids: poolIds,
          delay_ms: 5000,
          message_text: form.message_text.trim(),
          preparation_id: preparation?.status === 'ready' ? preparation.id : undefined,
          manual_confirmed_userbot_risk: true
        }
      });
      toast.success('Рассылка запущена.');
      const campaigns = await apiRequest('/api/broadcast/campaigns', { accessToken });
      setState((prev) => ({
        ...prev,
        campaigns: campaigns.campaigns || [],
        failures: campaigns.failures || []
      }));
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSending(false);
    }
  }

  if (state.loading) {
    return <LoadingState text="Загружаем рассылки..." />;
  }

  const visibleMemberIds = (members.rows || []).map((r) => String(r.tg_user_id));
  const eligibleUserbots = state.userbots.filter((row) => row.runtime_status !== 'pending_activation' && !(row.proxy_id && row.proxies?.is_working === false));
  const allSelected = eligibleUserbots.length > 0 && eligibleUserbots.every((row) => poolIds.map(String).includes(String(row.id)));
  const messageEmpty = !form.message_text.trim();
  const preparationBlocking = !preparation
    ? 'Сначала прогони подготовку.'
    : ACTIVE_PREPARATION_STATUSES.has(preparation.status)
      ? 'Подготовка ещё идёт — вернись на шаг 3.'
      : preparation.status !== 'ready'
        ? 'Подготовка не завершена — вернись на шаг 3.'
        : !selectionMatchesPreparation
          ? 'База или юзерботы изменились — запусти подготовку заново.'
          : '';
  const sendDisabled = sending || messageEmpty || !baseSelected || poolIds.length === 0
    || !planRules.canSendBroadcasts
    || Boolean(preparationBlocking);
  const stepIndex = STEPS.findIndex((item) => item.id === step);
  let nextAction = null;
  if (step === 'base') {
    nextAction = { label: 'Дальше — Юзерботы', onClick: () => setStep('userbots'), disabled: !baseSelected };
  } else if (step === 'userbots') {
    nextAction = selectionMatchesPreparation
      ? { label: 'Дальше — Подготовка', onClick: () => setStep('prepare') }
      : { label: 'Подготовить', onClick: startPreparation, disabled: preparing || poolIds.length === 0, busy: preparing };
  } else if (step === 'prepare') {
    nextAction = {
      label: 'Дальше — Отправка',
      onClick: () => setStep('send'),
      disabled: preparation?.status !== 'ready' || !selectionMatchesPreparation
    };
  }

  return (
    <section className="page page--flush space-y-6">
      <Card>
        <Section>
          <ol className="flex items-start w-full">
            {STEPS.map((item, i) => {
              const done = i < stepIndex;
              const current = i === stepIndex;
              const locked = (item.id === 'prepare' || item.id === 'send') && !selectionMatchesPreparation;
              return (
                <li key={item.id} className="flex items-start flex-1 last:flex-none">
                  <button
                    type="button"
                    disabled={locked && !current}
                    onClick={() => setStep(item.id)}
                    className={`flex flex-col items-center gap-1.5 ${locked && !current ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                  >
                    <span
                      className={`flex items-center justify-center w-9 h-9 rounded-full text-xs font-black transition-all ${
                        done || current
                          ? 'bg-indigo-600 text-white shadow-sm'
                          : 'bg-white border border-slate-200 text-slate-400'
                      } ${current ? 'ring-4 ring-indigo-100' : ''} ${locked && !current ? 'opacity-40' : ''}`}
                    >
                      {done ? <Check className="w-4 h-4" /> : i + 1}
                    </span>
                    <span className={`text-[11px] font-bold whitespace-nowrap ${current ? 'text-indigo-700' : done ? 'text-slate-600' : 'text-slate-400'}`}>
                      {item.label}
                    </span>
                  </button>
                  {i < STEPS.length - 1 ? (
                    <div className={`hidden md:block flex-1 h-0.5 mx-2 mt-[18px] rounded-full ${done ? 'bg-indigo-500' : 'bg-slate-200'}`} aria-hidden="true" />
                  ) : null}
                </li>
              );
            })}
          </ol>
        </Section>
      </Card>

      {step === 'base' ? (
        <Card>
          <Section>
            <SectionTitle icon={Users}>База</SectionTitle>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input className={inputCls} type="text" value={form.title} onChange={(e) => setField('title', e.target.value)} placeholder="Название кампании" />
              <select className={inputCls} value={form.base} onChange={(e) => setField('base', e.target.value)}>
                <option value="">Выбери базу</option>
                {baseOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.name}{opt.count !== null ? ` • ${opt.count} чел.` : ''}
                  </option>
                ))}
              </select>
            </div>
            {!baseSelected ? (
              state.clientBases.length === 0 && (manual.tg_user_ids || []).length === 0 ? (
                <div className="mt-3">
                  <EmptyNote>
                    Пока нет ни одной базы.{' '}
                    <Link to="/app/bases" className="text-indigo-600 font-bold hover:text-indigo-700">Создать базу</Link>
                  </EmptyNote>
                </div>
              ) : (
                <div className="mt-3 text-sm text-slate-500 font-medium">
                  Базы создаются руками на странице «Базы». Ручная выборка передаётся из CRM и брошенных корзин.
                </div>
              )
            ) : null}
            {form.base.startsWith('client:') ? (
              members.loading ? (
                <div className="mt-4"><EmptyNote>Грузим состав базы...</EmptyNote></div>
              ) : (
                <div className="mt-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm text-slate-600 font-medium">
                      {members.total === 0
                        ? 'База пустая.'
                        : clientSelectionActive
                          ? `Получат: ${selectedIds.length} из ${members.total} человек.`
                          : `В базе: ${members.total} человек — письмо пойдёт всем.`}
                    </div>
                    <div className="flex items-center gap-4 shrink-0">
                      {clientSelectionActive ? (
                        <button
                          type="button"
                          className="text-xs font-bold text-slate-500 hover:text-slate-700 transition-colors"
                          onClick={() => setSelectedIds([])}
                        >
                          Писать всей базе
                        </button>
                      ) : null}
                    </div>
                  </div>
                  {members.rows.length > 0 ? (
                    <div className="mt-3">
                      <TableShell>
                    <thead>
                      <tr>
                        <Th>
                          <input
                            type="checkbox"
                            className="w-4 h-4 accent-indigo-600"
                            checked={visibleMemberIds.length > 0 && visibleMemberIds.every((id) => selectedIds.includes(id))}
                            onChange={toggleAllVisibleRecipients}
                            aria-label="Отметить всех видимых"
                          />
                        </Th>
                        <Th>Кто</Th>
                        <Th>Деньги</Th>
                        <Th>Где есть</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {members.rows.map((member) => {
                        const badge = paymentBadge(member.payment_status);
                        const cov = coverageChannels(member);
                        return (
                          <Tr key={member.id}>
                            <Td>
                              <input
                                type="checkbox"
                                className="w-4 h-4 accent-indigo-600"
                                checked={selectedIds.includes(String(member.tg_user_id))}
                                onChange={() => toggleRecipient(String(member.tg_user_id))}
                              />
                            </Td>
                            <Td>
                              <div className="text-sm font-bold text-slate-900">{memberDisplayName(member)}</div>
                              <div className="text-xs text-slate-500 font-mono">
                                {member.username ? `@${member.username}` : 'без username'} · {member.tg_user_id}
                              </div>
                            </Td>
                            <Td>
                              <span className={`inline-flex px-2 py-1 rounded-md text-[11px] font-black ${badge.cls}`}>
                                {badge.text}
                              </span>
                              <div className="text-xs text-slate-500 font-medium mt-1">
                                {member.active_subscription_count || 0} активн. · {member.expired_subscription_count || 0} истекш.
                              </div>
                            </Td>
                            <Td>
                              <div className="text-xs font-black uppercase tracking-wider text-slate-500 mb-1">
                                {coverageLabel(member)}
                              </div>
                              {cov.presentTotal > 0 ? (
                                <div className="text-xs text-slate-700">В: {cov.present.join(', ')}</div>
                              ) : (
                                <div className="text-xs text-slate-400">Нигде не найден</div>
                              )}
                            </Td>
                          </Tr>
                        );
                      })}
                    </tbody>
                  </TableShell>
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                        <div className="text-xs text-slate-500 font-medium">
                          Страница {membersPage + 1} из {Math.max(Math.ceil(members.total / MEMBERS_PAGE_SIZE), 1)} · всего {members.total}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className={btnGhost}
                            disabled={membersPage === 0 || members.loading}
                            onClick={() => setMembersPage((prev) => Math.max(prev - 1, 0))}
                          >
                            Назад
                          </button>
                          <button
                            type="button"
                            className={btnGhost}
                            disabled={(membersPage + 1) * MEMBERS_PAGE_SIZE >= members.total || members.loading}
                            onClick={() => setMembersPage((prev) => prev + 1)}
                          >
                            Вперёд
                          </button>
                        </div>
                      </div>
                  </div>
                    ) : null}
                </div>
              )
              ) : form.base === 'manual' ? (
              <div className="mt-3 text-sm text-slate-500 font-medium">
                Ручная выборка: {manual.tg_user_ids.length} человек.
              </div>
            ) : null}
          </Section>
        </Card>
      ) : null}

      {!planRules.canSendBroadcasts ? (
        <>
          <PlanBanner
            tone="warning"
            title="Trial: отправка рассылок закрыта"
            text="На Trial можно собрать базу и прогнать подготовку. Отправка откроется на Normal."
          />
          <UpgradeCallout
            title={trialUpgradeUrgent ? `Trial скоро сгорит: осталось около ${trialHoursLeft} ч` : undefined}
            text={trialUpgradeUrgent
              ? 'Не упирайся в trial-лимит до дедлайна — переходи на Normal и запускай рассылки.'
              : 'Переходи на Normal, чтобы отправлять рассылки по собранной базе.'}
          />
        </>
      ) : null}

      {state.error ? <ErrorNote>{state.error}</ErrorNote> : null}

      {step === 'userbots' ? (
        <Card>
          <Section>
            <SectionTitle icon={Bot}>Юзерботы</SectionTitle>
            <div className="text-sm text-slate-500 font-medium mb-4">
              Рассылка пойдёт от имени выбранных аккаунтов. Safe-mode и аккаунты с недоступным прокси не участвуют.
            </div>
            {state.userbots.length === 0 ? (
              <EmptyNote>
                Нет юзерботов.{' '}
                <Link to="/app/userbots" className="text-indigo-600 font-bold hover:text-indigo-700">Подключить аккаунты</Link>
              </EmptyNote>
            ) : (
              <div>
              <div className="flex items-center justify-between gap-3 mb-3">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Выбрано: {poolIds.length} из {eligibleUserbots.length}
                </span>
                {eligibleUserbots.length > 0 ? (
                  <button
                    type="button"
                    className="text-xs font-bold text-indigo-600 hover:text-indigo-700 transition-colors"
                    onClick={() => setPoolIds(allSelected ? [] : eligibleUserbots.map((row) => row.id))}
                  >
                    {allSelected ? 'Снять всех' : 'Выбрать всех'}
                  </button>
                ) : null}
              </div>
              <div className="space-y-2">
                {state.userbots.map((row) => {
                  const safeMode = row.runtime_status === 'pending_activation';
                  const deadProxy = row.proxy_id && row.proxies?.is_working === false;
                  const checked = poolIds.map(String).includes(String(row.id));
                  return (
                    <label
                      key={row.id}
                      className={`flex items-center justify-between gap-3 p-4 rounded-2xl border transition-all ${
                        checked ? 'border-slate-900 bg-slate-50' : 'border-slate-200 bg-white hover:border-slate-300'
                      } ${safeMode || deadProxy ? 'opacity-55 cursor-not-allowed' : 'cursor-pointer'}`}
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-black text-slate-900 truncate">@{row.tg_username || row.tg_account_id}</div>
                        <div className="text-xs text-slate-500 font-medium mt-0.5 flex flex-wrap items-center gap-2">
                          {safeMode ? <StatusBadge tone="warning">safe-mode</StatusBadge> : null}
                          {deadProxy ? <StatusBadge tone="danger">прокси недоступен</StatusBadge> : null}
                          {!safeMode && !deadProxy ? (
                            <span>
                              {row.proxies?.host ? `${row.proxies.host}:${row.proxies.port}` : 'Прокси не найден'}
                              {row.proxies?.last_check_country ? ` • ${row.proxies.last_check_country}` : ''}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        className="w-4 h-4 accent-slate-900 shrink-0"
                        disabled={safeMode || deadProxy}
                        checked={checked}
                        onChange={() => togglePoolUserbot(row.id)}
                      />
                    </label>
                  );
                })}
              </div>
              </div>
            )}
            {preparation && !selectionMatchesPreparation ? (
              <div className="mt-4 text-sm text-amber-700 font-medium">
                Выбор изменился — нужна новая подготовка.
              </div>
            ) : null}
          </Section>
        </Card>
      ) : null}

      {step === 'prepare' ? (
        preparation ? (
          <>
            <PreparationRunner preparation={preparation} onCancel={cancelPreparation} />
            {preparation.status === 'ready' && selectionMatchesPreparation ? (
              <ReadinessDashboard
                accessToken={accessToken}
                preparation={preparation}
                onRecheck={recheckPreparation}
                onAddGroups={addJoinTargets}
                busy={sending}
              />
            ) : null}
          </>
        ) : (
          <Card>
            <Section>
              <EmptyNote>Активной подготовки нет. Вернись к юзерботам и нажми «Подготовить».</EmptyNote>
            </Section>
          </Card>
        )
      ) : null}

      {step === 'send' ? (
        preparation?.status === 'ready' && selectionMatchesPreparation ? (
          <ReadinessDashboard
            accessToken={accessToken}
            preparation={preparation}
            readOnly
          />
        ) : (
          <Card>
            <Section>
              <EmptyNote>
                {preparation && ACTIVE_PREPARATION_STATUSES.has(preparation.status)
                  ? 'Подготовка ещё идёт — вернись на шаг 3.'
                  : 'Сначала прогони подготовку.'}
              </EmptyNote>
            </Section>
          </Card>
        )
      ) : null}

      {step === 'send' ? (
        <>
          <Card>
            <Section>
              <SectionTitle icon={MessageSquare}>Сообщение</SectionTitle>
              <textarea
                className="w-full px-4 py-3 rounded-xl bg-white border border-slate-200 text-sm font-medium text-slate-900 focus:outline-none focus:border-slate-400 shadow-sm transition resize-none min-h-[160px]"
                rows="8"
                value={form.message_text}
                onChange={(e) => setField('message_text', e.target.value)}
                placeholder="Текст сообщения"
              />
              {preparationBlocking ? (
                <div className="mt-3 text-sm text-amber-700 font-medium">
                  {preparationBlocking}
                </div>
              ) : null}
              <div className="mt-6 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-3">
                <button type="button" className={`${btnGhost} w-full sm:w-auto`} onClick={() => setStep('userbots')}>
                  Назад
                </button>
                <button type="button" className={`${btnPrimary} w-full sm:w-auto`} onClick={sendCampaign} disabled={sendDisabled}>
                  {sending ? <><Loader2 className="w-4 h-4 animate-spin" /> Отправляем...</> : !planRules.canSendBroadcasts ? 'Нужен Normal' : 'Отправить рассылку'}
                </button>
              </div>
            </Section>
          </Card>
        </>
      ) : null}

      {nextAction ? (
        <button
          type="button"
          disabled={nextAction.disabled}
          onClick={nextAction.onClick}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-3.5 rounded-2xl bg-indigo-600 !text-white text-sm font-black hover:bg-indigo-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {nextAction.busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Запускаем...</> : nextAction.label}
        </button>
      ) : null}

      <Card>
        <Section>
          <SectionTitle icon={ListChecks}>История</SectionTitle>
          {state.campaigns.length === 0 ? (
            <EmptyNote>Рассылок еще не было.</EmptyNote>
          ) : (
            <TableShell>
              <thead>
                <tr>
                  <Th>Дата</Th>
                  <Th>Название</Th>
                  <Th>База</Th>
                  <Th>Отправители</Th>
                  <Th>Статус</Th>
                </tr>
              </thead>
              <tbody>
                {state.campaigns.slice(0, 20).map((campaign) => (
                  <Tr key={campaign.id}>
                    <Td><div className="text-xs text-slate-500 font-medium whitespace-nowrap">{formatWhen(campaign.created_at)}</div></Td>
                    <Td><div className="text-sm font-bold text-slate-900">{campaign.title}</div></Td>
                    <Td><div className="text-xs text-slate-600 font-medium">{AUDIENCE_LABELS[campaign.audience_type] || campaign.audience_type}</div></Td>
                    <Td><div className="text-xs text-slate-600 font-medium">{senderLabel(campaign)}</div></Td>
                    <Td>
                      <StatusBadge tone={campaign.status === 'sent' ? 'ok' : campaign.status === 'completed_with_errors' ? 'warning' : 'default'}>
                        {campaign.status}
                      </StatusBadge>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </TableShell>
          )}
          {state.failures.length > 0 ? (
            <div className="mt-6">
              <div className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-3">Не доставлено</div>
              <TableShell>
                <thead>
                  <tr>
                    <Th>Дата</Th>
                    <Th>TG ID</Th>
                    <Th>Ошибка</Th>
                  </tr>
                </thead>
                <tbody>
                  {state.failures.slice(0, 20).map((row) => (
                    <Tr key={row.id}>
                      <Td><div className="text-xs text-slate-500 font-medium whitespace-nowrap">{formatWhen(row.created_at)}</div></Td>
                      <Td><div className="text-xs text-slate-600 font-mono">{row.tg_user_id}</div></Td>
                      <Td><div className="text-xs text-rose-600 font-medium">{row.error_text || '—'}</div></Td>
                    </Tr>
                  ))}
                </tbody>
              </TableShell>
            </div>
          ) : null}
        </Section>
      </Card>
    </section>
  );
}
