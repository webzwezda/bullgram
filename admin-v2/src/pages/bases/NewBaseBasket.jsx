import { Plus, X } from 'lucide-react';

export function NewBaseBasket({ buffer, saving, pendingBaseId, draftName, onRemoveFromBuffer, onSaveOrRetry, onOpenManual }) {
  return (
    <div className="p-6 md:p-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
        <h3 className="text-sm font-black uppercase tracking-widest text-slate-500">Корзина</h3>
        <span className="text-xs font-bold text-slate-500">{buffer.length} в корзине</span>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button
          type="button"
          onClick={onOpenManual}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> + ID руками
        </button>
        <button
          type="button"
          onClick={onSaveOrRetry}
          disabled={saving || (pendingBaseId ? buffer.length === 0 : !draftName.trim())}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors ml-auto"
        >
          {saving ? 'Сохраняем…' : pendingBaseId ? 'Дозалить в созданную базу' : 'Сохранить базу'}
        </button>
      </div>

      {pendingBaseId ? (
        <div className="mb-4 p-3 rounded-xl bg-amber-50/60 border border-amber-200 text-xs text-amber-800">
          Базу создали, но залить в неё людей не вышло. Корзина цела — жми «Дозалить в созданную базу»: повтор не создаст дубль базы.
        </div>
      ) : null}

      {buffer.length === 0 ? (
        <div className="p-4 rounded-2xl bg-slate-50/50 border border-slate-100 text-sm text-slate-500 font-medium">
          Корзина пустая. Добавьте людей кнопкой «В базу» в аудитории сверху или «+ ID руками».
        </div>
      ) : (
        <div className="overflow-x-auto -mx-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50">
                <th className="px-4 py-3 text-left text-[11px] font-black uppercase tracking-widest text-slate-500">Кто</th>
                <th className="px-4 py-3 text-left text-[11px] font-black uppercase tracking-widest text-slate-500">Источник</th>
                <th className="px-4 py-3 text-right text-[11px] font-black uppercase tracking-widest text-slate-500"></th>
              </tr>
            </thead>
            <tbody>
              {buffer.slice(0, 200).map((entry) => (
                <tr key={entry.tempId} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/30 transition-colors">
                  <td className="px-4 py-3">
                    <div className="text-sm font-bold text-slate-900">
                      {entry.display_name || `TG ${entry.tg_user_id}`}
                    </div>
                    <div className="text-xs text-slate-500 font-mono">
                      {entry.username ? `@${entry.username}` : 'без username'} · {entry.tg_user_id}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-1 rounded-md text-[11px] font-bold ${
                      entry.source === 'manual' ? 'bg-slate-100 text-slate-600' : 'bg-emerald-50 text-emerald-700'
                    }`}>
                      {entry.source === 'manual' ? 'Вбит' : 'Из аудитории'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => onRemoveFromBuffer(entry.tempId)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {buffer.length > 200 ? (
            <div className="px-4 py-3 text-xs font-medium text-slate-500">
              Показываем первые 200 из {buffer.length}. Все попадут в базу при сохранении.
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
