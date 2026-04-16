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
      status: 'Группа не подключена',
      text: 'Назначьте бота админом в закрытой группе или канале, чтобы Telegram прислал событие.',
      tone: 'warning'
    };
  }

  return {
    status: targets.length > 1 ? 'Админ в группах' : 'Админ в группе',
    text: summarizeTargets(targets),
    tone: 'ok'
  };
}

function botChatMeta(targets = []) {
  if (!Array.isArray(targets) || !targets.length) {
    return {
      status: 'Чат не подключен',
      text: 'Назначьте бота админом в чате, если тариф должен выдавать доступ еще и туда.',
      tone: 'warning'
    };
  }

  return {
    status: targets.length > 1 ? 'Админ в чатах' : 'Админ в чате',
    text: summarizeTargets(targets),
    tone: 'ok'
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
      status: 'Админ назначен',
      text: adminContextMeta(account),
      tone: 'ok'
    };
  }

  if (fallbackAdminTgId) {
    return {
      status: 'Админ из Billing',
      text: adminContextMeta(fallbackAdminTgId),
      tone: 'warning'
    };
  }

  return {
    status: 'Админ не назначен',
    text: 'Укажите Telegram ID в блоке выше, чтобы бот знал, кому отдавать чеки и админские сигналы.',
    tone: 'warning'
  };
}

