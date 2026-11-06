// Диалог подтверждения опасных действий AutopostManagePage (behavior-preserving
// разрезка 2026-11-07). confirmState/closeConfirm/confirmCancelRef живут на
// странице (там же esc-обработчик и авто-фокус) — сюда перенесён только рендер.
import { AlertTriangle } from 'lucide-react';
import { Button } from '../../../components/ui/button.jsx';

export default function ConfirmDialog({ confirmState, closeConfirm, confirmCancelRef }) {
  return (
    <>
      {/* Диалог подтверждения опасных действий */}
      {confirmState && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4"
          onClick={() => closeConfirm(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
            className="bg-white w-full max-w-md rounded-2xl shadow-xl p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${confirmState.danger ? 'bg-rose-50 text-rose-600' : 'bg-indigo-50 text-indigo-600'}`}>
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h3 id="confirm-dialog-title" className="text-lg font-bold text-slate-900">{confirmState.title}</h3>
                <p className="text-sm text-slate-500 mt-1 leading-relaxed">{confirmState.description}</p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                ref={confirmCancelRef}
                variant="outline"
                className="h-10 px-4 rounded-xl font-semibold border-slate-200 text-slate-700"
                onClick={() => closeConfirm(false)}
              >
                Отмена
              </Button>
              <Button
                className={`h-10 px-4 rounded-xl font-bold text-white shadow-md ${confirmState.danger ? 'bg-rose-600 hover:bg-rose-700 shadow-rose-200' : 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200'}`}
                onClick={() => {
                  const action = confirmState.onConfirm;
                  closeConfirm(true);
                  if (action) action();
                }}
              >
                {confirmState.actionLabel || 'Подтвердить'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
