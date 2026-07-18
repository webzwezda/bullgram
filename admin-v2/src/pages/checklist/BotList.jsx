import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { Bot, Plus, ArrowRight } from 'lucide-react';
import { Button } from '../../components/ui/button.jsx';
import { Card } from '../../components/ui/card.jsx';
import { Skeleton } from '../../components/ui/skeleton.jsx';
import { Badge } from '../../components/ui/badge.jsx';
import { listBots } from './api.js';

export function BotList({ accessToken, onOpen, onCreate }) {
  const [bots, setBots] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { bots: data } = await listBots(accessToken);
      setBots(data || []);
    } catch (e) {
      toast.error(e.message || 'Не удалось загрузить ботов');
      setBots([]);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="grid gap-3 md:grid-cols-2">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!bots?.length) {
    return (
      <Card className="p-10 text-center">
        <div className="flex justify-center mb-3">
          <div className="w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center">
            <Bot className="w-6 h-6 text-blue-600" />
          </div>
        </div>
        <h3 className="font-bold text-slate-900 mb-1">У тебя ещё нет ботов</h3>
        <p className="text-sm text-slate-500 mb-4 max-w-md mx-auto">
          Создай своего первого бота через @BotFather и подключи его к семейной
          группе. Это займёт ~3 минуты.
        </p>
        <Button onClick={onCreate} className="mx-auto">
          <Plus className="w-4 h-4" />
          Создать первого бота
        </Button>
      </Card>
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {bots.map((b) => (
        <Card key={b.id} className="p-5 flex flex-col gap-3 hover:border-blue-300 transition-colors cursor-pointer" onClick={() => onOpen(b.id)}>
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
                <Bot className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <div className="font-bold text-slate-900">
                  {b.display_name || `@${b.bot_username}`}
                </div>
                <div className="text-xs text-slate-500 font-mono">@{b.bot_username}</div>
              </div>
            </div>
            <Badge variant={b.is_active ? 'secondary' : 'outline'}>
              {b.is_active ? 'активен' : 'остановлен'}
            </Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500">
              Создан {new Date(b.created_at).toLocaleDateString('ru-RU')}
            </span>
            <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); onOpen(b.id); }}>
              Открыть <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </Card>
      ))}

      <Card className="p-5 flex items-center justify-center text-slate-500 border-dashed cursor-pointer hover:border-blue-300 hover:text-blue-600 transition-colors" onClick={onCreate}>
        <div className="flex items-center gap-2">
          <Plus className="w-4 h-4" />
          <span className="font-semibold text-sm">Добавить ещё бота</span>
        </div>
      </Card>
    </div>
  );
}
