import { AlertTriangle, CheckCircle2, KeyRound, Link2, Loader2, MessageSquare, Radio, ShieldCheck } from 'lucide-react';

function normalizeStatusKey(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
}

function isAdminStatusOk(value) {
  return ['administrator', 'creator', 'owner', 'admin'].includes(normalizeStatusKey(value));
}

function formatAdminStatus(value) {
  const normalized = normalizeStatusKey(value);
  if (!normalized) return 'неизвестно';
  if (['administrator', 'admin'].includes(normalized)) return 'админ';
  if (['creator', 'owner'].includes(normalized)) return 'владелец';
  return String(value || '').trim();
}

function formatPermissionValue(value) {
  if (value === true) return 'да';
  if (value === false) return 'нет';
  return 'неизвестно';
}

function formatCheckedAt(value) {
  if (!value) return 'не обновляли';
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function formatVisibility(option) {
  if (option?.visibility === 'public') return option.username ? `Публичная @${option.username}` : 'Публичная';
  if (option?.visibility === 'private') return 'Приватная';
  return 'Публичность не проверена';
}

function getRoleConfigs() {
  return [
    {
      key: 'public_channel',
      title: 'Открытый',
      subtitle: 'Канал-витрина',
      field: 'publicChannelId',
      oppositeField: 'paidChannelId',
      empty: 'Нет каналов',
      icon: Radio,
      required: false
    },
    {
      key: 'public_chat',
      title: 'Публичный чат',
      subtitle: 'Открытое общение',
      field: 'publicChatId',
      oppositeField: 'paidChatId',
      empty: 'Нет чатов',
      icon: MessageSquare,
      required: false
    },
    {
      key: 'paid_channel',
      title: 'Закрытый канал',
      subtitle: 'Доступ по тарифу',
      field: 'paidChannelId',
      oppositeField: 'publicChannelId',
      empty: 'Нет каналов',
      icon: Link2,
      required: false
    },
    {
      key: 'paid_chat',
      title: 'Закрытый чат',
      subtitle: 'Чат для участников',
      field: 'paidChatId',
      oppositeField: 'publicChatId',
      empty: 'Нет чатов',
      icon: MessageSquare,
      required: false
    }
  ];
}

function optionsForRole(config, props) {
  if (config.key === 'public_channel') return props.publicChannelOptions || [];
  if (config.key === 'public_chat') return props.publicChatOptions || [];
  if (config.key === 'paid_channel') return props.paidChannelOptions || [];
  if (config.key === 'paid_chat') return props.paidChatOptions || [];
  return [];
}

function rightsSummary(result, selectedId) {
  if (!selectedId) {
    return {
      tone: 'muted',
      title: 'Не выбрано',
      text: 'Сначала выберите площадку'
    };
  }

  if (!result) {
    return {
      tone: 'muted',
      title: 'Не проверено',
      text: 'Нажмите "Обновить права"'
    };
  }

  if (result.status === 'error') {
    return {
      tone: 'error',
      title: 'Ошибка',
      text: result.message || 'Telegram не ответил'
    };
  }

  const adminOk = isAdminStatusOk(result.adminStatus);
  const canInvite = result.canInviteUsers !== false;
  const canManage = result.canManageChat !== false;
  const canPromote = result.canPromoteMembers !== false;
  const isOk = adminOk && canInvite && canManage && canPromote;

  if (isOk) {
    return {
      tone: 'ok',
      title: 'Права в порядке',
      text: `Обновлено: ${formatCheckedAt(result.checkedAt)}`
    };
  }

  return {
    tone: 'warning',
    title: 'Не хватает прав',
    text: result.message || `Обновлено: ${formatCheckedAt(result.checkedAt)}`
  };
}

function RightsDetails({ result }) {
  if (!result) return null;

  const adminOk = isAdminStatusOk(result.adminStatus);
  const pillClass = 'inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-bold';
  const rights = [
    ['Админ', adminOk],
    ['Приглашать', result.canInviteUsers],
    ['Удалять', result.canRestrictMembers],
    ['Назначать админов', result.canPromoteMembers],
    ['Управлять', result.canManageChat]
  ];

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-1.5">
        {rights.map(([label, value]) => {
          const ok = value === true;
          const bad = value === false;
          return (
            <span key={label} className={`${pillClass} ${
              ok
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : bad
                  ? 'border-amber-200 bg-amber-50 text-amber-800'
                  : 'border-slate-200 bg-white text-slate-500'
            }`}>
              {ok ? <CheckCircle2 className="size-3" /> : <AlertTriangle className="size-3" />}
              {label}: {formatPermissionValue(value)}
            </span>
          );
        })}
      </div>
      <p className="text-xs font-medium text-slate-500">
        Статус Telegram: {formatAdminStatus(result.adminStatus)} · Обновлено: {formatCheckedAt(result.checkedAt)}
      </p>
      {result.warnings?.length ? (
        <p className="text-xs font-medium leading-snug text-amber-700">{result.warnings[0]}</p>
      ) : null}
    </div>
  );
}

