import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Loader2,
} from 'lucide-react';
import { SUPPORT_TELEGRAM } from '../../contacts.js';
import { useAuth } from '../../app/providers/AuthProvider.jsx';
import { createTonConnectOrder, checkoutErrorMessage } from '../../features/ton-checkout/pro-order.js';

const plans = [
  {
    id: 'trial',
    label: 'Пробный вход',
    title: 'Trial',
    price: '0 TON',
    period: 'бессрочно',
    description: 'Подключи свою сессию и проверь, как агент работает с твоими группами.',
    action: 'Начать бесплатно',
    features: [
      'Подключение одного юзербота',
      '1000 запросов к API и MCP',
      'своя сессия — файлом или QR'
    ]
  },
  {
    id: 'pro',
    label: 'Рекомендуем',
    title: 'Pro',
    price: '10 TON',
    period: 'за 365 дней доступа',
    description: 'Год полного режима для постоянных автоматизаций.',
    highlighted: true,
    features: [
      'готовый Telegram-аккаунт в комплекте',
      'безлимит по API и MCP',
      'сколько угодно юзерботов и ботов'
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
  const { login } = useAuth();
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
        href="/userbot/profile"
        className="mt-auto inline-flex w-full items-center justify-center gap-2 rounded-full bg-emerald-50 px-5 py-4 text-base font-bold text-emerald-700 ring-1 ring-inset ring-emerald-200 transition hover:bg-emerald-100"
      >
        <CheckCircle2 className="h-4 w-4" strokeWidth={2.5} />
        Активирован до {formatEndDate(proEndsAt) || '—'}
      </a>
    );
  }

  if (pendingOrder) {
    const expired = !countdown || countdown === '00:00';
    return (
      <div className="mt-auto space-y-2">
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-bold uppercase tracking-wider text-amber-700 ring-1 ring-inset ring-amber-200">
          {expired ? 'Счёт истёк' : `Ожидает оплаты · ${countdown}`}
        </div>
        {expired ? null : (
          <button
            type="button"
            onClick={() => navigate(`/pay/${pendingOrder.id}`)}
            className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-amber-600 px-5 py-4 text-base font-bold text-white shadow-lg shadow-amber-600/20 transition hover:bg-amber-700"
          >
            Завершить оплату
            <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
          </button>
        )}
      </div>
    );
  }

  if (!user) {
    return (
      <button
        type="button"
        onClick={() => login()}
        className="mt-auto inline-flex w-full items-center justify-center gap-2 rounded-full bg-indigo-600 px-5 py-4 text-base font-bold text-white shadow-lg shadow-indigo-600/20 transition hover:bg-indigo-700"
      >
        Войди, чтобы оплатить
        <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
      </button>
    );
  }

  const onCreate = async () => {
    setCreating(true);
    setError('');
    try {
      const orderId = await createTonConnectOrder(accessToken);
      navigate(`/pay/${orderId}`);
    } catch (e) {
      setError(checkoutErrorMessage(e));
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
        className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-indigo-600 px-5 py-4 text-base font-bold text-white shadow-lg shadow-indigo-600/20 transition hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
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
        <div className="flex items-start gap-1.5 text-xs text-red-700">
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
    ? 'relative flex flex-col rounded-2xl border-2 border-action-primary bg-surface-card p-6 shadow-xl shadow-indigo-600/10'
    : 'relative flex flex-col rounded-2xl border border-border-default bg-surface-card p-6 shadow-sm';

  return (
    <article className={cardClass}>
      {plan.highlighted ? (
        <div className="absolute -top-4 left-6 rounded-lg bg-action-primary px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] text-action-primary-text shadow-md">
          {plan.label}
        </div>
      ) : (
        <div className="mb-4 text-xs font-semibold uppercase tracking-[0.12em] text-ink-muted">{plan.label}</div>
      )}

      {plan.highlighted ? <div className="mb-4 h-2" /> : null}
      <div className="mb-5">
        <h3 className="text-2xl font-bold text-ink-strong">{plan.title}</h3>
        <p className="mt-2 min-h-[3rem] text-sm font-semibold leading-6 text-ink-body">{plan.description}</p>
      </div>

      <div className="mb-6">
        <div className="text-4xl font-black tracking-tight text-ink-strong">{plan.price}</div>
        <div className="mt-1 text-sm font-bold text-ink-muted">{plan.period}</div>
      </div>

      <ul className="mb-8 space-y-3">
        {plan.features.map((feature) => (
          <li key={feature} className="flex gap-3 text-sm font-medium leading-6 text-ink-body">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-feedback-success-text" strokeWidth={2.5} aria-hidden="true" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      {children}
    </article>
  );
}

// Тарифы (scroll-mt — чтобы якорь #tariffs не уезжал под липкую мобильную шапку)
export function TariffsSection({ profilePlan, proEndsAt, pendingOrder, user, accessToken, login }) {
  return (
    <section id="tariffs" className="scroll-mt-24 bg-white px-6 pb-20 sm:px-10 sm:pb-24 lg:px-16">
      <div className="mx-auto w-full max-w-5xl">
        <div className="mb-8">
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-action-primary">Тарифы</div>
          <h2 className="mt-3 text-balance text-3xl font-bold tracking-tight text-ink-strong sm:text-4xl">
            Самое выгодное решение
          </h2>
        </div>
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
                user ? (
                  <a
                    href="/userbot"
                    className="mt-auto inline-flex w-full items-center justify-center gap-2 rounded-full bg-surface-card px-5 py-4 text-base font-bold text-ink-strong ring-1 ring-inset ring-border-default transition hover:bg-surface-subtle hover:ring-border-strong"
                  >
                    Открыть кабинет
                    <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={() => login('/userbot')}
                    className="mt-auto inline-flex w-full items-center justify-center gap-2 rounded-full bg-surface-card px-5 py-4 text-base font-bold text-ink-strong ring-1 ring-inset ring-border-default transition hover:bg-surface-subtle hover:ring-border-strong"
                  >
                    {plan.action}
                    <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
                  </button>
                )
              )}
            </PlanCard>
          ))}
        </div>
        <p className="mt-6 text-center text-pretty text-sm font-medium leading-6 text-ink-muted">
          Людям с инвалидностью — тариф Normal бесплатно, без справок:{' '}
          <a
            href="/access-request"
            className="font-bold text-action-primary underline decoration-2 underline-offset-2 hover:text-action-primary-hover"
          >
            заполнить короткую форму
          </a>
          .
        </p>
      </div>
    </section>
  );
}
