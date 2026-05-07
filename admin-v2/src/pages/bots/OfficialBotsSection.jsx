import { Bot, ShieldAlert, Trash2, CheckCircle2, Users, UserCog, ExternalLink, RefreshCw } from 'lucide-react';
import { SalesContourSection } from './SalesContourSection.jsx';

function adminContextMeta(accountOrAdminTgId) {
  const adminTgId = typeof accountOrAdminTgId === 'object'
    ? accountOrAdminTgId?.admin_tg_id
    : accountOrAdminTgId;
  const adminTgUsername = typeof accountOrAdminTgId === 'object'
    ? String(accountOrAdminTgId?.admin_tg_username || '').trim().replace(/^@/, '')
    : '';

  if (!adminTgId) return 'Не указан';
  return adminTgUsername ? `TG ID ${adminTgId} • @${adminTgUsername}` : `TG ID ${adminTgId}`;
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

function formatVisibility(target) {
  const visibility = String(target?.visibility || '').toLowerCase();
  const username = String(target?.username || '').trim().replace(/^@/, '');
  if (visibility === 'public') return username ? `Публичная @${username}` : 'Публичная';
  if (visibility === 'private') return 'Приватная';
  return 'Публичность не проверена';
}

function SelectChevron() {
  return (
    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
    </div>
  );
}

function ConnectOfficialBotCard({
  botForm,
  setBotForm,
  state,
  addOfficialBot
}) {
  return (
    <section className="overflow-hidden rounded-3xl border border-slate-200/60 bg-white shadow-[0_8px_30px_rgb(0,0,0,0.04)] transition-all hover:border-slate-300/60">
      <div className="relative z-10 flex flex-col gap-4 border-b border-slate-100 bg-white p-6 sm:flex-row sm:items-center sm:justify-between md:p-8">
        <div className="flex items-center gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-lg shadow-blue-500/20">
            <Bot className="size-6" />
          </div>
          <div>
            <h3 className="text-xl font-black tracking-tight text-slate-900">Подключить нового бота</h3>
            <p className="mt-0.5 text-sm font-medium text-slate-500">Через официальный API Telegram</p>
          </div>
        </div>
        <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-5 py-2.5 text-[13px] font-bold text-slate-700 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700">
          Открыть @BotFather <ExternalLink className="size-3.5" />
        </a>
      </div>

      <div className="bg-slate-50/50 p-6 md:p-8">
        <div className="grid grid-cols-1 gap-5 md:grid-cols-12">
          <div className="md:col-span-7">
            <label className="flex flex-col gap-2">
              <span className="flex items-center text-sm font-bold text-slate-700">
                Bot Token
                <span className="ml-2 rounded-md border border-blue-200/50 bg-blue-100/50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-blue-600">Обязательно</span>
              </span>
              <input
                className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 font-mono text-[15px] font-medium text-slate-900 shadow-sm transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                type="text"
                value={botForm.botToken}
                onChange={(event) => setBotForm((prev) => ({ ...prev, botToken: event.target.value }))}
                placeholder="8123456789:AAE_x7v9Kq2Lm..."
                spellCheck="false"
              />
            </label>
          </div>

          <div className="md:col-span-3">
            <label className="flex flex-col gap-2">
              <span className="text-sm font-bold text-slate-700">Тип бота</span>
              <div className="relative">
                <select
                  className="h-12 w-full cursor-pointer appearance-none rounded-xl border border-slate-200 bg-white pl-4 pr-10 text-[15px] font-medium text-slate-900 shadow-sm transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  value={botForm.botKind}
                  onChange={(event) => setBotForm((prev) => ({ ...prev, botKind: event.target.value }))}
                >
                  <option value="sales">Бот продаж</option>
                  <option value="template">Заготовка</option>
                </select>
                <SelectChevron />
              </div>
            </label>
          </div>

          <div className="flex items-end md:col-span-2">
            <button
              className="h-12 w-full rounded-xl bg-blue-600 text-[15px] font-bold text-white shadow-sm shadow-blue-500/20 transition-all hover:bg-blue-700 active:scale-[0.98] disabled:pointer-events-none disabled:bg-slate-200 disabled:text-slate-400 disabled:opacity-70 disabled:shadow-none"
              onClick={addOfficialBot}
              disabled={state.savingBot || !botForm.botToken.trim()}
            >
              {state.savingBot ? '...' : 'Подключить'}
            </button>
          </div>
        </div>

        {botForm.botKind === 'sales' ? (
          <div className="mt-5 flex flex-wrap gap-x-6 gap-y-3 rounded-2xl border border-blue-100/50 bg-blue-50/50 p-4">
            {['Выдает ссылки после оплаты', 'Исключает при неоплате', 'Напоминает о продлении', 'Заносит в CRM'].map((item) => (
              <div key={item} className="flex items-center gap-2 text-[13px] font-medium text-slate-600">
                <CheckCircle2 className="size-4 shrink-0 text-blue-500" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-100/80 p-4 text-[13px] font-medium text-slate-600">
            Заготовка подключается сразу, но контур продаж и боевые Telegram-настройки для нее не требуются.
          </div>
        )}
      </div>
    </section>
  );
}

function AdminSettingsPanel({
  selectedOfficialBot,
  botAdminDrafts,
  setBotAdminDrafts,
  saveBotAdmin,
  state
}) {
  const selectedBotId = String(selectedOfficialBot.id);
  const adminDraftValue = Object.prototype.hasOwnProperty.call(botAdminDrafts, selectedBotId)
    ? botAdminDrafts[selectedBotId]
    : selectedOfficialBot.admin_tg_id || '';

  return (
    <article className="flex min-h-[248px] flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex min-w-0 gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
          <UserCog className="size-5" />
        </div>
        <div className="min-w-0">
          <h4 className="text-sm font-black text-slate-900">Админ</h4>
          <p className="mt-0.5 text-xs font-medium text-slate-500">{adminContextMeta(selectedOfficialBot)}</p>
        </div>
      </div>

      <label className="grid gap-2">
        <span className="text-xs font-black uppercase tracking-wider text-slate-400">Telegram ID</span>
        <input
          className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20"
          type="text"
          value={adminDraftValue}
          onChange={(event) => setBotAdminDrafts((prev) => ({
            ...prev,
            [selectedBotId]: event.target.value
          }))}
          placeholder={state.paymentAdminTgId ? `${state.paymentAdminTgId}` : '488609412'}
        />
      </label>

      <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
        <p className="text-sm font-black text-slate-700">Контакт админа</p>
        <p className="mt-0.5 line-clamp-2 text-xs font-medium text-slate-500">{adminContextMeta(selectedOfficialBot)}</p>
      </div>

      <div className="mt-auto grid gap-2 pt-3">
        <button
          className="h-10 rounded-xl bg-slate-900 text-[13px] font-bold text-white shadow-sm transition hover:bg-slate-800 disabled:pointer-events-none disabled:opacity-70"
          onClick={() => saveBotAdmin(selectedOfficialBot)}
          disabled={state.savingBotAdminId === selectedBotId}
        >
          {state.savingBotAdminId === selectedBotId ? 'Сохраняем...' : 'Сохранить'}
        </button>
        <a href="https://t.me/userinfobot" target="_blank" rel="noreferrer" className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-[13px] font-bold text-slate-700 transition hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700">
          Узнать ID <ExternalLink className="size-3.5" />
        </a>
      </div>
    </article>
  );
}

function SelectedOfficialBotWorkspace({
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
  const adminSlot = (
    <AdminSettingsPanel
      selectedOfficialBot={selectedOfficialBot}
      botAdminDrafts={botAdminDrafts}
      setBotAdminDrafts={setBotAdminDrafts}
      saveBotAdmin={saveBotAdmin}
      state={state}
    />
  );

  return (
    <section className="overflow-hidden rounded-3xl border border-slate-200/60 bg-white shadow-[0_8px_30px_rgb(0,0,0,0.04)] transition-all hover:border-slate-300/60">
      <div className="relative z-10 flex flex-col gap-4 border-b border-slate-100 bg-white p-6 sm:flex-row sm:items-center sm:justify-between md:p-8">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-600 text-white shadow-lg shadow-indigo-500/20">
            <ShieldAlert className="size-6" />
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-xl font-black tracking-tight text-slate-900">Настройка выбранного бота</h3>
            <p className="mt-0.5 truncate text-sm font-medium text-slate-500">
              {botTitle(selectedOfficialBot)} · {botKindLabel(kind)}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-5 bg-slate-50/50 p-6 md:p-8">
        <div className="grid grid-cols-1 gap-5 md:grid-cols-12">
          <div className="md:col-span-4">
            <label className="flex flex-col gap-2">
              <span className="text-sm font-bold text-slate-700">Выберите бота</span>
              <div className="relative">
                <select
                  className="h-12 w-full cursor-pointer appearance-none rounded-xl border border-slate-200 bg-white pl-4 pr-10 text-[15px] font-medium text-slate-900 shadow-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
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
            </label>
          </div>

          <div className="md:col-span-3">
            <label className="flex flex-col gap-2">
              <span className="text-sm font-bold text-slate-700">Тип бота</span>
              <div className="relative">
                <select
                  className="h-12 w-full cursor-pointer appearance-none rounded-xl border border-slate-200 bg-white pl-4 pr-10 text-[15px] font-medium text-slate-900 shadow-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:cursor-wait"
                  value={kind}
                  onChange={(event) => saveBotKind(selectedOfficialBot, event.target.value)}
                  disabled={state.savingBotKindId === selectedBotId}
                >
                  <option value="sales">Бот продаж</option>
                  <option value="template">Заготовка</option>
                </select>
                <SelectChevron />
              </div>
              <p className="text-xs font-medium text-slate-500">
                {state.savingBotKindId === selectedBotId
                  ? 'Сохраняем тип бота...'
                  : kind === 'sales'
                    ? 'Ниже открывается контур продаж.'
                    : 'Заготовка живет без sales-контура.'}
              </p>
            </label>
          </div>

        </div>

        {kind === 'template' ? (
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-5">
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-600 2xl:col-span-4">
              Это заготовка. Runtime продаж и контур для нее не используются, но токен и админа можно держать наготове.
            </div>
            {adminSlot}
          </div>
        ) : salesContourSectionProps?.isVisible ? (
          <SalesContourSection
            {...salesContourSectionProps}
            adminSlot={adminSlot}
            selectedOfficialBot={selectedOfficialBot}
          />
        ) : null}
      </div>
    </section>
  );
}

function TelegramPlacesList({
  selectedOfficialBot,
  channelsByBotId,
  saveTelegramPlaceType,
  deleteTelegramPlace,
  refreshTelegramPlaceInfo,
  refreshingTelegramPlaceId
}) {
  const selectedBotId = String(selectedOfficialBot?.id || '');
  const targets = channelsByBotId[selectedBotId] || [];

  if (!selectedOfficialBot) return null;

  if (!targets.length) {
    return (
      <section className="overflow-hidden rounded-3xl border border-slate-200/60 bg-white shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
        <div className="p-6 md:p-8 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              <Users className="size-5" />
            </div>
            <div>
              <h3 className="text-[15px] font-bold text-slate-900">Telegram-площадки</h3>
              <p className="text-sm text-slate-500">Группы, чаты и каналы где бот — админ.</p>
            </div>
          </div>
        </div>
        <div className="p-8 text-center">
          <Users className="mx-auto mb-3 size-10 text-slate-200" />
          <p className="text-sm text-slate-400 font-bold">Площадок пока нет</p>
          <p className="mt-1 text-[13px] text-slate-400">Назначьте бота админом в группе или канале.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-3xl border border-slate-200/60 bg-white shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
      <div className="p-6 md:p-8 border-b border-slate-100">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              <Users className="size-5" />
            </div>
            <div>
              <h3 className="text-[15px] font-bold text-slate-900">Telegram-площадки</h3>
              <p className="text-sm text-slate-500">Группы, чаты и каналы где бот — админ.</p>
            </div>
          </div>
          <div className="px-3 py-1.5 rounded-lg bg-slate-100 text-sm font-bold text-slate-600">
            {targets.length}
          </div>
        </div>
      </div>
      <div className="divide-y divide-slate-100">
        {targets.map((target) => {
          const isRefreshing = refreshingTelegramPlaceId === String(target.id);
          const chatType = String(target.chat_type || '').toLowerCase();
          const typeLabel = chatType === 'channel' ? 'Канал' : chatType === 'group' ? 'Группа' : chatType === 'supergroup' ? 'Супергруппа' : 'Неизвестно';
          const typeColor = chatType === 'channel' ? 'bg-violet-50 text-violet-600 border-violet-200' : 'bg-blue-50 text-blue-600 border-blue-200';
          const vis = String(target?.visibility || '').toLowerCase();
          const visLabel = vis === 'public' ? (target.username ? `@${target.username}` : 'Публичная') : vis === 'private' ? 'Приватная' : 'Не проверено';
          const visColor = vis === 'public' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : vis === 'private' ? 'bg-slate-100 text-slate-600 border-slate-200' : 'bg-amber-50 text-amber-600 border-amber-200';
          return (
            <div key={target.id} className="p-5 md:px-8 md:py-5 hover:bg-slate-50/50 transition-colors">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[14px] font-bold text-slate-900 truncate">{target.title || target.tg_chat_id || 'Без названия'}</span>
                    <span className={`inline-flex px-2 py-0.5 rounded-md text-[10px] font-black uppercase border ${typeColor}`}>{typeLabel}</span>
                    <span className={`inline-flex px-2 py-0.5 rounded-md text-[10px] font-black uppercase border ${visColor}`}>{visLabel}</span>
                  </div>
                  <div className="mt-2 text-xs text-slate-500 font-mono">
                    {target.tg_chat_id || '—'}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <select
                    className="h-9 px-3 rounded-lg border border-slate-200 bg-white text-[13px] font-bold text-slate-700 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                    value={chatType}
                    onChange={(event) => saveTelegramPlaceType(target, event.target.value)}
                  >
                    <option value="channel">Канал</option>
                    <option value="group">Группа</option>
                    <option value="supergroup">Супергруппа</option>
                  </select>
                  <button
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[12px] font-bold text-slate-600 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 disabled:cursor-wait disabled:opacity-60"
                    onClick={() => refreshTelegramPlaceInfo(target)}
                    disabled={isRefreshing}
                  >
                    <RefreshCw className={`size-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                    {isRefreshing ? 'Обновляем' : 'Обновить'}
                  </button>
                  <button
                    className="h-9 px-3 rounded-lg border border-rose-200 bg-rose-50 text-[12px] font-bold text-rose-600 transition-colors hover:bg-rose-100 hover:text-rose-700 inline-flex items-center gap-1.5"
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
    </section>
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
  channelsByBotId,
  saveTelegramPlaceType,
  deleteTelegramPlace,
  refreshTelegramPlaceInfo,
  refreshingTelegramPlaceId,
  salesContourSectionProps
}) {
  return (
    <div className="space-y-6">
      <ConnectOfficialBotCard
        botForm={botForm}
        setBotForm={setBotForm}
        state={state}
        addOfficialBot={addOfficialBot}
      />

      <SelectedOfficialBotWorkspace
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

      <TelegramPlacesList
        selectedOfficialBot={selectedOfficialBot}
        channelsByBotId={channelsByBotId}
        saveTelegramPlaceType={saveTelegramPlaceType}
        deleteTelegramPlace={deleteTelegramPlace}
        refreshTelegramPlaceInfo={refreshTelegramPlaceInfo}
        refreshingTelegramPlaceId={refreshingTelegramPlaceId}
      />
    </div>
  );
}
