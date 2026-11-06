import { Fragment, useMemo } from 'react';
import { Bot, Rocket, Save, RotateCcw } from 'lucide-react';

// Лёгкий рендер легаси-Telegram-markdown для превью: *жирный*, _курсив_, `код`.
// Подставляем только {channel_name}; остальные теги оставляем как есть — их видит админ, не подписчик.
function renderLegacyMarkdown(text, channelName) {
  if (!text || !text.trim()) return [];
  const withChannel = text.replace(/\{channel_name\}/g, () => channelName || 'название канала');
  const parts = withChannel.split(/(\*[^*\n]+\*|_[^_\n]+_|`[^`\n]+`)/g);
  return parts
    .filter((part) => part !== '')
    .map((part, idx) => {
      if (part.length > 2 && part.startsWith('*') && part.endsWith('*')) {
        return <strong key={idx}>{part.slice(1, -1)}</strong>;
      }
      if (part.length > 2 && part.startsWith('_') && part.endsWith('_')) {
        return <em key={idx}>{part.slice(1, -1)}</em>;
      }
      if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) {
        return <code key={idx} className="rounded bg-slate-100 px-1 font-mono text-[0.9em]">{part.slice(1, -1)}</code>;
      }
      return <Fragment key={idx}>{part}</Fragment>;
    });
}

/* Секция «Что отправляется подписчикам» retention-напоминаний: редактор текста,
   превью «Так увидит подписчик (бот)» и userbot fallback. Черновики и экшены
   приходят пропсами из RetentionPage; превью считаются на месте из черновика. */
export function RetentionMessageSection({
  reminderDraft, setReminderDraft,
  reminderDirty, reminderSaving, reminderSaved, reminderError,
  insertStandardTemplate, saveReminder, resetReminder,
  previewChannelName
}) {
  const botPreviewNodes = renderLegacyMarkdown(reminderDraft, previewChannelName);

  const userbotWrappedPreview = useMemo(() => {
    if (!reminderDraft.trim()) return '';
    // Юзербот шлёт без parse_mode — markdown-декор в превью не показываем, как и в реальной отправке
    return `🔔 Системное уведомление!\nМой бот не смог до тебя достучаться, пишу лично.\n\n${reminderDraft.replace(/[*_`\[\]]/g, '')}`;
  }, [reminderDraft]);

  return (
    <section className="p-6 md:p-8 border-b border-slate-100">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
            <h3 className="text-sm font-black uppercase tracking-widest text-slate-500">
              Что отправляется подписчикам
            </h3>
            <span className="text-[11px] text-slate-400 font-medium">
              Превью для: <span className="font-bold text-slate-600">{previewChannelName}</span>
            </span>
          </div>

          <div className="flex items-center gap-2 mb-3">
            <Bot className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            <span className="text-sm font-bold text-slate-700">Основное сообщение (от бота)</span>
            <span className="text-xs text-slate-400 font-medium">— редактируемое</span>
            <div className="ml-auto flex gap-1.5">
              <button
                type="button"
                className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
                onClick={insertStandardTemplate}
              >
                Сбросить к стандарту
              </button>
            </div>
          </div>

          <textarea
            className="w-full p-3 rounded-xl bg-white border border-slate-200 text-sm text-slate-800 font-mono leading-relaxed focus:outline-none focus:border-slate-400 min-h-[180px]"
            value={reminderDraft}
            onChange={(event) => setReminderDraft(event.target.value)}
            placeholder="Текст, который бот отправит подписчику за 24ч до истечения подписки."
          />

          <div className="mt-3 max-w-2xl text-xs text-slate-500 leading-relaxed">
            Теги автоматически заменятся при отправке: <code className="px-1 bg-slate-100 rounded">{`{channel_name}`}</code> → название канала, <code className="px-1 bg-slate-100 rounded">{`{renewal_link}`}</code> → ссылка на оплату тарифа (https://t.me/бот?start=buy_…), <code className="px-1 bg-slate-100 rounded">{`{upsell_tariff_name}`}</code>, <code className="px-1 bg-slate-100 rounded">{`{upsell_price}`}</code>, <code className="px-1 bg-slate-100 rounded">{`{upsell_currency}`}</code> — для пробников с привязанным апселл-тарифом.
          </div>
          <div className="mt-2 max-w-2xl text-xs text-slate-500 leading-relaxed">
            Inline-кнопка «💳 Продлить доступ» добавляется к сообщению, когда доступна ссылка на оплату (привязан тариф продления); если ссылки нет — подписчик увидит обычное сообщение со ссылкой из тега. Userbot кнопки отправить не может — поэтому важно, чтобы ссылка была прямо в тексте (через тег {`{renewal_link}`}).
          </div>

          <div className="mt-6 p-4 rounded-2xl bg-emerald-50/40 border border-emerald-100">
            <div className="flex items-center gap-2 mb-3">
              <Bot className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              <span className="text-sm font-bold text-slate-700">Так увидит подписчик (бот)</span>
            </div>
            <div className="p-3 rounded-xl bg-white border border-slate-200 text-sm text-slate-800 leading-relaxed whitespace-pre-wrap max-h-72 overflow-y-auto">
              {botPreviewNodes.length > 0 ? botPreviewNodes : '— пусто — редактируй текст выше —'}
            </div>
            <div className="mt-3">
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white">💳 Продлить доступ</span>
              <div className="mt-1.5 text-[11px] text-slate-500">
                Кнопка добавляется, когда доступна ссылка на оплату (привязан тариф продления)
              </div>
            </div>
          </div>

          <div className="mt-6 p-4 rounded-2xl bg-blue-50/40 border border-blue-100">
            <div className="flex items-center gap-2 mb-3">
              <Rocket className="w-4 h-4 text-blue-600 flex-shrink-0" />
              <span className="text-sm font-bold text-slate-700">Userbot fallback</span>
              <span className="text-xs text-slate-400 font-medium">— если бот заблокирован у подписчика (только чтение)</span>
            </div>
            <pre className="text-sm text-slate-700 whitespace-pre-wrap font-sans leading-relaxed">
{userbotWrappedPreview || '— пусто — редактируй основное сообщение выше —'}
            </pre>
          </div>

          <div className="flex flex-wrap items-center gap-2 mt-6">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              onClick={saveReminder}
              disabled={!reminderDirty || reminderSaving}
            >
              <Save className="w-3.5 h-3.5" />
              {reminderSaving ? 'Сохраняю...' : 'Сохранить'}
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              onClick={resetReminder}
              disabled={!reminderDirty || reminderSaving}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Отменить правки
            </button>
            {reminderSaved ? (
              <span className="text-xs font-bold text-emerald-600 ml-1">✓ Сохранено</span>
            ) : null}
            {reminderDirty && !reminderSaved ? (
              <span className="text-xs font-medium text-amber-600 ml-1">есть несохранённые правки</span>
            ) : null}
            {reminderError ? (
              <span className="text-xs font-bold text-rose-600 ml-1">{reminderError}</span>
            ) : null}
          </div>
    </section>
  );
}
