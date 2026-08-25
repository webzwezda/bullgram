import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowDown,
  ArrowRight,
  Bot,
  CheckCircle2,
  ChevronDown,
  CreditCard,
  Loader2,
  QrCode,
  ReceiptText,
  Repeat,
  RotateCcw,
  Send,
  Settings,
  ShieldCheck,
  Terminal,
  UserMinus,
  Users,
  Wallet,
} from 'lucide-react';
import { SUPPORT_TELEGRAM } from '../contacts.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { apiRequest } from '../api/client.js';

const kassaOutcomes = [
  {
    icon: Wallet,
    title: 'Касса идёт напрямую вам',
    text: 'Деньги от клиентов поступают на ваши P2P-реквизиты или TON-кошелёк. Bullgram не держит деньги, не берёт процент — ведёт только статус и чек.'
  },
  {
    icon: Bot,
    title: 'Доступ выдаётся автоматически',
    text: 'Клиент оплатил — получил приглашение в канал. Клиент не продлил — исключён без ручных действий. Вы контролирующий, не исполняющий.'
  },
  {
    icon: Repeat,
    title: 'Продления без напоминаний вам',
    text: 'Bullgram сам напоминает об истекающем доступе, ведёт статус продления и фиксирует новую оплату. Вы просто видите: кто продлил, а кто нет.'
  },
  {
    icon: Users,
    title: 'База клиентов — не таблица, а система',
    text: 'История платежей, статусы подписок, оттоков и возвращений. Вы знаете каждого клиента, а не только его последний чек.'
  },
  {
    icon: Settings,
    title: 'Тарифы под ваш сценарий',
    text: 'День, неделя, месяц, год — любой период. Несколько тарифов для одного канала. Цена, описание и реквизиты — всё в одном месте.'
  },
  {
    icon: ShieldCheck,
    title: 'Контроль данных и оплат',
    text: 'Каждый чек привязан к человеку, тарифу и статусу. Вся история сохраняется, и вы можете проверить её в любой момент.'
  }
];

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

function ScreenSection({ id, className = '', children }) {
  return (
    <section id={id} className={`flex min-h-screen snap-start snap-always flex-col ${className}`}>
      {children}
    </section>
  );
}

function scrollToId(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
}

function UserbotsCodeMock() {
  return (
    <div className="overflow-hidden rounded-2xl bg-slate-900 ring-1 ring-white/10 shadow-2xl shadow-black/40">
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
        <span className="h-3 w-3 rounded-full bg-rose-500/80" />
        <span className="h-3 w-3 rounded-full bg-amber-400/80" />
        <span className="h-3 w-3 rounded-full bg-emerald-500/80" />
        <span className="ml-3 inline-flex items-center gap-2 text-xs font-bold text-slate-400">
          <Terminal className="h-3.5 w-3.5" strokeWidth={2.5} />
          bullgram api
        </span>
      </div>
      <pre className="overflow-x-auto px-5 py-4 font-mono text-[13px] leading-6 text-slate-300">
        <code>
          <span className="text-sky-400">curl</span> -X POST https://bullgram.xyz/api/userbot/u1/send-message {'\n'}
          {'  '}-H <span className="text-emerald-300">"Authorization: Bearer $TOKEN"</span> {'\n'}
          {'  '}-d {'\{'}<span className="text-emerald-300">"chat"</span>: <span className="text-emerald-300">"@closed_group"</span>,
          {'  '}    <span className="text-emerald-300">"text"</span>: <span className="text-emerald-300">"Добро пожаловать!"</span>{'\}'}
          {'\n\n'}
          <span className="text-slate-500">→ 200 OK</span> {'{'}<span className="text-emerald-300">"delivered"</span>: <span className="text-amber-300">true</span>{'}'}
        </code>
      </pre>
    </div>
  );
}

