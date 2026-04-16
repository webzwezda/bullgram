export function BillingAdminIdSection({
  fillAdminIdFromUserbot,
  patchSettings,
  selectedUserbotId,
  setSelectedUserbotId,
  settings,
  userbots
}) {
  return (
    <div className="grid grid--double" style={{ marginBottom: 20 }}>
      <div className="table-card">
        <div className="table-card__title">Сервисный Telegram ID</div>
        <div className="form-grid">
          <div className="field-group">
            <span>admin_tg_id</span>
            <div className="field-inline">
              <input
                className="field"
                value={settings.admin_tg_id || ''}
                onChange={(event) => patchSettings({ admin_tg_id: event.target.value })}
                placeholder="123456789"
              />
              <button className="ghost-button" type="button" onClick={fillAdminIdFromUserbot}>
                Из юзербота
              </button>
            </div>
          </div>
          <label className="field-group">
            <span>Какой юзербот брать</span>
            <select className="field" value={selectedUserbotId} onChange={(event) => setSelectedUserbotId(event.target.value)}>
              <option value="">Выбери юзербота</option>
              {userbots.map((userbot) => (
                <option key={userbot.id} value={userbot.id}>
                  {userbot.tg_username ? `@${userbot.tg_username}` : `ID ${userbot.tg_account_id}`}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
    </div>
  );
}
