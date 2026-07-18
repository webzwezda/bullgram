import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CheckSquare, ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '../components/ui/button.jsx';
import { Card } from '../components/ui/card.jsx';
import { Input } from '../components/ui/input.jsx';
import { Skeleton } from '../components/ui/skeleton.jsx';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '../components/ui/select.jsx';
import { listBots, registerBot } from './checklist/api.js';
import { BotDetail } from './checklist/BotDetail.jsx';

export function ChecklistPage({ accessToken }) {
  const [bots, setBots] = useState(null);
  const [selectedBotId, setSelectedBotId] = useState('new');
  const [botToken, setBotToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { bots: data } = await listBots(accessToken);
      const list = data || [];
      setBots(list);
      setSelectedBotId((current) => {
        if (current === 'new') return list.length ? list[0].id : 'new';
        return list.some((b) => b.id === current) ? current : (list[0]?.id || 'new');
      });
    } catch (e) {
      toast.error(e.message || 'Не удалось загрузить ботов');
      setBots([]);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => { load(); }, [load]);

  async function handleConnect() {
    if (!botToken.trim() || submitting) return;
    setSubmitting(true);
    try {
      const { bot } = await registerBot(accessToken, { bot_token: botToken.trim() });
      toast.success(`Бот @${bot.bot_username} создан`);
      setBotToken('');
      await load();
      setSelectedBotId(bot.id);
    } catch (e) {
      toast.error(e.message || 'Не удалось создать бота');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading && !bots) {
    return (
      <section className="page page--flush space-y-6">
        <Skeleton className="h-40 w-full rounded-2xl" />
        <Skeleton className="h-96 w-full rounded-2xl" />
      </section>
    );
  }

  const list = bots || [];
  const isNew = selectedBotId === 'new' || !list.some((b) => b.id === selectedBotId);

  return (
    <section className="page page--flush space-y-6">
      <Card className="p-0 gap-0 border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 bg-white overflow-hidden rounded-2xl">
        <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex flex-row items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-500/20 shrink-0">
                <CheckSquare className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-900">
                  {isNew ? 'Подключение бота' : 'Семейные чеклисты'}
                </h2>
                <p className="text-sm font-medium text-slate-500 mt-0.5">
                  {isNew
                    ? 'Получите токен у @BotFather и вставьте сюда.'
                    : 'Списки покупок и дел прямо в семейной Telegram-группе'}
                </p>
              </div>
            </div>
            <Select value={selectedBotId} onValueChange={setSelectedBotId}>
              <SelectTrigger className="h-10 w-[220px] bg-white rounded-xl border-slate-200 shadow-sm text-sm font-semibold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                <SelectItem value="new" className="rounded-lg">➕ Подключить нового</SelectItem>
                {list.map((b) => (
                  <SelectItem key={b.id} value={b.id} className="rounded-lg">
                    {b.display_name || `@${b.bot_username}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {isNew && (
          <div className="p-5 sm:p-6 bg-white">
            <div className="flex flex-col md:flex-row items-end gap-4">
              <div className="flex-1 w-full">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2 block">Токен бота</label>
                <Input
                  value={botToken}
                  onChange={(e) => setBotToken(e.target.value)}
                  placeholder="123456:ABC-DEF..."
                  spellCheck="false"
                  className="font-mono bg-white h-11 rounded-xl border-slate-200 shadow-sm focus-visible:ring-indigo-500"
                />
              </div>
              <div className="flex gap-2 w-full md:w-auto">
                <Button
                  onClick={handleConnect}
                  disabled={!botToken.trim() || submitting}
                  className="h-11 px-6 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold shadow-md shadow-indigo-200 disabled:opacity-50 w-full md:w-auto"
                >
                  {submitting ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Подключение...</>
                  ) : 'Подключить'}
                </Button>
                <Button variant="outline" asChild className="h-11 rounded-xl text-slate-700 border-slate-200 shadow-sm font-semibold">
                  <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="flex items-center gap-2">
                    @BotFather <ExternalLink className="w-4 h-4" />
                  </a>
                </Button>
              </div>
            </div>
          </div>
        )}
      </Card>

      {!isNew && (
        <BotDetail
          accessToken={accessToken}
          botId={selectedBotId}
          onDeleted={load}
        />
      )}
    </section>
  );
}
