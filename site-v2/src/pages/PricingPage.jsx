import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Loader2,
} from 'lucide-react';
import { SUPPORT_TELEGRAM } from '../contacts.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { apiRequest } from '../api/client.js';

const plans = [
  {
    id: 'trial',
    label: 'Пробный вход',
    title: 'Trial',
    price: '0 ₽',
    period: 'на 14 дней',
    description: 'Пробный доступ к Bullgram, чтобы собрать первый рабочий контур и проверить сценарии без оплаты.',
    href: '/app/profile',
    action: 'Начать Trial',
    features: [
      '500 запросов к API и MCP в месяц',
      '1 юзербот и 1 свой прокси',
      '1 автопост-бот',
      'покупка готовых активов в Shop'
    ]
  },
  {
    id: 'pro',
    label: 'Первый платный вход',
    title: 'Pro',
    price: '900 ₽',
    period: 'за 365 дней доступа',
    description: 'Основной платный тариф Bullgram: рабочий режим без лимитов на запросы и активы, рассылки и продажи.',
    highlighted: true,
    features: [
      'безлимит запросов к API и MCP',
      'безлимит юзерботов и своих прокси',
      '3 автопост-бота и живые рассылки',
      'продажа активов в Shop с прямым денежным потоком'
    ]
  }
];

function formatEndDate(value) {
  if (!value) return null;
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long' }).format(new Date(value));
}

function formatCountdown(value) {
  if (!value) return null;
  const ms = new Date(value).getTime() - Date.now();
  if (ms <= 0) return '00:00';
  const totalSec = Math.floor(ms / 1000);
  const hh = Math.floor(totalSec / 3600);
  const mm = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
  const ss = String(totalSec % 60).padStart(2, '0');
  return hh > 0 ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`;
}

function ProCheckoutButton({ profilePlan, proEndsAt, pendingOrder, user, accessToken }) {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(() => formatCountdown(pendingOrder?.expires_at));

  useEffect(() => {
    if (!pendingOrder?.expires_at) return;
    const t = setInterval(() => setCountdown(formatCountdown(pendingOrder.expires_at)), 1000);
    return () => clearInterval(t);
  }, [pendingOrder?.expires_at]);

  if (profilePlan === 'pro' || profilePlan === 'normal') {
    return (
      <a
        href="/app/profile"
        className="mt-auto inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-50 px-5 py-4 text-base font-black text-emerald-700 ring-1 ring-inset ring-emerald-200 transition hover:bg-emerald-100"
      >
        <CheckCircle2 className="h-4 w-4" strokeWidth={2.5} />
        Активирован до {formatEndDate(proEndsAt) || '—'}
      </a>
    );
  }

  if (pendingOrder) {
    return (
      <div className="mt-auto space-y-2">
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-bold uppercase tracking-wider text-amber-700 ring-1 ring-inset ring-amber-200">
          Ожидает оплаты · {countdown || '00:00'}
        </div>
        <button
          type="button"
          onClick={() => navigate(`/pay/${pendingOrder.id}`)}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-amber-600 px-5 py-4 text-base font-black text-white shadow-lg shadow-amber-600/20 transition hover:bg-amber-700"
        >
          Завершить оплату
          <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
        </button>
      </div>
    );
  }

  if (!user) {
    return (
      <a
        href="/?login=1"
        className="mt-auto inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-4 text-base font-black text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700"
      >
        Войдите, чтобы оплатить
        <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
      </a>
    );
  }

  const onCreate = async () => {
    setCreating(true);
    setError('');
    try {
      const data = await apiRequest('/api/billing/checkout/ton-connect', {
        accessToken,
        method: 'POST',
        body: {}
      });
      if (!data?.order_id) throw new Error('Не получили order_id от сервера');
      navigate(`/pay/${data.order_id}`);
    } catch (e) {
      const status = e?.status || e?.statusCode;
      if (status >= 500) {
        setError('Сервис оплаты недоступен. Напишите в поддержку.');
      } else {
        setError(e.message || 'Не удалось создать счёт');
      }
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="mt-auto space-y-2">
      <button
        type="button"
        onClick={onCreate}
        disabled={creating}
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-4 text-base font-black text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {creating ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Создаём счёт…
          </>
        ) : (
          <>
            Оплатить TON
            <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
          </>
        )}
      </button>
      {error ? (
        <div className="flex items-start gap-1.5 text-xs text-rose-600">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}
      <a
        href={SUPPORT_TELEGRAM}
        target="_blank"
        rel="noreferrer"
        className="block text-center text-xs text-slate-500 underline hover:text-slate-700"
      >
        или через поддержку
      </a>
    </div>
  );
}

function PlanCard({ plan, children }) {
  const cardClass = plan.highlighted
    ? 'relative flex flex-col rounded-lg border-2 border-blue-600 bg-white p-6 shadow-xl shadow-blue-600/10'
    : 'relative flex flex-col rounded-lg border border-slate-200 bg-white p-6 shadow-sm';

  return (
    <article className={cardClass}>
      {plan.highlighted ? (
        <div className="absolute -top-4 left-6 rounded-lg bg-blue-600 px-3 py-1 text-xs font-black uppercase tracking-[0.14em] text-white shadow-md">
          {plan.label}
        </div>
      ) : (
        <div className="mb-4 text-xs font-black uppercase tracking-[0.16em] text-slate-400">{plan.label}</div>
      )}

      {plan.highlighted ? <div className="mb-4 h-2" /> : null}
      <div className="mb-5">
        <h2 className="text-2xl font-black text-slate-950">{plan.title}</h2>
        <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">{plan.description}</p>
      </div>

      <div className="mb-6">
        <div className="text-4xl font-black tracking-tight text-slate-950">{plan.price}</div>
        <div className="mt-1 text-sm font-bold text-slate-500">{plan.period}</div>
      </div>

      <ul className="mb-8 space-y-3">
        {plan.features.map((feature) => (
          <li key={feature} className="flex gap-3 text-sm font-semibold leading-6 text-slate-700">
            <CheckCircle2 className={`mt-0.5 h-5 w-5 shrink-0 ${plan.highlighted ? 'text-blue-600' : 'text-emerald-500'}`} strokeWidth={2.5} />
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      {children}
    </article>
  );
}

export function PricingPage() {
  const { user, accessToken, profilePlan, proEndsAt, billingOrder } = useAuth();
  const pendingOrder = billingOrder?.status === 'pending' ? billingOrder : null;

  return (
    <div className="w-full max-w-7xl mx-auto px-4 py-12 sm:px-6 md:py-16 lg:px-8">
      <section className="pb-12">
        <div className="grid gap-5 lg:grid-cols-2 lg:items-stretch">
          {plans.map((plan) => (
            <PlanCard key={plan.id} plan={plan}>
              {plan.id === 'pro' ? (
                <ProCheckoutButton
                  profilePlan={profilePlan}
                  proEndsAt={proEndsAt}
                  pendingOrder={pendingOrder}
                  user={user}
                  accessToken={accessToken}
                />
              ) : (
                <a
                  href={plan.href}
                  className="mt-auto inline-flex w-full items-center justify-center gap-2 rounded-lg bg-white px-5 py-4 text-base font-black text-slate-800 ring-1 ring-inset ring-slate-200 transition hover:bg-slate-50 hover:ring-slate-300"
                >
                  {plan.action}
                  <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
                </a>
              )}
            </PlanCard>
          ))}
        </div>
      </section>
    </div>
  );
}
