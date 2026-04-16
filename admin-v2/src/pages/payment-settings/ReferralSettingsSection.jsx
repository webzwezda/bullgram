export function ReferralSettingsSection({ patchSettings, settings }) {
  return (
    <div className="table-card">
      <div className="table-card__title">Рефералка</div>
      <div className="form-grid">
        <label className="field-group">
          <span>Партнерка включена</span>
          <select
            className="field"
            value={settings.referral_enabled ? 'yes' : 'no'}
            onChange={(event) => patchSettings({ referral_enabled: event.target.value === 'yes' })}
          >
            <option value="no">Нет</option>
            <option value="yes">Да</option>
          </select>
        </label>
        <label className="field-group">
          <span>Процент награды</span>
          <input
            className="field"
            type="number"
            min="0"
            max="100"
            value={settings.referral_reward_percent || 0}
            onChange={(event) => patchSettings({ referral_reward_percent: Number(event.target.value || 0) })}
          />
        </label>
        <label className="field-group" style={{ gridColumn: '1 / -1' }}>
          <span>Текст приветствия по рефке</span>
          <textarea
            className="field field--textarea"
            value={settings.referral_welcome_text || ''}
            onChange={(event) => patchSettings({ referral_welcome_text: event.target.value })}
            placeholder="Что увидит человек, пришедший по партнерской ссылке"
          />
        </label>
      </div>
    </div>
  );
}
