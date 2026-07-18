import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { RefreshCw, Trash2, Loader2, ListChecks } from 'lucide-react';
import { Button } from '../../components/ui/button.jsx';
import { Skeleton } from '../../components/ui/skeleton.jsx';
import { listLists, deleteList, retryList } from './api.js';

function formatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });
  } catch {
    return iso;
  }
}

function StatusBadge({ status }) {
  if (status === 'posted') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1 animate-pulse" />
        опубликован
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200 shrink-0">
        ошибка
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 shrink-0">
      отправляется…
    </span>
  );
}

export function ListsHistory({ accessToken, botId, onChatsChange }) {
  const [lists, setLists] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { lists: data } = await listLists(accessToken, botId, { limit: 50 });
      setLists(data || []);
      const chats = Array.from(new Set((data || []).map((l) => String(l.chat_id))));
      onChatsChange?.(chats);
    } catch (e) {
      toast.error(e.message || 'Не удалось загрузить историю');
      setLists([]);
    } finally {
      setLoading(false);
    }
  }, [accessToken, botId, onChatsChange]);

  useEffect(() => { load(); }, [load]);

  async function handleDelete(listId) {
    if (!confirm('Удалить список из истории? (Сообщение в Telegram останется.)')) return;
    setPendingId(listId);
    try {
      await deleteList(accessToken, listId);
      toast.success('Удалено');
      load();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setPendingId(null);
    }
  }

  async function handleRetry(listId) {
    setPendingId(listId);
    try {
      await retryList(accessToken, listId);
      toast.success('Отправлено повторно');
      load();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setPendingId(null);
    }
  }

  if (loading) return <Skeleton className="h-32 w-full rounded-xl" />;

  if (!lists?.length) {
    return (
      <div className="rounded-2xl border border-slate-100 bg-slate-50/50 p-8 text-center">
        <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center mx-auto mb-3 ring-1 ring-slate-100">
          <ListChecks className="w-6 h-6 text-slate-300" />
        </div>
        <p className="text-sm font-bold text-slate-900">Пока нет ни одного списка</p>
        <p className="mt-1 text-sm text-slate-500">Отправь первый чеклист через форму выше.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {lists.map((l) => (
        <div
          key={l.id}
          className="rounded-xl border border-slate-100 bg-slate-50/50 hover:bg-slate-100 transition-colors p-4 flex items-start gap-3"
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-bold text-sm text-slate-900 truncate">{l.title}</span>
              <StatusBadge status={l.status} />
            </div>
            <div className="text-xs text-slate-500">
              {formatDate(l.created_at)} · {l.items_checked}/{l.items_total} отмечено · chat {l.chat_id}
            </div>
            {l.status === 'failed' && l.error_message && (
              <div className="text-xs text-rose-600 mt-1 font-mono break-all">
                {l.error_message.slice(0, 200)}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {l.status === 'failed' && (
              <Button
                size="icon-sm"
                variant="outline"
                onClick={() => handleRetry(l.id)}
                disabled={pendingId === l.id}
                title="Повторить"
                className="h-8 w-8 rounded-lg"
              >
                {pendingId === l.id
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <RefreshCw className="w-3.5 h-3.5" />}
              </Button>
            )}
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => handleDelete(l.id)}
              disabled={pendingId === l.id}
              title="Удалить"
              className="h-8 w-8 rounded-lg text-rose-600 hover:bg-rose-50 hover:text-rose-700"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
