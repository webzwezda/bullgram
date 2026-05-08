import { Bot, Trash2, Users, UserCog, ExternalLink, RefreshCw, Loader2, CheckCircle2, AlertTriangle, Radio, MessageSquare, Link2, KeyRound, Plus, X, Settings, Zap } from 'lucide-react';
import { useState } from 'react';

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

function botKindLabel(value) {
  return normalizeBotKind(value) === 'template' ? 'Заготовка' : 'Продажи';
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

function SelectChevron() {
  return (
    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
    </div>
  );
}

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';

function ConnectBotSection({ botForm, setBotForm, state, addOfficialBot }) {
  return (
    <Card className="relative ring-slate-200/60 shadow-sm mb-6 overflow-hidden">
      <div className="absolute top-0 inset-x-0 h-32 bg-gradient-to-b from-blue-50/50 to-transparent pointer-events-none" />
      <CardHeader className="relative flex flex-row items-start gap-4 pb-4">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/20 shrink-0">
          <Bot className="w-6 h-6" />
        </div>
        <div className="flex-1">
          <CardTitle className="text-xl font-bold text-slate-900">
            Подключить нового бота
          </CardTitle>
          <CardDescription className="text-sm font-medium text-slate-500 mt-1">Получи токен у @BotFather и вставь сюда.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="relative">
        <div className="flex flex-col sm:flex-row items-end gap-4">
          <div className="flex-1 w-full">
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5 block">Токен бота</label>
            <Input
              value={botForm.botToken}
              onChange={(e) => setBotForm((prev) => ({ ...prev, botToken: e.target.value }))}
              placeholder="8123456789:AAE_x7v9Kq2Lm..."
              spellCheck="false"
              className="font-mono bg-slate-50 h-11"
            />
          </div>
          <div className="w-full sm:w-48">
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5 block">Тип</label>
            <Select
              value={botForm.botKind}
              onValueChange={(value) => setBotForm((prev) => ({ ...prev, botKind: value }))}
            >
              <SelectTrigger className="data-[size=default]:h-11 w-full bg-slate-50">
                <SelectValue placeholder="Тип бота" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sales">Бот продаж</SelectItem>
                <SelectItem value="template">Заготовка</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2 w-full sm:w-auto">
            <Button
              onClick={addOfficialBot}
              disabled={state.savingBot || !botForm.botToken.trim()}
              className="h-11 px-6 bg-blue-600 hover:bg-blue-700 w-full sm:w-auto"
            >
              {state.savingBot ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Подключить
            </Button>
            <Button variant="outline" asChild className="h-11 w-full sm:w-auto text-slate-700">
              <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="flex items-center gap-2">
                @BotFather <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </Button>
          </div>
        </div>
      </CardContent>
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
  saveBotKind,
  state,
  salesContourSectionProps
}) {
  if (!selectedOfficialBot) return null;

  const selectedBotId = String(selectedOfficialBot.id);
  const kind = normalizeBotKind(selectedOfficialBot.bot_kind);
  const adminDraftValue = Object.prototype.hasOwnProperty.call(botAdminDrafts, selectedBotId)
    ? botAdminDrafts[selectedBotId]
    : selectedOfficialBot.admin_tg_id || '';

  const contourDraftWithProps = salesContourSectionProps?.draft
    ? { ...salesContourSectionProps.draft, _props: salesContourSectionProps }
    : null;

  return (
    <Card className="ring-slate-200/60 shadow-sm">
      <CardHeader className="flex flex-row items-start gap-4">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/20 shrink-0">
          <Settings className="w-6 h-6" />
        </div>
        <div className="flex-1">
          <CardTitle className="text-xl font-bold text-slate-900">
            Настройка бота
          </CardTitle>
          <CardDescription className="text-sm font-medium text-slate-500 mt-1">Выбери бота, укажи тип и Telegram ID для уведомлений о продажах.</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5 block">Бот</label>
            <Select
              value={selectedOfficialBotId || selectedBotId}
              onValueChange={(value) => setSelectedOfficialBotId(value)}
            >
              <SelectTrigger className="data-[size=default]:h-11 w-full bg-slate-50">
                <SelectValue placeholder="Выбери бота" />
              </SelectTrigger>
              <SelectContent>
                {officialBots.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {botTitle(account)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5 block">Тип бота</label>
            <Select
              value={kind}
              onValueChange={(value) => saveBotKind(selectedOfficialBot, value)}
              disabled={state.savingBotKindId === selectedBotId}
            >
              <SelectTrigger className="data-[size=default]:h-11 w-full bg-slate-50">
                <SelectValue placeholder="Тип бота" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sales">Бот продаж</SelectItem>
                <SelectItem value="template">Заготовка</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5 block">Админ TG ID</label>
            <div className="flex gap-2">
              <Input
                value={adminDraftValue}
                onChange={(e) => setBotAdminDrafts((prev) => ({
                  ...prev,
                  [selectedBotId]: e.target.value
                }))}
                placeholder="488609412"
                className="h-11 bg-slate-50 font-mono"
              />
              <Button
                onClick={() => saveBotAdmin(selectedOfficialBot)}
                disabled={state.savingBotAdminId === selectedBotId}
                className="h-11 px-4 bg-slate-900 hover:bg-slate-800 text-white"
              >
                {state.savingBotAdminId === selectedBotId ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Сохранить'}
              </Button>
            </div>
            <div className="mt-1.5 text-xs text-slate-500">
              {adminContextMeta(selectedOfficialBot) === 'Не указан'
                ? 'Укажи свой Telegram ID — так бот узнает, кто админ, и будет присылать уведомления о продажах.'
                : adminContextMeta(selectedOfficialBot)}
            </div>
          </div>
        </div>
      </CardContent>

      {kind === 'sales' && salesContourSectionProps?.isVisible ? (
        <div className="border-t border-slate-100 bg-slate-50/30">
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
      ) : kind === 'template' ? (
        <CardContent className="border-t border-slate-100 pt-6">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 font-medium flex items-center gap-2">
            <Bot className="w-4 h-4 text-slate-400" />
            Это заготовка. Магазин и привязка площадок для неё не нужны, но токен и админа можно держать наготове.
          </div>
        </CardContent>
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
    <div className="border-t border-slate-100">
      <div className="px-6 md:px-8 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <UserCog className="w-4 h-4 text-slate-400" />
            <div className="text-sm font-bold text-slate-900">Юзерботы</div>
          </div>
          <div className="flex items-center gap-2">
            {selectedOptions.length ? (
              <div className="px-2.5 py-1 rounded-full bg-slate-200 text-xs font-bold text-slate-600">{selectedOptions.length}</div>
            ) : null}
            {availableOptions.length > 0 ? (
              <Button
                size="sm"
                onClick={() => setAdding(true)}
                className="bg-blue-600 hover:bg-blue-700 h-8 text-xs px-3"
              >
                <Plus className="w-3.5 h-3.5 mr-1" />
                Добавить
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {adding && availableOptions.length > 0 ? (
        <div className="px-6 md:px-8 py-3 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
          <Select onValueChange={(value) => { if (value) handleAdd(value); }}>
            <SelectTrigger className="flex-1 w-full bg-white data-[size=default]:h-9">
              <SelectValue placeholder="Выбери юзербота" />
            </SelectTrigger>
            <SelectContent>
              {availableOptions.map((option) => (
                <SelectItem key={option.id} value={option.id}>{option.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAdding(false)}
            className="h-9 text-slate-600"
          >
            Отмена
          </Button>
        </div>
      ) : null}

      {!selectedOptions.length && !adding ? (
        <div className="px-6 md:px-8 py-8 text-center bg-slate-50/50">
          <div className="w-10 h-10 bg-white rounded-full shadow-sm flex items-center justify-center mx-auto mb-3">
            <UserCog className="w-5 h-5 text-slate-300" />
          </div>
          <p className="text-sm text-slate-600 font-semibold">Юзерботы не привязаны</p>
          <p className="mt-1 text-xs text-slate-500">Они будут приглашать и управлять подписчиками.</p>
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {selectedOptions.map((option) => {
            const isActive = salesContourSectionProps?.userbotActiveMap?.[String(option.id)] !== false;
            const isToggling = salesContourSectionProps?.togglingUserbotId === String(option.id);
            return (
              <div key={option.id} className="px-6 md:px-8 py-3 hover:bg-slate-50 transition-colors flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-2 h-2 rounded-full shadow-sm" style={{ backgroundColor: statusColor(option.runtimeStatus) }} />
                    <span className="text-sm font-bold text-slate-900">{option.title}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div
                      className={`toggle-switch ${isActive ? 'toggle-switch--on' : ''} ${isToggling ? 'opacity-60 pointer-events-none' : ''}`}
                      role="switch"
                      aria-checked={isActive}
                      aria-label={`Статус ${option.title}`}
                      onClick={() => salesContourSectionProps?.toggleUserbotActive?.(option.id, !isActive)}
                    >
                      <span className="toggle-switch__thumb" />
                    </div>
                    <span className={`text-[11px] font-semibold ${isActive ? 'text-emerald-600' : 'text-slate-400'}`}>Работаю</span>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-slate-500 hover:text-rose-600 hover:bg-rose-50"
                  onClick={() => handleRemove(option.id)}
                  disabled={savingContour}
                >
                  <X className="w-3.5 h-3.5 mr-1" />
                  Отвязать
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {savingContour ? (
        <div className="px-6 md:px-8 py-2 text-xs font-medium text-slate-400 bg-slate-50">Сохраняем...</div>
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
      <Card className="border-rose-200 bg-rose-50 shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: statusMeta.dot }} />
              <div>
                <div className="text-sm font-bold text-rose-800">{statusMeta.title}</div>
                <div className="text-xs text-rose-700/80 mt-0.5">{statusMeta.text}</div>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="border-rose-200 text-rose-700 hover:bg-rose-100/50 hover:text-rose-800"
              onClick={() => refreshOfficialBotWebhookStatus(selectedOfficialBot)}
              disabled={isBusy}
            >
              {isBusy ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-2" />}
              Переподключить
            </Button>
          </div>
        </CardContent>
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

  if (isOk) return { tone: 'ok', title: 'Ок', text: '' };
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
      <div className="mt-2 inline-flex rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-500">
        Права появятся после выбора площадки.
      </div>
    );
  }

  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {rights.map(({ label, value }) => (
        <span key={label} className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${permissionPillClass(value)}`}>
          {value === true ? <CheckCircle2 className="size-3" /> : value === false ? <AlertTriangle className="size-3" /> : <span className="size-1.5 rounded-full bg-current opacity-60" />}
          {label}
        </span>
      ))}
      {result?.warnings?.length ? (
        <span className="basis-full text-[11px] font-medium text-rose-700">{result.warnings[0]}</span>
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
    <div className="bg-slate-50/50 pb-2">
      {contourError ? (
        <div className="mx-6 md:mx-8 mb-4 mt-4 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-sm">
          <AlertTriangle className="mt-0.5 w-5 h-5 shrink-0 text-amber-500" />
          <div>
            <p className="font-bold">Ошибка контура</p>
            <p className="mt-0.5 text-amber-800/90 text-xs">Площадки можно выбрать, но сохранять лучше после ответа сервера.</p>
          </div>
        </div>
      ) : null}

      <div className="divide-y divide-slate-100">
        {ROLE_CONFIGS.map((config) => {
          const Icon = config.icon;
          const options = optionsForRole(config, draft._props || {});
          const selectedId = String(draft[config.field] || '');
          const selectedOption = options.find((o) => String(o.id) === selectedId);
          const rights = botRightsByTarget[config.key] || null;
          const summary = rightsSummary(rights, selectedId);
          const checking = checkingBotRightsTarget === config.key;

          return (
            <div key={config.key} className="px-6 md:px-8 py-5">
              <div className="flex flex-col lg:flex-row lg:items-center gap-4">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-white shadow-sm flex items-center justify-center shrink-0 border border-slate-100">
                    <Icon className="w-4 h-4 text-slate-500" />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-slate-900">{config.title}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: summary.tone === 'ok' ? '#10b981' : summary.tone === 'warning' ? '#f59e0b' : summary.tone === 'error' ? '#ef4444' : '#cbd5e1' }} />
                      <span className="text-xs text-slate-500">{summary.title}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 ml-11 lg:ml-0">
                  <div className="w-full sm:w-[220px]">
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
                      <SelectTrigger className="data-[size=default]:h-9 w-full bg-white">
                        <SelectValue placeholder={options.length ? '—' : 'Нет площадок'} />
                      </SelectTrigger>
                      <SelectContent>
                        {options.map((option) => (
                          <SelectItem key={option.id} value={String(option.id)}>
                            {option.title || option.tgChatId || option.id}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 shrink-0 text-slate-700 bg-white"
                    onClick={() => checkBotRights(config.key)}
                    disabled={!selectedId || checking}
                  >
                    {checking ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5 mr-1.5 text-slate-400" />}
                    Проверить
                  </Button>
                </div>
              </div>

              <div className="ml-11 mt-3">
                {selectedOption ? (
                  <div className="mb-2 text-xs text-slate-500 flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-slate-100 font-medium">
                      {selectedOption.visibility === 'public' ? (selectedOption.username ? `@${selectedOption.username}` : 'Публичная') : selectedOption.visibility === 'private' ? 'Приватная' : 'Не проверена'}
                    </span>
                    {selectedOption.tgChatId && <span className="font-mono text-[11px] opacity-70">{selectedOption.tgChatId}</span>}
                  </div>
                ) : null}
                <RightsBadges result={rights} selectedId={selectedId} />
                {savingContour ? (
                  <div className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-indigo-600">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Сохраняем выбор...
                  </div>
                ) : null}
                {summary.text ? (
                  <div className="mt-1.5 text-[11px] font-medium text-slate-500 bg-slate-100/50 p-2 rounded-md border border-slate-100">{summary.text}</div>
                ) : null}
              </div>
            </div>
          );
        })}
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
    <Card className="ring-slate-200/60 shadow-sm">
      <CardHeader className="flex flex-row items-start justify-between border-b border-slate-100 bg-slate-50/50">
        <div className="flex gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center text-white shadow-lg shadow-emerald-500/20 shrink-0">
            <Users className="w-6 h-6" />
          </div>
          <div className="flex-1">
            <CardTitle className="text-xl font-bold text-slate-900">
              Telegram-площадки
            </CardTitle>
            <CardDescription className="text-sm font-medium text-slate-500 mt-1">Открытые и закрытые каналы/чаты, где бот — админ.</CardDescription>
          </div>
        </div>
        {targets.length > 0 && (
          <div className="px-4 py-2 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-xl text-sm font-bold">
            {targets.length}
          </div>
        )}
      </CardHeader>

      {!targets.length ? (
        <CardContent className="p-12 text-center flex flex-col items-center justify-center">
          <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mb-3">
            <Users className="w-6 h-6 text-slate-400" />
          </div>
          <p className="text-sm text-slate-500 font-semibold">Площадок пока нет</p>
          <p className="mt-1 text-xs text-slate-400">Назначьте бота админом в канале или чате.</p>
        </CardContent>
      ) : (
        <div className="divide-y divide-slate-100">
          {targets.map((target) => {
            const isRefreshing = refreshingTelegramPlaceId === String(target.id);
            const categoryLabel = formatPlaceCategory(target);
            const categoryColor = placeCategoryColor(target);
            const username = String(target?.username || '').trim().replace(/^@/, '');
            return (
              <div key={target.id} className="p-4 sm:px-6 hover:bg-slate-50 transition-colors">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-slate-900 truncate">{target.title || target.tg_chat_id || 'Без названия'}</span>
                      <span className={`inline-flex px-2 py-0.5 rounded-md text-[10px] font-black uppercase border ${categoryColor}`}>{categoryLabel}</span>
                      {username && (
                        <span className="inline-flex px-2 py-0.5 rounded-md text-[10px] font-black uppercase border border-indigo-200 bg-indigo-50 text-indigo-700">@{username}</span>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      <span className="font-mono">{target.tg_chat_id || '—'}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-slate-600 hover:text-indigo-700 hover:bg-indigo-50 hover:border-indigo-200"
                      onClick={() => refreshTelegramPlaceInfo(target)}
                      disabled={isRefreshing}
                    >
                      <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                      {isRefreshing ? 'Обновляем' : 'Обновить'}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-rose-600 border-rose-200 bg-rose-50 hover:bg-rose-100"
                      onClick={() => deleteTelegramPlace(target)}
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-1.5" />
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
  saveBotKind,
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

      <BotConfigSection
        selectedOfficialBot={selectedOfficialBot}
        selectedOfficialBotId={selectedOfficialBotId}
        setSelectedOfficialBotId={setSelectedOfficialBotId}
        officialBots={officialBots}
        botAdminDrafts={botAdminDrafts}
        setBotAdminDrafts={setBotAdminDrafts}
        saveBotAdmin={saveBotAdmin}
        saveBotKind={saveBotKind}
        state={state}
        salesContourSectionProps={salesContourSectionProps}
      />

      <BotRuntimeSection
        selectedOfficialBot={selectedOfficialBot}
        refreshOfficialBotWebhookStatus={refreshOfficialBotWebhookStatus}
        state={state}
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
