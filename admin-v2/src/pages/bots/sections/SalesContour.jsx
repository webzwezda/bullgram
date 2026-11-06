import { Radio, MessageSquare, MessagesSquare, Lock, Link2, AlertTriangle, Loader2, RefreshCw, ShieldCheck, Trash2, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';

function normalizeStatusKey(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
}

function isAdminStatusOk(value) {
  return ['administrator', 'creator', 'owner', 'admin'].includes(normalizeStatusKey(value));
}

function permissionPillClass(value) {
  if (value === true) return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (value === false) return 'border-rose-200 bg-rose-50 text-rose-700';
  return 'border-slate-200 bg-slate-50 text-slate-500';
}

function rightsSummary(result, selectedId) {
  if (!selectedId) return { tone: 'muted', title: 'Не выбрано', text: '' };
  if (!result) return { tone: 'muted', title: 'Не проверено', text: '' };
  if (result.status === 'error') return { tone: 'error', title: 'Ошибка', text: result.message || '' };

  const adminOk = isAdminStatusOk(result.adminStatus);
  const canInvite = result.canInviteUsers !== false;
  const canManage = result.canManageChat !== false;
  const canPromote = result.canPromoteMembers !== false;
  const isOk = adminOk && canInvite && canManage && canPromote;

  if (isOk) return { tone: 'ok', title: 'Права настроены', text: '' };
  return { tone: 'warning', title: 'Есть ограничения', text: result.message || '' };
}

function RightsBadges({ result, selectedId, hasOptions }) {
  if (!selectedId) {
    if (!hasOptions) {
      return (
        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100/50 px-2.5 py-1 text-xs font-bold text-slate-500 shadow-sm">
          Площадок пока нет. Добавьте бота администратором в канал или чат — площадка появится в списке.
        </div>
      );
    }
    return (
      <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100/50 px-2.5 py-1 text-xs font-bold text-slate-500 shadow-sm">
        Укажите площадку, чтобы проверить права бота.
      </div>
    );
  }

  if (!result) {
    return (
      <div className="text-[11px] text-slate-500 italic">
        Права ещё не проверялись — нажмите «Проверить права».
      </div>
    );
  }

  if (result.status === 'error') {
    return (
      <div className="text-[11px] text-rose-600 font-bold flex items-center gap-1.5">
        <AlertTriangle className="w-3 h-3" />
        Не удалось проверить права{result.message ? `: ${result.message}` : ''}
      </div>
    );
  }

  const adminOk = isAdminStatusOk(result.adminStatus);
  const rights = [
    { label: 'Админ', value: adminOk },
    { label: 'Приглашать', value: result.canInviteUsers },
    { label: 'Удалять', value: result.canRestrictMembers },
    { label: 'Назначать', value: result.canPromoteMembers },
    { label: 'Управлять', value: result.canManageChat }
  ];

  const okCount = rights.filter((r) => r.value === true).length;
  const problemRights = rights.filter((r) => r.value !== true);

  if (problemRights.length === 0) {
    return (
      <div className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500">
        <CheckCircle2 className="w-3 h-3 text-emerald-500" />
        Все права настроены
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {problemRights.map(({ label, value }) => (
        <span key={label} className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold shadow-sm ${permissionPillClass(value)}`}>
          {value === false ? <AlertTriangle className="w-3 h-3" /> : <span className="w-1.5 h-1.5 rounded-full bg-current opacity-40 ml-0.5" />}
          {label}
        </span>
      ))}
      {okCount > 0 ? (
        <span className="text-[10px] font-medium text-slate-500 ml-1">+ {okCount} ок</span>
      ) : null}
      {result?.warnings?.length ? (
        <span className="basis-full text-xs font-bold text-rose-600 mt-1">{result.warnings[0]}</span>
      ) : null}
    </div>
  );
}

const ROLE_CONFIGS = [
  {
    key: 'public_channel',
    title: 'Открытый канал',
    description: 'Анонсы и привлечение аудитории',
    field: 'publicChannelId',
    oppositeField: 'paidChannelId',
    group: 'channel',
    icon: Radio
  },
  {
    key: 'public_chat',
    title: 'Открытый чат',
    description: 'Открытое обсуждение для всех',
    field: 'publicChatId',
    oppositeField: 'paidChatId',
    group: 'chat',
    icon: MessageSquare
  },
  {
    key: 'paid_channel',
    title: 'Закрытый канал',
    description: 'Платный доступ по подписке',
    field: 'paidChannelId',
    oppositeField: 'publicChannelId',
    group: 'channel',
    icon: Lock
  },
  {
    key: 'paid_chat',
    title: 'Закрытый чат',
    description: 'Только для платных подписчиков',
    field: 'paidChatId',
    oppositeField: 'publicChatId',
    group: 'chat',
    icon: MessagesSquare
  }
];

function optionsForRole(config, props) {
  if (config.key === 'public_channel') return props.publicChannelOptions || [];
  if (config.key === 'public_chat') return props.publicChatOptions || [];
  if (config.key === 'paid_channel') return props.paidChannelOptions || [];
  if (config.key === 'paid_chat') return props.paidChatOptions || [];
  return [];
}

function SalesContourBlock({
  draft,
  setFieldValue,
  savingContour,
  botRightsByTarget,
  contourError,
  ensureAdminRights,
  ensureAdminPending,
  refreshContourInfo,
  contourInfoPending,
  targets,
  deleteTelegramPlace
}) {
  return (
    <div className="bg-slate-50/50 pb-5">
      {contourError ? (
        <div className="mx-5 sm:mx-6 mb-4 mt-4 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-sm">
          <AlertTriangle className="mt-0.5 w-5 h-5 shrink-0 text-amber-500" />
          <div>
            <p className="font-bold">Ошибка сохранения контура</p>
            <p className="mt-0.5 text-amber-800/90 text-sm font-medium">Площадки можно выбрать, но сохранять лучше после ответа сервера.</p>
          </div>
        </div>
      ) : null}

      <div className="px-5 sm:px-6 pt-5 pb-2 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center shrink-0">
              <Link2 className="w-4 h-4 text-indigo-600" />
            </div>
            <div className="text-base font-bold text-slate-900">Привязка площадок</div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              onClick={() => refreshContourInfo?.()}
              disabled={contourInfoPending || ensureAdminPending}
              title="Обновит данные площадок из Telegram и перепроверит права бота"
              className="h-9 px-3 text-xs rounded-xl bg-surface-card border-border-default shadow-sm font-bold text-ink-body hover:bg-surface-subtle shrink-0"
            >
              {contourInfoPending ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5 mr-1.5 text-ink-faint" />
              )}
              {contourInfoPending ? 'Обновляю…' : 'Обновить информацию'}
            </Button>
            <Button
              variant="outline"
              onClick={() => ensureAdminRights?.()}
              disabled={ensureAdminPending || contourInfoPending}
              title="Проверит и выдаст права админа боту и юзерботам во всех площадках контура"
              className="h-9 px-3 text-xs rounded-xl bg-surface-card border-border-default shadow-sm font-bold text-ink-body hover:bg-surface-subtle shrink-0"
            >
              {ensureAdminPending ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : (
                <ShieldCheck className="w-3.5 h-3.5 mr-1.5 text-ink-faint" />
              )}
              {ensureAdminPending ? 'Выдаю максимум прав…' : 'Выдать максимум прав'}
            </Button>
          </div>
        </div>

        <div className="[display:grid] grid-cols-1 sm:grid-cols-2 gap-3 items-stretch">
          {ROLE_CONFIGS.map((config) => (
            <ContourCard
              key={config.key}
              config={config}
              draft={draft}
              setFieldValue={setFieldValue}
              savingContour={savingContour}
              botRightsByTarget={botRightsByTarget}
              targets={targets}
              deleteTelegramPlace={deleteTelegramPlace}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ContourCard({
  config,
  draft,
  setFieldValue,
  savingContour,
  botRightsByTarget,
  targets,
  deleteTelegramPlace
}) {
  const Icon = config.icon;
  const options = optionsForRole(config, draft._props || {});
  const selectedId = String(draft[config.field] || '');
  const selectedOption = options.find((o) => String(o.id) === selectedId);
  const selectedTarget = (targets || []).find((t) => String(t.id) === selectedId) || null;
  const connected = !!selectedId;
  const rights = botRightsByTarget[config.key] || null;
  const summary = rightsSummary(rights, selectedId);

  async function copyToClipboard(text, label) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} скопирован: ${text}`);
    } catch (err) {
      toast.error('Не удалось скопировать');
    }
  }

  return (
    <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col h-full gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-all ${
            connected ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 text-slate-500'
          }`}>
            <Icon className="w-4.5 h-4.5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="font-bold text-sm text-slate-900 truncate">{config.title}</h4>
            </div>
            <p className="text-xs text-slate-500 font-medium mt-0.5 line-clamp-1">{config.description}</p>
          </div>
        </div>
        {connected ? (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1 animate-pulse" />
            Подключен
          </span>
        ) : options.length ? (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-50 text-slate-500 border border-slate-200 shrink-0">
            Не выбрано
          </span>
        ) : (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-50 text-slate-500 border border-slate-200 shrink-0">
            Нет площадки
          </span>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1 min-w-0">
          <Select
            value={selectedId}
            onValueChange={(value) => {
              if (config.oppositeField && value && String(draft[config.oppositeField] || '') === String(value)) {
                setFieldValue(config.field, value, { autoSave: true, oppositeField: config.oppositeField })
                  .catch((error) => console.error('Failed to save contour:', error));
              } else {
                setFieldValue(config.field, value, { autoSave: true })
                  .catch((error) => console.error('Failed to save contour:', error));
              }
            }}
            disabled={!options.length}
          >
            <SelectTrigger className="data-[size=default]:h-9 w-full bg-white rounded-xl border-slate-200 shadow-sm focus:ring-indigo-500">
              <SelectValue placeholder={options.length ? 'Выберите площадку' : 'Нет доступных площадок'} />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              {options.map((option) => (
                <SelectItem key={option.id} value={String(option.id)} className="rounded-lg py-2">
                  {option.title || option.tgChatId || option.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {selectedTarget ? (
            <button
              type="button"
              title="Удалить площадку из Bullgram"
              onClick={() => deleteTelegramPlace?.(selectedTarget)}
              className="inline-flex items-center justify-center w-9 h-9 rounded-xl border border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100 shadow-sm transition-colors shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      {(() => {
        const expectedVisibility = config.key.startsWith('public_') ? 'public' : 'private';
        const actualVisibility = selectedOption?.visibility;
        if (selectedOption && actualVisibility && actualVisibility !== 'unknown' && actualVisibility !== expectedVisibility) {
          const becameLabel = actualVisibility === 'public' ? 'публичным' : 'приватным';
          return (
            <div className="flex items-start gap-2 text-xs font-bold text-amber-700 bg-amber-50 p-2.5 rounded-xl border border-amber-200">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>Канал стал {becameLabel} — нажми «Обновить информацию», и площадка переедет в правильный слот.</span>
            </div>
          );
        }
        return null;
      })()}

      {selectedOption && (selectedOption.tgChatId || selectedOption.username) ? (
        <div className="flex items-center gap-1.5 flex-wrap">
          {selectedOption.tgChatId && (
            <button
              type="button"
              onClick={() => copyToClipboard(selectedOption.tgChatId, 'ID площадки')}
              title="Скопировать ID"
              className="font-mono text-[11px] text-slate-600 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200 transition-colors cursor-pointer"
            >
              {selectedOption.tgChatId}
            </button>
          )}
          {selectedOption.username && (
            <button
              type="button"
              onClick={() => copyToClipboard(`@${selectedOption.username}`, 'Username')}
              title="Скопировать @username"
              className="text-[11px] font-medium text-indigo-700 hover:text-indigo-900 bg-indigo-50 hover:bg-indigo-100 px-2 py-0.5 rounded-md border border-indigo-200 transition-colors cursor-pointer"
            >
              @{selectedOption.username}
            </button>
          )}
        </div>
      ) : null}

      <RightsBadges result={rights} selectedId={selectedId} hasOptions={options.length > 0} />

      {savingContour ? (
        <div className="flex items-center gap-2 text-xs font-bold text-indigo-600 bg-indigo-50/50 p-2 rounded-lg border border-indigo-100/50">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Синхронизация контура...
        </div>
      ) : null}

      {summary.text ? (
        <div className="text-xs font-bold text-slate-600 bg-slate-50 p-3 rounded-xl border border-slate-200">{summary.text}</div>
      ) : null}
    </div>
  );
}

export { SalesContourBlock };
