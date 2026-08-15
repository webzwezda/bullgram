import { Loader2, Radar, AlertTriangle } from 'lucide-react';
import { Card, Section, SectionTitle, StatusBadge } from './ui.jsx';

const STATUS_LABELS = {
  pending: 'В очереди',
  scanning: 'Сканируем диалоги юзерботов',
  joining: 'Вступаем в группы',
  recomputing: 'Пересчитываем достижимость',
  ready: 'Готово',
  failed: 'Ошибка',
  cancelled: 'Отменено'
};

export function PreparationRunner({ preparation, onCancel }) {
  const phase = preparation?.phase_detail || {};
  const scan = phase.scan || { done: 0, total: 0 };
  const joins = phase.joins || { done: 0, total: 0 };
  const errors = (phase.errors || []).slice(-8);
  const active = ['pending', 'scanning', 'joining', 'recomputing'].includes(preparation?.status);
  const statusLabel = STATUS_LABELS[preparation?.status] || preparation?.status;

  return (
    <Card>
      <Section>
        <SectionTitle
          icon={Radar}
          action={
            <StatusBadge tone={active ? 'warning' : preparation?.status === 'ready' ? 'ok' : preparation?.status === 'failed' ? 'danger' : 'default'}>
              {statusLabel}
            </StatusBadge>
          }
        >
          Подготовка рассылки
        </SectionTitle>

        <div className="space-y-3">
          <div className="flex items-center gap-3 p-4 rounded-2xl bg-slate-50/60 border border-slate-100">
            {active ? <Loader2 className="w-4 h-4 animate-spin text-slate-500 shrink-0" /> : null}
            <div className="text-sm font-bold text-slate-900">
              Скан диалогов: {scan.done} / {scan.total || '—'}
            </div>
          </div>
          <div className="flex items-center gap-3 p-4 rounded-2xl bg-slate-50/60 border border-slate-100">
            {active ? <Loader2 className="w-4 h-4 animate-spin text-slate-500 shrink-0" /> : null}
            <div className="text-sm font-bold text-slate-900">
              Вступления: {joins.done} / {joins.total || '—'}
            </div>
          </div>
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