function KassaFlowMock() {
  const steps = [
    { icon: CreditCard, tone: 'bg-blue-50 text-blue-600', title: 'Клиент оплачивает', text: 'P2P-перевод или TON — деньги идут напрямую вам' },
    { icon: CheckCircle2, tone: 'bg-emerald-50 text-emerald-600', title: 'Доступ выдан автоматически', text: 'Бот приглашает в закрытую группу сразу после оплаты' },
    { icon: RotateCcw, tone: 'bg-amber-50 text-amber-600', title: 'Продление напомнит о себе', text: 'Бот сам напомнит и продлит подписку' },
    { icon: UserMinus, tone: 'bg-rose-50 text-rose-600', title: 'Подписка истекла — доступ забран', text: 'Автокик сработает без ручной сверки чеков' },
  ];
  return (
    <div className="flex flex-col gap-2">
      {steps.map((step, index) => {
        const Icon = step.icon;
        return (
          <div key={step.title}>
            <div className="flex items-start gap-4 rounded-xl bg-slate-50 p-4">
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${step.tone}`}>
                <Icon className="h-5 w-5" strokeWidth={2.5} />
              </span>
              <div>
                <div className="text-sm font-black text-slate-950">{step.title}</div>
                <div className="mt-0.5 text-sm font-medium leading-5 text-slate-600">{step.text}</div>
              </div>
            </div>
            {index < steps.length - 1 ? (
              <div className="flex justify-center py-1">
                <ArrowDown className="h-4 w-4 text-slate-300" strokeWidth={2.5} />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function InvoiceMock() {
  return (
    <div className="mx-auto w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl shadow-black/40">
      <div className="flex items-center justify-between">
        <div className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em] text-slate-400">
          <ReceiptText className="h-4 w-4" strokeWidth={2.5} />
          Счёт на оплату
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-black text-slate-500">TON</span>
      </div>
      <div className="mt-4 text-4xl font-black tracking-tight text-slate-950">12.5 TON</div>
      <div className="mt-1 text-sm font-bold text-slate-500">за цифровой товар</div>
      <div className="mt-5 flex items-center gap-4">
        <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 text-slate-400">
          <QrCode className="h-10 w-10" strokeWidth={2} />
        </div>
        <div className="space-y-2 text-sm font-semibold text-slate-600">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" strokeWidth={2.5} />
            QR и ссылка для покупателя
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" strokeWidth={2.5} />
            Оплата через TonConnect
          </div>
          <div className="rounded-lg bg-slate-900 px-3 py-2 font-mono text-xs font-bold text-slate-200">
            Секрет: ••••••••
          </div>
        </div>
      </div>
      <div className="mt-4 rounded-lg bg-slate-100 px-3 py-2 text-center text-xs font-bold text-slate-500">
        секрет раскроется покупателю после подтверждения платежа
      </div>
    </div>
  );
}

export function HomePage() {
  const { user, accessToken, profilePlan, proEndsAt, billingOrder, login } = useAuth();
  const pendingOrder = billingOrder?.status === 'pending' ? billingOrder : null;
  const { hash } = useLocation();

  useEffect(() => {
    document.documentElement.classList.add('home-scroll-snap');
    return () => document.documentElement.classList.remove('home-scroll-snap');
  }, []);

  useEffect(() => {
    if (hash === '#tariffs') {
      document.getElementById('tariffs')?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [hash]);

  return (
    <div className="w-full">
      {/* Экран 1 — герой */}
      <ScreenSection>
        <div className="flex w-full flex-1 flex-col justify-center bg-gradient-to-br from-blue-50 via-white to-slate-50 px-6 py-16 sm:px-10 lg:px-16">
          <div className="mx-auto w-full max-w-6xl">
            <div className="inline-flex items-center rounded-full bg-blue-600/10 px-3 py-1 text-xs font-black uppercase tracking-[0.14em] text-blue-700 ring-1 ring-inset ring-blue-600/20">
              Bullgram
            </div>
            <h1 className="mt-5 max-w-3xl text-4xl font-black tracking-tight text-slate-950 sm:text-5xl lg:text-6xl">
              Касса, юзерботы и счета для Telegram
            </h1>
            <p className="mt-5 max-w-2xl text-base font-medium leading-7 text-slate-600 sm:text-lg">
              Приём оплат для закрытой группы, юзербот-инфраструктура с API и MCP и TON-счета —
              один сервис вместо зоопарка инструментов.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              {user ? (
                <a
                  href="/app"
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-3.5 text-sm font-black text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700"
                >
                  Открыть кабинет
                  <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
                </a>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => login()}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-white px-5 py-3.5 text-sm font-black text-slate-700 ring-1 ring-inset ring-slate-200 transition hover:bg-slate-50 hover:ring-slate-300"
                  >
                    <GoogleIcon />
                    Войти через Google
                  </button>
                  <button
                    type="button"
                    onClick={() => login(null, 'custom:telegram')}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-sky-500 px-5 py-3.5 text-sm font-black text-white shadow-lg shadow-sky-500/20 transition hover:bg-sky-600"
                  >
                    <Send className="h-4 w-4" strokeWidth={2.5} />
                    Войти через Telegram
                  </button>
                </>
              )}
              <a
                href="/docs"
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-white px-5 py-3.5 text-sm font-black text-slate-800 ring-1 ring-inset ring-slate-200 transition hover:bg-slate-50 hover:ring-slate-300"
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
          <button
            type="button"
            onClick={() => scrollToId('userbots')}
            className="mx-auto mt-10 flex flex-col items-center gap-1 text-xs font-black uppercase tracking-[0.14em] text-slate-400 transition hover:text-slate-600"
          >
            Листайте вниз
            <ChevronDown className="h-5 w-5 animate-bounce" strokeWidth={2.5} />
          </button>
        </div>
      </ScreenSection>

      {/* Экран 2 — юзерботы + API/MCP */}
      <ScreenSection id="userbots">
        <div className="flex w-full flex-1 flex-col justify-center bg-slate-950 px-6 py-16 sm:px-10 lg:px-16">
          <div className="mx-auto grid w-full max-w-6xl items-center gap-12 lg:grid-cols-2">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.16em] text-sky-400">Флагман</div>
              <h2 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-4xl">
                Юзерботы + API и MCP
              </h2>
              <p className="mt-4 text-base font-medium leading-7 text-slate-400">
                Юзерботы подключаются через выделенные прокси и управляются из кода или от AI-агента:
                рассылки, мониторинг, действия в группах — без пальцев и без ограничений ботов.
              </p>
              <ul className="mt-6 space-y-3">
                {['REST API и Bullgram MCP из коробки', 'выделенный прокси на каждого юзербота', 'safe-mode до ручной активации'].map((feature) => (
                  <li key={feature} className="flex gap-3 text-sm font-semibold leading-6 text-slate-200">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-sky-400" strokeWidth={2.5} />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-8 flex flex-wrap gap-3">
                {user ? (
                  <a
                    href="/app"
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700"
                  >
                    Открыть кабинет
                    <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={() => login()}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700"
                  >
                    Начать бесплатно
                    <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
                  </button>
                )}
                <a
                  href="/docs"
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-white/10 px-5 py-3 text-sm font-black text-white ring-1 ring-inset ring-white/20 transition hover:bg-white/15"
                >
                  Документация
                  <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
                </a>
              </div>
            </div>
            <UserbotsCodeMock />
          </div>
        </div>
      </ScreenSection>

      {/* Экран 3 — касса закрытой группы */}
      <ScreenSection>
        <div className="flex w-full flex-1 flex-col justify-center bg-white px-6 py-16 sm:px-10 lg:px-16">
          <div className="mx-auto grid w-full max-w-6xl items-center gap-12 lg:grid-cols-2">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.16em] text-blue-700">Касса</div>
              <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
                Касса закрытой группы
              </h2>
              <p className="mt-4 text-base font-medium leading-7 text-slate-600">
                Официальный бот принимает оплату и сам управляет доступом в закрытую группу.
                Деньги идут напрямую вам — без посредников и комиссий площадки.
              </p>
              <ul className="mt-6 space-y-3">
                {['приём оплат P2P и в TON', 'автовыдача и автокик доступа', 'продления и база клиентов без ручной сверки'].map((feature) => (
                  <li key={feature} className="flex gap-3 text-sm font-semibold leading-6 text-slate-700">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" strokeWidth={2.5} />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-8">
                {user ? (
                  <a
                    href="/app/profile"
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700"
                  >
                    Начать Trial
                    <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={() => login()}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700"
                  >
                    Начать Trial
                    <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
                  </button>
                )}
              </div>
            </div>
            <KassaFlowMock />
          </div>
        </div>
      </ScreenSection>

      {/* Экран 4 — что вы получаете от кассы */}
      <ScreenSection>
        <div className="flex w-full flex-1 flex-col justify-center bg-slate-50 px-6 py-16 sm:px-10 lg:px-16">
          <div className="mx-auto w-full max-w-6xl">
            <div className="text-xs font-black uppercase tracking-[0.16em] text-blue-700">Касса закрытой группы</div>
            <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">Что вы получаете</h2>
            <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {kassaOutcomes.map((outcome) => {
                const Icon = outcome.icon;
                return (
                  <article key={outcome.title} className="rounded-xl bg-white p-5">
                    <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                      <Icon className="h-5 w-5" strokeWidth={2.5} />
                    </span>
                    <h3 className="mt-4 text-base font-black leading-6 text-slate-950">{outcome.title}</h3>
                    <p className="mt-2 text-sm font-medium leading-6 text-slate-600">{outcome.text}</p>
                  </article>
                );
              })}
            </div>
            <div className="mt-10 flex justify-center">
              {user ? (
                <a
                  href="/app/profile"
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700"
                >
                  Начать Trial
                  <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
                </a>
              ) : (
                <button
                  type="button"
                  onClick={() => login()}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700"
                >
                  Начать Trial
                  <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
                </button>
              )}
            </div>
          </div>
        </div>
      </ScreenSection>

      {/* Экран 5 — счета на оплату */}
      <ScreenSection>
        <div className="flex w-full flex-1 flex-col justify-center bg-slate-950 px-6 py-16 sm:px-10 lg:px-16">
          <div className="mx-auto grid w-full max-w-6xl items-center gap-12 lg:grid-cols-2">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.16em] text-sky-400">Без регистрации</div>
              <h2 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-4xl">
                Счета на оплату
              </h2>
              <p className="mt-4 text-base font-medium leading-7 text-slate-400">
                TON-счёт за 30 секунд: ссылка и QR для покупателя, оплата через TonConnect,
                секрет раскрывается сразу после подтверждения платежа.
              </p>
              <ul className="mt-6 space-y-3">
                {['оплата в TON через TonConnect', 'QR-код и ссылка на счёт', 'секрет доступен покупателю после оплаты'].map((feature) => (
                  <li key={feature} className="flex gap-3 text-sm font-semibold leading-6 text-slate-200">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-sky-400" strokeWidth={2.5} />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-8">
                <a
                  href="/create"
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-white px-5 py-3 text-sm font-black text-slate-900 transition hover:bg-slate-100"
                >
                  Создать счёт — без регистрации
                  <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
                </a>
              </div>
            </div>
            <InvoiceMock />
          </div>
        </div>
      </ScreenSection>

      {/* Экран 6 — тарифы */}
      <ScreenSection id="tariffs">
        <div className="flex w-full flex-1 flex-col justify-center bg-white px-6 py-16 sm:px-10 lg:px-16">
          <div className="mx-auto w-full max-w-5xl">
            <div className="text-center">
              <div className="text-xs font-black uppercase tracking-[0.16em] text-blue-700">Тарифы</div>
              <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
                Начните бесплатно — платите, когда вырастете
              </h2>
            </div>
            <div className="mt-10 grid gap-5 lg:grid-cols-2 lg:items-stretch">
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
            <div className="mt-10 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs font-bold text-slate-400">
              <a href="/docs" className="transition-colors hover:text-slate-600">Docs</a>
              <span>·</span>
              <a href="/app/api" className="transition-colors hover:text-slate-600">API</a>
              <span>·</span>
              <a href="/app/mcp" className="transition-colors hover:text-slate-600">MCP</a>
              <span>·</span>
              <a href={SUPPORT_TELEGRAM} target="_blank" rel="noreferrer" className="transition-colors hover:text-slate-600">
                Поддержка
              </a>
            </div>
          </div>
        </div>
      </ScreenSection>
    </div>
  );
}
