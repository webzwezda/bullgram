import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

export function CodeBlock({ value, label }) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    if (!value) return;
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100">
        <span className="text-xs font-semibold text-slate-500">{label}</span>
        <button
          type="button"
          className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          onClick={handleCopy}
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Скопировано' : 'Копировать'}
        </button>
      </div>
      <pre className="p-3 overflow-x-auto text-xs font-mono leading-5 text-slate-700"><code>{value}</code></pre>
    </div>
  );
}
