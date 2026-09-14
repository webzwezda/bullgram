const TONE_STYLES = {
  warning: { card: 'bg-amber-50 border-amber-200', dot: 'bg-amber-700', label: 'Внимание' },
  danger: { card: 'bg-red-50 border-red-200', dot: 'bg-red-700', label: 'Ошибка' }
};

// Денежные алерты «Кассы». [display:grid] вместо grid — legacy .grid из app.css
// перебивает Tailwind-колонки (паттерн CustomersPage).
export function PrioritySignalsGrid({ signals }) {
  if (signals.length === 0) return null;

  return (
    <div className="[display:grid] grid-cols-1 sm:grid-cols-2 gap-4">
      {signals.map((signal) => {
        const tone = TONE_STYLES[signal.tone] || TONE_STYLES.warning;
        return (
          <article
            key={signal.title}
            className={`rounded-2xl border p-4 ${tone.card}`}
          >
            <div className="flex items-center gap-2">
              <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${tone.dot}`} />
              <span className="text-[11px] font-black uppercase tracking-widest text-slate-500">
                {tone.label}
              </span>
            </div>
            <h3 className="mt-1.5 text-sm font-bold text-slate-900">{signal.title}</h3>
            <p className="mt-0.5 text-xs font-medium text-slate-500">{signal.text}</p>
          </article>
        );
      })}
    </div>
  );
}
