import { Bot, Trash2, Users, UserCog, ExternalLink, RefreshCw, Loader2, CheckCircle2, AlertTriangle, Radio, MessageSquare, MessagesSquare, Link2, Lock, KeyRound, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

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

function ConnectBotForm({ botForm, setBotForm, state, addOfficialBot }) {
  return (
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
  );
}

function BotConfigSection({
  selectedOfficialBot,
  selectedOfficialBotId,
  setSelectedOfficialBotId,
  officialBots,
  botForm,
  setBotForm,
  addOfficialBot,
  state,
  salesContourSectionProps,
  channelsByBotId,
  deleteTelegramPlace,
  refreshTelegramPlaceInfo,
  refreshingTelegramPlaceId
}) {
  const isNew = selectedOfficialBotId === 'new';

  const contourDraftWithProps = salesContourSectionProps?.draft
    ? { ...salesContourSectionProps.draft, _props: salesContourSectionProps }
    : null;

  const selectedBotId = String(selectedOfficialBot?.id || '');
  const targets = channelsByBotId?.[selectedBotId] || [];

  return (
    <Card className="border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 bg-white overflow-hidden rounded-2xl">
      <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex flex-row items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-500/20 shrink-0">
              <Bot className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900">
                {isNew ? 'Подключение бота' : 'Бот продаж'}
              </h2>
              <p className="text-sm font-medium text-slate-500 mt-0.5">
                {isNew
                  ? 'Получите токен у @BotFather и вставьте сюда.'
                  : 'Конфигурация, тип и уведомления о продажах.'}
              </p>
            </div>
          </div>

          <Select value={selectedOfficialBotId || 'new'} onValueChange={setSelectedOfficialBotId}>
            <SelectTrigger className="h-10 w-[220px] bg-white rounded-xl border-slate-200 shadow-sm text-sm font-semibold">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="new" className="rounded-lg">➕ Подключить нового</SelectItem>
              {officialBots.map((account) => (
                <SelectItem key={account.id} value={account.id} className="rounded-lg py-2.5">
                  <span className="font-medium text-slate-900">{botTitle(account)}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isNew ? (
        <div className="p-5 sm:p-6 bg-white">
          <ConnectBotForm
            botForm={botForm}
            setBotForm={setBotForm}
            state={state}
            addOfficialBot={addOfficialBot}
          />
        </div>
      ) : (
        <>
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
                targets={targets}
                refreshTelegramPlaceInfo={refreshTelegramPlaceInfo}
                deleteTelegramPlace={deleteTelegramPlace}
                refreshingTelegramPlaceId={refreshingTelegramPlaceId}
              />
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}

function BotAdminsSection({
  selectedOfficialBot,
  botAdmins,
  botAdminsLoading,
  inviteLink,
  addingBotAdmin,
  newAdminTgId,
  setNewAdminTgId,
  handleAddBotAdmin,
  handleRemoveBotAdmin,
  handleRegenerateBotAdminInvite,
  regeneratingInvite
}) {
  if (!selectedOfficialBot) return null;

  const admins = Array.isArray(botAdmins) ? botAdmins : [];
  const loading = botAdminsLoading;
  const canCopy = typeof navigator !== 'undefined' && navigator.clipboard;

  async function copyInvite() {
    if (!inviteLink || !canCopy) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
    } catch (_) {}
  }

  return (
    <Card className="border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 bg-white overflow-hidden rounded-2xl">
      <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-500/20 shrink-0">
            <UserCog className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              Администраторы бота
              {admins.length > 0 && (
                <Badge variant="secondary" className="bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border-0 text-xs rounded-full px-2">
                  {admins.length}
                </Badge>
              )}
            </h2>
            <p className="text-sm font-medium text-slate-500 mt-0.5">
              Управляйте доступом: ссылка-приглашение, ручное добавление, удаление.
            </p>
          </div>
        </div>
      </div>

      <div className="p-5 sm:p-6 space-y-6 bg-white">
        {/* Ссылка-приглашение */}
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-500 block">
            Ссылка-приглашение
          </label>
          {loading ? (
            <div className="h-11 rounded-xl bg-slate-50 border border-slate-100 flex items-center px-4 text-sm text-slate-500">
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Загрузка…
            </div>
          ) : inviteLink ? (
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                readOnly
                value={inviteLink}
                onClick={copyInvite}
                className="font-mono bg-slate-50 h-11 rounded-xl border-slate-200 shadow-sm cursor-pointer text-xs sm:text-sm flex-1"
              />
              <div className="flex gap-2">
                <Button
                  onClick={copyInvite}
                  variant="outline"
                  className="h-11 px-4 rounded-xl border-slate-200 bg-white text-slate-700 hover:bg-slate-50 shadow-sm font-bold"
                >
                  Копировать
                </Button>
                <Button
                  onClick={handleRegenerateBotAdminInvite}
                  disabled={regeneratingInvite}
                  variant="outline"
                  className="h-11 px-4 rounded-xl border-slate-200 bg-white text-slate-700 hover:bg-slate-50 shadow-sm font-bold"
                >
                  {regeneratingInvite ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                  Новая
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <Button
                onClick={handleRegenerateBotAdminInvite}
                disabled={regeneratingInvite}
                className="h-11 px-5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold shadow-md shadow-indigo-200"
              >
                {regeneratingInvite ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                Создать ссылку-приглашение
              </Button>
              <span className="text-xs font-medium text-slate-500 max-w-md">
                Пользователь перейдёт по ссылке в бота и автоматически получит доступ администратора.
              </span>
            </div>
          )}
        </div>

        {/* Список текущих админов */}
        <div className="space-y-3">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-500 block">
            Администраторы ({admins.length})
          </label>
          {loading ? (
            <div className="space-y-2">
              {[0, 1].map((i) => (
                <div key={i} className="h-14 rounded-2xl bg-slate-50 border border-slate-100 animate-pulse" />
              ))}
            </div>
          ) : admins.length === 0 ? (
            <div className="rounded-2xl border border-slate-100 bg-slate-50/50 p-8 text-center">
              <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center mx-auto mb-3 ring-1 ring-slate-100">
                <UserCog className="w-6 h-6 text-slate-300" />
              </div>
              <p className="text-sm text-slate-700 font-bold">Администраторов пока нет</p>
              <p className="mt-1 text-sm text-slate-500">Создайте ссылку-приглашение или добавьте TG ID вручную выше.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {admins.map((adminId, idx) => {
                const isOwner = idx === 0;
                return (
                  <div key={adminId} className="flex items-center justify-between p-4 bg-slate-50/50 hover:bg-slate-100 rounded-2xl border border-slate-100 transition-all gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center shrink-0">
                        <span className="text-xs font-bold text-indigo-600">{isOwner ? '★' : '#'}</span>
                      </div>
                      <span className="font-mono text-sm font-bold text-slate-900 truncate">{String(adminId)}</span>
                    </div>
                    {isOwner ? (
                      <Badge variant="secondary" className="bg-indigo-50 text-indigo-700 border-0 text-xs font-bold px-2.5 py-1 rounded-md shrink-0">
                        Владелец
                      </Badge>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveBotAdmin(adminId)}
                        className="text-rose-500 hover:text-rose-600 hover:bg-rose-50 h-9 px-3 rounded-lg shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                        Удалить
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Ручное добавление */}
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-500 block">
            Добавить вручную по Telegram ID
          </label>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              value={newAdminTgId}
              onChange={(e) => setNewAdminTgId(e.target.value)}
              placeholder="Пример: 123456789"
              className="h-11 bg-white rounded-xl border-slate-200 shadow-sm focus-visible:ring-indigo-500 font-mono flex-1"
            />
            <Button
              onClick={handleAddBotAdmin}
              disabled={!newAdminTgId.trim() || addingBotAdmin}
              className="h-11 px-5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold shadow-md shadow-indigo-200"
            >
              {addingBotAdmin ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
              Добавить
            </Button>
          </div>
        </div>
      </div>
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

  async function handleAdd(optionId) {
    const next = [...selectedIds, String(optionId)];
    if (setFieldValue) {
      try {
        await setFieldValue({
          selectedUserbotIds: next,
          selectedUserbotId: '',
          userbotMode: 'pool'
        }, null, { autoSave: true });
        setAdding(false);
        salesContourSectionProps?.triggerJoinAll?.();
      } catch (err) {
        console.error('Failed to add userbot to contour:', err);
      }
    } else {
      setAdding(false);
    }
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
        <div className="px-5 sm:px-6 py-4 border-y border-slate-100 bg-slate-50/50 flex items-center gap-3">
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
            className="h-11 rounded-xl text-slate-600 border-slate-200 bg-white hover:bg-slate-50 font-bold"
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
              <div key={option.id} className="p-3 bg-slate-50/50 hover:bg-slate-100 rounded-2xl border border-slate-100 flex items-center justify-between gap-4 transition-all">
                <div className="flex items-center gap-4 min-w-0">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-2.5 h-2.5 rounded-full shadow-sm shrink-0" style={{ backgroundColor: statusColor(option.runtimeStatus) }} />
                    <span className="text-sm font-bold text-slate-900 truncate">{option.title}</span>
                  </div>
                  <div className="w-px h-4 bg-slate-200 shrink-0"></div>
                  <div className="flex items-center gap-2 shrink-0">
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
                  className="h-9 px-3 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg shrink-0"
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
  reregisterWebhook,
  state
}) {
  if (!selectedOfficialBot) return null;

  const accountId = String(selectedOfficialBot.id || '');
  const isBusy = state.webhookRuntimeActionId === accountId;
  const statusMeta = webhookStatusMeta(selectedOfficialBot);
  const isError = statusMeta.title === 'Ошибка подключения';

  if (!isError) return null;

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
          <div className="flex flex-wrap gap-2 w-full sm:w-auto">
            <Button
              variant="outline"
              className="h-11 rounded-xl border-rose-200 text-rose-700 bg-white hover:bg-rose-100 hover:text-rose-800 font-bold shadow-sm w-full sm:w-auto"
              onClick={() => refreshOfficialBotWebhookStatus(selectedOfficialBot)}
              disabled={isBusy}
            >
              {isBusy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
              Проверить webhook
            </Button>
            <Button
              className="h-11 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold shadow-sm shadow-indigo-200 w-full sm:w-auto"
              onClick={() => reregisterWebhook?.(selectedOfficialBot)}
              disabled={isBusy || !reregisterWebhook}
            >
              {isBusy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
              Переподключить webhook
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
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
  if (!selectedId) {
    return (
      <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100/50 px-2.5 py-1 text-xs font-bold text-slate-500 shadow-sm">
        Укажите площадку, чтобы проверить права бота.
      </div>
    );
  }

  if (!result) {
    return (
      <div className="text-[11px] text-slate-400 italic">
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
        <span className="text-[10px] font-medium text-slate-400 ml-1">+ {okCount} ок</span>
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
  checkBotRights,
  checkingBotRightsTarget,
  botRightsByTarget,
  contourError,
  targets,
  refreshTelegramPlaceInfo,
  deleteTelegramPlace,
  refreshingTelegramPlaceId
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
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center">
            <Link2 className="w-4 h-4 text-indigo-600" />
          </div>
          <div className="text-base font-bold text-slate-900">Привязка площадок</div>
        </div>

        <div className="[display:grid] grid-cols-1 sm:grid-cols-2 gap-3 items-stretch">
          {ROLE_CONFIGS.map((config) => (
            <ContourCard
              key={config.key}
              config={config}
              draft={draft}
              setFieldValue={setFieldValue}
              savingContour={savingContour}
              checkBotRights={checkBotRights}
              checkingBotRightsTarget={checkingBotRightsTarget}
              botRightsByTarget={botRightsByTarget}
              targets={targets}
              refreshTelegramPlaceInfo={refreshTelegramPlaceInfo}
              deleteTelegramPlace={deleteTelegramPlace}
              refreshingTelegramPlaceId={refreshingTelegramPlaceId}
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
  checkBotRights,
  checkingBotRightsTarget,
  botRightsByTarget,
  targets,
  refreshTelegramPlaceInfo,
  deleteTelegramPlace,
  refreshingTelegramPlaceId
}) {
  const Icon = config.icon;
  const options = optionsForRole(config, draft._props || {});
  const selectedId = String(draft[config.field] || '');
  const selectedOption = options.find((o) => String(o.id) === selectedId);
  const selectedTarget = (targets || []).find((t) => String(t.id) === selectedId) || null;
  const isRefreshingSelected = !!selectedTarget && refreshingTelegramPlaceId === String(selectedTarget.id);
  const connected = !!selectedId;
  const rights = botRightsByTarget[config.key] || null;
  const summary = rightsSummary(rights, selectedId);
  const checking = checkingBotRightsTarget === config.key;

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
        ) : (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-50 text-slate-500 border border-slate-200 shrink-0">
            Ожидание
          </span>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1 min-w-0">
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
          <Button
            variant="outline"
            className="h-9 px-3 text-xs rounded-xl text-slate-700 bg-white border-slate-200 shadow-sm font-bold hover:bg-slate-50 flex-1 sm:flex-initial justify-center"
            onClick={() => checkBotRights(config.key)}
            disabled={!selectedId || checking}
          >
            {checking ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5 mr-1.5 text-slate-400" />}
            {checking ? 'Проверка...' : 'Проверить права'}
          </Button>
          {selectedTarget ? (
            <>
              <button
                type="button"
                title="Обновить информацию из Telegram"
                onClick={() => refreshTelegramPlaceInfo?.(selectedTarget)}
                disabled={isRefreshingSelected}
                className="inline-flex items-center justify-center w-9 h-9 rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50 shadow-sm transition-colors shrink-0"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingSelected ? 'animate-spin' : ''}`} />
              </button>
              <button
                type="button"
                title="Удалить площадку из BullRun"
                onClick={() => deleteTelegramPlace?.(selectedTarget)}
                className="inline-flex items-center justify-center w-9 h-9 rounded-xl border border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100 shadow-sm transition-colors shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </>
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
              <span>Канал стал {becameLabel} — нажмите «Обновить» для авто-переноса в правильный слот.</span>
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

      <RightsBadges result={rights} selectedId={selectedId} />

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

function FreePlacesSection({
  selectedOfficialBot,
  channelsByBotId,
  deleteTelegramPlace,
  refreshTelegramPlaceInfo,
  refreshingTelegramPlaceId,
  assignedIds
}) {
  const selectedBotId = String(selectedOfficialBot?.id || '');
  const allTargets = channelsByBotId?.[selectedBotId] || [];
  const freeTargets = allTargets.filter((t) => !assignedIds.has(String(t.id)));

  if (!selectedOfficialBot || !freeTargets.length) return null;

  return (
    <Card className="border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 bg-white overflow-hidden rounded-2xl">
      <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6">
        <div className="flex flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-slate-200 flex items-center justify-center text-white shadow-md shrink-0">
              <Users className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                Свободные площадки
                <Badge variant="secondary" className="bg-slate-100 text-slate-700 hover:bg-slate-200 border-0 text-xs rounded-full px-2">
                  {freeTargets.length}
                </Badge>
              </h2>
              <p className="text-sm font-medium text-slate-500 mt-0.5">Не привязаны ни к одной роли. Назначьте в карточках выше или удалите.</p>
            </div>
          </div>
        </div>
      </div>

      <div className="p-5 sm:p-6 space-y-2 bg-white">
        {freeTargets.map((target) => {
          const isRefreshing = refreshingTelegramPlaceId === String(target.id);
          const categoryLabel = formatPlaceCategory(target);
          const categoryColor = placeCategoryColor(target);
          const username = String(target?.username || '').trim().replace(/^@/, '');

          return (
            <div key={target.id} className="p-4 bg-slate-50/50 hover:bg-slate-100 rounded-2xl border border-slate-100 transition-all">
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
                    <span className="font-mono bg-white px-2 py-0.5 rounded-md border border-slate-100">{target.tg_chat_id || '—'}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    variant="outline"
                    className="h-11 rounded-xl text-slate-700 font-bold border-slate-200 bg-white hover:bg-slate-50 shadow-sm"
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
  refreshOfficialBotWebhookStatus,
  reregisterWebhook,
  channelsByBotId,
  deleteTelegramPlace,
  refreshTelegramPlaceInfo,
  refreshingTelegramPlaceId,
  salesContourSectionProps,
  addingBotAdmin,
  botAdmins,
  botAdminsLoading,
  handleAddBotAdmin,
  handleRemoveBotAdmin,
  handleRegenerateBotAdminInvite,
  inviteLink,
  newAdminTgId,
  regeneratingInvite,
  setNewAdminTgId
}) {
  const isNew = selectedOfficialBotId === 'new';

  const contourDraft = salesContourSectionProps?.draft || {};
  const assignedIds = new Set(
    [
      contourDraft.publicChannelId,
      contourDraft.publicChatId,
      contourDraft.paidChannelId,
      contourDraft.paidChatId
    ]
      .filter(Boolean)
      .map((value) => String(value))
  );

  return (
    <div className="flex flex-col gap-6">
      {!isNew ? (
        <BotRuntimeSection
          selectedOfficialBot={selectedOfficialBot}
          refreshOfficialBotWebhookStatus={refreshOfficialBotWebhookStatus}
          reregisterWebhook={reregisterWebhook}
          state={state}
        />
      ) : null}

      <BotConfigSection
        selectedOfficialBot={selectedOfficialBot}
        selectedOfficialBotId={selectedOfficialBotId}
        setSelectedOfficialBotId={setSelectedOfficialBotId}
        officialBots={officialBots}
        botForm={botForm}
        setBotForm={setBotForm}
        addOfficialBot={addOfficialBot}
        state={state}
        salesContourSectionProps={salesContourSectionProps}
        channelsByBotId={channelsByBotId}
        deleteTelegramPlace={deleteTelegramPlace}
        refreshTelegramPlaceInfo={refreshTelegramPlaceInfo}
        refreshingTelegramPlaceId={refreshingTelegramPlaceId}
      />

      {!isNew ? (
        <BotAdminsSection
          selectedOfficialBot={selectedOfficialBot}
          botAdmins={botAdmins}
          botAdminsLoading={botAdminsLoading}
          inviteLink={inviteLink}
          addingBotAdmin={addingBotAdmin}
          newAdminTgId={newAdminTgId}
          setNewAdminTgId={setNewAdminTgId}
          handleAddBotAdmin={handleAddBotAdmin}
          handleRemoveBotAdmin={handleRemoveBotAdmin}
          handleRegenerateBotAdminInvite={handleRegenerateBotAdminInvite}
          regeneratingInvite={regeneratingInvite}
        />
      ) : null}

      {!isNew ? (
        <FreePlacesSection
          selectedOfficialBot={selectedOfficialBot}
          channelsByBotId={channelsByBotId}
          deleteTelegramPlace={deleteTelegramPlace}
          refreshTelegramPlaceInfo={refreshTelegramPlaceInfo}
          refreshingTelegramPlaceId={refreshingTelegramPlaceId}
          assignedIds={assignedIds}
        />
      ) : null}
    </div>
  );
}