function RoleCard({
  config,
  options,
  draft,
  setFieldValue,
  savingContour,
  checkBotRights,
  checking,
  rightsResult
}) {
  const Icon = config.icon;
  const selectedId = String(draft[config.field] || '');
  const selectedOption = options.find((option) => String(option.id) === selectedId);
  const summary = rightsSummary(rightsResult, selectedId);
  const toneClass = summary.tone === 'ok'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : summary.tone === 'warning'
      ? 'border-amber-200 bg-amber-50 text-amber-800'
      : summary.tone === 'error'
        ? 'border-rose-200 bg-rose-50 text-rose-700'
        : 'border-slate-200 bg-white text-slate-500';

  function selectRole(value) {
    if (config.oppositeField && value && String(draft[config.oppositeField] || '') === String(value)) {
      setFieldValue(config.field, value, {
        autoSave: true,
        oppositeField: config.oppositeField
      });
      return;
    }
    setFieldValue(config.field, value, { autoSave: true });
  }

  return (
    <article className="flex min-h-[248px] flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
            <Icon className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-sm font-black text-slate-900">{config.title}</h4>
              {config.required ? (
                <span className="rounded-md bg-rose-50 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-rose-600">обязательно</span>
              ) : null}
            </div>
            <p className="mt-0.5 text-xs font-medium text-slate-500">{config.subtitle}</p>
          </div>
        </div>
      </div>

      <label className="grid gap-2">
        <span className="text-xs font-black uppercase tracking-wider text-slate-400">Площадка</span>
        <select
          className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:bg-slate-50 disabled:text-slate-400"
          value={selectedId}
          onChange={(event) => selectRole(event.target.value)}
          disabled={!options.length || savingContour}
        >
          <option value="">{options.length ? 'Не выбрано' : config.empty}</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.title || option.label || option.tgChatId || option.id}
            </option>
          ))}
        </select>
      </label>

      <div className="mt-3 min-h-[40px] text-xs font-medium text-slate-500">
        {selectedOption ? (
          <span>{formatVisibility(selectedOption)}</span>
        ) : (
          <span>Выберите площадку из списка, который видит official-бот.</span>
        )}
      </div>

      <div className={`mt-auto rounded-xl border px-3 py-2 ${toneClass}`}>
        <p className="text-sm font-black">{savingContour ? 'Сохраняем...' : summary.title}</p>
        <p className="mt-0.5 line-clamp-2 text-xs font-medium">
          {savingContour ? 'Изменение селектора сохраняется автоматически' : summary.text}
        </p>
      </div>

      <div className="mt-3 grid gap-2">
        <button
          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-slate-900 px-3 text-[13px] font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={() => checkBotRights(config.key)}
          disabled={!selectedId || checking}
        >
          {checking ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
          Обновить права
        </button>
      </div>

      {rightsResult ? (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <RightsDetails result={rightsResult} />
        </div>
      ) : null}
    </article>
  );
}

export function SalesContourSection({
  adminSlot,
  botRightsByTarget = {},
  checkBotRights,
  checkingBotRightsTarget = '',
  contourError,
  contourWarnings = [],
  draft,
  paidChannelOptions,
  paidChatOptions,
  publicChannelOptions,
  publicChatOptions,
  savingContour,
  setFieldValue
}) {
  const roleConfigs = getRoleConfigs();

  return (
    <div className="space-y-4">
      {contourError ? (
        <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
          <div>
            <p className="font-bold">Контурный endpoint ответил ошибкой</p>
            <p className="mt-0.5 text-amber-800/90">Площадки можно выбрать по локальным данным, но сохранять лучше после ответа backend.</p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-5">
        {roleConfigs.map((config) => (
          <RoleCard
            key={config.key}
            config={config}
            options={optionsForRole(config, {
              publicChannelOptions,
              publicChatOptions,
              paidChannelOptions,
              paidChatOptions
            })}
            draft={draft}
            setFieldValue={setFieldValue}
            savingContour={savingContour}
            checkBotRights={checkBotRights}
            checking={checkingBotRightsTarget === config.key}
            rightsResult={botRightsByTarget[config.key] || null}
          />
        ))}
        {adminSlot}
      </div>

      {contourWarnings.length ? (
        <div className="grid gap-2">
          {contourWarnings.map((warning) => (
            <div key={warning} className="flex gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[13px] font-medium text-slate-700">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
              <span>{warning}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
        <ShieldCheck className="mr-2 inline size-4 text-indigo-600" />
        Права хранятся в BullRun. Telegram дергаем только по кнопке "Обновить права".
      </div>
    </div>
  );
}
