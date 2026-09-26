// --- Formatters ---

export function formatWhen(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value));
}

export function formatTon(value) {
  return Number(value || 0).toFixed(4);
}

// Для ДОСТУПНОГО лимита: округление ВНИЗ до 4 знаков. Серверный лимит — 6 знаков,
// обычный toFixed(4) округляет вверх, и заявка на показанный максимум отклоняется.
export function formatTonFloor(value) {
  const v = Number(value || 0);
  return (Math.floor(v * 1e4) / 1e4).toFixed(4);
}

// --- Initial form states ---

export const TONE_COLORS = {
  success: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  ok: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  warning: 'bg-amber-100 text-amber-800 border-amber-200',
  error: 'bg-rose-100 text-rose-800 border-rose-200',
  danger: 'bg-rose-100 text-rose-800 border-rose-200',
  default: 'bg-slate-100 text-slate-700 border-slate-200'
};
