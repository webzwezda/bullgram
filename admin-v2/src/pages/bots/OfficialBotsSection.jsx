import { Bot, Trash2, Users, UserCog, ExternalLink, RefreshCw, Loader2, CheckCircle2, AlertTriangle, Radio, MessageSquare, Link2, KeyRound, Plus, X } from 'lucide-react';
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

function ConnectBotSection({ botForm, setBotForm, state, addOfficialBot }) {
  return (
    <div className="p-6 md:p-8">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-2 h-2 rounded-full bg-blue-500" />
        <div className="text-[15px] font-bold text-slate-900">Подключить нового бота</div>
      </div>
      <div className="text-sm text-slate-500 mb-5">Получи токен у @BotFather и вставь сюда.</div>

      <div className="flex flex-col sm:flex-row items-end gap-3">
        <div className="flex-1 min-w-0">
          <label className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400 block mb-1.5">Токен бота</label>
          <input
            className="h-11 w-full px-4 rounded-xl border border-slate-200 bg-slate-50 font-mono text-[14px] font-medium text-slate-950 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10"
            type="text"
            value={botForm.botToken}
            onChange={(event) => setBotForm((prev) => ({ ...prev, botToken: event.target.value }))}
            placeholder="8123456789:AAE_x7v9Kq2Lm..."
            spellCheck="false"
          />
        </div>
        <div className="w-full sm:w-44">
          <label className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400 block mb-1.5">Тип</label>
          <div className="relative">
            <select
              className="h-11 w-full cursor-pointer appearance-none px-4 pr-10 rounded-xl border border-slate-200 bg-slate-50 text-[14px] font-medium text-slate-950 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10"
              value={botForm.botKind}
              onChange={(event) => setBotForm((prev) => ({ ...prev, botKind: event.target.value }))}
            >
              <option value="sales">Бот продаж</option>
              <option value="template">Заготовка</option>
            </select>
            <SelectChevron />
          </div>
        </div>
        <div className="flex gap-2">
          <button
            className="h-11 px-5 rounded-xl bg-blue-600 text-[14px] font-bold text-white hover:bg-blue-700 transition-all disabled:opacity-50"
            onClick={addOfficialBot}
            disabled={state.savingBot || !botForm.botToken.trim()}
          >
            {state.savingBot ? '...' : 'Подключить'}
          </button>
          <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="h-11 px-4 rounded-xl border border-slate-200 text-[13px] font-bold text-slate-700 hover:bg-slate-50 transition-all inline-flex items-center gap-1.5">
            @BotFather <ExternalLink className="size-3" />
          </a>
        </div>
      </div>
    </div>
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
    <div className="border-t border-slate-100">
      <div className="p-6 md:p-8">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-2 h-2 rounded-full bg-indigo-500" />
          <div className="text-[15px] font-bold text-slate-900">Настройка бота</div>
        </div>
        <div className="text-sm text-slate-500 mb-5">Выбери бота, укажи тип и Telegram ID для уведомлений о продажах.</div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400 block mb-1.5">Бот</label>
            <div className="relative">
              <select
                className="h-11 w-full cursor-pointer appearance-none px-4 pr-10 rounded-xl border border-slate-200 bg-slate-50 text-[14px] font-medium text-slate-950 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/10"
                value={selectedOfficialBotId || selectedBotId}
                onChange={(event) => setSelectedOfficialBotId(event.target.value)}
              >
                {officialBots.map((account) => (
                  <option key={account.id} value={account.id}>
                    {botTitle(account)}
                  </option>
                ))}
              </select>
              <SelectChevron />
            </div>
          </div>

          <div>
            <label className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400 block mb-1.5">Тип бота</label>
            <div className="relative">
              <select
                className="h-11 w-full cursor-pointer appearance-none px-4 pr-10 rounded-xl border border-slate-200 bg-slate-50 text-[14px] font-medium text-slate-950 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/10 disabled:opacity-60"
                value={kind}
                onChange={(event) => saveBotKind(selectedOfficialBot, event.target.value)}
                disabled={state.savingBotKindId === selectedBotId}
              >
                <option value="sales">Бот продаж</option>
                <option value="template">Заготовка</option>
              </select>
              <SelectChevron />
            </div>
          </div>

          <div>
            <label className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400 block mb-1.5">Админ TG ID</label>
            <div className="flex gap-2">
              <input
                className="h-11 flex-1 px-4 rounded-xl border border-slate-200 bg-slate-50 text-[14px] font-bold text-slate-950 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-500/10"
                type="text"
                value={adminDraftValue}
                onChange={(event) => setBotAdminDrafts((prev) => ({
                  ...prev,
                  [selectedBotId]: event.target.value
                }))}
                placeholder="488609412"
              />
              <button
                className="h-11 px-4 rounded-xl bg-slate-900 text-[13px] font-bold text-white hover:bg-slate-800 transition-all disabled:opacity-50"
                onClick={() => saveBotAdmin(selectedOfficialBot)}
                disabled={state.savingBotAdminId === selectedBotId}
              >
                {state.savingBotAdminId === selectedBotId ? '...' : 'Сохранить'}
              </button>
            </div>
            <div className="mt-1.5 text-xs text-slate-500">
              {adminContextMeta(selectedOfficialBot) === 'Не указан'
                ? 'Укажи свой Telegram ID — так бот узнает, кто админ, и будет присылать уведомления о продажах.'
                : adminContextMeta(selectedOfficialBot)}
            </div>
          </div>
        </div>
      </div>

      {kind === 'sales' && salesContourSectionProps?.isVisible ? (
        <div className="border-t border-slate-100">
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
        <div className="border-t border-slate-100 p-6 md:p-8">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 font-medium">
            Это заготовка. Магазин и привязка площадок для неё не нужны, но токен и админа можно держать наготове.
          </div>
        </div>
      ) : null}
    </div>
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
            <UserCog className="size-4 text-slate-400" />
            <div className="text-[15px] font-bold text-slate-900">Юзерботы</div>
          </div>
          <div className="flex items-center gap-2">
            {selectedOptions.length ? (
              <div className="px-2.5 py-1 rounded-lg bg-slate-100 text-[13px] font-bold text-slate-600">{selectedOptions.length}</div>
            ) : null}
            {availableOptions.length > 0 ? (
              <button
                className="h-8 px-3 rounded-lg bg-blue-600 text-[12px] font-bold text-white hover:bg-blue-700 transition-all inline-flex items-center gap-1.5"
                onClick={() => setAdding(true)}
              >
                <Plus className="size-3.5" />
                Добавить
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {adding && availableOptions.length > 0 ? (
        <div className="px-6 md:px-8 py-3 border-b border-slate-100 bg-slate-50">
          <div className="flex items-center gap-2">
            <select
              className="h-9 flex-1 px-3 rounded-lg border border-slate-200 bg-white text-[13px] font-bold text-slate-700 outline-none focus:border-blue-400"
              defaultValue=""
              onChange={(e) => { if (e.target.value) handleAdd(e.target.value); }}
            >
              <option value="" disabled>Выбери юзербота</option>
              {availableOptions.map((option) => (
                <option key={option.id} value={option.id}>{option.title}</option>
              ))}
            </select>
            <button
              className="h-9 px-3 rounded-lg border border-slate-200 text-[12px] font-bold text-slate-600 hover:bg-white transition-all"
              onClick={() => setAdding(false)}
            >
              Отмена
            </button>
          </div>
        </div>
      ) : null}

      {!selectedOptions.length && !adding ? (
        <div className="px-6 md:px-8 py-6 text-center">
          <p className="text-[13px] text-slate-400 font-medium">Юзерботы не привязаны</p>
          <p className="mt-1 text-[12px] text-slate-400">Привяжи юзерботов — они будут приглашать и управлять подписчиками.</p>
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {selectedOptions.map((option) => (
            <div key={option.id} className="px-6 md:px-8 py-3 hover:bg-slate-50/50 transition-colors">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="size-2 rounded-full" style={{ backgroundColor: statusColor(option.runtimeStatus) }} />
                  <span className="text-[13px] font-bold text-slate-900">{option.title}</span>
                </div>
                <button
                  className="h-7 px-2.5 rounded-lg border border-slate-200 text-[11px] font-bold text-slate-500 hover:text-rose-600 hover:border-rose-200 transition-all inline-flex items-center gap-1"
                  onClick={() => handleRemove(option.id)}
                  disabled={savingContour}
                >
                  <X className="size-3" />
                  Отвязать
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {savingContour ? (
        <div className="px-6 md:px-8 py-2 text-[12px] font-medium text-slate-400">Сохраняем...</div>
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
      <div className="border-t border-slate-100">
        <div className="p-6 md:p-8">
          <div className={`rounded-xl border p-4 ${statusMeta.className}`}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="size-2.5 rounded-full shrink-0" style={{ backgroundColor: statusMeta.dot }} />
                <div>
                  <div className="text-[13px] font-black">{statusMeta.title}</div>
                  <div className="text-[11px] opacity-70 mt-0.5">{statusMeta.text}</div>
                </div>
              </div>
              <button
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-current/20 bg-white/60 px-3 text-[12px] font-bold transition-colors hover:bg-white disabled:cursor-wait disabled:opacity-60 shrink-0"
                onClick={() => refreshOfficialBotWebhookStatus(selectedOfficialBot)}
                disabled={isBusy}
              >
                {isBusy ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
                Переподключить
              </button>
            </div>
          </div>
        </div>
      </div>
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
    <div>
      {contourError ? (
        <div className="mx-6 md:mx-8 mb-4 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
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
            <div key={config.key} className="px-6 md:px-8 py-4">
              <div className="flex items-center gap-3">
                <Icon className="size-4 text-slate-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-bold text-slate-900">{config.title}</span>
                  </div>
                </div>
                <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: summary.tone === 'ok' ? '#10b981' : summary.tone === 'warning' ? '#f59e0b' : summary.tone === 'error' ? '#ef4444' : '#cbd5e1' }} />
                <select
                  className="h-9 px-3 rounded-lg border border-slate-200 bg-white text-[13px] font-bold text-slate-700 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 max-w-[200px]"
                  value={selectedId}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (config.oppositeField && value && String(draft[config.oppositeField] || '') === String(value)) {
                      setFieldValue(config.field, value, { autoSave: true, oppositeField: config.oppositeField });
                    } else {
                      setFieldValue(config.field, value, { autoSave: true });
                    }
                  }}
                  disabled={!options.length}
                >
                  <option value="">{options.length ? '—' : 'Нет площадок'}</option>
                  {options.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.title || option.tgChatId || option.id}
                    </option>
                  ))}
                </select>
                <button
                  className="h-9 px-3 rounded-lg border border-slate-200 text-[12px] font-bold text-slate-700 hover:bg-slate-50 transition-all disabled:opacity-50 inline-flex items-center gap-1.5"
                  onClick={() => checkBotRights(config.key)}
                  disabled={!selectedId || checking}
                >
                  {checking ? <Loader2 className="size-3 animate-spin" /> : <KeyRound className="size-3" />}
                  Обновить права
                </button>
              </div>

              <div className="ml-7 mt-2">
                {selectedOption ? (
                  <div className="mb-1 text-xs text-slate-500">
                    {selectedOption.visibility === 'public' ? (selectedOption.username ? `@${selectedOption.username}` : 'Публичная') : selectedOption.visibility === 'private' ? 'Приватная' : 'Публичность не проверена'}
                    {selectedOption.tgChatId ? <span className="font-mono ml-2">{selectedOption.tgChatId}</span> : null}
                  </div>
                ) : null}
                <RightsBadges result={rights} selectedId={selectedId} />
                {savingContour ? (
                  <div className="mt-1 text-[12px] font-medium text-slate-400">Сохраняем выбор...</div>
                ) : null}
                {summary.text ? (
                  <div className="mt-1 text-[11px] font-medium text-slate-500">{summary.text}</div>
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
    <div className="border-t border-slate-100">
      <div className="p-6 md:p-8 border-b border-slate-100">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Users className="size-4 text-slate-400" />
            <div>
              <div className="text-[15px] font-bold text-slate-900">Telegram-площадки</div>
              <div className="text-sm text-slate-500">Открытые и закрытые каналы/чаты, где бот — админ.</div>
            </div>
          </div>
          {targets.length ? (
            <div className="px-3 py-1.5 rounded-lg bg-slate-100 text-sm font-bold text-slate-600">{targets.length}</div>
          ) : null}
        </div>
      </div>

      {!targets.length ? (
        <div className="p-8 text-center">
          <p className="text-sm text-slate-400 font-bold">Площадок пока нет</p>
          <p className="mt-1 text-[13px] text-slate-400">Назначьте бота админом в канале или чате.</p>
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {targets.map((target) => {
            const isRefreshing = refreshingTelegramPlaceId === String(target.id);
            const categoryLabel = formatPlaceCategory(target);
            const categoryColor = placeCategoryColor(target);
            const username = String(target?.username || '').trim().replace(/^@/, '');
            return (
              <div key={target.id} className="px-6 md:px-8 py-4 hover:bg-slate-50/50 transition-colors">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[14px] font-bold text-slate-900 truncate">{target.title || target.tg_chat_id || 'Без названия'}</span>
                      <span className={`inline-flex px-2 py-0.5 rounded-md text-[10px] font-black uppercase border ${categoryColor}`}>{categoryLabel}</span>
                      {username ? (
                        <span className="inline-flex px-2 py-0.5 rounded-md text-[10px] font-black uppercase border border-indigo-200 bg-indigo-50 text-indigo-700">@{username}</span>
                      ) : null}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      <span className="font-mono">{target.tg_chat_id || '—'}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[12px] font-bold text-slate-600 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 disabled:cursor-wait disabled:opacity-60"
                      onClick={() => refreshTelegramPlaceInfo(target)}
                      disabled={isRefreshing}
                    >
                      <RefreshCw className={`size-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                      {isRefreshing ? 'Обновляем' : 'Обновить'}
                    </button>
                    <button
                      className="h-9 px-3 rounded-lg border border-rose-200 bg-rose-50 text-[12px] font-bold text-rose-600 hover:bg-rose-100 transition-all inline-flex items-center gap-1.5"
                      onClick={() => deleteTelegramPlace(target)}
                    >
                      <Trash2 className="size-3.5" />
                      Удалить
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
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
    <div className="bg-white border border-slate-200/60 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
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
