import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  Bot,
  CheckCircle2,
  CreditCard,
  Loader2,
  ReceiptText,
  Send,
} from 'lucide-react';
import { SUPPORT_TELEGRAM } from '../contacts.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { apiRequest } from '../api/client.js';

const plans = [
  {
    id: 'trial',
    label: 'Пробный вход',
    title: 'Trial',
    price: '0 TON',
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
    price: '4.5 TON',
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

const products = [
  {
    id: 'userbots',
    icon: Bot,
    label: 'Флагман',
    title: 'Юзерботы + API и MCP',
    description: 'Юзерботы подключаются через выделенные прокси и управляются из кода или от AI-агента: рассылки, мониторинг, действия в группах.',
    highlighted: true,
    features: [
      'REST API и Bullgram MCP',
      'выделенный прокси на каждого юзербота',
      'safe-mode до ручной активации'
    ]
  },
  {
    id: 'access',
    icon: CreditCard,
    label: 'Касса',
    title: 'Касса закрытой группы',
    description: 'Официальный бот принимает оплату, сам выдаёт доступ в закрытую группу и забирает его, когда подписка закончилась.',
    features: [
      'приём оплат P2P и в TON',
      'автовыдача и автокик доступа',
      'продления и база клиентов без ручной сверки'
    ]
  },
  {
    id: 'invoices',
    icon: ReceiptText,
    label: 'Без регистрации',
    title: 'Счета на оплату',
    description: 'TON-счёт за 30 секунд: ссылка и QR для покупателя, секрет раскрывается после подтверждения платежа.',
    features: [
      'оплата в TON через TonConnect',
      'QR-код и ссылка на счёт',
      'секрет доступен покупателю после оплаты'
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
      <button
        type="button"
        onClick={() => login()}
        className="mt-auto inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-4 text-base font-black text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700"
      >
        Войдите, чтобы оплатить
        <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
      </button>
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
        <h3 className="text-2xl font-black text-slate-950">{plan.title}</h3>
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

function ProductCard({ product, children }) {
  const cardClass = product.highlighted
    ? 'relative flex flex-col rounded-lg border-2 border-blue-600 bg-white p-6 shadow-xl shadow-blue-600/10'
    : 'relative flex flex-col rounded-lg border border-slate-200 bg-white p-6 shadow-sm';
  const Icon = product.icon;

  return (
    <article className={cardClass}>
      {product.highlighted ? (
        <div className="absolute -top-4 left-6 rounded-lg bg-blue-600 px-3 py-1 text-xs font-black uppercase tracking-[0.14em] text-white shadow-md">
          {product.label}
        </div>
      ) : (
        <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">{product.label}</div>
      )}

      {product.highlighted ? <div className="mb-4 h-2" /> : null}
      <div className={`mb-4 flex items-center gap-3 ${product.highlighted ? '' : 'mt-1'}`}>
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
            product.highlighted ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-600'
          }`}
        >
          <Icon className="h-5 w-5" strokeWidth={2.5} />
        </span>
        <h3 className="text-xl font-black text-slate-950">{product.title}</h3>
      </div>
      <p className="mb-5 text-sm font-semibold leading-6 text-slate-600">{product.description}</p>

      <ul className="mb-8 space-y-3">
        {product.features.map((feature) => (
          <li key={feature} className="flex gap-3 text-sm font-semibold leading-6 text-slate-700">
            <CheckCircle2 className={`mt-0.5 h-5 w-5 shrink-0 ${product.highlighted ? 'text-blue-600' : 'text-emerald-500'}`} strokeWidth={2.5} />
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      {children}
    </article>
  );
}

function GoogleIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  );
}

export function HomePage() {
  const { user, accessToken, profilePlan, proEndsAt, billingOrder, login } = useAuth();
  const pendingOrder = billingOrder?.status === 'pending' ? billingOrder : null;
  const { hash } = useLocation();

  useEffect(() => {
    if (hash === '#tariffs') {
      document.getElementById('tariffs')?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [hash]);

  return (
    <div className="w-full max-w-7xl mx-auto px-4 py-10 sm:px-6 md:py-14 lg:px-8">
      <section className="relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-blue-50 via-white to-slate-50 px-6 py-12 sm:px-10 md:py-16">
        <div className="relative max-w-3xl">
          <div className="inline-flex items-center rounded-full bg-blue-600/10 px-3 py-1 text-xs font-black uppercase tracking-[0.14em] text-blue-700 ring-1 ring-inset ring-blue-600/20">
            Bullgram
          </div>
          <h1 className="mt-5 text-4xl font-black tracking-tight text-slate-950 sm:text-5xl">
            Юзерботы для Telegram с API и MCP
          </h1>
          <p className="mt-4 text-base font-medium leading-7 text-slate-600">
            Подключите Telegram к коду и AI-агентам: юзербот-инфраструктура, касса закрытой группы
            и TON-счета — в одном сервисе.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            {user ? (
              <a
                href="/app"
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700"
              >
                Открыть кабинет
                <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
              </a>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => login()}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-white px-5 py-3 text-sm font-black text-slate-700 ring-1 ring-inset ring-slate-200 transition hover:bg-slate-50 hover:ring-slate-300"
                >
                  <GoogleIcon />
                  Войти через Google
                </button>
                <button
                  type="button"
                  onClick={() => login(null, 'custom:telegram')}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-sky-500 px-5 py-3 text-sm font-black text-white shadow-lg shadow-sky-500/20 transition hover:bg-sky-600"
                >
                  <Send className="h-4 w-4" strokeWidth={2.5} />
                  Войти через Telegram
                </button>
              </>
            )}
            <a
              href="/docs"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-white px-5 py-3 text-sm font-black text-slate-800 ring-1 ring-inset ring-slate-200 transition hover:bg-slate-50 hover:ring-slate-300"
            >
              Смотреть API и MCP
              <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
            </a>
          </div>
          <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-xs font-bold text-slate-500">
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" strokeWidth={2.5} />
              Trial 14 дней бесплатно
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" strokeWidth={2.5} />
              Оплата в TON
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" strokeWidth={2.5} />
              Счёт можно создать без регистрации
            </span>
          </div>
        </div>
      </section>

      <section className="mt-12">
        <div className="text-sm font-black uppercase tracking-[0.16em] text-blue-700">Что внутри</div>
        <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950">Три продукта — один сервис</h2>
        <div className="mt-8 grid gap-5 lg:grid-cols-3 lg:items-stretch">
          {products.map((product) => (
            <ProductCard key={product.id} product={product}>
              {product.id === 'userbots' ? (
                <a
                  href="/docs"
                  className="mt-auto inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-4 text-base font-black text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700"
                >
                  Документация API
                  <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
                </a>
              ) : product.id === 'access' ? (
                user ? (
                  <a
                    href="/app/profile"
                    className="mt-auto inline-flex w-full items-center justify-center gap-2 rounded-lg bg-white px-5 py-4 text-base font-black text-slate-800 ring-1 ring-inset ring-slate-200 transition hover:bg-slate-50 hover:ring-slate-300"
                  >
                    Начать Trial
                    <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={() => login()}
                    className="mt-auto inline-flex w-full items-center justify-center gap-2 rounded-lg bg-white px-5 py-4 text-base font-black text-slate-800 ring-1 ring-inset ring-slate-200 transition hover:bg-slate-50 hover:ring-slate-300"
                  >
                    Начать Trial
                    <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
                  </button>
                )
              ) : (
                <a
                  href="/create"
                  className="mt-auto inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-5 py-4 text-base font-black text-white transition hover:bg-slate-800"
                >
                  Создать счёт
                  <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
                </a>
              )}
            </ProductCard>
          ))}
        </div>
      </section>

      <section id="tariffs" className="mt-12 scroll-mt-6 pb-12">
        <div className="text-sm font-black uppercase tracking-[0.16em] text-blue-700">Тарифы</div>
        <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950">Начните бесплатно — платите, когда вырастете</h2>
        <div className="mt-8 grid gap-5 lg:grid-cols-2 lg:items-stretch">
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
