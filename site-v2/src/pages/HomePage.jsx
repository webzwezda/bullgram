import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  AlertTriangle,
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
    price: '0 TON',
    period: 'бессрочно',
    description: 'Подключи свою сессию и проверь, как агент работает с твоими группами.',
    action: 'Начать бесплатно',
    features: [
      '1 юзербот',
      '100 запросов к API и MCP',
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

const steps = [
  {
    n: '01',
    title: 'Подключи сессию',
    text: 'Свою — файлом или QR. Или возьми готовый аккаунт из магазина: уже на выделенном прокси, стартует в safe-mode.'
  },
  {
    n: '02',
    title: 'Дай агенту доступ',
    text: 'Интеграционный токен — в два клика. MCP-сервер и REST API работают с n8n, Claude и любым MCP-клиентом.'
  },
  {
    n: '03',
    title: 'Агент работает в Telegram',
    text: 'Читает группы и историю, мониторит каналы, пишет в ЛС. Всё, чего не умеет Bot API.'
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
      const data = await apiRequest('/api/billing/checkout/ton-connect', {
        accessToken,
        method: 'POST',
        body: {}
      });
      if (!data?.order_id) throw new Error('Не получили order_id от сервера');
      navigate(`/pay/${data.order_id}`);
    } catch (e) {
      const status = e?.status || e?.statusCode;
      if (!status) {
        setError('Не удалось связаться с сервером. Проверь интернет и попробуй ещё раз.');
      } else if (status >= 500) {
        setError('Сервис оплаты недоступен. Напиши в поддержку.');
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

function StartFreeButton({ user, login }) {
  return (
    <button
      type="button"
      onClick={() => (user ? window.location.assign('/app/profile') : login('/app/profile'))}
      className="group inline-flex items-center justify-center gap-2 rounded-full bg-action-primary px-8 py-4 text-base font-bold text-action-primary-text shadow-lg shadow-indigo-600/20 transition-all hover:bg-action-primary-hover hover:shadow-[0_8px_30px_rgba(79,70,229,0.24)] hover:-translate-y-0.5"
    >
      Начать бесплатно
      <ArrowRight className="w-5 h-5" strokeWidth={2.5} />
    </button>
  );
}

function McpExampleCard() {
  return (
    <div className="overflow-hidden rounded-2xl bg-slate-900 shadow-2xl shadow-black/40 ring-1 ring-white/10">
      <div className="flex items-center border-b border-white/10 px-4 py-3">
        <span className="font-mono text-xs font-semibold text-slate-400">mcp · n8n · агент</span>
      </div>
      <pre className="overflow-x-auto p-5 font-mono text-xs leading-6 text-slate-200 sm:p-6">
        <code>
          <span className="text-slate-400">{'// MCP · сообщения группы за последние сутки'}</span>
          {'\n'}
          <span className="text-indigo-300">bullgram_userbot_messages</span>
          {'({\n  userbot_id: '}
          <span className="text-emerald-300">"8f3c…"</span>
          {',\n  chat_id:    '}
          <span className="text-emerald-300">"-1001234567890"</span>
          {',\n  since:      '}
          <span className="text-emerald-300">"2026-09-19T00:00:00Z"</span>
          {',\n  limit:      '}
          <span className="text-slate-200">200</span>
          {'\n})\n\n'}
          <span className="text-slate-400">{'// → текст, автор, время — вход для n8n'}</span>
        </code>
      </pre>
    </div>
  );
}

export function HomePage() {
  const { user, accessToken, profilePlan, proEndsAt, billingOrder, login } = useAuth();
  const pendingOrder = billingOrder?.status === 'pending' && billingOrder?.provider === 'ton_connect' ? billingOrder : null;
  const { hash } = useLocation();

  useEffect(() => {
    if (!hash) return;
    const el = document.getElementById(hash.slice(1));
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  }, [hash]);

  return (
    <div className="w-full">
      {/* Герой — вариант B: исход для строителя агентов */}
      <section className="relative isolate overflow-hidden px-4 pb-14 pt-20 text-center sm:px-6 sm:pt-24 lg:pt-28">
        <div className="absolute inset-0 -z-10 h-full w-full bg-white bg-[linear-gradient(to_right,#f0f0f0_1px,transparent_1px),linear-gradient(to_bottom,#f0f0f0_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_80%_50%_at_50%_0%,#000_70%,transparent_100%)]" />
        <div className="absolute top-0 -z-10 w-full h-[600px] bg-[radial-gradient(circle_800px_at_50%_-200px,#e0e7ff,transparent)]" />
        <div className="absolute top-40 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-blue-400/20 blur-[100px] rounded-full mix-blend-multiply pointer-events-none -z-10" />

        <div className="flex flex-wrap items-center justify-center gap-3 mb-8">
          <span
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-card border border-border-default shadow-[0_2px_10px_-3px_rgba(79,70,229,0.1)]"
            title="Принимаем оплату только в криптовалюте — TON"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="11" fill="#0098EA" />
              <path d="M12 5.5 17.5 11 12 18.5 6.5 11 12 5.5Z" fill="#fff" />
            </svg>
            <span className="text-[13px] font-bold tracking-wide text-ink-body uppercase">
              Оплата в TON
            </span>
          </span>
        </div>

        <h1 className="mx-auto max-w-4xl text-balance text-4xl sm:text-6xl lg:text-7xl font-black tracking-tighter text-ink-strong leading-[0.95] mb-6 sm:mb-8">
          Дай своему ИИ-агенту <br className="hidden sm:block" />
          <span className="text-action-primary">Telegram-аккаунт</span>
        </h1>

        <p className="mx-auto max-w-[42rem] text-pretty text-lg sm:text-xl text-ink-muted font-medium leading-relaxed mb-8 sm:mb-10 tracking-tight">
          Живой аккаунт для агента: группы, каналы, сообщения — через MCP, REST API
          или Telegram Web. Прокси и предохранители уже включены.
        </p>

        <StartFreeButton user={user} login={login} />
      </section>

      {/* Как это работает — 3 шага */}
      <section className="bg-white px-6 py-16 sm:px-10 lg:px-16 sm:py-20">
        <div className="mx-auto w-full max-w-6xl">
          <div className="mb-10 max-w-2xl">
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-action-primary">Как это работает</div>
            <h2 className="mt-3 text-balance text-3xl font-bold tracking-tight text-ink-strong sm:text-4xl">
              Три шага — и агент в Telegram
            </h2>
          </div>
          <ol className="grid gap-5 sm:grid-cols-3">
            {steps.map((step) => (
              <li key={step.n} className="rounded-2xl border border-border-default bg-surface-subtle p-6">
                <div className="font-mono text-xs font-bold uppercase tracking-widest text-ink-muted">{step.n}</div>
                <h3 className="mt-3 text-lg font-bold leading-snug text-ink-strong">{step.title}</h3>
                <p className="mt-2 text-pretty text-sm font-medium leading-6 text-ink-body">{step.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Интерфейс: MCP и REST API к живым сессиям */}
      <section className="bg-slate-950 px-6 py-16 sm:px-10 sm:py-20 lg:px-16">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-10 lg:grid-cols-2 lg:gap-14">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-indigo-300">MCP и REST API</div>
            <h2 className="mt-3 text-balance text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Живой интерфейс к живым аккаунтам
            </h2>
            <p className="mt-4 text-pretty text-base font-medium leading-7 text-slate-400">
              Каждая сессия — управляемый аккаунт: выделенный прокси 1:1, safe-mode после импорта,
              лимиты флуда и паузы при риске бана. Инструменты читают группы, ищут сообщения,
              шлют ЛС и управляют чатами — то, чего Bot API не умеет.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => (user ? window.location.assign('/app/api') : login('/app/api'))}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-white/10 px-5 py-3 text-sm font-bold text-white ring-1 ring-inset ring-white/20 transition hover:bg-white/15"
              >
                REST API
                <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
              </button>
              <button
                type="button"
                onClick={() => (user ? window.location.assign('/app/mcp') : login('/app/mcp'))}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-surface-card px-5 py-3 text-sm font-bold text-ink-strong shadow-lg shadow-black/30 transition hover:bg-surface-subtle"
              >
                Bullgram MCP
                <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
              </button>
            </div>
          </div>
          <McpExampleCard />
        </div>
      </section>

      {/* Серая зона — честно, без сюсюканья */}
      <section className="bg-white px-6 pb-16 sm:px-10 sm:pb-20 lg:px-16">
        <div className="mx-auto w-full max-w-3xl">
          <div className="flex gap-4 rounded-2xl border border-feedback-warning-text/20 bg-feedback-warning-bg p-6 sm:p-7">
            <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-feedback-warning-text" strokeWidth={2.2} aria-hidden="true" />
            <div>
              <h3 className="text-base font-bold text-feedback-warning-text">Серая зона — говорим прямо</h3>
              <p className="mt-2 text-pretty text-sm font-medium leading-6 text-ink-body">
                Автоматизация личного Telegram-аккаунта официально не благословлена, и агрессивная
                работа ловит лимиты и баны. Bullgram закрывает инфраструктуру: прокси на каждую сессию,
                безопасный старт, мониторинг SpamBot. Темп и аккуратность — на тебе: мы не делаем вид,
                что это белая зона.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Тарифы (scroll-mt — чтобы якорь #tariffs не уезжал под липкую мобильную шапку) */}
      <section id="tariffs" className="scroll-mt-24 bg-white px-6 pb-20 sm:px-10 lg:px-16 sm:pb-24">
        <div className="mx-auto w-full max-w-5xl">
          <div className="mb-8">
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-action-primary">Тарифы</div>
            <h2 className="mt-3 text-balance text-3xl font-bold tracking-tight text-ink-strong sm:text-4xl">
              Сколько стоит вход
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
                      href="/app/profile"
                      className="mt-auto inline-flex w-full items-center justify-center gap-2 rounded-full bg-surface-card px-5 py-4 text-base font-bold text-ink-strong ring-1 ring-inset ring-border-default transition hover:bg-surface-subtle hover:ring-border-strong"
                    >
                      Открыть кабинет
                      <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
                    </a>
                  ) : (
                    <button
                      type="button"
                      onClick={() => login('/app/profile')}
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
          <p className="mt-6 text-center text-sm font-medium leading-6 text-ink-muted">
            Вопрос по тарифам или нужен другой формат?{' '}
            <a
              href={SUPPORT_TELEGRAM}
              target="_blank"
              rel="noreferrer"
              className="font-bold text-action-primary underline decoration-2 underline-offset-2 hover:text-action-primary-hover"
            >
              Напиши в поддержку в Telegram
            </a>
          </p>
        </div>
      </section>

      {/* Финальный CTA */}
      <section className="relative isolate overflow-hidden bg-white px-4 py-20 text-center sm:px-6 sm:py-24">
        <div className="absolute inset-0 -z-10 h-full w-full bg-white bg-[linear-gradient(to_right,#f0f0f0_1px,transparent_1px),linear-gradient(to_bottom,#f0f0f0_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_80%_50%_at_50%_0%,#000_70%,transparent_100%)]" />
        <div className="absolute top-0 -z-10 h-[600px] w-full bg-[radial-gradient(circle_800px_at_50%_-200px,#e0e7ff,transparent)]" />

        <h2 className="mx-auto max-w-3xl text-balance text-4xl font-black tracking-tighter text-ink-strong sm:text-6xl">
          Дай агенту Telegram — уже сегодня
        </h2>
        <div className="mt-10">
          <StartFreeButton user={user} login={login} />
        </div>
        <p className="mt-6 text-pretty text-sm font-medium text-ink-muted">
          Регистрация → подключаешь сессию → первый вызов MCP в тот же день. Оплата в TON, поддержка в Telegram.
        </p>
        {/* Dogfood-цифра: 9 710 вызовов агента за 30 дней — реальная, из прод-базы
            (снята 2026-09-18); обновлять при следующем прогоне. Число каналов не
            называем — не верифицировано. */}
        <p className="mx-auto mt-10 max-w-xl text-pretty text-sm font-medium leading-5 text-ink-muted">
          Мы сами строим на Bullgram: наш крипто-контур каждый день делает ИИ-сводки по нашим
          Telegram-каналам —{' '}
          <span className="font-bold text-ink-strong">9 710 вызовов агента</span> за последние 30 дней.
          Разбор n8n-флоу —{' '}
          <a href="/blog/" className="font-semibold text-action-primary underline decoration-1 underline-offset-2 hover:text-action-primary-hover">
            скоро в блоге
          </a>
          .
        </p>
      </section>
    </div>
  );
}
