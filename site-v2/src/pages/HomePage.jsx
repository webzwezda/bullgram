import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
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
    price: '0 TON',
    period: 'бессрочно',
    description: 'Подключи одну группу и получи первые сводки — чтобы понять, твоё ли это.',
    action: 'Начать бесплатно',
    features: [
      '1 юзербот',
      '100 запросов к API и MCP'
    ]
  },
  {
    id: 'pro',
    label: 'Полный доступ',
    title: 'Pro',
    price: '10 TON',
    period: 'за 365 дней доступа',
    description: 'Полный режим для тех, кто делегирует агенту всё.',
    highlighted: true,
    features: [
      'сколько угодно групп и ботов',
      'рассылки и автопостинг',
      'готовый тг-аккаунт в комплекте',
      'API и MCP без лимитов'
    ]
  }
];

const steps = [
  {
    n: '01',
    title: 'Подключи группу',
    text: 'Любую Telegram-группу или канал, за которыми не успеваешь следить: свои, рабочие, отраслевые.'
  },
  {
    n: '02',
    title: 'Агент читает и собирает суть',
    text: 'Агент следит за всеми сообщениями и отделяет шум от того, что действительно важно.'
  },
  {
    n: '03',
    title: 'Получаешь сводку по расписанию',
    text: 'Короткая выжимка приходит сама. Рассылки, проверки и рутину агент тоже берёт на себя.'
  }
];

// «Живой пример»: 9 710 вызовов агента за 30 дней — реальная цифра из прод-базы
// (2026-09-18). Цифры карточки (3 группы · 412 сообщений → 5 пунктов) и тексты
// выжимки — иллюстративный формат: заменить на настоящие данные контура владельца
// при первом реальном прогоне сводок.
const digestItems = [
  'BTC за сутки вышел из диапазона 56–58k на объёме — в двух каналах ждут ретест',
  'TON-дайджест: обновление Wallet и новый каталог мини-аппов, обсуждение активное',
  'Три разбора сделок за неделю в трейдинг-чате — главный вывод: не усреднять убыток',
  'Аирдропы: новые задания от трёх проектов, дедлайны в течение 48 часов',
  'Два канала независимо подняли тему регулирования в ЕС — мнения сводятся в скепсис'
];

