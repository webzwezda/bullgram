import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Copy, Download } from 'lucide-react';

export function SecretRevealBlock({ secret, title = 'Ваш секрет' }) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const onDownload = () => {
    try {
      const blob = new Blob([secret], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'secret.txt';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
  };

  return (
    <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{title}</div>
        <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
      </div>
      <pre className="font-mono text-sm text-slate-900 bg-white border border-slate-200 rounded-lg p-3 whitespace-pre-wrap break-all max-h-72 overflow-y-auto">
        {secret}
      </pre>
      <div className="flex flex-col sm:flex-row gap-2">
        <button
          type="button"
          onClick={onCopy}
          className={`flex-1 inline-flex items-center justify-center gap-2 h-11 px-4 rounded-xl text-sm font-bold transition-colors ${
            copied ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-900 text-white hover:bg-slate-800'
          }`}
        >
          {copied ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          {copied ? 'Скопировано' : 'Скопировать'}
        </button>
        <button
          type="button"
          onClick={onDownload}
          className="flex-1 inline-flex items-center justify-center gap-2 h-11 px-4 rounded-xl bg-white border border-slate-200 text-slate-700 text-sm font-bold hover:bg-slate-50 transition-colors"
        >
          <Download className="w-4 h-4" />
          Скачать .txt
        </button>
      </div>
      <p className="text-[11px] text-amber-700 leading-relaxed">
        Сохраните секрет сейчас — без ссылки его не восстановить.
      </p>
    </div>
  );
}
