import { TONE_COLORS } from './treasury.utils.js';

export function StatusBadge({ tone, children }) {
  return (
    <span className={`inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold tracking-wide ${TONE_COLORS[tone] || TONE_COLORS.default}`}>
      {children}
    </span>
  );
}
