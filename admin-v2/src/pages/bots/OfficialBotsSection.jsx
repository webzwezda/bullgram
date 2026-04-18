import { useMemo } from 'react';
import { Bot, KeyRound, ShieldAlert, Trash2, CheckCircle2, AlertCircle, MessageSquare, Users, UserCog, ExternalLink } from 'lucide-react';

function summarizeTargets(targets = []) {
  const titles = targets
    .map((target) => String(target?.title || target?.tg_chat_id || '').trim())
    .filter(Boolean);

  return titles.length <= 2 ? titles.join(', ') : `${titles.slice(0, 2).join(', ')} +${titles.length - 2}`;
}

function isChatTarget(target) {
  const chatType = String(target?.chat_type || '').toLowerCase();
  return chatType === 'group' || chatType === 'supergroup';
}

function botGroupMeta(targets = []) {
  if (!Array.isArray(targets) || !targets.length) {
    return {
      status: 'Не подключена',
      text: 'Назначьте бота админом в закрытой группе или канале',
      ok: false
    };
  }

  return {
    status: 'Подключена',
    text: summarizeTargets(targets),
    ok: true
  };
}

function botChatMeta(targets = []) {
  if (!Array.isArray(targets) || !targets.length) {
    return {
      status: 'Не подключен',
      text: 'Назначьте бота админом в чате',
      ok: false
    };
  }

  return {
    status: 'Подключен',
    text: summarizeTargets(targets),
    ok: true
  };
}

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

