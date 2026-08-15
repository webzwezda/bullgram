export function ExternalTargetsField({ value, onChange, disabled }) {
  return (
    <div className="toolbar-card section">
      <div className="toolbar-card__title">Сторонние группы для вступления</div>
      <div className="toolbar-card__body">
        <textarea
          className="field"
          rows="3"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          placeholder={'@durov\nhttps://t.me/+AbCdEf...\nПо одной группе на строку'}
        />
      </div>
      <div className="toolbar-card__hint" style={{ color: '#b45309' }}>
        Юзерботы вступят в указанные группы, чтобы получить точки прикосновения к недостающим людям.
        Это агрессивное действие — Telegram может ограничить аккаунты. Продолжая, ты принимаешь риск.
      </div>
      <div className="toolbar-card__hint">
        Вступления идут медленно и по очереди: лимит на аккаунт в час + паузы, чтобы не поймать flood wait.
      </div>
    </div>
  );
}
