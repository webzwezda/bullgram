import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { Copy, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/button.jsx';
import { Card } from '../../components/ui/card.jsx';
import { Badge } from '../../components/ui/badge.jsx';
import { Skeleton } from '../../components/ui/skeleton.jsx';
import { QuickAddForm } from './QuickAddForm.jsx';
import { ListsHistory } from './ListsHistory.jsx';
import {
  getBot, updateBot, deleteBot, restartBot,
  listIntegrationTokens, createIntegrationToken
} from './api.js';

function webhookUrl() {
  return `${window.location.origin.replace(/\/$/, '')}/api/checklist/push`;
}

export function BotDetail({ accessToken, botId, onBack, onDeleted }) {
  const [bot, setBot] = useState(null);
  const [tokens, setTokens] = useState([]);
  const [revealedToken, setRevealedToken] = useState(null);
  const [recentChats, setRecentChats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [historyKey, setHistoryKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ bot: botData }, { tokens: tokensData }] = await Promise.all([
        getBot(accessToken, botId),
        listIntegrationTokens(accessToken, botId)
      ]);
      setBot(botData);
      setTokens(tokensData || []);
    } catch (e) {
      toast.error(e.message || 'Не удалось загрузить бота');
    } finally {
      setLoading(false);
    }
  }, [accessToken, botId]);

  useEffect(() => { load(); }, [load]);

  function copyText(text, label = 'Скопировано') {
    navigator.clipboard.writeText(text).then(() => toast.success(label));
  }

  async function handleCreateToken() {
    try {
      const { token, record } = await createIntegrationToken(accessToken, botId);
      setRevealedToken(token);
      setTokens(prev => [record, ...prev.filter(t => t.id !== record.id)]);
      toast.success('Токен создан. Скопируй сейчас — повторно не покажем.');
    } catch (e) {
      toast.error(e.message);
    }
  }

  async function handleToggle() {
    const newActive = !bot.is_active;
    try {
      await updateBot(accessToken, botId, { is_active: newActive });
      setBot(prev => ({ ...prev, is_active: newActive }));
      toast.success(newActive ? 'Бот включён' : 'Бот остановлен');
    } catch (e) {
      toast.error(e.message);
    }
  }

  async function handleRestart() {
    try {
      await restartBot(accessToken, botId);
      toast.success('Перезапущен');
      setTimeout(load, 500);
    } catch (e) {
      toast.error(e.message);
    }
  }

  async function handleDelete() {
    if (!confirm('Удалить бота? Все его списки исчезнут из истории. Сообщения в Telegram останутся.')) return;
    try {
      await deleteBot(accessToken, botId);
      toast.success('Бот удалён');
      onDeleted?.();
    } catch (e) {
      toast.error(e.message);
    }
  }

  if (loading) return <Skeleton className="h-64 w-full" />;
  if (!bot) return null;

  const samplePayload = JSON.stringify({
    bot_id: bot.id,
    chat_id: -1001234567890,
    title: 'Покупки на неделю',
    items: ['Молоко', 'Хлеб', 'Яйца']
  }, null, 2);

  const latestToken = tokens[0];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Button variant="ghost" size="sm" onClick={onBack}>← Все боты</Button>
        <div className="flex items-center gap-2">
          <Badge variant={bot.is_active ? 'secondary' : 'outline'}>
            {bot.is_active ? 'активен' : 'остановлен'}
          </Badge>
          <Button size="sm" variant="outline" onClick={handleToggle}>
            {bot.is_active ? 'Остановить' : 'Запустить'}
          </Button>
          <Button size="sm" variant="outline" onClick={handleRestart}>
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
          <Button size="sm" variant="ghost" onClick={handleDelete}>
            <Trash2 className="w-3.5 h-3.5 text-rose-500" />
          </Button>
        </div>
      </div>

      <div>
        <h2 className="text-2xl font-black text-slate-900">
          {bot.display_name || `@${bot.bot_username}`}
        </h2>
        <p className="text-sm text-slate-500 font-mono">@{bot.bot_username}</p>
      </div>

      <Card className="p-5 bg-amber-50 border-amber-200">
        <h3 className="font-bold text-slate-900 mb-3">Что сделать с ботом</h3>
        <ol className="flex flex-col gap-2 text-sm">
          <li className="flex gap-2">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-amber-500 text-white text-xs font-bold flex items-center justify-center">1</span>
            <span>Найди <span className="font-mono">@{bot.bot_username}</span> в Telegram и открой чат с ботом</span>
          </li>
          <li className="flex gap-2">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-amber-500 text-white text-xs font-bold flex items-center justify-center">2</span>
            <span>Добавь бота в свою семейную группу</span>
          </li>
          <li className="flex gap-2">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-amber-500 text-white text-xs font-bold flex items-center justify-center">3</span>
            <span className="font-semibold">Сделай бота админом группы</span> (иначе не сможет постить чеклисты)
          </li>
          <li className="flex gap-2">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-amber-500 text-white text-xs font-bold flex items-center justify-center">4</span>
            <span>Отправь боту в личку любой текст с пунктами — он сделает чеклист</span>
          </li>
        </ol>
      </Card>

      <Card className="p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-slate-900">Подключение AI-агента</h3>
          <Button size="sm" variant="outline" onClick={handleCreateToken}>
            Создать токен
          </Button>
        </div>
        <p className="text-sm text-slate-500 mb-3">
          AI-агент (Hermes, OpenClaw, любой другой) сможет POST-запросами
          отправлять чеклисты в твою группу.
        </p>

        {latestToken && (
          <div className="mb-3 p-3 rounded border border-slate-200 bg-slate-50">
            <div className="flex items-center justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-xs text-slate-500">{latestToken.label}</div>
                <code className="text-xs font-mono break-all">
                  {revealedToken
                    ? revealedToken
                    : `brapi_${latestToken.token_prefix}_••••••••`}
                </code>
              </div>
              {revealedToken && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => copyText(revealedToken, 'Токен скопирован')}
                >
                  <Copy className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
          </div>
        )}

        <div className="bg-slate-50 rounded p-3 text-sm">
          <div className="flex items-center justify-between mb-1">
            <span className="font-semibold text-slate-700">POST URL</span>
            <Button size="sm" variant="ghost" onClick={() => copyText(webhookUrl(), 'URL скопирован')}>
              <Copy className="w-3.5 h-3.5" />
            </Button>
          </div>
          <code className="text-xs font-mono break-all">{webhookUrl()}</code>
        </div>

        <div className="mt-3">
          <div className="text-xs font-semibold text-slate-600 mb-1">Пример JSON для AI:</div>
          <pre className="bg-slate-900 text-slate-100 text-xs p-3 rounded font-mono overflow-x-auto">{samplePayload}</pre>
        </div>
      </Card>

      <Card className="p-5">
        <h3 className="font-bold text-slate-900 mb-3">Быстрый список</h3>
        <QuickAddForm
          accessToken={accessToken}
          botId={botId}
          recentChats={recentChats}
          onPosted={() => setHistoryKey(k => k + 1)}
        />
      </Card>

      <Card className="p-5">
        <h3 className="font-bold text-slate-900 mb-3">История списков</h3>
        <ListsHistory
          key={historyKey}
          accessToken={accessToken}
          botId={botId}
          onChatsChange={setRecentChats}
        />
      </Card>
    </div>
  );
}
