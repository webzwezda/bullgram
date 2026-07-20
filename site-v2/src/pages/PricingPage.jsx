import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Loader2,
  Mail,
  ReceiptText,
  RotateCcw,
  ShieldCheck,
  Truck,
} from 'lucide-react';
import { SALES_LINKS } from '../components/MarketingPrimitives.jsx';
import { SUPPORT_EMAIL, SUPPORT_TELEGRAM } from '../contacts.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { apiRequest } from '../api/client.js';

const plans = [
  {
    id: 'trial',
    label: 'Пробный вход',
    title: 'Trial',
    price: '0 ₽',
    period: 'на 14 дней',
    description: 'Пробный доступ к Bullgram, чтобы проверить сценарий платного Telegram-доступа без оплаты.',
    href: SALES_LINKS.trial,
    action: 'Начать Trial',
    features: [
      'до 50 активных подписчиков',
      'первый checkout и доступ после оплаты',
      'базовая проверка Telegram-сценария',
      'ограничения пробного режима'
    ]
  },
  {
    id: 'normal',
    label: 'Первый платный вход',
    title: 'Normal',
    price: '900 ₽',
    period: 'за 365 дней доступа',
    description: 'Основной платный тариф для доступа к Bullgram: P2P/TON-касса, доступ, CRM, продления и Shop.',
    highlighted: true,
    features: [
      'доступ к кабинету Bullgram на 365 дней',
      'P2P/TON-касса для Telegram-канала или группы',
      'CRM, заказы, продления и исключение из доступа',
      'Shop/P2P-сценарий с прямым денежным потоком продавцу'
    ]
  },
  {
    id: 'custom',
    label: 'Индивидуально',
    title: 'Под заказ',
    price: 'по согласованию',
    period: 'после брифа',
    description: 'Индивидуальная настройка, миграция или отдельный запуск. Пока тариф не принимает оплату на сайте.',
    action: 'Временно недоступно',
    disabled: true,
    features: [
      'состав работ фиксируется до оплаты',
      'срок и результат согласуются в заказе',
      'подходит для нестандартной Telegram-инфраструктуры',
      'будет включен после готовности ручного процесса'
    ]
  }
];

const normalDelivery = [
  'Нажмите «Оплатить TON», подключите TonConnect-кошелёк и подтвердите платёж.',
  'Деньги уходят напрямую на кошелёк сервиса, платёж отслеживается автоматически.',
  'Сразу после подтверждения тариф активируется — кабинет открывается на 365 дней.',
  'Услуга оказывается дистанционно в течение оплаченного периода.'
];

