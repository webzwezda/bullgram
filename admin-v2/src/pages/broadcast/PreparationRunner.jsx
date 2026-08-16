import { useEffect, useState } from 'react';
import { Loader2, Radar, AlertTriangle, Check } from 'lucide-react';
import { Card, Section, SectionTitle, StatusBadge } from './ui.jsx';

const STATUS_LABELS = {
  pending: 'В очереди',
  scanning: 'Сканируем диалоги',
  joining: 'Вступаем в группы',
  recomputing: 'Пересчитываем покрытие',
  ready: 'Готово',
  failed: 'Ошибка',
  cancelled: 'Отменено'
};

function fmtDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function PhaseRow({ label, done, total, current, finished }) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null;
  return (
    <div className={`p-4 rounded-2xl border transition-all ${
      current ? 'bg-indigo-50/60 border-indigo-200'
      : finished ? 'bg-slate-50/60 border-slate-100'
      : 'bg-white border-slate-100 opacity-55'
    }`}>
      <div className="flex items-center gap-3">
        {current ? (
          <Loader2 className="w-4 h-4 animate-spin text-indigo-600 shrink-0" />
        ) : finished ? (
          <Check className="w-4 h-4 text-emerald-500 shrink-0" />
        ) : (
          <span className="w-4 h-4 rounded-full border-2 border-slate-200 shrink-0" />
        )}
        <div className="text-sm font-bold text-slate-900 flex-1">{label}</div>
        <div className="text-xs font-black text-slate-500">{total > 0 ? `${done} / ${total}` : '—'}</div>
      </div>
      <div className="mt-3 h-1.5 rounded-full bg-slate-200/70 overflow-hidden">
        {pct != null ? (
          <div
            className={`h-full rounded-full transition-all duration-500 ${finished ? 'bg-emerald-500' : 'bg-indigo-500'}`}
            style={{ width: `${pct}%` }}
          />
        ) : current ? (
          <div className="h-full w-full bg-indigo-300/70 animate-pulse rounded-full" />
        ) : null}
      </div>
    </div>
  );
}

export function PreparationRunner({ preparation, onCancel, children }) {
  const phase = preparation?.phase_detail || {};
  const scan = phase.scan || { done: 0, total: 0 };
  const joins = phase.joins || { done: 0, total: 0 };
  const errors = (phase.errors || []).slice(-8);
  const status = preparation?.status;
  const active = ['pending', 'scanning', 'joining', 'recomputing'].includes(status);
  const statusLabel = STATUS_LABELS[status] || status;

  const [mountedTs] = useState(() => Date.now());
  const [nowTs, setNowTs] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const timer = window.setInterval(() => setNowTs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  const scanCurrent = status === 'pending' || status === 'scanning';
  const scanFinished = ['joining', 'recomputing', 'ready'].includes(status);
  const joinsCurrent = status === 'joining';
  const joinsFinished = ['recomputing', 'ready'].includes(status);
  const recomputeCurrent = status === 'recomputing';

  const totalOps = (scan.total || 0) + (joins.total || 0);
  const doneOps = Math.min(scan.done, scan.total || 0) + Math.min(joins.done, joins.total || 0);
  const overallPct = totalOps > 0 ? Math.min(100, Math.round((doneOps / totalOps) * 100)) : null;

  const startTs = preparation?.created_at ? new Date(preparation.created_at).getTime() : mountedTs;
  const elapsedSeconds = Math.max(0, Math.floor((nowTs - startTs) / 1000));
  const updatedTs = preparation?.updated_at ? new Date(preparation.updated_at).getTime() : null;
  const secondsSinceUpdate = updatedTs ? Math.max(0, Math.floor((nowTs - updatedTs) / 1000)) : null;
  const looksStalled = active && secondsSinceUpdate != null && secondsSinceUpdate > 120;

  return (
    <Card>
      <Section>
        <SectionTitle
          icon={Radar}
          action={
            <StatusBadge tone={active ? 'warning' : status === 'ready' ? 'ok' : status === 'failed' ? 'danger' : 'default'}>
              {statusLabel}
            </StatusBadge>
          }
        >
          Подготовка
        </SectionTitle>

        {active ? (
          <div className="mb-5">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-bold text-slate-500">Общий прогресс</span>
              <span className="text-xs font-black text-indigo-600">{overallPct != null ? `${overallPct}%` : 'оцениваем…'}</span>
            </div>
            <div className="h-2 rounded-full bg-slate-200/70 overflow-hidden">
              {overallPct != null ? (
                <div className="h-full bg-indigo-600 rounded-full transition-all duration-500" style={{ width: `${overallPct}%` }} />
              ) : (
                <div className="h-full w-full bg-indigo-400/70 animate-pulse rounded-full" />
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400 font-medium">
              <span>в работе {fmtDuration(elapsedSeconds)}</span>
              {secondsSinceUpdate != null ? <span>· обновление {fmtDuration(secondsSinceUpdate)} назад</span> : null}
            </div>
          </div>
        ) : null}

        <div className="space-y-3">
          <PhaseRow label="Скан диалогов" done={scan.done} total={scan.total} current={scanCurrent} finished={scanFinished} />
          <PhaseRow label="Вступления в группы" done={joins.done} total={joins.total} current={joinsCurrent} finished={joinsFinished} />
          <PhaseRow label="Пересчёт покрытия" done={0} total={0} current={recomputeCurrent} finished={status === 'ready'} />
          {looksStalled ? (
            <div className="p-4 rounded-2xl bg-amber-50/60 border border-amber-200 text-xs text-amber-800 font-medium">
              Нет обновлений уже {fmtDuration(secondsSinceUpdate)} — это нормально: между вступлениями пауза около 45 секунд, плюс лимиты Telegram на вступления в час. Если пауза затянулась больше часа — отмени и запусти подготовку заново.
            </div>
          ) : null}
          {phase.note ? (
            <div className="p-4 rounded-2xl bg-slate-50/50 border border-slate-100 text-sm text-slate-500 font-medium">
              {phase.note}
            </div>
          ) : null}
          {preparation?.error ? (
            <div className="p-4 rounded-2xl bg-rose-50/60 border border-rose-200 text-sm text-rose-700 font-medium">
              {preparation.error}
            </div>
          ) : null}
          {errors.length > 0 ? (
            <div className="space-y-2">
              {errors.map((error, index) => (
                <div key={`${index}-${error.slice(0, 20)}`} className="flex items-start gap-2.5 p-3 rounded-2xl bg-amber-50/60 border border-amber-200 text-xs text-amber-800 font-medium">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  {error}
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {children}

        {active ? (
          <div className="mt-5">
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-rose-200 text-rose-600 text-xs font-bold hover:bg-rose-50 transition-colors"
            >
              Отменить подготовку
            </button>
          </div>
        ) : null}
      </Section>
    </Card>
  );
}
