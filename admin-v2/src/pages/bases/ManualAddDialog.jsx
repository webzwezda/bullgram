import { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from '../../components/ui/dialog.jsx';
import { parseCsvInput } from './shared.js';

export function ManualAddDialog({ open, onClose, onSubmit, mode }) {
  const [text, setText] = useState('');

  useEffect(() => {
    if (open) setText('');
  }, [open]);

  const parsed = useMemo(() => parseCsvInput(text), [text]);

  function handleSubmit() {
    if (parsed.length === 0) return;
    onSubmit(parsed);
    onClose?.();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose?.()}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>+ ID руками</DialogTitle>
          <DialogDescription>
            Формат строки: <code className="px-1 py-0.5 bg-slate-100 rounded text-[11px]">TG_ID,@username,Имя</code> — по одной записи на строку. Username и имя необязательны.
            {mode === 'existing'
              ? ' Записи сразу добавляются в выбранную базу.'
              : ' Записи попадают в корзину и сохранятся вместе с новой базой.'}
          </DialogDescription>
        </DialogHeader>

        <textarea
          rows={8}
          autoFocus
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={'TG_ID,@username,Имя\n488609412,@user,Иван\n123456789,,Петр'}
          className="w-full p-3 rounded-xl bg-white border border-slate-200 text-sm text-slate-800 font-mono leading-relaxed focus:outline-none focus:border-slate-400"
        />

        <div className="text-xs text-slate-500 font-medium">
          Распознано: <span className="font-bold text-slate-700">{parsed.length}</span> {parsed.length === 1 ? 'запись' : 'записей'}
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors"
          >
            Отменить
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={parsed.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Добавить {parsed.length > 0 ? `(${parsed.length})` : ''}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