function officialBotRoleMeta(botRole) {
  if (botRole === 'placeholder') {
    return {
      title: 'Заготовка',
      lines: [
        'Это заготовка под следующую роль official-бота. Здесь позже можно будет подключать отдельного бота под постинг, антиспам или составные сценарии доступа.',
        'Пока эта роль только резервирует место в интерфейсе и не подключается в рабочий контур.'
      ]
    };
  }

  return {
    title: 'Продажи доступа',
    lines: [
      'Принятие оплат и выдача однаразовой ссылки доступа в группу',
      'Выдача цыфровых материалов, доступ в чат и закрытую группу',
      'Узнает своего админа и отдает ему чеки СБП',
      'Авто удаление клиента если закончился срок купленного тарифа',
      'Добавление покупателя в CRM',
      'Авто напоминание о продление тарифа',
      'Предоставление скидки если человек посмотрел но не оплатил в течении двух часов'
    ]
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
  const selectedOfficialBotRoleMeta = useMemo(
    () => officialBotRoleMeta(botForm.botRole),
    [botForm.botRole]
  );

  return (
    <>
      <div className="toolbar-card section section--first">
        <div className="toolbar-card__title">
          Подключить{' '}
          <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">
            @BotFather
          </a>
        </div>
        <div className="toolbar-card__body">
          <input
            className="field"
            type="text"
            value={botForm.botToken}
            onChange={(event) => setBotForm((prev) => ({ ...prev, botToken: event.target.value }))}
            placeholder="8123456789:AAE_x7v9Kq2LmN4pR8sTuVwXyZ0abCDeFg"
          />
          <select
            className="field"
            value={botForm.botRole}
            onChange={(event) => setBotForm((prev) => ({ ...prev, botRole: event.target.value }))}
          >
            <option value="sales">Продажи доступа</option>
            <option value="placeholder">Заготовка</option>
          </select>
          <button className="ghost-button ghost-button--primary" onClick={addOfficialBot} disabled={state.savingBot}>
            {state.savingBot ? 'Подключаем...' : 'Подключить'}
          </button>
        </div>
      </div>

      <div className="grid grid--double section">
        <div className="table-card">
          <div className="table-card__title">{selectedOfficialBotRoleMeta.title}</div>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-[14px] leading-6 text-slate-600">
            {selectedOfficialBotRoleMeta.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>

        <div className="table-card">
          <div className="table-card__title">Админ бота</div>
          {!selectedOfficialBot ? (
            <div className="table-subtext">
              Сначала подключи бота. После этого можно назначить админа.
            </div>
          ) : (
            <>
              <div className="official-bot-admin-form">
                <label className="field-group official-bot-admin-form__field">
                  <span>Бот</span>
                  <select
                    className="field"
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
                <label className="field-group official-bot-admin-form__field">
                  <span>Админ</span>
                  <input
                    className="field"
                    type="text"
                    value={Object.prototype.hasOwnProperty.call(botAdminDrafts, String(selectedOfficialBot.id))
                      ? botAdminDrafts[String(selectedOfficialBot.id)]
                      : selectedOfficialBot.admin_tg_id || ''}
                    onChange={(event) => setBotAdminDrafts((prev) => ({
                      ...prev,
                      [String(selectedOfficialBot.id)]: event.target.value
                    }))}
                    placeholder={state.paymentAdminTgId
                      ? `Например: ${state.paymentAdminTgId}`
                      : '488609412'}
                  />
                </label>
                <div className="official-bot-admin-form__actions">
                  <button
                    className="ghost-button ghost-button--primary"
                    onClick={() => saveBotAdmin(selectedOfficialBot)}
                    disabled={state.savingBotAdminId === String(selectedOfficialBot.id)}
                  >
                    {state.savingBotAdminId === String(selectedOfficialBot.id) ? 'Сохраняем...' : 'Назначить'}
                  </button>
                </div>
              </div>
              <div className="official-bot-admin-help">
                <div>Нужен числовой Telegram ID, не @username.</div>
                <div>
                  Узнай свой ID{' '}
                  <a href="https://t.me/userinfobot" target="_blank" rel="noreferrer">
                    @userinfobot
                  </a>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="section">
        {officialBots.length === 0 ? (
          <div className="table-card">
            <div className="empty-inline">Ботов пока нет.</div>
          </div>
        ) : (() => {
          const account = selectedOfficialBot || officialBots[0];
          const botTargets = channelsByBotId[String(account.id)] || [];
          const chatTargets = botTargets.filter(isChatTarget);
          const groupTargets = botTargets.filter((target) => !isChatTarget(target));
          const groupsMeta = botGroupMeta(groupTargets);
          const chatsMeta = botChatMeta(chatTargets);
          const adminMeta = botAdminMeta(account, state.paymentAdminTgId);

          return (
            <div className="official-bot-card">
              <div className="official-bot-card__main">
                <div className="official-bot-card__head">
                  <div className="official-bot-card__identity">
                    <select
                      className="field official-bot-card__select"
                      value={String(account.id)}
                      onChange={(event) => setSelectedOfficialBotId(event.target.value)}
                    >
                      {officialBots.map((item) => (
                        <option key={item.id} value={item.id}>
                          @{item.tg_username || `bot-${String(item.tg_account_id || item.id)}`}
                        </option>
                      ))}
                    </select>
                    <div className="official-bot-card__subtitle">Роль: продажи и доступ</div>
                  </div>
                  <button
                    className="official-bot-card__delete"
                    onClick={() => deleteAccount(account)}
                    disabled={state.deletingAccountId === String(account.id)}
                  >
                    {state.deletingAccountId === String(account.id) ? 'Удаляем...' : 'Удалить бота'}
                  </button>
                </div>
                <div className="official-bot-card__facts">
                  <div className={`official-bot-card__fact official-bot-card__fact--${groupsMeta.tone}`}>
                    <div className="official-bot-card__fact-label">{groupsMeta.status}</div>
                    <div className="official-bot-card__fact-text">{groupsMeta.text}</div>
                  </div>
                  <div className={`official-bot-card__fact official-bot-card__fact--${chatsMeta.tone}`}>
                    <div className="official-bot-card__fact-label">{chatsMeta.status}</div>
                    <div className="official-bot-card__fact-text">{chatsMeta.text}</div>
                  </div>
                  <div className={`official-bot-card__fact official-bot-card__fact--${adminMeta.tone}`}>
                    <div className="official-bot-card__fact-label">{adminMeta.status}</div>
                    <div className="official-bot-card__fact-text">{adminMeta.text}</div>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    </>
  );
}
