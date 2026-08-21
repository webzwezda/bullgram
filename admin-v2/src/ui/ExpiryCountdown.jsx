import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';

export function ExpiryCountdown({ expiresAt, prefix = '', className = '' }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - now;
  if (!Number.isFinite(ms)) return null;

  const totalSec = Math.max(Math.floor(ms / 1000), 0);
  const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const ss = String(totalSec % 60).padStart(2, '0');
  const urgent = ms > 0 && ms < 5 * 60 * 1000;
  const done = ms <= 0;

  return (
    <span
      className={`inline-flex items-center gap-1.5 tabular-nums font-mono ${done ? 'text-slate-400' : urgent ? 'text-rose-600 font-bold' : 'text-slate-600'} ${className}`}
      aria-label={`${prefix} ${mm}:${ss}`}
    >
      <Clock className="size-3.5" aria-hidden />
      {prefix ? <span className="font-sans">{prefix}</span> : null}
      {mm}:{ss}
    </span>
  );
}