const platformModules = [
  'платный доступ в канал',
  'автопостинг с чек-листами',
  'магазин за TON',
  'рассылки по расписанию'
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
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-amber-600 px-5 py-4 text-base font-black text-white shadow-lg shadow-amber-600/20 transition hover:bg-amber-700"
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
        className="mt-auto inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-5 py-4 text-base font-black text-white shadow-lg shadow-indigo-600/20 transition hover:bg-indigo-700"
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
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-5 py-4 text-base font-black text-white shadow-lg shadow-indigo-600/20 transition hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
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
    ? 'relative flex flex-col rounded-lg border-2 border-action-primary bg-surface-card p-6 shadow-xl shadow-indigo-600/10'
    : 'relative flex flex-col rounded-lg border border-border-default bg-surface-card p-6 shadow-sm';

  return (
    <article className={cardClass}>
      {plan.highlighted ? (
        <div className="absolute -top-4 left-6 rounded-lg bg-action-primary px-3 py-1 text-xs font-black uppercase tracking-[0.14em] text-action-primary-text shadow-md">
          {plan.label}
        </div>
      ) : (
        <div className="mb-4 text-xs font-black uppercase tracking-[0.16em] text-ink-muted">{plan.label}</div>
      )}

      {plan.highlighted ? <div className="mb-4 h-2" /> : null}
      <div className="mb-5">
        <h3 className="text-2xl font-black text-ink-strong">{plan.title}</h3>
        <p className="mt-2 text-sm font-semibold leading-6 text-ink-body">{plan.description}</p>
      </div>

      <div className="mb-6">
        <div className="text-4xl font-black tracking-tight text-ink-strong">{plan.price}</div>
        <div className="mt-1 text-sm font-bold text-ink-muted">{plan.period}</div>
      </div>

      <ul className="mb-8 space-y-3">
        {plan.features.map((feature) => (
          <li key={feature} className="flex gap-3 text-sm font-semibold leading-6 text-ink-body">
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

function DigestCard() {
  return (
    <div className="overflow-hidden rounded-2xl bg-slate-900 p-2 shadow-2xl shadow-black/40 ring-1 ring-white/10">
      <div className="rounded-xl bg-slate-800 p-5 text-left sm:p-6">
        <div className="flex items-center gap-3 border-b border-white/10 pb-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-500/20 text-sm font-black text-indigo-300">АГ</span>
          <div className="min-w-0">
            <div className="text-sm font-black text-white">Агент Bullgram</div>
            <div className="text-xs font-semibold text-slate-400">сводка по расписанию · 09:00</div>
          </div>
        </div>
        <div className="pt-4">
          <div className="text-base font-black text-white">Сводка за 24 часа</div>
          <div className="mt-1 text-xs font-bold text-emerald-300">3 группы · 412 сообщений → 5 пунктов</div>
          <ul className="mt-4 space-y-2.5">
            {digestItems.map((item) => (
              <li key={item} className="flex gap-2.5 text-sm font-medium leading-6 text-slate-200">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" aria-hidden="true" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
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
      {/* Герой — один исход: агент читает Telegram за тебя */}
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

        <h1 className="mx-auto max-w-4xl text-5xl sm:text-6xl lg:text-7xl font-black tracking-tighter text-ink-strong leading-[0.95] mb-6 sm:mb-8">
          Твой агент читает <br className="hidden sm:block" />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 via-indigo-500 to-violet-500">Telegram за тебя</span>
        </h1>

        <p className="mx-auto max-w-[40rem] text-lg sm:text-xl text-ink-muted font-medium leading-relaxed mb-8 sm:mb-10 tracking-tight">
          Подключи группы — и получай по расписанию короткие ИИ-сводки: что произошло и что важно.
          Рассылки, проверки и рутинные действия агент тоже берёт на себя.
        </p>

        <StartFreeButton user={user} login={login} />
      </section>

      {/* Как это работает — 3 шага */}
      <section className="bg-white px-6 py-16 sm:px-10 lg:px-16 sm:py-20">
        <div className="mx-auto w-full max-w-6xl">
          <div className="mb-10 max-w-2xl">
            <div className="text-xs font-black uppercase tracking-[0.16em] text-action-primary">Как это работает</div>
            <h2 className="mt-3 text-3xl font-black tracking-tight text-ink-strong sm:text-4xl">
              Три шага — и за Telegram больше не нужно следить
            </h2>
          </div>
          <ol className="grid gap-5 sm:grid-cols-3">
            {steps.map((step) => (
              <li key={step.n} className="rounded-2xl border border-border-default bg-surface-subtle p-6">
                <div className="font-mono text-xs font-bold uppercase tracking-widest text-ink-muted">{step.n}</div>
                <h3 className="mt-3 text-lg font-black leading-snug text-ink-strong">{step.title}</h3>
                <p className="mt-2 text-sm font-medium leading-6 text-ink-body">{step.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Живой пример — как выглядит сводка */}
      <section className="bg-white px-6 pb-16 sm:px-10 lg:px-16 sm:pb-20">
        <div className="mx-auto w-full max-w-2xl text-center">
          <div className="text-xs font-black uppercase tracking-[0.16em] text-action-primary">Живой пример</div>
          <h2 className="mt-3 text-3xl font-black tracking-tight text-ink-strong sm:text-4xl">
            Так выглядит сводка за сутки
          </h2>
          <div className="mt-8">
            <DigestCard />
          </div>
          <p className="mt-6 text-sm font-medium leading-6 text-ink-muted">
            Этим же контуром мы сами ведём свой канал каждый день:{' '}
            <span className="font-bold text-ink-strong">9 710 вызовов агента</span> за последние 30 дней.
          </p>
        </div>
      </section>

      {/* Тарифы (scroll-mt — чтобы якорь #tariffs не уезжал под липкую мобильную шапку) */}
      <section id="tariffs" className="scroll-mt-24 bg-white px-6 pb-20 sm:px-10 lg:px-16 sm:pb-24">
        <div className="mx-auto w-full max-w-5xl">
          <div className="mb-8">
            <div className="text-xs font-black uppercase tracking-[0.16em] text-action-primary">Тарифы</div>
            <h2 className="mt-3 text-3xl font-black tracking-tight text-ink-strong sm:text-4xl">
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
                      className="mt-auto inline-flex w-full items-center justify-center gap-2 rounded-lg bg-surface-card px-5 py-4 text-base font-black text-ink-strong ring-1 ring-inset ring-border-default transition hover:bg-surface-subtle hover:ring-border-strong"
                    >
                      Открыть кабинет
                      <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
                    </a>
                  ) : (
                    <button
                      type="button"
                      onClick={() => login('/app/profile')}
                      className="mt-auto inline-flex w-full items-center justify-center gap-2 rounded-lg bg-surface-card px-5 py-4 text-base font-black text-ink-strong ring-1 ring-inset ring-border-default transition hover:bg-surface-subtle hover:ring-border-strong"
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

      {/* Дев-тир: MCP и API для своих автоматизаций */}
      <section className="bg-slate-950 px-6 py-14 sm:px-10 lg:px-16">
        <div className="mx-auto w-full max-w-5xl">
          <div className="text-xs font-black uppercase tracking-[0.16em] text-sky-400">Для разработчиков</div>
          <h2 className="mt-3 text-2xl font-black tracking-tight text-white sm:text-3xl">
            Строишь агентов или автоматизации?
          </h2>
          <p className="mt-3 max-w-2xl text-base font-medium leading-7 text-slate-400">
            MCP и API к живым Telegram-аккаунтам: сессии, прокси 1:1, предохранители.
            Работает с n8n и любыми MCP-клиентами.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
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
              className="inline-flex items-center justify-center gap-2 rounded-full bg-white/10 px-5 py-3 text-sm font-bold text-white ring-1 ring-inset ring-white/20 transition hover:bg-white/15"
            >
              Bullgram MCP
              <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
            </button>
          </div>
        </div>
      </section>

      {/* Модули платформы — одной строкой */}
      <section className="border-t border-border-default bg-surface-subtle px-6 py-8">
        <div className="mx-auto flex w-full max-w-5xl flex-col items-center justify-center gap-2 text-center sm:flex-row sm:gap-3">
          <span className="shrink-0 text-xs font-black uppercase tracking-[0.16em] text-ink-muted">
            Платформа умеет ещё
          </span>
          <p className="text-sm font-semibold text-ink-body">
            {platformModules.join(' · ')}
          </p>
        </div>
      </section>

      {/* Финальный CTA */}
      <section className="relative isolate overflow-hidden bg-white px-4 py-20 text-center sm:px-6 sm:py-24">
        <div className="absolute inset-0 -z-10 h-full w-full bg-white bg-[linear-gradient(to_right,#f0f0f0_1px,transparent_1px),linear-gradient(to_bottom,#f0f0f0_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_80%_50%_at_50%_0%,#000_70%,transparent_100%)]" />
        <div className="absolute top-0 -z-10 h-[600px] w-full bg-[radial-gradient(circle_800px_at_50%_-200px,#e0e7ff,transparent)]" />

        <h2 className="mx-auto max-w-3xl text-4xl font-black tracking-tighter text-ink-strong sm:text-6xl">
          Хватит читать всё вручную
        </h2>
        <div className="mt-10">
          <StartFreeButton user={user} login={login} />
        </div>
        <p className="mt-6 text-sm font-medium text-ink-muted">
          Регистрация → подключаешь группу → первая сводка в тот же день. Оплата в TON, поддержка в Telegram.
        </p>
      </section>
    </div>
  );
}
