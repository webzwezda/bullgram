import { Bot, Trash2, Users, UserCog, ExternalLink, RefreshCw, Loader2, CheckCircle2, AlertTriangle, Radio, MessageSquare, Link2, KeyRound, Plus, X, Settings } from 'lucide-react';
import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

function adminContextMeta(accountOrAdminTgId) {
  const adminTgId = typeof accountOrAdminTgId === 'object'
    ? accountOrAdminTgId?.admin_tg_id
    : accountOrAdminTgId;
  const adminTgUsername = typeof accountOrAdminTgId === 'object'
    ? String(accountOrAdminTgId?.admin_tg_username || '').trim().replace(/^@/, '')
    : '';

  if (!adminTgId) return 'Не указан';
  return adminTgUsername ? `TG ID ${adminTgId} · @${adminTgUsername}` : `TG ID ${adminTgId}`;
}

function normalizeBotKind(value) {
  return value === 'template' ? 'template' : 'sales';
}

function botTitle(account) {
  return `@${account?.tg_username || `bot-${String(account?.tg_account_id || account?.id || '')}`}`;
}

function normalizeWebhookMode(value) {
  return String(value || 'polling').trim().toLowerCase() === 'webhook' ? 'webhook' : 'polling';
}

function webhookStatusMeta(account) {
  const mode = normalizeWebhookMode(account?.webhook_mode);
  const status = String(account?.webhook_status || '').trim().toLowerCase();
  if (mode !== 'webhook') {
    return {
      title: 'Тестовый режим',
      text: 'Бот работает через сервер в тестовом режиме.',
      className: 'border-amber-200 bg-amber-50 text-amber-700',
      dot: '#f59e0b',
      showAction: false
    };
  }
  if (status === 'error' || account?.runtime_error) {
    return {
      title: 'Ошибка подключения',
      text: account?.runtime_error || 'Telegram не смог подключить бота.',
      className: 'border-rose-200 bg-rose-50 text-rose-700',
      dot: '#ef4444',
      showAction: false
    };
  }
  if (status === 'receiving') {
    return {
      title: 'Бот получает сообщения',
      text: 'Telegram уже отправлял сообщения боту.',
      className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      dot: '#10b981',
      showAction: false
    };
  }
  return {
    title: 'Бот подключён',
    text: 'Бот работает и принимает сообщения.',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    dot: '#10b981',
    showAction: true
  };
}

function isChatPlace(target) {
  const chatType = String(target?.chat_type || '').toLowerCase();
  return chatType === 'group' || chatType === 'supergroup';
}

function formatPlaceCategory(target) {
  const surface = isChatPlace(target) ? 'чат' : 'канал';
  const visibility = String(target?.visibility || '').toLowerCase();

  if (visibility === 'public') return `Открытый ${surface}`;
  if (visibility === 'private') return `Закрытый ${surface}`;
  return `${surface === 'чат' ? 'Чат' : 'Канал'} - открытость не проверена`;
}

function placeCategoryColor(target) {
  const visibility = String(target?.visibility || '').toLowerCase();
  if (visibility === 'public') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (visibility === 'private') return 'bg-slate-100 text-slate-700 border-slate-200';
  return 'bg-amber-50 text-amber-700 border-amber-200';
}

