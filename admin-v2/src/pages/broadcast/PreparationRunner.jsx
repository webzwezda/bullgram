const STATUS_LABELS = {
  pending: 'Стартуем...',
  scanning: 'Сканируем точки прикосновения',
  joining: 'Вступаем в группы',
  recomputing: 'Пересчитываем матрицу',
  ready: 'Готово',
  failed: 'Ошибка',
  cancelled: 'Отменено'
};

function phaseLine(detail) {
  if (!detail) return '';
  const parts = [];
  if (detail.scan && detail.scan.total > 0) {
    parts.push(`скан юзерботов ${detail.scan.done}/${detail.scan.total}`);
  }
  if (detail.joins && detail.joins.total > 0) {
    parts.push(`вступления ${detail.joins.done}/${detail.joins.total}`);
  }
  return parts.join(' • ');
}

export function PreparationRunner({ preparation, onCancel }) {
  const status = preparation?.status || 'pending';
  const detail = preparation?.phase_detail || {};
  const errors = detail.errors || [];
  const failed = status === 'failed' || status === 'cancelled';

  return (
    <div className="toolbar-card section">
      <div className="toolbar-card__title">
        {STATUS_LABELS[status] || status}
        {!failed && status !== 'ready' ? '...' : ''}
      </div>

      {phaseLine(detail) ? (
        <div className="toolbar-card__hint">{phaseLine(detail)}</div>
      ) : null}

      {detail.note ? (
        <div className="toolbar-card__hint" style={{ color: '#b45309' }}>{detail.note}</div>
      ) : null}

      {preparation?.error ? (
        <div className="error-card">{preparation.error}</div>
      ) : null}

      {errors.length > 0 ? (
        <div className="list-stack" style={{ marginTop: '12px' }}>
          {errors.slice(-8).map((error, index) => (
            <div key={index} className="list-item">
              <div className="list-item__title" style={{ color: '#b45309' }}>{error}</div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="toolbar-card__body" style={{ marginTop: '12px' }}>
        {failed ? (
          <span className="pill pill--warning">{STATUS_LABELS[status]}</span>
        ) : (
          <span className="pill">экран сам обновляется</span>
        )}
        {!failed ? (
          <button className="ghost-button" onClick={onCancel}>Отменить подготовку</button>
        ) : null}
      </div>
    </div>
  );
}
