import { Fragment } from 'react';
import { Bot as BotIcon, Tag, Save, RotateCcw } from 'lucide-react';

// Лёгкий рендер легаси-Telegram-markdown для превью: *жирный*, _курсив_, `код`.
// Подставляем только {tariff_name} и {discount_percent}; {discount_price}/{old_price}/{currency}
// оставляем как есть — цену без конкретного тарифа не знаем, админ видит теги.
function renderLegacyMarkdown(text, discountPercent) {
  if (!text || !text.trim()) return [];
  const withSubs = text
    .replace(/\{tariff_name\}/g, () => 'название тарифа')
    .replace(/\{discount_percent\}/g, () => String(Number(discountPercent || 0)));
  const parts = withSubs.split(/(\*[^*\n]+\*|_[^_\n]+_|`[^`\n]+`)/g);
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

/* Секция «Что отправляется подписчикам» брошенных корзин: редактор текста/скидки,
   превью сообщения и кнопки сохранения. Черновики и экшены приходят пропсами из AbandonedPage. */
export function AbandonedMessageSection({
  textDraft, setTextDraft,
  discountDraft, setDiscountDraft,
  discountError, setDiscountError,
  insertStandardTemplate, insertTrialTemplate,
  saveSettings, resetDraft,
  dirty, saving, savedAt, saveError
}) {
  const previewNodes = renderLegacyMarkdown(textDraft, discountDraft);

  return (
    <section className="p-6 md:p-8 border-b border-slate-100">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
            <h3 className="text-sm font-black uppercase tracking-widest text-slate-500">
              Что отправляется подписчикам
            </h3>
            <span className="text-[11px] text-slate-400 font-medium">
              <span className="font-bold text-slate-600">Общий текст</span> для обоих сценариев
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3 mb-4">
            <div>
              <div className="flex items-center gap-2">
                <Tag className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                <span className="text-sm font-bold text-slate-700">Скидка</span>
                <input
                  type="number"
                  min="0"
                  max="99"
                  value={discountDraft}
                  onChange={(event) => {
                    setDiscountDraft(Number(event.target.value || 0));
                    setDiscountError('');
                  }}
                  className={`w-20 px-3 py-1.5 rounded-lg bg-white border text-sm font-bold text-slate-900 focus:outline-none focus:border-slate-400 ${discountError ? 'border-rose-300' : 'border-slate-200'}`}
                />
                <span className="text-sm font-bold text-slate-500">%</span>
              </div>
              {discountError ? (
                <div className="text-[11px] font-bold text-rose-600 mt-1">{discountError}</div>
              ) : null}
            </div>
            <div className="ml-auto flex gap-1.5">
              <button
                type="button"
                className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
                onClick={insertStandardTemplate}
              >
                Сбросить к стандарту
              </button>
              <button
                type="button"
                className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
                onClick={insertTrialTemplate}
              >
                Пробник (без скидки)
              </button>
            </div>
          </div>

          <textarea
            className="w-full p-3 rounded-xl bg-white border border-slate-200 text-sm text-slate-800 font-mono leading-relaxed focus:outline-none focus:border-slate-400 min-h-[180px]"
            value={textDraft}
            onChange={(event) => setTextDraft(event.target.value)}
            placeholder="Текст, который бот отправит подписчику с брошенной корзиной."
          />

          <div className="mt-3 max-w-2xl text-xs text-slate-600 leading-relaxed">
            Теги автоматически заменятся при отправке: <code className="px-1 bg-slate-100 rounded">{`{tariff_name}`}</code> → название тарифа, <code className="px-1 bg-slate-100 rounded">{`{discount_percent}`}</code> → значение скидки, <code className="px-1 bg-slate-100 rounded">{`{discount_price}`}</code> → цена со скидкой, <code className="px-1 bg-slate-100 rounded">{`{old_price}`}</code> → исходная цена, <code className="px-1 bg-slate-100 rounded">{`{currency}`}</code> → валюта.
          </div>
          <div className="mt-2 max-w-2xl text-xs text-slate-600 leading-relaxed">
            Этот текст и скидка также применяются в сценарии <span className="font-medium">«Дожим после просмотра»</span> (напоминание после просмотра тарифа).
          </div>

          <div className="mt-6 p-4 rounded-2xl bg-emerald-50/40 border border-emerald-100">
            <div className="flex items-center gap-2 mb-3">
              <BotIcon className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              <span className="text-sm font-bold text-slate-700">Так увидит подписчик (бот)</span>
            </div>
            <div className="p-3 rounded-xl bg-white border border-slate-200 text-sm text-slate-800 leading-relaxed whitespace-pre-wrap">
              {previewNodes.length > 0 ? previewNodes : '— пусто — редактируй текст выше —'}
            </div>
            <div className="mt-3">
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white">
                {Number(discountDraft) > 0 ? '💳 Вернуться и получить скидку' : '💳 Продолжить оплату'}
              </span>
              <div className="mt-1.5 text-[11px] text-slate-500">
                Кнопка создаёт свежий счёт по цене из текста, живёт 15 минут
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 mt-6">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              onClick={saveSettings}
              disabled={!dirty || saving}
            >
              <Save className="w-3.5 h-3.5" />
              {saving ? 'Сохраняю...' : 'Сохранить'}
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              onClick={resetDraft}
              disabled={!dirty || saving}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Отменить правки
            </button>
            {savedAt ? (
              <span className="text-xs font-bold text-emerald-600 ml-1">✓ Сохранено</span>
            ) : null}
            {dirty && !savedAt ? (
              <span className="text-xs font-medium text-amber-600 ml-1">есть несохранённые правки</span>
            ) : null}
            {saveError ? (
              <span className="text-xs font-bold text-rose-600 ml-1">{saveError}</span>
            ) : null}
          </div>
    </section>
  );
}
