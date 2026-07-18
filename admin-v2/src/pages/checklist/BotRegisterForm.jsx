import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button.jsx';
import { Input } from '../../components/ui/input.jsx';
import { registerBot } from './api.js';

const STEPS = [
  { num: 1, title: 'Открой @BotFather в Telegram', hint: 'Найди бота @BotFather, нажми Start' },
  { num: 2, title: 'Отправь команду /newbot', hint: 'BotFather спросит имя и username' },
  { num: 3, title: 'Придумай имя', hint: 'Например: Семейные списки Ивановых' },
  { num: 4, title: 'Придумай username', hint: 'Должен заканчиваться на _bot. Например: ivanov_checklist_bot' },
  { num: 5, title: 'Скопируй токен', hint: 'BotFather пришлёт длинную строку вида 1234:ABCdefGHI...' },
  { num: 6, title: 'Вставь токен ниже', hint: 'И нажми «Создать бота»' }
];

export function BotRegisterForm({ accessToken, onCreated }) {
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
      const { bot } = await registerBot(accessToken, {
        bot_token: botToken.trim(),
        display_name: displayName.trim()
      });
      toast.success(`Бот @${bot.bot_username} создан`);
      onCreated?.(bot);
    } catch (e) {
      toast.error(e.message || 'Не удалось создать бота');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid md:grid-cols-2 gap-6">
      <div className="flex flex-col gap-3">
        <h3 className="font-bold text-slate-900">Как создать бота</h3>
        <ol className="flex flex-col gap-3">
          {STEPS.map((s) => (
            <li key={s.num} className="flex gap-3 items-start">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center">
                {s.num}
              </span>
              <div>
                <div className="text-sm font-semibold text-slate-900">{s.title}</div>
                <div className="text-xs text-slate-500">{s.hint}</div>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-3 bg-slate-50 rounded-xl p-5">
        <h3 className="font-bold text-slate-900">Регистрация</h3>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">
            bot_token <span className="text-rose-500">*</span>
          </label>
          <Input
            value={botToken}
            onChange={(e) => setBotToken(e.target.value)}
            placeholder="1234567890:AABcdEfGhIJkLMnopQRsTUvWXyZ..."
            className="font-mono text-xs"
            required
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">
            Как называть у вас (опционально)
          </label>
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Бот для покупок"
            maxLength={80}
          />
        </div>
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Создаём…' : 'Создать бота'}
        </Button>
        <p className="text-xs text-slate-500">
          После создания бот начнёт работать сразу. Добавь его в семейную
          группу как админа — инструкции на следующем экране.
        </p>
      </form>
    </div>
  );
}
