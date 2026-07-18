import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button.jsx';
import { Badge } from '../../components/ui/badge.jsx';
import { Skeleton } from '../../components/ui/skeleton.jsx';
import { listLists, deleteList, retryList } from './api.js';

function formatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });
  } catch { return iso; }
}

function StatusBadge({ status }) {
  if (status === 'posted') return <Badge className="bg-emerald-100 text-emerald-700">опубликован</Badge>;
  if (status === 'failed') return <Badge className="bg-rose-100 text-rose-700">ошибка</Badge>;
  return <Badge className="bg-amber-100 text-amber-700">отправляется…</Badge>;
}

export function ListsHistory({ accessToken, botId, onChatsChange }) {
  const [lists, setLists] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { lists: data } = await listLists(accessToken, botId, { limit: 50 });
      setLists(data || []);
      // Собираем уникальные chat_id для автодополнения в quick-add
      const chats = Array.from(new Set((data || []).map(l => String(l.chat_id))));
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
    try {
      await deleteList(accessToken, listId);
      toast.success('Удалено');
      load();
    } catch (e) {
      toast.error(e.message);
    }
  }

  async function handleRetry(listId) {
    try {
      await retryList(accessToken, listId);
      toast.success('Отправлено повторно');
      load();
    } catch (e) {
      toast.error(e.message);
    }
  }

  if (loading) return <Skeleton className="h-24 w-full" />;
  if (!lists?.length) {
    return (
      <div className="text-sm text-slate-500 text-center py-8">
        Пока нет ни одного списка.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {lists.map((l) => (
        <div key={l.id} className="border border-slate-200 rounded-lg p-3 flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-semibold text-sm text-slate-900 truncate">{l.title}</span>
              <StatusBadge status={l.status} />
            </div>
            <div className="text-xs text-slate-500">
              {formatDate(l.created_at)} · {l.items_checked}/{l.items_total} отмечено · chat {l.chat_id}
            </div>
            {l.status === 'failed' && l.error_message && (
              <div className="text-xs text-rose-600 mt-1 font-mono">
                {l.error_message.slice(0, 200)}
              </div>
            )}
          </div>
          <div className="flex flex-col gap-1">
            {l.status === 'failed' && (
              <Button size="sm" variant="outline" onClick={() => handleRetry(l.id)}>
                Повторить
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => handleDelete(l.id)}>
              Удалить
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
