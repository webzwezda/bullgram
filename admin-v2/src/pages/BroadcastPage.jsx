import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Send, Users, Bot, Radar, MessageSquare, ListChecks, Loader2 } from 'lucide-react';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { getProductTierRules } from '../app/productTier.js';
import { supabase } from '../lib/supabase.js';
import { LoadingState } from '../ui/LoadingState.jsx';
import { PlanBanner } from '../ui/PlanBanner.jsx';
import { UpgradeCallout } from '../ui/UpgradeCallout.jsx';
import { ExternalTargetsField } from './broadcast/ExternalTargetsField.jsx';
import { PreparationRunner } from './broadcast/PreparationRunner.jsx';
import { ReadinessDashboard } from './broadcast/ReadinessDashboard.jsx';
import {
  Card, Section, SectionTitle, EmptyNote, ErrorNote, StatusBadge, StatTile,
  TableShell, Th, Td, Tr, inputCls, btnPrimary, btnGhost
} from './broadcast/ui.jsx';

const AUDIENCES = [
  { id: 'channel_audience_members', label: 'Вся база по нескольким группам' },
  { id: 'client_base_members', label: 'База клиентов (кураторский список)' },
  { id: 'manual_list', label: 'Ручная выборка' },
  { id: 'active_subscribers', label: 'Активные подписчики (без подготовки)' },
  { id: 'expired_subscribers', label: 'Ушедшие / просроченные (без подготовки)' },
  { id: 'viewed_no_invoice', label: 'Смотрели тариф, но не создали счет (без подготовки)' },
  { id: 'unpaid_leads', label: 'Нажали тариф, но не оплатили (без подготовки)' },
  { id: 'paid_not_joined', label: 'Вход не подтвержден (без подготовки)' },
  { id: 'trial_active', label: 'Пробники внутри (без подготовки)' },
  { id: 'trial_expiring', label: 'Пробник скоро сгорит (без подготовки)' },
  { id: 'trial_unpaid', label: 'Пробник нажали, но не оплатили (без подготовки)' },
  { id: 'channel_active', label: 'Активные по конкретному каналу (без подготовки)' }
];

const PREPARABLE_AUDIENCES = new Set(['channel_audience_members', 'client_base_members', 'manual_list']);

const STEPS = [
  { id: 'audience', label: '1. Аудитория' },
  { id: 'pool', label: '2. Юзерботы' },
  { id: 'prepare', label: '3. Подготовка' },
  { id: 'ready', label: '4. Отправка' }
];

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

function audienceHint(type) {
  const map = {
    active_subscribers: 'Живые платники. Тут анонсы, апдейты и то, что должно долетать до тех, кто уже внутри.',
    expired_subscribers: 'Те, кто уже сгорел. Этот хвост надо возвращать.',
    viewed_no_invoice: 'Открыли тарифы, но не дошли до счета. Это верх воронки для мягкого касания.',
    unpaid_leads: 'Нажали тариф, но слились до оплаты. Тут лежат быстрые деньги.',
    paid_not_joined: 'Оплата есть, а входа нет. Тут надо дотащить до доступа.',
    channel_audience_members: 'Общая база по нескольким местам. Основной путь для юзербот-рассылки.',
    client_base_members: 'Кураторский список, собранный вручную из аудитории. Не зависит от синка каналов.',
    manual_list: 'Ручная выборка, которую ты собрал сам на другом экране.',
    trial_active: 'Сидят на пробнике прямо сейчас.',
    trial_expiring: 'Пробники скоро сгорят. Самый горячий момент на апселл.',
    trial_unpaid: 'Даже дешевый вход не добили. Тут нужен отдельный дожим.',
    channel_active: 'Живые подписчики только по одному выбранному каналу.'
  };
  return map[type] || 'Выбери сегмент и смотри, кого реально зацепишь.';
}

