import { useMemo } from 'react';

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
      text: 'Назначьте бота админом в закрытой группе или канале'
    };
  }

  return {
    status: 'Подключена',
    text: summarizeTargets(targets)
  };
}

function botChatMeta(targets = []) {
  if (!Array.isArray(targets) || !targets.length) {
    return {
      status: 'Не подключен',
      text: 'Назначьте бота админом в чате'
    };
  }

  return {
    status: 'Подключен',
    text: summarizeTargets(targets)
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
    tone: 'warning'
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
    <div className="space-y-5">
      {/* Подключение бота */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-4 text-lg font-semibold text-slate-950">Подключить бота</h3>
        <p className="mb-4 text-sm text-slate-500">
          Получи токен у{' '}
          <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="font-semibold text-sky-600 underline">
            @BotFather
          </a>
        </p>

        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:gap-3">
          <input
            className="field h-11 rounded-xl border-slate-200 bg-slate-50 text-[14px]"
            type="text"
            value={botForm.botToken}
            onChange={(event) => setBotForm((prev) => ({ ...prev, botToken: event.target.value }))}
            placeholder="8123456789:AAE_x7v9Kq2LmN4pR8sTuVwXyZ0abCDeFg"
          />
          <select
            className="field h-11 rounded-xl border-slate-200 bg-slate-50 text-[14px]"
            value={botForm.botRole}
            onChange={(event) => setBotForm((prev) => ({ ...prev, botRole: event.target.value }))}
          >
            <option value="sales">Продажи доступа</option>
            <option value="placeholder">Заготовка</option>
          </select>
          <button
            className="h-11 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            onClick={addOfficialBot}
            disabled={state.savingBot}
          >
            {state.savingBot ? 'Подключаем...' : 'Подключить'}
          </button>
        </div>

        {botForm.botRole === 'sales' && (
          <div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
            <p className="font-medium text-slate-700">Роль: продажи доступа</p>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs">
              <li>Принятие оплат и выдача доступа</li>
              <li>Авто удаление клиента после окончания тарифа</li>
              <li>Добавление покупателей в CRM</li>
              <li>Авто напоминания о продлении</li>
            </ul>
          </div>
        )}
      </section>

      {/* Назначение админа */}
      {selectedOfficialBot && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="mb-4 text-lg font-semibold text-slate-950">Админ бота</h3>

          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <div>
              <label className="field-group">
                <span className="text-sm">Бот</span>
                <select
                  className="field h-11 rounded-xl border-slate-200 bg-slate-50 text-[14px]"
                  value={selectedOfficialBot ? String(selectedOfficialBot.id) : ''}
                  onChange={(event) => setSelectedOfficialBotId(event.target.value)}
                >
                  {officialBots.map((account) => (
                    <option key={account.id} value={account.id}>
                      @{account.tg_username || `bot-${String(account.tg_account_id || account.id)}`}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div>
              <label className="field-group">
                <span className="text-sm">Telegram ID админа</span>
                <input
                  className="field h-11 rounded-xl border-slate-200 bg-slate-50 text-[14px]"
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
          </div>

          <div className="mt-3 flex items-center justify-between">
            <p className="text-xs text-slate-500">
              Узнай свой ID у{' '}
              <a href="https://t.me/userinfobot" target="_blank" rel="noreferrer" className="font-semibold text-sky-600 underline">
                @userinfobot
              </a>
            </p>
            <button
              className="h-9 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              onClick={() => saveBotAdmin(selectedOfficialBot)}
              disabled={state.savingBotAdminId === String(selectedOfficialBot.id)}
            >
              {state.savingBotAdminId === String(selectedOfficialBot.id) ? 'Сохраняем...' : 'Сохранить'}
            </button>
          </div>
        </section>
      )}

      {/* Список ботов */}
      {officialBots.length === 0 ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="text-sm text-slate-500">Ботов пока нет. Подключи первого бота выше.</p>
        </section>
      ) : (
        <section className="space-y-3">
          {officialBots.map((account) => {
            const botTargets = channelsByBotId[String(account.id)] || [];
            const chatTargets = botTargets.filter(isChatTarget);
            const groupTargets = botTargets.filter((target) => !isChatTarget(target));
            const groupsMeta = botGroupMeta(groupTargets);
            const chatsMeta = botChatMeta(chatTargets);
            const adminMeta = botAdminMeta(account, state.paymentAdminTgId);

            return (
              <article key={account.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <h4 className="text-base font-semibold text-slate-950">
                        @{account.tg_username || `bot-${String(account.tg_account_id || account.id)}`}
                      </h4>
                      <span className="text-xs text-slate-500">Роль: продажи</span>
                    </div>

                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      <div>
                        <p className="text-xs text-slate-500">Группа/канал</p>
                        <p className={`text-sm font-medium ${groupsMeta.status === 'Подключена' ? 'text-green-600' : 'text-slate-700'}`}>
                          {groupsMeta.status}
                        </p>
                        <p className="text-xs text-slate-600">{groupsMeta.text}</p>
                      </div>

                      <div>
                        <p className="text-xs text-slate-500">Чат</p>
                        <p className={`text-sm font-medium ${chatsMeta.status === 'Подключен' ? 'text-green-600' : 'text-slate-700'}`}>
                          {chatsMeta.status}
                        </p>
                        <p className="text-xs text-slate-600">{chatsMeta.text}</p>
                      </div>

                      <div>
                        <p className="text-xs text-slate-500">Админ</p>
                        <p className={`text-sm font-medium ${adminMeta.status === 'Назначен' ? 'text-green-600' : 'text-slate-700'}`}>
                          {adminMeta.status}
                        </p>
                        <p className="text-xs text-slate-600">{adminMeta.text}</p>
                      </div>
                    </div>
                  </div>

                  <button
                    className="text-sm text-red-600 hover:text-red-700 disabled:opacity-50"
                    onClick={() => deleteAccount(account)}
                    disabled={state.deletingAccountId === String(account.id)}
                  >
                    {state.deletingAccountId === String(account.id) ? 'Удаляем...' : 'Удалить'}
                  </button>
                </div>
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}
