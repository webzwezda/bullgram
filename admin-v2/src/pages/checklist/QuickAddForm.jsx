import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button.jsx';
import { Input } from '../../components/ui/input.jsx';
import { Textarea } from '../../components/ui/textarea.jsx';
import { pushFromUi } from './api.js';

/**
 * Quick-add форма: title + textarea (по строке = пункт) + chat_id.
 * chat_id можно выбрать из ранее использованных или ввести вручную.
 */
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
    setSubmitting(true);
    try {
      const parsedChatId = Number(chatId);
      if (!Number.isFinite(parsedChatId)) {
        toast.error('chat_id должен быть числом');
        return;
      }
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
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-1">
          Название (опционально)
        </label>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Покупки на неделю"
          maxLength={120}
        />
      </div>
      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-1">
          Пункты (один пункт = одна строка)
        </label>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'- Молоко\n- Хлеб\n- Яйца'}
          rows={6}
          className="font-mono text-sm"
        />
      </div>
      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-1">
          ID группы куда отправить
        </label>
        <Input
          value={chatId}
          onChange={(e) => setChatId(e.target.value)}
          placeholder="-1001234567890"
          list={`recent-chats-${botId}`}
        />
        <datalist id={`recent-chats-${botId}`}>
          {recentChats.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <p className="text-xs text-slate-500 mt-1">
          Не знаешь ID? Добавь бота в группу и напиши там любое сообщение —
          ID появится в истории списков ниже автоматически.
        </p>
      </div>
      <Button type="submit" disabled={submitting}>
        {submitting ? 'Отправляем…' : 'Отправить в Telegram'}
      </Button>
    </form>
  );
}