const complianceBlocks = [
  {
    icon: Truck,
    title: 'Получение услуги',
    text: 'Normal открывает дистанционный доступ к сервису Bullgram и рабочим сценариям для Telegram-проекта на оплаченный срок.'
  },
  {
    icon: RotateCcw,
    title: 'Отказ и возврат',
    text: 'До начала оказания услуги покупатель может отказаться от заказа и получить полный возврат. После начала доступного периода возврат рассчитывается по неоказанной части услуги.'
  },
  {
    icon: ShieldCheck,
    title: 'Персональные данные',
    text: 'Контакты покупателя используются для связи по заказу, выдачи доступа, чеков и поддержки. Данные не передаются третьим лицам без законного основания.'
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

function NormalCheckoutButton({ profilePlan, normalEndsAt, pendingOrder, user, accessToken }) {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(() => formatCountdown(pendingOrder?.expires_at));

  useEffect(() => {
    if (!pendingOrder?.expires_at) return;
    const t = setInterval(() => setCountdown(formatCountdown(pendingOrder.expires_at)), 1000);
    return () => clearInterval(t);
  }, [pendingOrder?.expires_at]);

  if (profilePlan === 'normal') {
    return (
      <a
        href="/plan"
        className="mt-auto inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-50 px-5 py-4 text-base font-black text-emerald-700 ring-1 ring-inset ring-emerald-200 transition hover:bg-emerald-100"
      >
        <CheckCircle2 className="h-4 w-4" strokeWidth={2.5} />
        Активирован до {formatEndDate(normalEndsAt) || '—'}
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
    : plan.disabled
      ? 'relative flex flex-col rounded-lg border border-slate-200 bg-slate-100/80 p-6 text-slate-500'
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
        <h2 className={`text-2xl font-black ${plan.disabled ? 'text-slate-500' : 'text-slate-950'}`}>{plan.title}</h2>
        <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">{plan.description}</p>
      </div>

      <div className="mb-6">
        <div className={`text-4xl font-black tracking-tight ${plan.disabled ? 'text-slate-500' : 'text-slate-950'}`}>
          {plan.price}
        </div>
        <div className="mt-1 text-sm font-bold text-slate-500">{plan.period}</div>
      </div>

      <ul className="mb-8 space-y-3">
        {plan.features.map((feature) => (
          <li key={feature} className="flex gap-3 text-sm font-semibold leading-6 text-slate-700">
            {plan.disabled ? (
              <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" strokeWidth={2.5} />
            ) : (
              <CheckCircle2 className={`mt-0.5 h-5 w-5 shrink-0 ${plan.highlighted ? 'text-blue-600' : 'text-emerald-500'}`} strokeWidth={2.5} />
            )}
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      {children}
    </article>
  );
}

export function PricingPage() {
  const { user, accessToken, profilePlan, normalEndsAt, billingOrder } = useAuth();
  const pendingOrder = billingOrder?.status === 'pending' ? billingOrder : null;

  return (
    <div className="w-full max-w-7xl mx-auto px-4 py-12 sm:px-6 md:py-16 lg:px-8">
      <section className="border-b border-slate-200 pb-12">
        <div className="grid gap-5 lg:grid-cols-3 lg:items-stretch">
          {plans.map((plan) => (
            <PlanCard key={plan.id} plan={plan}>
              {plan.id === 'normal' ? (
                <NormalCheckoutButton
                  profilePlan={profilePlan}
                  normalEndsAt={normalEndsAt}
                  pendingOrder={pendingOrder}
                  user={user}
                  accessToken={accessToken}
                />
              ) : plan.disabled ? (
                <button
                  type="button"
                  disabled
                  className="mt-auto inline-flex w-full cursor-not-allowed items-center justify-center rounded-lg bg-slate-200 px-5 py-4 text-base font-black text-slate-500"
                >
                  {plan.action}
                </button>
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

      <section className="grid gap-8 border-b border-slate-200 py-12 lg:grid-cols-[0.8fr_1.2fr]">
        <div>
          <div className="text-sm font-black uppercase tracking-[0.16em] text-blue-700">Что оплачивает покупатель</div>
          <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950">Normal на 365 дней</h2>
          <p className="mt-4 text-base font-medium leading-7 text-slate-600">
            Это услуга дистанционного доступа к сервису Bullgram для управления платным Telegram-проектом:
            P2P/TON-касса, заявки, чеки, выдача доступа, CRM, продления, исключения и Shop/P2P-сценарии.
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-6">
          <div className="flex items-center gap-3 text-slate-950">
            <ReceiptText className="h-6 w-6 text-blue-600" strokeWidth={2.5} />
            <h3 className="text-2xl font-black tracking-tight">Порядок оказания услуги</h3>
          </div>
          <ol className="mt-6 space-y-4">
            {normalDelivery.map((step, index) => (
              <li key={step} className="flex gap-4">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-sm font-black text-blue-700">
                  {index + 1}
                </span>
                <span className="pt-1 text-sm font-semibold leading-6 text-slate-700">{step}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="border-b border-slate-200 py-12">
        <div className="max-w-3xl">
          <div className="text-sm font-black uppercase tracking-[0.16em] text-blue-700">Правила покупки</div>
          <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950">Информация об оплате и правилах покупки</h2>
        </div>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {complianceBlocks.map(({ icon: Icon, title, text }) => (
            <article key={title} className="rounded-lg border border-slate-200 bg-white p-5">
              <div className="flex items-center gap-3">
                <Icon className="h-5 w-5 text-blue-600" strokeWidth={2.5} />
                <h3 className="text-lg font-black text-slate-950">{title}</h3>
              </div>
              <p className="mt-3 text-sm font-medium leading-6 text-slate-600">{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="grid gap-8 py-12 lg:grid-cols-[0.9fr_1.1fr]">
        <div>
          <div className="text-sm font-black uppercase tracking-[0.16em] text-blue-700">Поддержка</div>
          <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950">Связь с командой</h2>
          <p className="mt-4 text-base font-medium leading-7 text-slate-600">
            Оплата и возвраты — в криптовалюте. По любым вопросам доступа, оплаты и тарифов пишите в поддержку.
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <a className="inline-flex items-center gap-2 rounded-lg bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-100" href={`mailto:${SUPPORT_EMAIL}`}>
              <Mail className="h-4 w-4" strokeWidth={2.5} />
              {SUPPORT_EMAIL}
            </a>
            <a className="inline-flex items-center gap-2 rounded-lg bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-100" href={SUPPORT_TELEGRAM} target="_blank" rel="noreferrer">
              <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
              Telegram поддержки
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
