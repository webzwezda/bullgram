import { AlertCircle } from 'lucide-react';

export function Card({ children, className = '' }) {
  return (
    <div className={`bg-white border border-slate-200/60 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden ${className}`}>
      {children}
    </div>
  );
}

export function Section({ children, className = '' }) {
  return <section className={`p-6 md:p-8 border-b border-slate-100 last:border-0 ${className}`}>{children}</section>;
}

export function SectionTitle({ icon: Icon, children, action }) {
  return (
    <div className="flex items-center justify-between gap-3 mb-4">
      <div className="flex items-center gap-2">
        {Icon ? <Icon className="w-5 h-5 text-slate-500" /> : null}
        <h2 className="text-sm font-black uppercase tracking-widest text-slate-400">{children}</h2>
      </div>
      {action}
    </div>
  );
}

export function EmptyNote({ children }) {
  return (
    <div className="p-4 rounded-2xl bg-slate-50/50 border border-slate-100 text-sm text-slate-500 font-medium">
      {children}
    </div>
  );
}

export function ErrorNote({ children }) {
  return (
    <div className="p-5 rounded-2xl bg-red-50 border border-red-100 text-red-600 font-bold text-sm flex items-center gap-3">
      <AlertCircle className="w-5 h-5 shrink-0" />
      {children}
    </div>
  );
}

const badgeTones = {
  ok: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  success: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  warning: 'bg-amber-100 text-amber-800 border-amber-200',
  danger: 'bg-rose-100 text-rose-800 border-rose-200',
  error: 'bg-rose-100 text-rose-800 border-rose-200',
  default: 'bg-slate-100 text-slate-700 border-slate-200'
};

export function StatusBadge({ tone = 'default', children }) {
  return (
    <span className={`inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold tracking-wide ${badgeTones[tone] || badgeTones.default}`}>
      {children}
    </span>
  );
}

export function StatTile({ label, value, tone = 'default', hint }) {
  const valueColor = tone === 'ok' || tone === 'success'
    ? 'text-emerald-600'
    : tone === 'warning'
      ? 'text-amber-600'
      : tone === 'danger' || tone === 'error'
        ? 'text-rose-600'
        : 'text-slate-900';
  return (
    <div className={`p-4 rounded-2xl border ${tone === 'warning' ? 'border-amber-200 bg-amber-50/40' : tone === 'danger' ? 'border-rose-200 bg-rose-50/40' : tone === 'ok' ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-200 bg-white'}`}>
      <div className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-1">{label}</div>
      <div className={`text-2xl font-black ${valueColor}`}>{value}</div>
      {hint ? <div className="text-xs text-slate-500 font-medium mt-1">{hint}</div> : null}
    </div>
  );
}

export function Th({ children, right = false }) {
  return <th className={`px-4 py-3 ${right ? 'text-right' : 'text-left'} text-[11px] font-black uppercase tracking-widest text-slate-400`}>{children}</th>;
}

export function Td({ children, right = false, className = '' }) {
  return <td className={`px-4 py-3 ${right ? 'text-right' : ''} ${className}`}>{children}</td>;
}

export function Tr({ children }) {
  return <tr className="border-b border-slate-50 last:border-0 hover:bg-slate-50/30 transition-colors">{children}</tr>;
}

export function TableShell({ children }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

export const inputCls = 'w-full px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-sm font-bold text-slate-900 focus:outline-none focus:border-slate-400 shadow-sm transition';

export const btnPrimary = 'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 !text-white text-xs font-bold hover:bg-slate-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap';

export const btnAccent = 'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 !text-white text-xs font-bold hover:bg-indigo-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap';

export const btnGhost = 'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-700 text-xs font-bold hover:bg-slate-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap';
