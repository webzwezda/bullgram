import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CheckSquare, Plus, ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '../components/ui/button.jsx';
import { Card } from '../components/ui/card.jsx';
import { Input } from '../components/ui/input.jsx';
import { Skeleton } from '../components/ui/skeleton.jsx';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '../components/ui/select.jsx';
import { listBots, registerBot } from './checklist/api.js';
import { BotDetail } from './checklist/BotDetail.jsx';

const STEPS = [
  { num: 1, title: 'Открой @BotFather в Telegram', hint: 'Найди бота @BotFather, нажми Start' },
  { num: 2, title: 'Отправь команду /newbot', hint: 'BotFather спросит имя и username' },
  { num: 3, title: 'Придумай имя', hint: 'Например: Семейные списки Ивановых' },
  { num: 4, title: 'Придумай username', hint: 'Должен заканчиваться на _bot. Например: ivanov_checklist_bot' },
  { num: 5, title: 'Скопируй токен', hint: 'BotFather пришлёт длинную строку вида 1234:ABCdefGHI...' },
  { num: 6, title: 'Вставь токен справа', hint: 'И нажми «Создать бота»' }
];

export function ChecklistPage({ accessToken }) {
  const [bots, setBots] = useState(null);
  const [selectedBotId, setSelectedBotId] = useState('new');
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

  async function handleRegister({ bot_token, display_name }) {
    const { bot } = await registerBot(accessToken, { bot_token, display_name });
    toast.success(`Бот @${bot.bot_username} создан`);
    await load();
    setSelectedBotId(bot.id);
  }

  if (loading && !bots) {
    return (
      <section className="page page--flush space-y-6">
        <Skeleton className="h-32 w-full rounded-2xl" />
        <Skeleton className="h-96 w-full rounded-2xl" />
      </section>
    );
  }

  const list = bots || [];
  const showOnboarding = selectedBotId === 'new' || !list.some((b) => b.id === selectedBotId);

  return (
    <section className="page page--flush space-y-6">
      <HeaderCard bots={list} selectedBotId={selectedBotId} onSelect={setSelectedBotId} />
      {showOnboarding ? (
        <OnboardingCard onSubmit={handleRegister} />
      ) : (
        <BotDetail
          accessToken={accessToken}
          botId={selectedBotId}
          onDeleted={load}
        />
      )}
    </section>
  );
}

function HeaderCard({ bots, selectedBotId, onSelect }) {
  return (
    <Card className="p-0 gap-0 border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 bg-white overflow-hidden rounded-2xl">
      <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex flex-row items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-500/20 shrink-0">
              <CheckSquare className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900">Семейные чеклисты</h2>
              <p className="text-sm font-medium text-slate-500 mt-0.5">
                Списки покупок и дел прямо в семейной Telegram-группе
              </p>
            </div>
          </div>
          <Select value={selectedBotId} onValueChange={onSelect}>
            <SelectTrigger className="h-10 w-[220px] bg-white rounded-xl border-slate-200 shadow-sm text-sm font-semibold">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="new" className="rounded-lg">➕ Создать нового</SelectItem>
              {bots.map((b) => (
                <SelectItem key={b.id} value={b.id} className="rounded-lg">
                  {b.display_name || `@${b.bot_username}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </Card>
  );
}

function OnboardingCard({ onSubmit }) {
  const [botToken, setBotToken] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!botToken.trim()) {
      toast.error('Вставь токен от BotFather');
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({ bot_token: botToken.trim(), display_name: displayName.trim() });
      setBotToken('');
      setDisplayName('');
    } catch (e) {
      toast.error(e.message || 'Не удалось создать бота');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="p-0 gap-0 border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 bg-white overflow-hidden rounded-2xl">
      <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-500/20 shrink-0">
            <Plus className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900">Подключение бота</h2>
            <p className="text-sm text-slate-500 mt-0.5">Создай бота через @BotFather и вставь токен</p>
          </div>
        </div>
      </div>
      <div className="p-5 sm:p-6 grid md:grid-cols-2 gap-6">
        <div className="space-y-3">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900 mb-2">Как создать бота</h3>
          {STEPS.map((s) => (
            <div key={s.num} className="flex items-start gap-3">
              <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-xs font-bold text-indigo-600 ring-1 ring-indigo-200">
                {s.num}
              </div>
              <div>
                <div className="text-sm font-bold text-slate-900">{s.title}</div>
                <div className="text-xs text-slate-500">{s.hint}</div>
              </div>
            </div>
          ))}
          <div className="pt-2">
            <Button variant="outline" asChild className="h-10 rounded-xl text-slate-700 border-slate-200 shadow-sm font-semibold">
              <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="flex items-center gap-2">
                @BotFather <ExternalLink className="w-4 h-4" />
              </a>
            </Button>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4 bg-slate-50/50 rounded-xl p-5 border border-slate-100">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900">Регистрация</h3>
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
              bot_token <span className="text-rose-500">*</span>
            </label>
            <Input
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              placeholder="1234567890:AABcdEfGhIJkLMnopQRsTUvWXyZ..."
              className="font-mono text-xs h-11 rounded-xl border-slate-200 shadow-sm focus-visible:ring-indigo-500"
              required
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Как называть у вас (опционально)
            </label>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Бот для покупок"
              maxLength={80}
              className="h-11 rounded-xl border-slate-200 shadow-sm focus-visible:ring-indigo-500"
            />
          </div>
          <Button
            type="submit"
            disabled={submitting}
            className="h-11 px-6 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold shadow-md shadow-indigo-200 disabled:opacity-50 w-full"
          >
            {submitting ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Создаём…</>
            ) : 'Создать бота'}
          </Button>
          <p className="text-xs text-slate-500">
            После создания бот начнёт работать сразу. Добавь его в семейную
            группу как админа — инструкции ниже.
          </p>
        </form>
      </div>
    </Card>
  );
}