function botAdminMeta(account, fallbackAdminTgId) {
  if (account?.admin_tg_id) {
    return {
      status: 'Назначен',
      text: adminContextMeta(account),
      tone: 'ok'
    };
  }

  if (fallbackAdminTgId) {
    return {
      status: 'Из Billing',
      text: adminContextMeta(fallbackAdminTgId),
      tone: 'warning'
    };
  }

  return {
    status: 'Не назначен',
    text: 'Укажите Telegram ID',
    tone: 'error'
  };
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
  deleteAccount,
  channelsByBotId
}) {
  return (
    <div className="pt-6 space-y-6">

      {/* Подключение бота */}
      <section className="bg-white border border-slate-200/60 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden transition-all hover:border-slate-300/60">
        <div className="p-6 md:p-8 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white relative z-10">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/20 text-white shrink-0">
              <Bot className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-xl font-black text-slate-900 tracking-tight">Подключить нового бота</h3>
              <p className="text-sm text-slate-500 font-medium mt-0.5">Через официальный API Telegram</p>
            </div>
          </div>
          <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="shrink-0 inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-slate-50 hover:bg-blue-50 text-slate-700 hover:text-blue-700 text-[13px] font-bold rounded-xl transition-colors border border-slate-200 hover:border-blue-200">
            Открыть @BotFather <ExternalLink className="w-3.5 h-3.5"/>
          </a>
        </div>

        <div className="p-6 md:p-8 bg-slate-50/50">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
            <div className="md:col-span-7">
              <label className="flex flex-col gap-2">
                <span className="text-sm font-bold text-slate-700 flex items-center">
                  Bot Token
                  <span className="ml-2 text-[10px] font-bold tracking-wider uppercase text-blue-600 bg-blue-100/50 px-2 py-0.5 rounded-md border border-blue-200/50">Обязательно</span>
                </span>
                <input
                  className="w-full h-12 px-4 rounded-xl border border-slate-200 bg-white text-[15px] font-medium text-slate-900 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 placeholder:text-slate-400 font-mono shadow-sm"
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
                <span className="text-sm font-bold text-slate-700">Роль бота</span>
                <div className="relative">
                  <select
                    className="w-full h-12 pl-4 pr-10 rounded-xl border border-slate-200 bg-white text-[15px] font-medium text-slate-900 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 appearance-none cursor-pointer shadow-sm"
                    value={botForm.botRole}
                    onChange={(event) => setBotForm((prev) => ({ ...prev, botRole: event.target.value }))}
                  >
                    <option value="sales">Продажи доступа</option>
                    <option value="placeholder">Заготовка</option>
                  </select>
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                  </div>
                </div>
              </label>
            </div>

            <div className="md:col-span-2 flex items-end">
              <button
                className="w-full h-12 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-[15px] font-bold shadow-sm shadow-blue-500/20 transition-all active:scale-[0.98] disabled:opacity-70 disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none disabled:pointer-events-none"
                onClick={addOfficialBot}
                disabled={state.savingBot || !botForm.botToken.trim()}
              >
                {state.savingBot ? '...' : 'Подключить'}
              </button>
            </div>
          </div>

          {botForm.botRole === 'sales' && (
            <div className="mt-5 flex flex-wrap gap-x-6 gap-y-3 p-4 bg-blue-50/50 rounded-2xl border border-blue-100/50">
              <div className="flex items-center gap-2 text-[13px] font-medium text-slate-600">
                <CheckCircle2 className="w-4 h-4 text-blue-500 shrink-0" />
                <span>Выдает ссылки после оплаты</span>
              </div>
              <div className="flex items-center gap-2 text-[13px] font-medium text-slate-600">
                <CheckCircle2 className="w-4 h-4 text-blue-500 shrink-0" />
                <span>Исключает при неоплате</span>
              </div>
              <div className="flex items-center gap-2 text-[13px] font-medium text-slate-600">
                <CheckCircle2 className="w-4 h-4 text-blue-500 shrink-0" />
                <span>Напоминает о продлении</span>
              </div>
              <div className="flex items-center gap-2 text-[13px] font-medium text-slate-600">
                <CheckCircle2 className="w-4 h-4 text-blue-500 shrink-0" />
                <span>Заносит в CRM</span>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Назначение админа */}
      {selectedOfficialBot && (
        <section className="bg-white border border-slate-200/60 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden transition-all hover:border-slate-300/60">
          <div className="p-6 md:p-8 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white relative z-10">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/20 text-white shrink-0">
                <ShieldAlert className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-xl font-black text-slate-900 tracking-tight">Админ бота</h3>
                <p className="text-sm text-slate-500 font-medium mt-0.5">Получатель сервисных уведомлений</p>
              </div>
            </div>
            <a href="https://t.me/userinfobot" target="_blank" rel="noreferrer" className="shrink-0 inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-slate-50 hover:bg-indigo-50 text-slate-700 hover:text-indigo-700 text-[13px] font-bold rounded-xl transition-colors border border-slate-200 hover:border-indigo-200">
              Узнать свой ID <ExternalLink className="w-3.5 h-3.5"/>
            </a>
          </div>

          <div className="p-6 md:p-8 bg-slate-50/50">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
              <div className="md:col-span-5">
                <label className="flex flex-col gap-2">
                  <span className="text-sm font-bold text-slate-700">Выберите бота</span>
                  <div className="relative">
                    <select
                      className="w-full h-12 pl-4 pr-10 rounded-xl border border-slate-200 bg-white text-[15px] font-medium text-slate-900 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 appearance-none cursor-pointer shadow-sm"
                      value={selectedOfficialBot ? String(selectedOfficialBot.id) : ''}
                      onChange={(event) => setSelectedOfficialBotId(event.target.value)}
                    >
                      {officialBots.map((account) => (
                        <option key={account.id} value={account.id}>
                          @{account.tg_username || `bot-${String(account.tg_account_id || account.id)}`}
                        </option>
                      ))}
                    </select>
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                    </div>
                  </div>
                </label>
              </div>

              <div className="md:col-span-5">
                <label className="flex flex-col gap-2">
                  <span className="text-sm font-bold text-slate-700">Telegram ID админа</span>
                  <input
                    className="w-full h-12 px-4 rounded-xl border border-slate-200 bg-white text-[15px] font-medium text-slate-900 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 placeholder:text-slate-400 shadow-sm"
                    type="text"
                    value={Object.prototype.hasOwnProperty.call(botAdminDrafts, String(selectedOfficialBot.id))
                      ? botAdminDrafts[String(selectedOfficialBot.id)]
                      : selectedOfficialBot.admin_tg_id || ''}
                    onChange={(event) => setBotAdminDrafts((prev) => ({
                      ...prev,
                      [String(selectedOfficialBot.id)]: event.target.value
                    }))}
                    placeholder={state.paymentAdminTgId
                      ? `${state.paymentAdminTgId}`
                      : '488609412'}
                  />
                </label>
              </div>

              <div className="md:col-span-2 flex items-end">
                <button
                  className="w-full h-12 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-[15px] font-bold shadow-sm transition-all active:scale-[0.98] disabled:opacity-70 disabled:pointer-events-none"
                  onClick={() => saveBotAdmin(selectedOfficialBot)}
                  disabled={state.savingBotAdminId === String(selectedOfficialBot.id)}
                >
                  {state.savingBotAdminId === String(selectedOfficialBot.id) ? '...' : 'Сохранить'}
                </button>
              </div>
            </div>
          </div>
        </section>
      )}
      {/* Список ботов */}
      {officialBots.length === 0 ? (
        <section className="bg-slate-50/50 border border-slate-200 border-dashed rounded-3xl p-10 flex flex-col items-center justify-center text-center">
          <Bot className="w-12 h-12 text-slate-300 mb-3" />
          <h4 className="text-lg font-bold text-slate-700 mb-1">Ботов пока нет</h4>
          <p className="text-sm text-slate-500 max-w-sm">Подключите первого официального бота для продаж через форму выше.</p>
        </section>
      ) : (
        <section className="grid gap-4">
          {officialBots.map((account) => {
            const botTargets = channelsByBotId[String(account.id)] || [];
            const chatTargets = botTargets.filter(isChatTarget);
            const groupTargets = botTargets.filter((target) => !isChatTarget(target));
            const groupsMeta = botGroupMeta(groupTargets);
            const chatsMeta = botChatMeta(chatTargets);
            const adminMeta = botAdminMeta(account, state.paymentAdminTgId);

            return (
              <article key={account.id} className="bg-white border border-slate-200/60 rounded-2xl p-5 shadow-[0_4px_20px_rgb(0,0,0,0.03)] transition-all hover:border-slate-300/60 hover:shadow-[0_4px_20px_rgb(0,0,0,0.06)]">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-5">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center">
                        <Bot className="w-5 h-5 text-blue-600" />
                      </div>
                      <div>
                        <h4 className="text-base font-bold text-slate-900">
                          @{account.tg_username || `bot-${String(account.tg_account_id || account.id)}`}
                        </h4>
                        <div className="inline-flex items-center gap-1.5 px-2 py-0.5 mt-1 bg-slate-100 text-slate-600 text-[11px] font-bold rounded-md uppercase tracking-wider">
                          Роль: продажи
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-3 max-w-3xl">
                      <div className="flex gap-3 items-start">
                        <Users className={`w-4 h-4 mt-0.5 shrink-0 ${groupsMeta.ok ? 'text-emerald-500' : 'text-slate-400'}`} />
                        <div>
                          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">Группа / Канал</p>
                          <p className={`text-sm font-bold ${groupsMeta.ok ? 'text-emerald-700' : 'text-slate-700'}`}>
                            {groupsMeta.status}
                          </p>
                          <p className="text-xs font-medium text-slate-500 mt-0.5 leading-snug">{groupsMeta.text}</p>
                        </div>
                      </div>

                      <div className="flex gap-3 items-start">
                        <MessageSquare className={`w-4 h-4 mt-0.5 shrink-0 ${chatsMeta.ok ? 'text-emerald-500' : 'text-slate-400'}`} />
                        <div>
                          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">Чат</p>
                          <p className={`text-sm font-bold ${chatsMeta.ok ? 'text-emerald-700' : 'text-slate-700'}`}>
                            {chatsMeta.status}
                          </p>
                          <p className="text-xs font-medium text-slate-500 mt-0.5 leading-snug">{chatsMeta.text}</p>
                        </div>
                      </div>

                      <div className="flex gap-3 items-start">
                        <UserCog className={`w-4 h-4 mt-0.5 shrink-0 ${adminMeta.tone === 'ok' ? 'text-emerald-500' : adminMeta.tone === 'warning' ? 'text-amber-500' : 'text-rose-400'}`} />
                        <div>
                          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">Админ</p>
                          <p className={`text-sm font-bold ${adminMeta.tone === 'ok' ? 'text-emerald-700' : adminMeta.tone === 'warning' ? 'text-amber-600' : 'text-rose-600'}`}>
                            {adminMeta.status}
                          </p>
                          <p className="text-xs font-medium text-slate-500 mt-0.5 leading-snug">{adminMeta.text}</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex shrink-0 border-t border-slate-100 pt-4 md:border-t-0 md:pt-0">
                    <button
                      className="flex items-center justify-center gap-2 w-full md:w-auto h-10 px-4 rounded-xl bg-rose-50 text-rose-600 hover:bg-rose-100 hover:text-rose-700 text-sm font-bold transition-colors disabled:opacity-50"
                      onClick={() => deleteAccount(account)}
                      disabled={state.deletingAccountId === String(account.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                      {state.deletingAccountId === String(account.id) ? 'Удаляем...' : 'Удалить'}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}