function previewClientLabel(row) {
  if (row.username) return `@${row.username}`;
  if (row.tariff_title) return row.tariff_title;
  return `TG ID ${row.tg_user_id}`;
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

function senderTypeUsesUserbot(senderType = '') {
  return [
    'userbot_only',
    'official_then_userbot',
    'userbot_pool_round_robin',
    'official_then_userbot_pool'
  ].includes(String(senderType || '').trim());
}

function senderTypeUsesUserbotPool(senderType = '') {
  return [
    'userbot_pool_round_robin',
    'official_then_userbot_pool'
  ].includes(String(senderType || '').trim());
}

const ACTIVE_PREPARATION_STATUSES = new Set(['pending', 'scanning', 'joining', 'recomputing']);

export function BroadcastPage() {
  const { accessToken, user, profilePlan, trialEndsAt } = useAuth();
  const [state, setState] = useState({
    loading: true,
    error: '',
    channels: [],
    bases: [],
    clientBases: [],
    userbots: [],
    campaigns: [],
    failures: [],
    summary: {},
    flags: { userbot_broadcast_enabled: false, auto_join_enabled: false }
  });
  const [step, setStep] = useState('audience');
  const [form, setForm] = useState({
    title: '',
    audience_type: 'channel_audience_members',
    channel_id: '',
    base_id: '',
    base_filter: 'all_members',
    manual_tg_user_ids: [],
    manual_members: [],
    sender_type: 'official_only',
    sender_userbot_id: '',
    sender_userbot_ids: [],
    delay_ms: 5000,
    message_text: ''
  });
  const [poolIds, setPoolIds] = useState([]);
  const [externalTargetsText, setExternalTargetsText] = useState('');
  const [preparation, setPreparation] = useState(null);
  const [preparing, setPreparing] = useState(false);
  const [sending, setSending] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState({ rows: [], count: 0 });
  const pollRef = useRef(null);

  const requiresChannel = form.audience_type === 'channel_active';
  const requiresBase = form.audience_type === 'channel_audience_members';
  const requiresClientBase = form.audience_type === 'client_base_members';
  const requiresManual = form.audience_type === 'manual_list';
  const isPreparable = PREPARABLE_AUDIENCES.has(form.audience_type);
  const usesPool = senderTypeUsesUserbotPool(form.sender_type);
  const usesUserbot = senderTypeUsesUserbot(form.sender_type);
  const planRules = useMemo(() => getProductTierRules(profilePlan), [profilePlan]);
  const trialHoursLeft = useMemo(() => {
    if (!trialEndsAt) return null;
    const diffMs = new Date(trialEndsAt).getTime() - Date.now();
    if (diffMs <= 0) return 0;
    return Math.ceil(diffMs / (1000 * 60 * 60));
  }, [trialEndsAt]);
  const trialUpgradeUrgent = profilePlan === 'trial' && trialHoursLeft !== null && trialHoursLeft > 0 && trialHoursLeft <= 72;

  useEffect(() => {
    let cancelled = false;

    async function loadAll() {
      if (!accessToken || !user?.id) return;
      try {
        const manualSelection = consumeManualSelection();
        const urlParams = new URLSearchParams(window.location.search);
        const queryBaseId = urlParams.get('base_id');
        const queryAudienceType = urlParams.get('audience_type');
        const [{ data: channels }, { data: rawUserbots }, reserved, bases, clientBases, campaigns, preparations] = await Promise.all([
          supabase.from('channels').select('id, title').eq('owner_id', user.id).order('created_at', { ascending: false }),
          supabase
            .from('tg_accounts')
            .select('id, tg_username, tg_account_id, runtime_status, proxy_id, proxies(id, name, is_working, last_check_country, host, port)')
            .eq('owner_id', user.id)
            .eq('account_type', 'userbot')
            .order('created_at', { ascending: false }),
          apiRequest('/api/shop/seller/reserved-assets', { accessToken }),
          apiRequest('/api/channel-audiences', { accessToken }),
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
          channels: channels || [],
          bases: bases.bases || [],
          clientBases: clientBases.bases || [],
          userbots,
          campaigns: campaigns.campaigns || [],
          failures: campaigns.failures || [],
          summary: campaigns.summary || {},
          flags: preparations.flags || prev.flags
        }));

        if (preparations.active?.id) {
          setPreparation(preparations.active);
          setStep(ACTIVE_PREPARATION_STATUSES.has(preparations.active.status) ? 'prepare' : 'ready');
        } else {
          const latestReady = (preparations.preparations || []).find((row) => {
            if (row.status !== 'ready') return false;
            return Date.now() - new Date(row.updated_at || row.created_at).getTime() < 24 * 60 * 60 * 1000;
          });
          if (latestReady) {
            setPreparation(latestReady);
            setStep('ready');
          }
        }

        setForm((prev) => {
          const next = {
            ...prev,
            sender_userbot_id: prev.sender_userbot_id || userbots[0]?.id || '',
            sender_userbot_ids: prev.sender_userbot_ids?.length ? prev.sender_userbot_ids : (userbots[0] ? [userbots[0].id] : [])
          };

          if (manualSelection?.tg_user_ids?.length) {
            next.audience_type = 'manual_list';
            next.manual_tg_user_ids = manualSelection.tg_user_ids || [];
            next.manual_members = manualSelection.members || [];
            next.title = prev.title || manualSelection.suggested_title || '';
            next.message_text = prev.message_text || manualSelection.suggested_message || '';
          }

          if (queryBaseId && queryAudienceType === 'client_base_members') {
            next.audience_type = 'client_base_members';
            next.base_id = queryBaseId;
            const suggested = (clientBases.bases || []).find((b) => b.id === queryBaseId);
            if (suggested && !prev.title) {
              next.title = `Рассылка по базе «${suggested.name}»`;
            }
            window.history.replaceState({}, '', window.location.pathname);
          }
          return next;
        });

        setPoolIds((prev) => (prev.length ? prev : (userbots[0] ? [userbots[0].id] : [])));
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

  // Превью аудитории
  useEffect(() => {
    let cancelled = false;
    async function runPreview() {
      if (!accessToken || !form.audience_type) return;
      setPreviewing(true);
      try {
        const data = await apiRequest('/api/broadcast/preview', {
          accessToken,
          method: 'POST',
          body: {
            audience_type: form.audience_type,
            channel_id: form.channel_id || null,
            base_id: form.base_id || null,
            manual_tg_user_ids: form.manual_tg_user_ids || [],
            manual_members: form.manual_members || [],
            base_filter: form.base_filter || 'all_members'
          }
        });
        if (!cancelled) {
          setPreviewing(false);
          setPreview({ rows: data.audience || [], count: data.count || 0 });
        }
      } catch (error) {
        if (!cancelled) {
          setPreviewing(false);
          setPreview({ rows: [], count: 0 });
        }
      }
    }
    runPreview();
    return () => {
      cancelled = true;
    };
  }, [
    accessToken,
    form.audience_type,
    form.channel_id,
    form.base_id,
    form.base_filter,
    JSON.stringify(form.manual_tg_user_ids),
    JSON.stringify(form.manual_members)
  ]);

  // Поллинг активной подготовки
  useEffect(() => {
    if (!accessToken || !preparation?.id || !ACTIVE_PREPARATION_STATUSES.has(preparation.status)) {
      if (pollRef.current) {
        window.clearTimeout(pollRef.current);
        pollRef.current = null;
      }
      if (preparation?.status === 'ready' && step === 'prepare') {
        setStep('ready');
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
  }, [accessToken, preparation?.id, preparation?.status, step]);

  function setField(key, value) {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'sender_type') {
        if (!senderTypeUsesUserbot(value)) {
          next.delay_ms = 1500;
        } else if (Number(next.delay_ms || 0) < 5000) {
          next.delay_ms = 5000;
        }
      }
      return next;
    });
  }

  function togglePoolUserbot(id) {
    setForm((prev) => {
      const current = new Set((prev.sender_userbot_ids || []).map(String));
      if (current.has(String(id))) current.delete(String(id));
      else current.add(String(id));
      return { ...prev, sender_userbot_ids: Array.from(current) };
    });
    setPoolIds((prev) => {
      const current = new Set(prev.map(String));
      if (current.has(String(id))) current.delete(String(id));
      else current.add(String(id));
      return Array.from(current);
    });
  }

  function clearManualSelection() {
    window.localStorage.removeItem('broadcast_manual_selection');
    setForm((prev) => ({
      ...prev,
      audience_type: 'channel_audience_members',
      manual_tg_user_ids: [],
      manual_members: [],
      title: '',
      message_text: ''
    }));
  }

  async function startPreparation() {
    if (!isPreparable) {
      toast.error('Для этой аудитории подготовка не нужна — там пишет официальный бот.');
      return;
    }
    if (requiresBase && !form.base_id) {
      toast.error('Выбери базу.');
      return;
    }
    if (requiresClientBase && !form.base_id) {
      toast.error('Выбери базу клиентов.');
      return;
    }
    if (requiresManual && !(form.manual_tg_user_ids || []).length) {
      toast.error('Ручная выборка пустая.');
      return;
    }
    if (poolIds.length === 0) {
      toast.error('Выбери хотя бы одного юзербота.');
      return;
    }

    setPreparing(true);
    try {
      const externalTargets = externalTargetsText.split('\n').map((line) => line.trim()).filter(Boolean);
      const data = await apiRequest('/api/broadcast/preparations', {
        accessToken,
        method: 'POST',
        body: {
          audience_type: form.audience_type,
          base_id: form.base_id || null,
          base_filter: form.base_filter || 'all_members',
          manual_tg_user_ids: form.manual_tg_user_ids || [],
          manual_members: form.manual_members || [],
          userbot_ids: poolIds,
          external_targets: externalTargets
        }
      });
      setPreparation({ id: data.id, status: 'pending', phase_detail: {} });
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
      setStep('pool');
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
      toast.error(`На ${planRules.label} рассылки закрыты. Здесь можно собрать аудиторию и понять, кого будешь добивать после апгрейда на Normal.`);
      return;
    }
    if (!form.message_text.trim()) {
      toast.error('Без текста рассылка не поедет.');
      return;
    }
    if (requiresChannel && !form.channel_id) {
      toast.error('Выбери канал.');
      return;
    }
    if (requiresBase && !form.base_id) {
      toast.error('Выбери базу.');
      return;
    }
    if (requiresClientBase && !form.base_id) {
      toast.error('Выбери базу клиентов.');
      return;
    }
    if (requiresManual && !(form.manual_tg_user_ids || []).length) {
      toast.error('Ручная выборка пустая.');
      return;
    }
    if (usesUserbot && !usesPool && !form.sender_userbot_id && form.sender_type !== 'official_then_userbot_pool') {
      toast.error('Выбери юзербота.');
      return;
    }
    if (usesUserbot && usesPool && !(form.sender_userbot_ids || []).length) {
      toast.error('Выбери хотя бы одного юзербота в пул.');
      return;
    }
    if (usesUserbot) {
      const confirmed = window.confirm(
        'Запустить рискованную рассылку через юзерботов? Telegram может ограничить аккаунт, если аудитория холодная или sender не знает людей.'
      );
      if (!confirmed) return;
    }

    setSending(true);
    try {
      await apiRequest('/api/broadcast/send', {
        accessToken,
        method: 'POST',
        body: {
          title: form.title,
          audience_type: form.audience_type,
          channel_id: form.channel_id || null,
          base_id: form.base_id || null,
          base_filter: form.base_filter || 'all_members',
          manual_tg_user_ids: form.manual_tg_user_ids || [],
          manual_members: form.manual_members || [],
          sender_type: form.sender_type,
          sender_userbot_id: form.sender_userbot_id || null,
          sender_userbot_ids: form.sender_userbot_ids || [],
          delay_ms: Number(form.delay_ms || 0),
          message_text: form.message_text.trim(),
          preparation_id: preparation?.status === 'ready' ? preparation.id : undefined,
          manual_confirmed_userbot_risk: usesUserbot ? true : undefined
        }
      });
      toast.success('Рассылка ушла. Экран сам подтянет результат.');
      const campaigns = await apiRequest('/api/broadcast/campaigns', { accessToken });
      setState((prev) => ({
        ...prev,
        campaigns: campaigns.campaigns || [],
        failures: campaigns.failures || [],
        summary: campaigns.summary || {}
      }));
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSending(false);
    }
  }

  if (state.loading) {
    return <LoadingState text="Тянем боевую рассылку..." />;
  }

  const selectedPoolUserbots = state.userbots.filter((row) => poolIds.map(String).includes(String(row.id)));

  return (
    <section className="page page--flush space-y-6">
      <Card>
        <Section>
          <SectionTitle icon={Send}>Рассылки</SectionTitle>
          <p className="text-sm text-slate-500 font-medium max-w-2xl mb-4">
            Собери аудиторию, подготовь точки прикосновения через юзерботов и бей по базе, зная заранее, до кого достучишься.
          </p>
          <div className="flex flex-wrap items-center gap-2 mb-5">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-100 text-xs font-bold text-slate-600">
              <Users className="w-3.5 h-3.5" />
              {previewing ? 'Считаем аудиторию...' : `Под ударом: ${preview.count}`}
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-100 text-xs font-bold text-slate-600">
              <Bot className="w-3.5 h-3.5" />
              Пул: {selectedPoolUserbots.length} юзербот(ов)
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {STEPS.map((item) => {
              const disabled = (item.id === 'prepare' || item.id === 'ready') && !preparation;
              const active = step === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => setStep(item.id)}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors ${
                    active
                      ? 'bg-slate-900 !text-white'
                      : 'bg-white border border-slate-200 text-slate-600 hover:border-slate-300'
                  } disabled:opacity-40 disabled:cursor-not-allowed`}
                >
                  {item.label}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setStep('direct')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors ${
                step === 'direct'
                  ? 'bg-slate-900 !text-white'
                  : 'bg-white border border-slate-200 text-slate-600 hover:border-slate-300'
              }`}
            >
              Без подготовки
            </button>
          </div>
          <div className="mt-3 text-xs text-slate-400 font-medium">
            {step !== 'direct'
              ? (isPreparable
                  ? 'Мастер: база → пул юзерботов → подготовка → отправка.'
                  : 'Эта аудитория живет в подписках — официальный бот знает этих людей, подготовка не нужна.')
              : 'Старый путь: сразу форма отправки без матрицы достижимости.'}
          </div>
        </Section>
      </Card>

      {!planRules.canSendBroadcasts ? (
        <>
          <PlanBanner
            tone="warning"
            title="Trial: рассылки пока в режиме разведки"
            text="На Trial этот экран нужен, чтобы собрать аудиторию и понять, кого будешь дожимать. Сам выстрел откроется уже на Normal."
          />
          <UpgradeCallout
            title={trialUpgradeUrgent ? `Trial скоро сгорит: осталось около ${trialHoursLeft} ч` : undefined}
            text={trialUpgradeUrgent
              ? 'Если уже видишь живой хвост и готов добивать людей, не упирайся в trial-лимит до дедлайна. Переходи на Normal и запускай реальные рассылки.'
              : 'Если уже видишь живой хвост и понимаешь, что пора дожимать людей по-настоящему, переходи на Normal. Там этот экран становится боевым, а не просто разведкой.'}
          />
        </>
      ) : null}

      {state.error ? <ErrorNote>{state.error}</ErrorNote> : null}

      {step === 'audience' ? (
        <>
          <Card>
            <Section>
              <SectionTitle icon={Users}>Собери аудиторию</SectionTitle>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input className={inputCls} type="text" value={form.title} onChange={(e) => setField('title', e.target.value)} placeholder="Название кампании" />
                <select className={inputCls} value={form.audience_type} onChange={(e) => setField('audience_type', e.target.value)}>
                  {AUDIENCES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
                {requiresChannel ? (
                  <select className={inputCls} value={form.channel_id} onChange={(e) => setField('channel_id', e.target.value)}>
                    <option value="">Выбери канал</option>
                    {state.channels.map((row) => <option key={row.id} value={row.id}>{row.title}</option>)}
                  </select>
                ) : null}
                {requiresBase ? (
                  <>
                    <select className={inputCls} value={form.base_id} onChange={(e) => setField('base_id', e.target.value)}>
                      <option value="">Выбери базу</option>
                      {state.bases.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                    </select>
                    <select className={inputCls} value={form.base_filter} onChange={(e) => setField('base_filter', e.target.value)}>
                      <option value="all_members">Вся база</option>
                      <option value="partial_only">Есть только в части базы</option>
                      <option value="present_only">Только найденные сейчас</option>
                      <option value="missing_only">Только пропавшие</option>
                      <option value="multi_channel_only">Есть сразу в нескольких местах</option>
                    </select>
                  </>
                ) : null}
                {requiresClientBase ? (
                  <select className={inputCls} value={form.base_id} onChange={(e) => setField('base_id', e.target.value)}>
                    <option value="">Выбери базу клиентов</option>
                    {state.clientBases.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.name}{row.stats?.total ? ` • ${row.stats.total} чел.` : ''}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
              <div className="mt-3 text-sm text-slate-500 font-medium">{audienceHint(form.audience_type)}</div>
              {requiresManual ? (
                <div className="mt-4">
                  <button type="button" className={btnGhost} onClick={clearManualSelection}>Очистить ручную выборку</button>
                </div>
              ) : null}
              <div className="mt-5">
                <button type="button" className={btnPrimary} onClick={() => setStep(isPreparable ? 'pool' : 'direct')}>
                  Дальше
                </button>
              </div>
            </Section>
          </Card>

          <Card>
            <Section>
              <SectionTitle icon={ListChecks}>Кто сейчас попадет под удар</SectionTitle>
              {!preview.rows.length ? (
                <EmptyNote>Тут пока пусто. Или аудитория нулевая, или надо выбрать канал/базу.</EmptyNote>
              ) : (
                <TableShell>
                  <thead>
                    <tr>
                      <Th>Клиент</Th>
                      <Th>Канал</Th>
                      <Th>Сегмент</Th>
                      <Th>Источник</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row) => (
                      <Tr key={`${row.tg_user_id}-${row.channel_id || 'global'}`}>
                        <Td>
                          <div className="text-sm font-bold text-slate-900">{previewClientLabel(row)}</div>
                          <div className="text-xs text-slate-500 font-mono">{row.tg_user_id}</div>
                        </Td>
                        <Td><div className="text-sm font-medium text-slate-700">{row.channel_title}</div></Td>
                        <Td><div className="text-xs font-black uppercase tracking-wider text-slate-500">{row.segment_label || (row.is_trial ? 'Пробник' : 'Обычный')}</div></Td>
                        <Td><div className="text-xs text-slate-500 font-mono">{row.source_type}</div></Td>
                      </Tr>
                    ))}
                  </tbody>
                </TableShell>
              )}
            </Section>
          </Card>
        </>
      ) : null}

      {step === 'pool' ? (
        <>
          <Card>
            <Section>
              <SectionTitle icon={Bot}>Пул юзерботов</SectionTitle>
              <div className="text-sm text-slate-500 font-medium mb-4">
                Выбери, от чьего имени будем готовить точки прикосновения. Safe-mode и сдохшие прокси не попадут в подготовку.
              </div>
              {state.userbots.length === 0 ? (
                <EmptyNote>Нет живых юзерботов. Подключи аккаунты на /app/userbots.</EmptyNote>
              ) : (
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
                            {safeMode ? <StatusBadge tone="warning">safe-mode: активируй вручную</StatusBadge> : null}
                            {deadProxy ? <StatusBadge tone="danger">прокси сдох</StatusBadge> : null}
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
              )}
              <div className="mt-5">
                <button
                  type="button"
                  className={btnPrimary}
                  disabled={preparing || poolIds.length === 0}
                  onClick={startPreparation}
                >
                  {preparing ? <><Loader2 className="w-4 h-4 animate-spin" /> Запускаем...</> : 'Подготовиться к рассылке'}
                </button>
              </div>
            </Section>
          </Card>

          {state.flags.auto_join_enabled ? (
            <ExternalTargetsField value={externalTargetsText} onChange={setExternalTargetsText} disabled={preparing} />
          ) : (
            <Card>
              <Section>
                <SectionTitle icon={Radar}>Сторонние группы</SectionTitle>
                <EmptyNote>
                  Автовступление выключено (USERBOT_AUTO_JOIN_ENABLED). Подготовка посчитает точки по текущим чатам и диалогам юзерботов.
                </EmptyNote>
              </Section>
            </Card>
          )}
        </>
      ) : null}

      {step === 'prepare' ? (
        preparation ? (
          <PreparationRunner preparation={preparation} onCancel={cancelPreparation} />
        ) : (
          <Card>
            <Section>
              <EmptyNote>Активной подготовки нет. Вернись к пулу юзерботов и запусти.</EmptyNote>
            </Section>
          </Card>
        )
      ) : null}

      {step === 'ready' ? (
        preparation?.status === 'ready' ? (
          <ReadinessDashboard
            accessToken={accessToken}
            preparation={preparation}
            userbots={state.userbots}
            onRecheck={recheckPreparation}
            onAddGroups={addJoinTargets}
            busy={sending}
          />
        ) : preparation ? (
          <PreparationRunner preparation={preparation} onCancel={cancelPreparation} />
        ) : (
          <Card>
            <Section>
              <EmptyNote>Сначала прогони подготовку.</EmptyNote>
            </Section>
          </Card>
        )
      ) : null}

      {(step === 'ready' || step === 'direct') ? (
        <>
          <Card>
            <Section>
              <SectionTitle icon={MessageSquare}>Сообщение</SectionTitle>
              <textarea
                className="w-full px-4 py-3 rounded-xl bg-white border border-slate-200 text-sm font-medium text-slate-900 focus:outline-none focus:border-slate-400 shadow-sm transition resize-none min-h-[160px]"
                rows="8"
                value={form.message_text}
                onChange={(e) => setField('message_text', e.target.value)}
                placeholder="Пиши как будто реально хочешь вернуть человека или дотащить его до оплаты."
              />
            </Section>
          </Card>

          <Card>
            <Section>
              <SectionTitle icon={Bot}>Кто пишет людям</SectionTitle>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <select className={inputCls} value={form.sender_type} onChange={(e) => setField('sender_type', e.target.value)}>
                  <option value="official_only">Только официальный бот</option>
                  <option value="official_then_userbot_pool">Официальный бот, если не пробьет — пул юзерботов</option>
                  <option value="userbot_pool_round_robin">Пул юзерботов по кругу</option>
                  <option value="userbot_only">Только один выбранный юзербот</option>
                </select>
                {!usesPool && usesUserbot ? (
                  <select className={inputCls} value={form.sender_userbot_id} onChange={(e) => setField('sender_userbot_id', e.target.value)}>
                    <option value="">Выбери юзербота</option>
                    {state.userbots.map((row) => (
                      <option key={row.id} value={row.id}>
                        @{row.tg_username || row.tg_account_id}{row.proxies?.last_check_country ? ` • ${row.proxies.last_check_country}` : ''}
                      </option>
                    ))}
                  </select>
                ) : null}
                <input
                  className={inputCls}
                  type="number"
                  min={usesUserbot ? '5000' : '0'}
                  max="30000"
                  step="250"
                  value={form.delay_ms}
                  onChange={(e) => setField('delay_ms', e.target.value)}
                  placeholder="Пауза, мс"
                />
              </div>
              {usesPool ? (
                <div className="space-y-2 mt-4">
                  {state.userbots.map((row) => {
                    const checked = (form.sender_userbot_ids || []).map(String).includes(String(row.id));
                    return (
                      <label
                        key={row.id}
                        className={`flex items-center justify-between gap-3 p-4 rounded-2xl border transition-all cursor-pointer ${
                          checked ? 'border-slate-900 bg-slate-50' : 'border-slate-200 bg-white hover:border-slate-300'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-black text-slate-900 truncate">@{row.tg_username || row.tg_account_id}</div>
                          <div className="text-xs text-slate-500 font-medium mt-0.5">
                            {row.proxies?.host ? `${row.proxies.host}:${row.proxies.port}` : 'Прокси не найден'}
                            {row.proxies?.last_check_country ? ` • ${row.proxies.last_check_country}` : ''}
                          </div>
                        </div>
                        <input
                          type="checkbox"
                          className="w-4 h-4 accent-slate-900 shrink-0"
                          checked={checked}
                          onChange={() => togglePoolUserbot(row.id)}
                        />
                      </label>
                    );
                  })}
                </div>
              ) : null}
              <div className="mt-4 text-xs text-slate-400 font-medium">
                Safe-first: по умолчанию шлет официальный бот. Юзербот-режимы — для ручного дожима теплого хвоста.
              </div>
              {usesUserbot ? (
                <div className="mt-3 p-4 rounded-2xl bg-amber-50/60 border border-amber-200 text-sm text-amber-800 font-medium">
                  Рискованный режим: Telegram может ограничить sender-аккаунт. Пиши тем, кого юзербот уже знает или с кем в общем чате.
                </div>
              ) : null}
              {preparation?.status === 'ready' ? (
                <div className="mt-3 p-4 rounded-2xl bg-emerald-50/60 border border-emerald-200 text-sm text-emerald-800 font-medium">
                  Всё готово к рассылке: отправка пойдет по матрице достижимости, каждому — через юзербота, который его знает.
                </div>
              ) : null}
              <div className="mt-5">
                <button type="button" className={btnPrimary} onClick={sendCampaign} disabled={sending || preview.count === 0}>
                  {sending ? <><Loader2 className="w-4 h-4 animate-spin" /> Шлем...</> : !planRules.canSendBroadcasts ? 'Нужен Normal' : 'Пульнуть рассылку'}
                </button>
              </div>
            </Section>
          </Card>
        </>
      ) : null}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatTile label="Всего кампаний" value={state.summary.totalCampaigns || 0} hint="Все рассылки по текущему владельцу." />
        <StatTile label="Ушли нормально" value={state.summary.sentCampaigns || 0} hint="Кампании без ошибок." tone="ok" />
        <StatTile label="С косяками" value={state.summary.partialCampaigns || 0} hint="Есть хвост недоставки." tone={(state.summary.partialCampaigns || 0) > 0 ? 'warning' : 'default'} />
        <StatTile label="Сообщений дошло" value={state.summary.totalSent || 0} hint="Суммарная доставка." />
        <StatTile label="Не достучались" value={state.summary.totalFailed || 0} hint="Главный хвост на ручную добивку." tone={(state.summary.totalFailed || 0) > 0 ? 'danger' : 'default'} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card>
          <Section>
            <SectionTitle icon={ListChecks}>Последние рассылки</SectionTitle>
            {state.campaigns.length === 0 ? (
              <EmptyNote>Рассылок еще не было.</EmptyNote>
            ) : (
              <TableShell>
                <thead>
                  <tr>
                    <Th>Дата</Th>
                    <Th>Название</Th>
                    <Th>Аудитория</Th>
                    <Th>Кто слал</Th>
                    <Th>Статус</Th>
                  </tr>
                </thead>
                <tbody>
                  {state.campaigns.slice(0, 20).map((campaign) => (
                    <Tr key={campaign.id}>
                      <Td><div className="text-xs text-slate-500 font-medium whitespace-nowrap">{formatWhen(campaign.created_at)}</div></Td>
                      <Td><div className="text-sm font-bold text-slate-900">{campaign.title}</div></Td>
                      <Td><div className="text-xs text-slate-500 font-mono">{campaign.audience_type}</div></Td>
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
          </Section>
        </Card>

        <Card>
          <Section>
            <SectionTitle icon={MessageSquare}>Куда не пробились</SectionTitle>
            {state.failures.length === 0 ? (
              <EmptyNote>По последним кампаниям фейлов не видно.</EmptyNote>
            ) : (
              <TableShell>
                <thead>
                  <tr>
                    <Th>Дата</Th>
                    <Th>TG ID</Th>
                    <Th>Кампания</Th>
                    <Th>Ошибка</Th>
                  </tr>
                </thead>
                <tbody>
                  {state.failures.slice(0, 20).map((row) => (
                    <Tr key={row.id}>
                      <Td><div className="text-xs text-slate-500 font-medium whitespace-nowrap">{formatWhen(row.created_at)}</div></Td>
                      <Td><div className="text-xs text-slate-600 font-mono">{row.tg_user_id}</div></Td>
                      <Td><div className="text-xs text-slate-400 font-mono">{row.campaign_id?.slice(0, 8)}</div></Td>
                      <Td><div className="text-xs text-rose-600 font-medium">{row.error_text || 'Без текста ошибки'}</div></Td>
                    </Tr>
                  ))}
                </tbody>
              </TableShell>
            )}
          </Section>
        </Card>
      </div>
    </section>
  );
}
