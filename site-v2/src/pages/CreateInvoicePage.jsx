import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  FilePlus,
  Loader2,
  Lock,
  Send,
  ShieldCheck,
  Tag,
  Wallet,
} from 'lucide-react';
import { apiRequest } from '../api/client.js';
import { Card } from '../components/ui/card.jsx';

const AMOUNT_CHIPS = [0.1, 0.5, 1, 5, 10];
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function FieldError({ message }) {
  if (!message) return null;
  return (
    <div className="mt-1.5 flex items-center gap-1.5 text-xs text-rose-600">
      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function SectionLabel({ icon: Icon, children, hint }) {
  return (
    <div className="flex items-center justify-between mb-2">
      <div className="flex items-center gap-1.5">
        {Icon ? <Icon className="w-3.5 h-3.5 text-slate-500" /> : null}
        <span className="text-xs font-bold uppercase tracking-wider text-slate-500">{children}</span>
      </div>
      {hint ? (
        <span className="text-[10px] text-slate-400 font-medium">{hint}</span>
      ) : null}
    </div>
  );
}

export function CreateInvoicePage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    title: '',
    description: '',
    amount_ton: '',
    secret_payload: '',
    seller_wallet: '',
    seller_email: '',
  });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const update = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
    if (submitError) setSubmitError('');
  };

  const validate = () => {
    const next = {};
    const title = form.title.trim();
    if (!title) next.title = 'Укажите название';
    else if (title.length > 120) next.title = 'До 120 символов';

    const amount = Number(form.amount_ton);
    if (!Number.isFinite(amount) || amount < 0.01 || amount > 10000) {
      next.amount_ton = 'От 0.01 до 10000 TON';
    }

    if (!form.secret_payload) next.secret_payload = 'Укажите, что получит покупатель';
    else if (form.secret_payload.length > 2000) next.secret_payload = 'До 2000 символов';

    if (form.description && form.description.length > 500) {
      next.description = 'До 500 символов';
    }

    if (!form.seller_wallet.trim()) {
      next.seller_wallet = 'Укажите TON-кошелёк';
    } else if (!/^[A-Za-z0-9_\-]{20,}$/.test(form.seller_wallet.trim())) {
      next.seller_wallet = 'Похоже на неверный адрес';
    }

    if (!form.seller_email.trim()) {
      next.seller_email = 'Укажите email';
    } else if (!EMAIL_RE.test(form.seller_email.trim())) {
      next.seller_email = 'Неверный email';
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    if (!validate()) return;

    setSubmitting(true);
    setSubmitError('');
    try {
      const data = await apiRequest('/api/public-invoices/public/create', {
        method: 'POST',
        body: {
          amount_ton: Number(form.amount_ton),
          title: form.title.trim(),
          description: form.description.trim() || null,
          secret_payload: form.secret_payload,
          seller_wallet: form.seller_wallet.trim(),
          seller_email: form.seller_email.trim(),
          network: 'mainnet',
        },
      });
      navigate(`/created/${data.id}`);
    } catch (err) {
      setSubmitError(err.message || 'Не удалось создать счёт');
    } finally {
      setSubmitting(false);
    }
  };

  const inputBase = 'w-full rounded-xl border bg-white px-3.5 h-12 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/5 transition-colors';
  const inputClass = (key) => errors[key]
    ? `${inputBase} border-rose-300 focus:border-rose-400`
    : `${inputBase} border-slate-200 focus:border-slate-400`;

  return (
    <section className="space-y-6">
      <Card className="p-0 gap-0 border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 bg-white overflow-hidden rounded-2xl">
        <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6">
          <div className="flex flex-row items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-500/20 shrink-0">
              <FilePlus className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <h2 className="text-xl font-bold text-slate-900">Счёт на оплату в TON</h2>
              <p className="text-sm font-medium text-slate-500 mt-0.5">
                Заполните условия — мы сгенерируем ссылку для покупателя.{' '}
                <span className="inline-flex items-center gap-1 font-mono">
                  <Clock className="w-3 h-3" />
                  Действует 1.5 часа
                </span>
              </p>
            </div>
          </div>
        </div>

        <div className="p-5 sm:p-6 bg-white">
          <form onSubmit={onSubmit} className="space-y-6">
            <div>
              <SectionLabel icon={Tag} hint="обязательно">Что продаёте</SectionLabel>
              <input
                type="text"
                value={form.title}
                onChange={(e) => update('title', e.target.value.slice(0, 120))}
                onBlur={() => form.title && validate()}
                placeholder="Например: консультация, файл, доступ к материалу"
                maxLength={120}
                aria-invalid={!!errors.title}
                className={inputClass('title')}
              />
              <FieldError message={errors.title} />
              <textarea
                value={form.description}
                onChange={(e) => update('description', e.target.value.slice(0, 500))}
                placeholder="Условия, детали, инструкции — необязательно"
                maxLength={500}
                rows={2}
                aria-invalid={!!errors.description}
                className={`mt-2 w-full rounded-xl border bg-white px-3.5 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/5 transition-colors ${errors.description ? 'border-rose-300' : 'border-slate-200 focus:border-slate-400'}`}
              />
              <FieldError message={errors.description} />
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <SectionLabel icon={Wallet} hint="обязательно">Сумма в TON</SectionLabel>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0.01"
                  value={form.amount_ton}
                  onChange={(e) => update('amount_ton', e.target.value)}
                  onBlur={() => form.amount_ton && validate()}
                  placeholder="0.5"
                  aria-invalid={!!errors.amount_ton}
                  className={inputClass('amount_ton')}
                />
                <FieldError message={errors.amount_ton} />
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {AMOUNT_CHIPS.map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => update('amount_ton', String(value))}
                      className={`px-3 h-9 rounded-lg text-xs font-bold transition-colors ${
                        Number(form.amount_ton) === value
                          ? 'bg-indigo-600 text-white'
                          : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {value} TON
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <SectionLabel icon={Wallet} hint="обязательно">Ваш TON-кошелёк</SectionLabel>
                <input
                  type="text"
                  value={form.seller_wallet}
                  onChange={(e) => update('seller_wallet', e.target.value)}
                  onBlur={() => form.seller_wallet && validate()}
                  placeholder="EQ… или UQ… или 0Q…"
                  spellCheck={false}
                  aria-invalid={!!errors.seller_wallet}
                  className={`${inputClass('seller_wallet')} font-mono`}
                />
                <FieldError message={errors.seller_wallet} />
              </div>
            </div>

            <div>
              <SectionLabel icon={Lock} hint="скрыто до оплаты">Что получит покупатель</SectionLabel>
              <textarea
                value={form.secret_payload}
                onChange={(e) => update('secret_payload', e.target.value.slice(0, 2000))}
                onBlur={() => form.secret_payload && validate()}
                placeholder="Ссылка, ключ, код, контакт — что увидит покупатель после оплаты"
                maxLength={2000}
                rows={4}
                aria-invalid={!!errors.secret_payload}
                className={`w-full rounded-xl border bg-white px-3.5 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/5 transition-colors font-mono ${errors.secret_payload ? 'border-rose-300' : 'border-slate-200 focus:border-slate-400'}`}
              />
              <div className="flex items-center justify-between text-xs text-slate-400 mt-1.5">
                <span>Текст увидят только после успешной оплаты.</span>
                <span className="font-mono">{form.secret_payload.length}/2000</span>
              </div>
              <FieldError message={errors.secret_payload} />
            </div>

            <div className="grid md:grid-cols-2 gap-4 items-end">
              <div>
                <SectionLabel icon={Send} hint="обязательно">Email для уведомления</SectionLabel>
                <input
                  type="email"
                  value={form.seller_email}
                  onChange={(e) => update('seller_email', e.target.value)}
                  onBlur={() => form.seller_email && validate()}
                  placeholder="you@example.com"
                  aria-invalid={!!errors.seller_email}
                  className={inputClass('seller_email')}
                />
                <FieldError message={errors.seller_email} />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="w-full inline-flex items-center justify-center gap-2 h-12 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold transition-colors shadow-md shadow-indigo-200"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Создаём счёт…
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    Создать счёт
                  </>
                )}
              </button>
            </div>

            {submitError ? (
              <div className="rounded-xl bg-rose-50 border border-rose-200 px-3.5 py-3 text-sm text-rose-700">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{submitError}</span>
                </div>
              </div>
            ) : null}

            <p className="text-center text-[11px] text-slate-400 leading-relaxed">
              Bullgram обеспечивает приём платежа и не гарантирует доставку товара.
            </p>
          </form>
        </div>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { icon: Send, title: 'Ссылка', text: 'Отправьте покупателю' },
          { icon: ShieldCheck, title: 'TON', text: 'Оплата напрямую вам' },
          { icon: CheckCircle2, title: 'Секрет', text: 'Покупатель видит текст' },
        ].map(({ icon: Icon, title, text }) => (
          <div key={title} className="rounded-2xl bg-white border border-slate-200 p-4 flex items-start gap-3 shadow-sm">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center shrink-0">
              <Icon className="w-4 h-4 text-indigo-600" />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-bold text-slate-700">{title}</div>
              <div className="text-xs text-slate-500">{text}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
