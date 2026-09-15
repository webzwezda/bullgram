import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Send } from 'lucide-react';
import { apiRequest } from '../api/client.js';

// Публичная форма заявки на доступ к Bullgram (режим Normal — без юзерботов
// и прокси). Доступна без регистрации: заявка сохраняется и уходит админу
// в Telegram. Сделана с расчётом на людей с ограниченными возможностями:
// крупные поля, явные label, фокус-кольца, ошибки через role="alert".

export function AccessRequestPage() {
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [note, setNote] = useState('');
  const [website, setWebsite] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const successHeadingRef = useRef(null);

  useEffect(() => {
    if (sent) {
      successHeadingRef.current?.focus();
    }
  }, [sent]);

  const onSubmit = async (event) => {
    event.preventDefault();
    setError('');

    if (website) {
      // honeypot: заполнено скрытое поле — молча делаем вид, что успех
      setSent(true);
      return;
    }

    const errors = {};
    if (!name.trim()) errors.name = 'Укажи имя';
    if (!contact.trim()) errors.contact = 'Укажи контакт для связи';
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});

    setSubmitting(true);
    try {
      await apiRequest('/api/access-requests', {
        method: 'POST',
        body: { name, contact, note, website }
      });
      setSent(true);
    } catch (err) {
      setError(err?.message || 'Не удалось отправить заявку. Попробуйте ещё раз или напишите нам в Telegram.');
    } finally {
      setSubmitting(false);
    }
  };

  if (sent) {
    return (
      <div className="w-full max-w-2xl mx-auto px-4 py-16 sm:px-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm" role="status">
          <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-700" strokeWidth={1.8} />
          <h1 ref={successHeadingRef} tabIndex={-1} className="mt-4 text-2xl font-black tracking-tight text-slate-950 outline-none">Заявка отправлена</h1>
          <p className="mt-3 text-base font-medium leading-7 text-slate-600">
            Мы получили вашу заявку и напишем вам по указанному контакту.
            Доступ подключим в режиме Normal — без юзерботов и прокси,
            с человеческой помощью в настройке.
          </p>
          <a
            href="/"
            className="mt-6 inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700"
          >
            Вернуться на главную
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl mx-auto px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
        Особый доступ к Bullgram
      </h1>
      <p className="mt-4 text-base font-medium leading-7 text-slate-600">
        Для людей с инвалидностью цифровые барьеры — не мелочь. Поэтому без справок,
        очередей и автоматических отказов: заполните три поля — рассмотрим заявку лично
        и подключим режим Normal (работа с сайтом без юзерботов и прокси).
      </p>
      <ul className="mt-4 space-y-1.5 text-sm font-semibold text-slate-500">
        <li>— справки и документы не нужны;</li>
        <li>— отвечаем лично, обычно в течение 1–2 дней;</li>
        <li>— заявку видим только мы.</li>
      </ul>

      <form
        onSubmit={onSubmit}
        className="mt-8 space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
        noValidate
      >
        {/* honeypot: человек поле не видит, боты заполняют */}
        <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
          <label htmlFor="website">Сайт</label>
          <input
            id="website"
            name="website"
            type="text"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            tabIndex={-1}
            autoComplete="off"
          />
        </div>

        <div>
          <label htmlFor="name" className="mb-1.5 block text-sm font-bold text-slate-700">
            Как вас зовут <span className="text-rose-500">*</span>
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            maxLength={100}
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Имя"
            aria-invalid={fieldErrors.name ? true : undefined}
            aria-describedby={fieldErrors.name ? 'name-error' : undefined}
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-base font-medium text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
          />
          {fieldErrors.name ? (
            <p id="name-error" role="alert" className="mt-1.5 text-xs font-semibold text-rose-700">
              {fieldErrors.name}
            </p>
          ) : null}
        </div>

        <div>
          <label htmlFor="contact" className="mb-1.5 block text-sm font-bold text-slate-700">
            Контакт для связи <span className="text-rose-500">*</span>
          </label>
          <input
            id="contact"
            name="contact"
            type="text"
            required
            maxLength={100}
            autoComplete="off"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder="Telegram @username или email"
            aria-invalid={fieldErrors.contact ? true : undefined}
            aria-describedby={fieldErrors.contact ? 'contact-error' : undefined}
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-base font-medium text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
          />
          {fieldErrors.contact ? (
            <p id="contact-error" role="alert" className="mt-1.5 text-xs font-semibold text-rose-700">
              {fieldErrors.contact}
            </p>
          ) : null}
          <p className="mt-1.5 text-xs font-medium text-slate-500">
            Напишем сюда, когда подключим доступ
          </p>
        </div>

        <div>
          <div className="mb-1.5 flex items-baseline justify-between gap-2">
            <label htmlFor="note" className="text-sm font-bold text-slate-700">
              Ваша ситуация или пожелания <span className="font-medium text-slate-500">(по желанию)</span>
            </label>
            <span className="shrink-0 text-[11px] font-medium text-slate-500" aria-hidden="true">
              {note.length} / 500
            </span>
          </div>
          <textarea
            id="note"
            name="note"
            rows={3}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Например: пользуюсь скринридером, нужен крупный шрифт, важна поддержка без спешки"
            aria-invalid={fieldErrors.note ? true : undefined}
            aria-describedby={fieldErrors.note ? 'note-error' : undefined}
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-base font-medium text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
          />
          {fieldErrors.note ? (
            <p id="note-error" role="alert" className="mt-1.5 text-xs font-semibold text-rose-700">
              {fieldErrors.note}
            </p>
          ) : null}
        </div>

        {error ? (
          <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={submitting}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-4 text-base font-black text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send className="h-5 w-5" strokeWidth={2.5} />
          {submitting ? 'Отправляем…' : 'Отправить заявку'}
        </button>

        <p className="text-center text-xs font-medium text-slate-500">
          Форма работает без регистрации. Если что-то не получилось —
          напишите нам в Telegram, примем заявку вручную.
        </p>
      </form>
    </div>
  );
}
