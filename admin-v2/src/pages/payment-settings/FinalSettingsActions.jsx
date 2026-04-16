export function FinalSettingsActions({ isPlansMode, onSave, saving }) {
  return (
    <div className="toolbar-card">
      <div className="toolbar-card__title">Финальный шаг</div>
      <div className="toolbar-card__body">
        <button className="ghost-button" type="button" onClick={() => onSave()} disabled={saving}>
          {saving ? 'Сохраняем...' : 'Сохранить настройки'}
        </button>
        {isPlansMode ? (
          <a className="ghost-button" href="/app/referrals" target="_blank" rel="noreferrer">
            Открыть партнерку
          </a>
        ) : null}
      </div>
    </div>
  );
}
