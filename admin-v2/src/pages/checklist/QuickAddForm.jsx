import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '../../components/ui/button.jsx';
import { Input } from '../../components/ui/input.jsx';
import { Textarea } from '../../components/ui/textarea.jsx';
import { pushFromUi } from './api.js';

const inputClass = 'h-11 rounded-xl border-slate-200 shadow-sm focus-visible:ring-indigo-500';
const labelClass = 'text-xs font-bold uppercase tracking-wider text-slate-500';

export function QuickAddForm({ accessToken, botId, recentChats = [], onPosted }) {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [chatId, setChatId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!chatId.trim()) {
      toast.error('Укажи chat_id группы');
      return;
    }
    if (!text.trim()) {
      toast.error('Введи хотя бы один пункт');
      return;
    }
    const parsedChatId = Number(chatId);
    if (!Number.isFinite(parsedChatId)) {
      toast.error('chat_id должен быть числом');
      return;
    }
    setSubmitting(true);
    try {
      const result = await pushFromUi(accessToken, botId, {
        chat_id: parsedChatId,
        title: title.trim(),
        text: text.trim()
      });
      toast.success('Список отправлен');
      setTitle('');
      setText('');
      onPosted?.(result?.list);
    } catch (e) {
      toast.error(e.message || 'Не удалось отправить');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5">
        <label className={labelClass}>Название (опционально)</label>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Покупки на неделю"
          maxLength={120}
          className={inputClass}
        />
      </div>
      <div className="space-y-1.5">
        <label className={labelClass}>Пункты (один пункт = одна строка)</label>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'- Молоко\n- Хлеб\n- Яйца'}
          rows={6}
          className="font-mono text-sm rounded-xl border-slate-200 shadow-sm focus-visible:ring-indigo-500"
        />
      </div>
      <div className="space-y-1.5">
        <label className={labelClass}>ID группы куда отправить</label>
        <Input
          value={chatId}
          onChange={(e) => setChatId(e.target.value)}
          placeholder="-1001234567890"
          list={`recent-chats-${botId}`}
          className={`font-mono text-sm ${inputClass}`}
        />
        <datalist id={`recent-chats-${botId}`}>
          {recentChats.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <p className="text-xs text-slate-500">
          Не знаешь ID? Добавь бота в группу и напиши там любое сообщение —
          ID появится в истории списков ниже автоматически.
        </p>
      </div>
      <Button
        type="submit"
        disabled={submitting}
        className="h-11 px-6 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold shadow-md shadow-indigo-200 disabled:opacity-50 w-full sm:w-auto"
      >
        {submitting ? (
          <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Отправляем…</>
        ) : 'Отправить в Telegram'}
      </Button>
    </form>
  );
}