function ConnectBotSection({ botForm, setBotForm, state, addOfficialBot }) {
  return (
    <Card className="border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 bg-white overflow-hidden rounded-2xl relative">

      <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6">
        <div className="flex flex-row items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-500/20 shrink-0">
            <Bot className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900">Подключить нового бота</h2>
            <p className="text-sm font-medium text-slate-500 mt-0.5">Получите токен у @BotFather и вставьте сюда.</p>
          </div>
        </div>
      </div>
      
      <div className="p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row items-end gap-4 max-w-4xl">
          <div className="flex-1 w-full">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2 block">Токен бота</label>
            <Input
              value={botForm.botToken}
              onChange={(e) => setBotForm((prev) => ({ ...prev, botToken: e.target.value }))}
              placeholder="8123456789:AAE_x7v9Kq2Lm..."
              spellCheck="false"
              className="font-mono bg-white h-11 rounded-xl border-slate-200 shadow-sm focus-visible:ring-indigo-500"
            />
          </div>

          <div className="flex gap-3 w-full sm:w-auto">
            <Button
              onClick={addOfficialBot}
              disabled={state.savingBot || !botForm.botToken.trim()}
              className="h-11 px-6 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-200 w-full sm:w-auto font-bold"
            >
              {state.savingBot ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              {state.savingBot ? 'Подключение...' : 'Подключить'}
            </Button>
            <Button variant="outline" asChild className="h-11 rounded-xl w-full sm:w-auto text-slate-700 border-slate-200 shadow-sm">
              <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="flex items-center gap-2 font-bold">
                @BotFather <ExternalLink className="w-4 h-4" />
              </a>
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function BotConfigSection({
  selectedOfficialBot,
  selectedOfficialBotId,
  setSelectedOfficialBotId,
  officialBots,
  botAdminDrafts,
  setBotAdminDrafts,
  saveBotAdmin,
  state,
  salesContourSectionProps
}) {
  if (!selectedOfficialBot) return null;

  const selectedBotId = String(selectedOfficialBot.id);
  const adminDraftValue = Object.prototype.hasOwnProperty.call(botAdminDrafts, selectedBotId)
    ? botAdminDrafts[selectedBotId]
    : selectedOfficialBot.admin_tg_id || '';

  const contourDraftWithProps = salesContourSectionProps?.draft
    ? { ...salesContourSectionProps.draft, _props: salesContourSectionProps }
    : null;

  return (
    <Card className="border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 bg-white overflow-hidden rounded-2xl">
      <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6">
        <div className="flex flex-row items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-500/20 shrink-0">
            <Settings className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900">Настройка бота</h2>
            <p className="text-sm font-medium text-slate-500 mt-0.5">Конфигурация, тип и уведомления о продажах.</p>
          </div>
        </div>
      </div>
      
      <div className="p-5 sm:p-6 bg-white">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl">
          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2 block">Выбранный бот</label>
            <Select
              value={selectedOfficialBotId || selectedBotId}
              onValueChange={(value) => setSelectedOfficialBotId(value)}
            >
              <SelectTrigger className="data-[size=default]:h-11 w-full bg-white rounded-xl border-slate-200 shadow-sm focus:ring-indigo-500">
                <SelectValue placeholder="Выбери бота" />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                {officialBots.map((account) => (
                  <SelectItem key={account.id} value={account.id} className="rounded-lg py-2.5">
                    <span className="font-medium text-slate-900">{botTitle(account)}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2 block">Админ TG ID</label>
            <div className="flex gap-2">
              <Input
                value={adminDraftValue}
                onChange={(e) => setBotAdminDrafts((prev) => ({
                  ...prev,
                  [selectedBotId]: e.target.value
                }))}
                placeholder="ID (напр. 488609412)"
                className="h-11 bg-white rounded-xl border-slate-200 shadow-sm focus-visible:ring-indigo-500 font-mono"
              />
              <Button
                onClick={() => saveBotAdmin(selectedOfficialBot)}
                disabled={state.savingBotAdminId === selectedBotId}
                className="h-11 px-5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold shadow-sm"
              >
                {state.savingBotAdminId === selectedBotId ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Сохранить'}
              </Button>
            </div>
            <div className="mt-2 text-xs font-medium text-slate-500">
              {adminContextMeta(selectedOfficialBot) === 'Не указан'
                ? 'Укажи свой TG ID для получения уведомлений.'
                : <span className="text-emerald-600 font-semibold flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Привязан: {adminContextMeta(selectedOfficialBot)}</span>}
            </div>
          </div>
        </div>
      </div>

      {salesContourSectionProps?.isVisible ? (
        <div className="border-t border-slate-100 bg-slate-50/50">
          <UserbotsSection
            salesContourSectionProps={salesContourSectionProps}
          />
          <SalesContourBlock
            draft={contourDraftWithProps || {}}
            setFieldValue={salesContourSectionProps?.setFieldValue}
            savingContour={salesContourSectionProps?.savingContour}
            checkBotRights={salesContourSectionProps?.checkBotRights}
            checkingBotRightsTarget={salesContourSectionProps?.checkingBotRightsTarget}
            botRightsByTarget={salesContourSectionProps?.botRightsByTarget}
            contourError={salesContourSectionProps?.contourError}
          />
        </div>
      ) : null}
    </Card>
  );
}

function UserbotsSection({
  salesContourSectionProps
}) {
  const draft = salesContourSectionProps?.draft || {};
  const setFieldValue = salesContourSectionProps?.setFieldValue;
  const savingContour = salesContourSectionProps?.savingContour;
  const userbotOptions = salesContourSectionProps?.userbotOptions || [];
  const selectedIds = draft.selectedUserbotIds || [];
  const [adding, setAdding] = useState(false);

  if (!salesContourSectionProps?.isVisible) return null;

  const selectedOptions = userbotOptions.filter((o) => selectedIds.includes(String(o.id)));
  const availableOptions = userbotOptions.filter((o) => !selectedIds.includes(String(o.id)) && o.eligible !== false);

  function statusColor(status) {
    if (status === 'online') return '#10b981';
    if (status === 'restricted' || status === 'expired' || status === 'error') return '#ef4444';
    return '#cbd5e1';
  }

  function handleAdd(optionId) {
    const next = [...selectedIds, String(optionId)];
    if (setFieldValue) {
      setFieldValue({
        selectedUserbotIds: next,
        selectedUserbotId: '',
        userbotMode: 'pool'
      }, null, { autoSave: true });
    }
    setAdding(false);
    salesContourSectionProps?.triggerJoinAll?.();
  }

  function handleRemove(optionId) {
    const next = selectedIds.filter((id) => id !== String(optionId));
    if (setFieldValue) {
      const nextMode = next.length > 0 ? 'pool' : 'none';
      setFieldValue({
        selectedUserbotIds: next,
        selectedUserbotId: '',
        userbotMode: nextMode
      }, null, { autoSave: true });
    }
  }

  return (
    <div className="border-t border-slate-100 pb-2">
      <div className="px-5 sm:px-6 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center">
              <UserCog className="w-4 h-4 text-indigo-600" />
            </div>
            <div className="text-base font-bold text-slate-900">Привязанные юзерботы</div>
          </div>
          <div className="flex items-center gap-3">
            {selectedOptions.length ? (
              <Badge variant="secondary" className="bg-white border border-slate-200 text-slate-700 shadow-sm">{selectedOptions.length}</Badge>
            ) : null}
            {availableOptions.length > 0 ? (
              <Button
                size="sm"
                onClick={() => setAdding(true)}
                className="bg-indigo-600 hover:bg-indigo-700 h-11 rounded-xl text-xs px-4 shadow-sm font-bold"
              >
                <Plus className="w-4 h-4 mr-1.5" />
                Добавить юзербота
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {adding && availableOptions.length > 0 ? (
        <div className="px-5 sm:px-6 py-4 border-y border-slate-100 bg-indigo-50/30 flex items-center gap-3">
          <Select onValueChange={(value) => { if (value) handleAdd(value); }}>
            <SelectTrigger className="flex-1 w-full bg-white rounded-xl border-slate-200 data-[size=default]:h-11 shadow-sm">
              <SelectValue placeholder="Выберите доступного юзербота" />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              {availableOptions.map((option) => (
                <SelectItem key={option.id} value={option.id} className="rounded-lg py-2">{option.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAdding(false)}
            className="h-11 rounded-xl text-slate-600 border-slate-200 bg-white"
          >
            Отмена
          </Button>
        </div>
      ) : null}

      {!selectedOptions.length && !adding ? (
        <div className="px-5 sm:px-6 py-8 text-center">
          <div className="w-12 h-12 bg-white border border-slate-100 rounded-full shadow-sm flex items-center justify-center mx-auto mb-3">
            <UserCog className="w-6 h-6 text-slate-300" />
          </div>
          <p className="text-sm text-slate-700 font-bold">Юзерботы не привязаны</p>
          <p className="mt-1 text-sm text-slate-500 max-w-sm mx-auto">Привяжите юзербота, чтобы он управлял приглашениями и подписчиками в контуре.</p>
        </div>
      ) : (
        <div className="px-5 sm:px-6 pb-2 space-y-2">
          {selectedOptions.map((option) => {
            const isActive = salesContourSectionProps?.userbotActiveMap?.[String(option.id)] !== false;
            const isToggling = salesContourSectionProps?.togglingUserbotId === String(option.id);
            return (
              <div key={option.id} className="bg-white border border-slate-200 p-3 rounded-xl shadow-sm flex items-center justify-between gap-4 transition-all hover:border-slate-300">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2.5">
                    <div className="w-2.5 h-2.5 rounded-full shadow-sm" style={{ backgroundColor: statusColor(option.runtimeStatus) }} />
                    <span className="text-sm font-bold text-slate-900">{option.title}</span>
                  </div>
                  <div className="w-px h-4 bg-slate-200"></div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={isActive}
                      onClick={() => salesContourSectionProps?.toggleUserbotActive?.(option.id, !isActive)}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${
                        isToggling ? 'opacity-50 pointer-events-none' : ''
                      } ${isActive ? 'bg-indigo-600' : 'bg-slate-200'}`}
                    >
                      <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${isActive ? 'translate-x-4' : 'translate-x-0'}`} />
                    </button>
                    <span className={`text-xs font-bold ${isActive ? 'text-indigo-600' : 'text-slate-400'}`}>Участвует в ротации</span>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2.5 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg"
                  onClick={() => handleRemove(option.id)}
                  disabled={savingContour}
                >
                  <X className="w-4 h-4 mr-1.5" />
                  Отвязать
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {savingContour ? (
        <div className="px-5 sm:px-6 py-3 text-xs font-bold text-indigo-500 flex items-center gap-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Сохранение контура...
        </div>
      ) : null}
    </div>
  );
}

function BotRuntimeSection({
  selectedOfficialBot,
  refreshOfficialBotWebhookStatus,
  state
}) {
  if (!selectedOfficialBot) return null;

  const accountId = String(selectedOfficialBot.id || '');
  const isBusy = state.webhookRuntimeActionId === accountId;
  const statusMeta = webhookStatusMeta(selectedOfficialBot);

  if (statusMeta.title === 'Ошибка подключения') {
    return (
      <Card className="border-0 shadow-sm ring-1 ring-rose-200/50 bg-rose-50 rounded-2xl overflow-hidden mb-6">
        <div className="p-5 sm:p-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-full bg-rose-100 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-rose-500" />
              </div>
              <div>
                <div className="text-base font-bold text-rose-900">{statusMeta.title}</div>
                <div className="text-sm font-medium text-rose-700 mt-0.5">{statusMeta.text}</div>
              </div>
            </div>
            <Button
              variant="outline"
              className="h-11 rounded-xl border-rose-200 text-rose-700 bg-white hover:bg-rose-100 hover:text-rose-800 font-bold shadow-sm w-full sm:w-auto"
              onClick={() => refreshOfficialBotWebhookStatus(selectedOfficialBot)}
              disabled={isBusy}
            >
              {isBusy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
              Переподключить бота
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  return null;
}

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

function RightsBadges({ result, selectedId }) {
  const adminOk = result ? isAdminStatusOk(result.adminStatus) : null;
  const rights = result ? [
    { label: 'Админ', value: adminOk },
    { label: 'Приглашать', value: result.canInviteUsers },
    { label: 'Удалять', value: result.canRestrictMembers },
    { label: 'Назначать', value: result.canPromoteMembers },
    { label: 'Управлять', value: result.canManageChat }
  ] : [
    { label: 'Админ', value: null },
    { label: 'Приглашать', value: null },
    { label: 'Удалять', value: null },
    { label: 'Назначать', value: null },
    { label: 'Управлять', value: null }
  ];

  if (!selectedId) {
    return (
      <div className="mt-2.5 inline-flex rounded-lg border border-slate-200 bg-slate-100/50 px-2.5 py-1 text-xs font-bold text-slate-500 shadow-sm">
        Укажите площадку, чтобы проверить права бота.
      </div>
    );
  }

  return (
    <div className="mt-2.5 flex flex-wrap gap-1.5">
      {rights.map(({ label, value }) => (
        <span key={label} className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-bold shadow-sm ${permissionPillClass(value)}`}>
          {value === true ? <CheckCircle2 className="w-3.5 h-3.5" /> : value === false ? <AlertTriangle className="w-3.5 h-3.5" /> : <span className="w-2 h-2 rounded-full bg-current opacity-40 ml-0.5" />}
          {label}
        </span>
      ))}
      {result?.warnings?.length ? (
        <span className="basis-full text-xs font-bold text-rose-600 mt-1">{result.warnings[0]}</span>
      ) : null}
    </div>
  );
}

const ROLE_CONFIGS = [
  { key: 'public_channel', title: 'Открытый канал', field: 'publicChannelId', oppositeField: 'paidChannelId', icon: Radio },
  { key: 'paid_channel', title: 'Закрытый канал', field: 'paidChannelId', oppositeField: 'publicChannelId', icon: Link2 },
  { key: 'public_chat', title: 'Публичный чат', field: 'publicChatId', oppositeField: 'paidChatId', icon: MessageSquare },
  { key: 'paid_chat', title: 'Закрытый чат', field: 'paidChatId', oppositeField: 'publicChatId', icon: MessageSquare }
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
  checkBotRights,
  checkingBotRightsTarget,
  botRightsByTarget,
  contourError
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

      <div className="px-5 sm:px-6 pt-5 pb-2">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center">
            <Link2 className="w-4 h-4 text-indigo-600" />
          </div>
          <div className="text-base font-bold text-slate-900">Привязка площадок</div>
        </div>

        <div className="space-y-3">
          {ROLE_CONFIGS.map((config) => {
            const Icon = config.icon;
            const options = optionsForRole(config, draft._props || {});
            const selectedId = String(draft[config.field] || '');
            const selectedOption = options.find((o) => String(o.id) === selectedId);
            const rights = botRightsByTarget[config.key] || null;
            const summary = rightsSummary(rights, selectedId);
            const checking = checkingBotRightsTarget === config.key;

            return (
              <div key={config.key} className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-sm transition-all hover:border-slate-300">
                <div className="flex flex-col lg:flex-row lg:items-center gap-4">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-slate-50 shadow-sm flex items-center justify-center shrink-0 border border-slate-100">
                      <Icon className="w-5 h-5 text-slate-500" />
                    </div>
                    <div>
                      <div className="text-sm font-bold text-slate-900">{config.title}</div>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: summary.tone === 'ok' ? '#10b981' : summary.tone === 'warning' ? '#f59e0b' : summary.tone === 'error' ? '#ef4444' : '#cbd5e1' }} />
                        <span className="text-xs font-bold text-slate-500">{summary.title}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 ml-12 lg:ml-0">
                    <div className="w-full sm:w-[280px]">
                      <Select
                        value={selectedId}
                        onValueChange={(value) => {
                          if (config.oppositeField && value && String(draft[config.oppositeField] || '') === String(value)) {
                            setFieldValue(config.field, value, { autoSave: true, oppositeField: config.oppositeField });
                          } else {
                            setFieldValue(config.field, value, { autoSave: true });
                          }
                        }}
                        disabled={!options.length}
                      >
                        <SelectTrigger className="data-[size=default]:h-11 w-full bg-white rounded-xl border-slate-200 shadow-sm focus:ring-indigo-500">
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
                    
                    <Button
                      variant="outline"
                      className="h-11 shrink-0 text-slate-700 bg-white border-slate-200 rounded-xl shadow-sm font-bold"
                      onClick={() => checkBotRights(config.key)}
                      disabled={!selectedId || checking}
                    >
                      {checking ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <KeyRound className="w-4 h-4 mr-2 text-slate-400" />}
                      {checking ? 'Проверка...' : 'Проверить права'}
                    </Button>
                  </div>
                </div>

                <div className="ml-12 mt-4 pt-4 border-t border-slate-100">
                  {selectedOption ? (
                    <div className="mb-3 text-xs text-slate-500 flex items-center gap-2">
                      <Badge variant="secondary" className="bg-slate-100 text-slate-600 border-0 shadow-sm font-bold">
                        {selectedOption.visibility === 'public' ? (selectedOption.username ? `@${selectedOption.username}` : 'Публичная') : selectedOption.visibility === 'private' ? 'Приватная' : 'Не проверена'}
                      </Badge>
                      {selectedOption.tgChatId && <span className="font-mono text-[11px] opacity-70 bg-slate-50 px-2 py-0.5 rounded-md border border-slate-100">{selectedOption.tgChatId}</span>}
                    </div>
                  ) : null}
                  <RightsBadges result={rights} selectedId={selectedId} />
                  {savingContour ? (
                    <div className="mt-3 flex items-center gap-2 text-xs font-bold text-indigo-600 bg-indigo-50/50 p-2 rounded-lg border border-indigo-100/50">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Синхронизация контура...
                    </div>
                  ) : null}
                  {summary.text ? (
                    <div className="mt-3 text-xs font-bold text-slate-600 bg-slate-100/80 p-3 rounded-xl border border-slate-200 shadow-inner">{summary.text}</div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function PlacesSection({
  selectedOfficialBot,
  channelsByBotId,
  deleteTelegramPlace,
  refreshTelegramPlaceInfo,
  refreshingTelegramPlaceId
}) {
  const selectedBotId = String(selectedOfficialBot?.id || '');
  const targets = channelsByBotId[selectedBotId] || [];

  if (!selectedOfficialBot) return null;

  return (
    <Card className="border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 bg-white overflow-hidden rounded-2xl">
      <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6">
        <div className="flex flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-500/20 shrink-0">
              <Users className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                Telegram-площадки
                {targets.length > 0 && (
                  <Badge variant="secondary" className="bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border-0 text-xs rounded-full px-2">
                    {targets.length}
                  </Badge>
                )}
              </h2>
              <p className="text-sm font-medium text-slate-500 mt-0.5">Открытые и закрытые каналы/чаты, где бот назначен администратором.</p>
            </div>
          </div>
        </div>
      </div>

      {!targets.length ? (
        <div className="p-12 text-center flex flex-col items-center justify-center bg-white">
          <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4 ring-1 ring-slate-100">
            <Users className="w-8 h-8 text-slate-300" />
          </div>
          <h3 className="text-base font-bold text-slate-900">Площадок пока нет</h3>
          <p className="mt-1 text-sm text-slate-500 max-w-sm">Назначьте бота админом в канале или чате, чтобы они появились здесь.</p>
        </div>
      ) : (
        <div className="p-5 sm:p-6 space-y-3 bg-white">
          {targets.map((target) => {
            const isRefreshing = refreshingTelegramPlaceId === String(target.id);
            const categoryLabel = formatPlaceCategory(target);
            const categoryColor = placeCategoryColor(target);
            const username = String(target?.username || '').trim().replace(/^@/, '');
            
            return (
              <div key={target.id} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:border-indigo-300 transition-colors">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2.5 flex-wrap mb-1.5">
                      <span className="text-base font-bold text-slate-900 truncate">{target.title || target.tg_chat_id || 'Без названия'}</span>
                      <Badge variant="outline" className={`${categoryColor} shadow-sm px-2 py-0.5 text-xs font-bold border`}>
                        {categoryLabel}
                      </Badge>
                      {username && (
                        <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200 shadow-sm px-2 py-0.5 text-xs font-bold">
                          @{username}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-slate-500">
                      <span className="font-mono bg-slate-50 px-2 py-0.5 rounded-md border border-slate-100">{target.tg_chat_id || '—'}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <Button
                      variant="outline"
                      className="h-11 rounded-xl text-slate-700 font-bold border-slate-200 hover:bg-indigo-50 hover:text-indigo-700 hover:border-indigo-200 shadow-sm"
                      onClick={() => refreshTelegramPlaceInfo(target)}
                      disabled={isRefreshing}
                    >
                      <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
                      {isRefreshing ? 'Обновление...' : 'Обновить'}
                    </Button>
                    <Button
                      variant="outline"
                      className="h-11 rounded-xl text-rose-600 border-rose-200 bg-rose-50 hover:bg-rose-100 font-bold shadow-sm"
                      onClick={() => deleteTelegramPlace(target)}
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Удалить
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

export function OfficialBotsSection({
  botForm,
  setBotForm,
  state,
  addOfficialBot,
  selectedOfficialBot,
  selectedOfficialBotId,
  setSelectedOfficialBotId,
  officialBots,
  botAdminDrafts,
  setBotAdminDrafts,
  saveBotAdmin,
  refreshOfficialBotWebhookStatus,
  channelsByBotId,
  deleteTelegramPlace,
  refreshTelegramPlaceInfo,
  refreshingTelegramPlaceId,
  salesContourSectionProps
}) {
  return (
    <div className="flex flex-col gap-6">
      <ConnectBotSection
        botForm={botForm}
        setBotForm={setBotForm}
        state={state}
        addOfficialBot={addOfficialBot}
      />

      <BotRuntimeSection
        selectedOfficialBot={selectedOfficialBot}
        refreshOfficialBotWebhookStatus={refreshOfficialBotWebhookStatus}
        state={state}
      />

      <BotConfigSection
        selectedOfficialBot={selectedOfficialBot}
        selectedOfficialBotId={selectedOfficialBotId}
        setSelectedOfficialBotId={setSelectedOfficialBotId}
        officialBots={officialBots}
        botAdminDrafts={botAdminDrafts}
        setBotAdminDrafts={setBotAdminDrafts}
        saveBotAdmin={saveBotAdmin}
        state={state}
        salesContourSectionProps={salesContourSectionProps}
      />

      <PlacesSection
        selectedOfficialBot={selectedOfficialBot}
        channelsByBotId={channelsByBotId}
        deleteTelegramPlace={deleteTelegramPlace}
        refreshTelegramPlaceInfo={refreshTelegramPlaceInfo}
        refreshingTelegramPlaceId={refreshingTelegramPlaceId}
      />
    </div>
  );
}
