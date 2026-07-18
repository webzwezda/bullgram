import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Bot, RefreshCw, Trash2, KeyRound, Copy, Plus, ListChecks, Loader2
} from 'lucide-react';
import { Button } from '../../components/ui/button.jsx';
import { Card } from '../../components/ui/card.jsx';
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

const cardShell = 'p-0 gap-0 border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 bg-white overflow-hidden rounded-2xl';
const headerBg = 'bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6';

export function BotDetail({ accessToken, botId, onDeleted }) {
  const [bot, setBot] = useState(null);
  const [tokens, setTokens] = useState([]);
  const [revealedToken, setRevealedToken] = useState(null);
  const [recentChats, setRecentChats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [historyKey, setHistoryKey] = useState(0);
  const [actionPending, setActionPending] = useState(null);

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

  useEffect(() => {
    setRevealedToken(null);
    load();
  }, [load]);

  function copyText(text, label = 'Скопировано') {
    navigator.clipboard.writeText(text).then(() => toast.success(label));
  }

  async function runAction(name, fn) {
    setActionPending(name);
    try {
      await fn();
    } finally {
      setActionPending(null);
    }
  }

  async function handleCreateToken() {
    try {
      const { token, record } = await createIntegrationToken(accessToken, botId);
      setRevealedToken(token);
      setTokens((prev) => [record, ...prev.filter((t) => t.id !== record.id)]);
      toast.success('Токен создан. Скопируй сейчас — повторно не покажем.');
    } catch (e) {
      toast.error(e.message);
    }
  }

  async function handleToggle() {
    const newActive = !bot.is_active;
    await runAction('toggle', async () => {
      try {
        await updateBot(accessToken, botId, { is_active: newActive });
        setBot((prev) => ({ ...prev, is_active: newActive }));
        toast.success(newActive ? 'Бот включён' : 'Бот остановлен');
      } catch (e) {
        toast.error(e.message);
      }
    });
  }

  async function handleRestart() {
    await runAction('restart', async () => {
      try {
        await restartBot(accessToken, botId);
        toast.success('Перезапущен');
        setTimeout(load, 500);
      } catch (e) {
        toast.error(e.message);
      }
    });
  }

  async function handleDelete() {
    if (!confirm('Удалить бота? Все его списки исчезнут из истории. Сообщения в Telegram останутся.')) return;
    await runAction('delete', async () => {
      try {
        await deleteBot(accessToken, botId);
        toast.success('Бот удалён');
        onDeleted?.();
      } catch (e) {
        toast.error(e.message);
      }
    });
  }

  if (loading) return <Skeleton className="h-96 w-full rounded-2xl" />;
  if (!bot) return null;

  const samplePayload = JSON.stringify({
    bot_id: bot.id,
    chat_id: -1001234567890,
    title: 'Покупки на неделю',
    items: ['Молоко', 'Хлеб', 'Яйца']
  }, null, 2);

  const latestToken = tokens[0];

  return (
    <div className="space-y-6">
      <ActionsCard
        bot={bot}
        actionPending={actionPending}
        onToggle={handleToggle}
        onRestart={handleRestart}
        onDelete={handleDelete}
      />

      <OnboardingStepsCard bot={bot} />

      <Card className={cardShell}>
        <div className={headerBg}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 shrink-0">
              <KeyRound className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-bold text-slate-900">Подключение AI-агента</h3>
              <p className="text-xs font-semibold text-slate-400">Hermes, OpenClaw или любой другой</p>
            </div>
            <Button size="sm" variant="outline" onClick={handleCreateToken} className="h-9 rounded-xl shrink-0">
              Создать токен
            </Button>
          </div>
        </div>
        <div className="p-5 sm:p-6 space-y-3">
          <p className="text-sm text-slate-500">
            AI-агент сможет POST-запросами отправлять чеклисты в твою группу.
          </p>

          {latestToken && (
            <div className="rounded-xl bg-slate-50/50 border border-slate-100 p-3 flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  {latestToken.label}
                </div>
                <code className="text-xs font-mono break-all text-slate-700">
                  {revealedToken
                    ? revealedToken
                    : `brapi_${latestToken.token_prefix}_••••••••`}
                </code>
              </div>
              {revealedToken && (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => copyText(revealedToken, 'Токен скопирован')}
                  className="shrink-0"
                >
                  <Copy className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
          )}

          <div className="rounded-xl bg-slate-50/50 border border-slate-100 p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">POST URL</span>
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => copyText(webhookUrl(), 'URL скопирован')}
                className="shrink-0"
              >
                <Copy className="w-3.5 h-3.5" />
              </Button>
            </div>
            <code className="text-xs font-mono break-all text-slate-700">{webhookUrl()}</code>
          </div>

          <div className="rounded-xl bg-slate-50/50 border border-slate-100 p-3">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">
              Пример JSON для AI
            </div>
            <pre className="text-xs font-mono text-slate-700 overflow-x-auto whitespace-pre">{samplePayload}</pre>
          </div>
        </div>
      </Card>

      <Card className={cardShell}>
        <div className={headerBg}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 shrink-0">
              <Plus className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900">Быстрый список</h3>
              <p className="text-xs font-semibold text-slate-400">Отправить чеклист в группу прямо сейчас</p>
            </div>
          </div>
        </div>
        <div className="p-5 sm:p-6">
          <QuickAddForm
            accessToken={accessToken}
            botId={botId}
            recentChats={recentChats}
            onPosted={() => setHistoryKey((k) => k + 1)}
          />
        </div>
      </Card>

      <Card className={cardShell}>
        <div className={headerBg}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 shrink-0">
              <ListChecks className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900">История списков</h3>
              <p className="text-xs font-semibold text-slate-400">Отправленные и неудачные — можно повторить</p>
            </div>
          </div>
        </div>
        <div className="p-5 sm:p-6">
          <ListsHistory
            key={historyKey}
            accessToken={accessToken}
            botId={botId}
            onChatsChange={setRecentChats}
          />
        </div>
      </Card>
    </div>
  );
}

function ActionsCard({ bot, actionPending, onToggle, onRestart, onDelete }) {
  return (
    <Card className={cardShell}>
      <div className={headerBg}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-500/20 shrink-0">
              <Bot className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <h2 className="text-xl font-bold text-slate-900 truncate">
                {bot.display_name || `@${bot.bot_username}`}
              </h2>
              <p className="text-sm text-slate-500 mt-0.5 truncate font-mono">@{bot.bot_username}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            {bot.is_active ? (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1 animate-pulse" />
                активен
              </span>
            ) : (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-50 text-slate-500 border border-slate-200 shrink-0">
                остановлен
              </span>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={onToggle}
              disabled={actionPending === 'toggle'}
              className="h-9 rounded-xl"
            >
              {actionPending === 'toggle' && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
              {bot.is_active ? 'Остановить' : 'Запустить'}
            </Button>
            <Button
              size="icon-sm"
              variant="outline"
              onClick={onRestart}
              disabled={actionPending === 'restart'}
              title="Перезапустить"
              className="h-9 w-9 rounded-xl"
            >
              {actionPending === 'restart'
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <RefreshCw className="w-3.5 h-3.5" />}
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={onDelete}
              disabled={actionPending === 'delete'}
              title="Удалить бота"
              className="h-9 w-9 rounded-xl text-rose-600 hover:bg-rose-50 hover:text-rose-700"
            >
              {actionPending === 'delete'
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Trash2 className="w-3.5 h-3.5" />}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function OnboardingStepsCard({ bot }) {
  return (
    <Card className={cardShell}>
      <div className={headerBg}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center text-amber-600 shrink-0">
            <ListChecks className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900">Что сделать с ботом</h3>
            <p className="text-xs font-semibold text-slate-400">Подключи бота в семейную группу за 4 шага</p>
          </div>
        </div>
      </div>
      <div className="p-5 sm:p-6 grid sm:grid-cols-2 gap-3">
        {[
          { num: 1, text: <>Найди <span className="font-mono text-slate-700">@{bot.bot_username}</span> в Telegram и открой чат с ботом</> },
          { num: 2, text: 'Добавь бота в свою семейную группу' },
          { num: 3, text: <>Сделай бота <span className="font-semibold text-slate-900">админом группы</span> (иначе не сможет постить чеклисты)</> },
          { num: 4, text: 'Отправь боту в личку любой текст с пунктами — он сделает чеклист' }
        ].map((s) => (
          <div key={s.num} className="flex items-start gap-3 rounded-xl bg-slate-50/50 border border-slate-100 p-3">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-xs font-bold text-indigo-600 ring-1 ring-indigo-200">
              {s.num}
            </div>
            <div className="text-sm text-slate-700">{s.text}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}
