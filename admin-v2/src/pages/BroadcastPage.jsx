import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Check, Loader2 } from 'lucide-react';
import { apiRequest } from '../api/client.js';
import { fetchMessagingCapacity } from '../api/messaging.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { getProductTierRules } from '../app/productTier.js';
import { LoadingState } from '../ui/LoadingState.jsx';
import { Card, Section } from './broadcast/ui.jsx';
import { ACTIVE_PREPARATION_STATUSES } from './broadcast/utils/broadcastDraft.js';
import { useBroadcastPreparation } from './broadcast/hooks/useBroadcastPreparation.js';
import { useBroadcastBootstrap } from './broadcast/hooks/useBroadcastBootstrap.js';
import { StepBase } from './broadcast/sections/StepBase.jsx';
import { StepUserbots } from './broadcast/sections/StepUserbots.jsx';
import { StepSend } from './broadcast/sections/StepSend.jsx';

const STEPS = [
  { id: 'base', label: 'База' },
  { id: 'userbots', label: 'Юзерботы' },
  { id: 'prepare', label: 'Подготовка' },
  { id: 'send', label: 'Отправка' }
];

export function BroadcastPage() {
  const { accessToken, user, profilePlan } = useAuth();
  const navigate = useNavigate();
  const [state, setState] = useState({
    loading: true,
    error: '',
    clientBases: [],
    userbots: []
  });
  const [step, setStep] = useState('base');
  const [form, setForm] = useState({ title: '', base: '', message_text: '', leave_groups_on_complete: false });
  const [manual, setManual] = useState({ tg_user_ids: [], members: [] });
  const [selectedIds, setSelectedIds] = useState([]);
  const [poolIds, setPoolIds] = useState([]);
  const [sending, setSending] = useState(false);
  const [broadcastFlags, setBroadcastFlags] = useState({ userbot_broadcast_enabled: false });
  const [capacity, setCapacity] = useState(null);

  const planRules = useMemo(() => getProductTierRules(profilePlan), [profilePlan]);
  const broadcastEnabled = broadcastFlags.userbot_broadcast_enabled !== false;

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
  const {
    preparation,
    setPreparation,
    preparing,
    members,
    membersPage,
    setMembersPage,
    membersReloadKey,
    setMembersReloadKey,
    manualPayload,
    groupsText,
    setGroupsText,
    pendingGroups,
    addingGroups,
    startPreparation,
    cancelPreparation,
    recheckPreparation,
    submitGroups
  } = useBroadcastPreparation({
    accessToken,
    form,
    audienceType,
    apiBaseId,
    manual,
    selectedIds,
    clientSelectionActive,
    poolIds,
    baseSelected,
    setStep
  });

  useBroadcastBootstrap({
    accessToken,
    user,
    setState,
    setForm,
    setManual,
    setPoolIds,
    setPreparation,
    setBroadcastFlags
  });

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

  // Сколько контактов реально уйдёт в рассылку при текущем выборе. Не знаем (базы по каналам) — null.
  const audienceSize = clientSelectionActive
    ? selectedIds.length
    : form.base.startsWith('client:')
      ? members.total
      : form.base === 'manual'
        ? (manual.tg_user_ids || []).length
        : null;
  const poolKey = useMemo(() => [...poolIds].map(String).sort().join(','), [poolIds]);

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

  // Оценка темпа: потянет ли пул юзерботов эту базу. Обновляем с дебаунсом,
  // пока виден шаг «Юзерботы» и размер аудитории известен; не получили — блок просто не показываем.
  useEffect(() => {
    if (step !== 'userbots' || !accessToken || !audienceSize) {
      setCapacity(null);
      return undefined;
    }
    let cancelled = false;
    setCapacity(null);
    const timer = window.setTimeout(() => {
      fetchMessagingCapacity(accessToken, audienceSize)
        .then((data) => {
          if (!cancelled) setCapacity(data);
        })
        .catch(() => {
          if (!cancelled) setCapacity(null);
        });
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [step, accessToken, audienceSize, poolKey]);

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

  function applyTemplate(template) {
    setField('message_text', template.text);
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
    if (!form.title.trim()) {
      toast.error('Введи название рассылки.');
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
    const prepStats = preparation.stats || {};
    const reachableCount = (prepStats.confirmed || 0) + (prepStats.probable || 0);
    const confirmed = window.confirm(
      `Допишемся по ЛС: ${reachableCount} получателей. Рассылка пойдёт от выбранных юзерботов. Telegram может ограничить аккаунты, если получатели на них жалуются. Запускаем?`
    );
    if (!confirmed) return;

    setSending(true);
    try {
      const data = await apiRequest('/api/broadcast/send', {
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
          manual_confirmed_userbot_risk: true,
          leave_groups_on_complete: form.leave_groups_on_complete === true
        }
      });
      const queuedCount = Number(data.queued_count);
      toast.success(
        Number.isFinite(queuedCount)
          ? `Рассылка поставлена в очередь: ${queuedCount} получателей`
          : 'Рассылка поставлена в очередь'
      );
      navigate(data.campaign?.id ? `/broadcast/history?campaign=${encodeURIComponent(data.campaign.id)}` : '/broadcast/history');
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
  const titleEmpty = !form.title.trim();
  const preparationBlocking = !preparation
    ? 'Сначала прогони подготовку.'
    : ACTIVE_PREPARATION_STATUSES.has(preparation.status)
      ? 'Подготовка ещё идёт — вернись на шаг 3.'
      : preparation.status !== 'ready'
        ? 'Подготовка не завершена — вернись на шаг 3.'
        : !selectionMatchesPreparation
          ? 'База или юзерботы изменились — запусти подготовку заново.'
          : '';
  const sendDisabled = sending || titleEmpty || messageEmpty || !baseSelected || poolIds.length === 0
    || !planRules.canSendBroadcasts
    || !broadcastEnabled
    || Boolean(preparationBlocking);
  const stepIndex = STEPS.findIndex((item) => item.id === step);
  let nextAction = null;
  if (step === 'base') {
    nextAction = { label: 'Дальше — Юзерботы', onClick: () => setStep('userbots'), disabled: !baseSelected || titleEmpty };
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
              const locked = (i > 0 && titleEmpty) || ((item.id === 'prepare' || item.id === 'send') && !selectionMatchesPreparation);
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
                          : 'bg-white border border-slate-200 text-slate-500'
                      } ${current ? 'ring-4 ring-indigo-100' : ''} ${locked && !current ? 'opacity-40' : ''}`}
                    >
                      {done ? <Check className="w-4 h-4" /> : i + 1}
                    </span>
                    <span className={`text-[11px] font-bold whitespace-nowrap ${current ? 'text-indigo-700' : done ? 'text-slate-600' : 'text-slate-500'}`}>
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

      <StepBase
        step={step}
        form={form}
        setField={setField}
        titleEmpty={titleEmpty}
        baseOptions={baseOptions}
        baseSelected={baseSelected}
        state={state}
        manual={manual}
        members={members}
        clientSelectionActive={clientSelectionActive}
        selectedIds={selectedIds}
        setSelectedIds={setSelectedIds}
        visibleMemberIds={visibleMemberIds}
        toggleAllVisibleRecipients={toggleAllVisibleRecipients}
        toggleRecipient={toggleRecipient}
        membersPage={membersPage}
        setMembersPage={setMembersPage}
        setMembersReloadKey={setMembersReloadKey}
        broadcastEnabled={broadcastEnabled}
        planRules={planRules}
      />

      <StepUserbots
        step={step}
        state={state}
        poolIds={poolIds}
        setPoolIds={setPoolIds}
        eligibleUserbots={eligibleUserbots}
        allSelected={allSelected}
        togglePoolUserbot={togglePoolUserbot}
        capacity={capacity}
        audienceSize={audienceSize}
        preparation={preparation}
        selectionMatchesPreparation={selectionMatchesPreparation}
      />

      <StepSend
        step={step}
        preparation={preparation}
        selectionMatchesPreparation={selectionMatchesPreparation}
        groupsText={groupsText}
        setGroupsText={setGroupsText}
        pendingGroups={pendingGroups}
        addingGroups={addingGroups}
        submitGroups={submitGroups}
        cancelPreparation={cancelPreparation}
        recheckPreparation={recheckPreparation}
        sending={sending}
        accessToken={accessToken}
        applyTemplate={applyTemplate}
        form={form}
        setField={setField}
        preparationBlocking={preparationBlocking}
        broadcastEnabled={broadcastEnabled}
        titleEmpty={titleEmpty}
        messageEmpty={messageEmpty}
        sendDisabled={sendDisabled}
        planRules={planRules}
        setStep={setStep}
      />
      {nextAction ? (
        <>
          <button
            type="button"
            disabled={nextAction.disabled}
            onClick={nextAction.onClick}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-3.5 rounded-2xl bg-indigo-600 !text-white text-sm font-black hover:bg-indigo-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {nextAction.busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Запускаем...</> : nextAction.label}
          </button>
          {nextAction.disabled && step === 'base' ? (
            <p className="text-xs text-slate-500 font-medium text-center">Выбери базу и укажи название — кнопка разблокируется.</p>
          ) : null}
        </>
      ) : null}

    </section>
  );
}
