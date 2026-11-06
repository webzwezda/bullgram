import { ChevronDown } from 'lucide-react';

export function StatusBadge({ tone, children, className = '' }) {
  const colorMap = {
    success: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    warning: 'bg-amber-100 text-amber-800 border-amber-200',
    error: 'bg-rose-100 text-rose-800 border-rose-200',
    danger: 'bg-rose-100 text-rose-800 border-rose-200',
    ok: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    default: 'bg-slate-100 text-slate-700 border-slate-200'
  };
  return (
    <span className={`inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold tracking-wide transition-colors ${colorMap[tone] || colorMap.default} ${className}`}>
      {children}
    </span>
  );
}

export function ModernSwitch({ checked, onChange, disabled, activeColor = 'bg-indigo-600' }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? activeColor : 'bg-slate-200'
      }`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
          checked ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

export function CollapsiblePanelHeader({ icon: Icon, iconClassName, title, open, onToggle }) {
  return (
    <h3 className="mb-3">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-1 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 rounded-lg hover:opacity-80 transition-opacity"
      >
        <Icon className={iconClassName} aria-hidden="true" />
        <span className="text-sm font-bold text-slate-900">{title}</span>
        <ChevronDown
          aria-hidden="true"
          className={`ml-auto w-4 h-4 text-ink-muted transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>
    </h3>
  );
}
