import { Fragment } from 'react';
import { Database, Plus } from 'lucide-react';

export function BasesModeHeader({ bases, mode, activeBaseId, bufferCount, draftName, draftDescription, onSelectBase, onStartNew, onDraftNameChange, onDraftDescriptionChange }) {
  return (
    <Fragment>
      <div className="p-6 md:p-8 border-b border-slate-100">
        <div className="flex items-center gap-2 mb-3">
          <Database className="w-5 h-5 text-slate-500" />
          <h2 className="text-sm font-black uppercase tracking-widest text-slate-700">Базы клиентов</h2>
        </div>
        <p className="text-sm text-slate-600 max-w-2xl">
          Кураторские списки для точечных рассылок и дожима. Кнопка „В базу“ кладёт человека туда, куда указывает чип „Куда попадёт“ в таблице аудитории.
        </p>
      </div>

      <div className="p-6 md:p-8 border-b border-slate-100">
        {bases.length === 0 && mode === 'new' ? null : (
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => {
                  if (mode === 'existing') return;
                  if (bases.length > 0) onSelectBase(bases[0].id);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                  mode === 'existing' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                Существующая база
              </button>
              <button
                type="button"
                onClick={() => mode !== 'new' && onStartNew()}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                  mode === 'new' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                + Новая база
              </button>
            </div>
          </div>
        )}

        {mode === 'existing' ? (
          <Fragment>
            {bases.length === 0 ? (
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-sm text-slate-600 font-medium flex flex-wrap items-center justify-between gap-3">
                <span>Пока нет баз. Создайте первую или перекиньте людей из аудитории бота.</span>
                <button
                  type="button"
                  onClick={onStartNew}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-900 text-white hover:bg-slate-700 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" /> Создать базу
                </button>
              </div>
            ) : (
              <select
                value={activeBaseId || ''}
                onChange={(event) => onSelectBase(event.target.value)}
                className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm font-bold text-slate-900 focus:outline-none focus:border-slate-400 max-w-[420px]"
              >
                {bases.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}{b.stats?.total ? ` • ${b.stats.total} чел.` : ''}
                  </option>
                ))}
              </select>
            )}
          </Fragment>
        ) : (
          <div className="flex flex-col gap-3 max-w-xl">
            <input
              type="text"
              value={draftName}
              onChange={(event) => onDraftNameChange(event.target.value)}
              placeholder="Название базы"
              className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm font-bold text-slate-900 focus:outline-none focus:border-slate-400"
            />
            <input
              type="text"
              value={draftDescription}
              onChange={(event) => onDraftDescriptionChange(event.target.value)}
              placeholder="Описание (необязательно)"
              className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm text-slate-700 focus:outline-none focus:border-slate-400"
            />
            <div className="text-xs text-slate-500">
              В корзине: <span className="font-bold text-slate-700">{bufferCount}</span> · добавьте ещё через [В базу] в аудитории сверху или «+ ID руками».
            </div>
          </div>
        )}
      </div>
    </Fragment>
  );
}
