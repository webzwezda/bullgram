import { AlertTriangle, CheckCircle2, KeyRound, Link2, Loader2, MessageSquare, Radio, ShieldCheck } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

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
            <Badge key={label} variant={ok ? 'default' : bad ? 'destructive' : 'secondary'} className={`text-[10px] uppercase font-bold py-0.5 px-2 ${ok ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100' : bad ? 'bg-amber-100 text-amber-800 hover:bg-amber-100' : 'bg-slate-100 text-slate-600 hover:bg-slate-100'}`}>
              {ok ? <CheckCircle2 className="w-3 h-3 mr-1" /> : <AlertTriangle className="w-3 h-3 mr-1" />}
              {label}
            </Badge>
          );
        })}
      </div>
      <p className="text-xs font-medium text-slate-500">
        Статус: {formatAdminStatus(result.adminStatus)} · Обновлено: {formatCheckedAt(result.checkedAt)}
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
        : 'border-slate-200 bg-slate-50 text-slate-500';

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
    <Card className="flex flex-col ring-slate-200/60 shadow-sm min-h-[280px]">
      <CardHeader className="pb-3 border-b border-slate-50/50 bg-slate-50/30">
        <div className="flex min-w-0 gap-3 items-center">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100/50">
            <Icon className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-sm font-bold text-slate-900">{config.title}</h4>
              {config.required ? (
                <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-rose-600">обязательно</span>
              ) : null}
            </div>
            <p className="text-xs text-slate-500">{config.subtitle}</p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col flex-1 pt-4 pb-4">
        <div className="grid gap-2">
          <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Площадка</label>
          <Select
            value={selectedId}
            onValueChange={selectRole}
            disabled={!options.length || savingContour}
          >
            <SelectTrigger className="data-[size=default]:h-10 w-full bg-white">
              <SelectValue placeholder={options.length ? 'Не выбрано' : config.empty} />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.id} value={String(option.id)}>
                  {option.title || option.label || option.tgChatId || option.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="mt-2 min-h-[32px] text-xs text-slate-500">
          {selectedOption ? (
            <span>{formatVisibility(selectedOption)}</span>
          ) : (
            <span className="opacity-70">Выберите площадку из списка</span>
          )}
        </div>

        <div className={`mt-auto rounded-xl border px-3 py-2.5 ${toneClass}`}>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full shrink-0 ${summary.tone === 'ok' ? 'bg-emerald-500' : summary.tone === 'warning' ? 'bg-amber-500' : summary.tone === 'error' ? 'bg-rose-500' : 'bg-slate-300'}`} />
            <p className="text-sm font-bold">{savingContour ? 'Сохраняем...' : summary.title}</p>
          </div>
          <p className="mt-1 line-clamp-2 text-[11px] font-medium leading-snug">
            {savingContour ? 'Изменение сохраняется...' : summary.text}
          </p>
        </div>

        <div className="mt-3">
          <Button
            className="w-full h-10 bg-slate-900 hover:bg-slate-800 text-white font-bold text-[13px]"
            onClick={() => checkBotRights(config.key)}
            disabled={!selectedId || checking}
          >
            {checking ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <KeyRound className="w-4 h-4 mr-2" />}
            Обновить права
          </Button>
        </div>

        {rightsResult ? (
          <div className="mt-4 pt-4 border-t border-slate-100">
            <RightsDetails result={rightsResult} />
          </div>
        ) : null}
      </CardContent>
    </Card>
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
    <div className="space-y-6">
      {contourError ? (
        <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-sm">
          <AlertTriangle className="mt-0.5 w-5 h-5 shrink-0 text-amber-500" />
          <div>
            <p className="font-bold">Контурный endpoint ответил ошибкой</p>
            <p className="mt-0.5 text-amber-800/90 text-xs">Площадки можно выбрать по локальным данным, но сохранять лучше после ответа backend.</p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
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
            <div key={warning} className="flex gap-3 items-center rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] font-medium text-amber-900">
              <AlertTriangle className="w-4 h-4 shrink-0 text-amber-500" />
              <span>{warning}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex items-center gap-2 rounded-xl border border-indigo-100 bg-indigo-50/50 px-4 py-3 text-sm text-indigo-800">
        <ShieldCheck className="w-5 h-5 text-indigo-500 shrink-0" />
        <span className="font-medium text-indigo-900">Права хранятся в Bullgram. Telegram дергаем только по кнопке "Обновить права".</span>
      </div>
    </div>
  );
}
