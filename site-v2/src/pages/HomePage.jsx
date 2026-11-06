import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  Braces,
  Globe,
  Loader2,
  PlugZap,
} from 'lucide-react';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { createTonConnectOrder, checkoutErrorMessage } from '../features/ton-checkout/pro-order.js';
import { TariffsSection } from './home/TariffsSection.jsx';

const steps = [
  {
    n: '01',
    title: 'Получи готовый аккаунт',
    text: 'Выгодно купить pro тариф и получить рабочий аккаунт'
  },
  {
    n: '02',
    title: 'Промпт для MCP-подключения',
    text: 'Выпусти MCP-токен и скопируй готовый промпт своему агенту для MCP-соединения.'
  },
  {
    n: '03',
    title: 'Агент работает в Telegram',
    text: 'Читает группы и историю, мониторит каналы, пишет в ЛС.'
  }
];

// Общий вход в оплату Pro живёт в features/ton-checkout/pro-order.js
// (используется кнопкой героя, карточкой тарифа и маршрутом /get-account)

// Главная кнопка страницы: «Получить аккаунт» = оплата Pro, аккаунт выдаётся после оплаты.
function GetAccountButton({ user, accessToken, profilePlan, pendingOrder, login, label = 'Получить аккаунт' }) {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const pillClass =
    'group inline-flex items-center justify-center gap-2 rounded-full bg-action-primary px-8 py-4 text-base font-bold text-action-primary-text shadow-lg shadow-indigo-600/20 transition-all hover:bg-action-primary-hover hover:shadow-[0_8px_30px_rgba(79,70,229,0.24)] hover:-translate-y-0.5';

  if (profilePlan === 'pro' || profilePlan === 'normal') {
    return (
      <a href="/userbot" className={pillClass}>
        Мой аккаунт
        <ArrowRight className="w-5 h-5" strokeWidth={2.5} />
      </a>
    );
  }

  if (pendingOrder) {
    return (
      <button
        type="button"
        onClick={() => navigate(`/pay/${pendingOrder.id}`)}
        className={pillClass}
      >
        Завершить оплату
        <ArrowRight className="w-5 h-5" strokeWidth={2.5} />
      </button>
    );
  }

  const onCreate = async () => {
    if (!user) {
      login('/get-account');
      return;
    }
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
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={onCreate}
        disabled={creating}
        className={`${pillClass} disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        {creating ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" />
            Создаём счёт…
          </>
        ) : (
          <>
            {label}
            <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" strokeWidth={2.5} />
          </>
        )}
      </button>
      {error ? (
        <div className="flex items-start gap-1.5 text-xs text-feedback-error-text">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}
    </div>
  );
}

const accessTools = [
  {
    icon: Globe,
    name: 'Telegram Web',
    text: 'Работай руками: аккаунт прямо в браузере.',
    path: '/userbot'
  },
  {
    icon: Braces,
    name: 'REST API',
    text: 'Вызывай аккаунты из кода: n8n, скрипты, бэкенды.',
    path: '/userbot/api'
  },
  {
    icon: PlugZap,
    name: 'Bullgram MCP',
    text: 'Подключи ИИ-агента: Claude, Cursor, любой MCP-клиент.',
    path: '/userbot/mcp'
  }
];

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
          <a
            href="https://github.com/webzwezda/bullgram"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-card border border-border-default shadow-[0_2px_10px_-3px_rgba(79,70,229,0.1)] transition-all hover:shadow-[0_2px_15px_-3px_rgba(79,70,229,0.2)] hover:border-action-primary/40"
            aria-label="Bullgram на GitHub — проект с открытым кодом"
          >
            <svg className="w-4 h-4 text-ink-strong" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.91-1.03 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
            </svg>
            <span className="text-xs font-bold tracking-wide text-ink-body uppercase">
              Open Source
            </span>
          </a>
          <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-card border border-border-default shadow-[0_2px_10px_-3px_rgba(79,70,229,0.1)]">
            <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="11" fill="#0098EA" />
              <path d="M12 5.5 17.5 11 12 18.5 6.5 11 12 5.5Z" fill="#fff" />
            </svg>
            <span className="text-xs font-bold tracking-wide text-ink-body uppercase">
              crypto friendly
            </span>
          </span>
        </div>

        <h1 className="mx-auto max-w-4xl text-balance text-4xl sm:text-6xl lg:text-7xl font-black tracking-tighter text-ink-strong leading-[0.95] mb-6 sm:mb-8">
          Дай своему ИИ-агенту <br className="hidden sm:block" />
          <span className="text-action-primary">Telegram-аккаунт</span>
        </h1>

        <p className="mx-auto max-w-[42rem] text-pretty text-lg sm:text-xl text-ink-muted font-medium leading-relaxed mb-8 sm:mb-10 tracking-tight">
          Живой аккаунт для агента: группы, каналы, сообщения. Управление через MCP, REST API
          или Telegram Web.
        </p>

        <GetAccountButton
          user={user}
          accessToken={accessToken}
          profilePlan={profilePlan}
          pendingOrder={pendingOrder}
          login={login}
        />
      </section>

      {/* Как это работает — 3 шага */}
      <section className="bg-white px-6 py-16 sm:px-10 lg:px-16 sm:py-20">
        <div className="mx-auto w-full max-w-6xl">
          <div className="mb-10 max-w-2xl">
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-action-primary">Как это работает</div>
            <h2 className="mt-3 text-balance text-3xl font-bold tracking-tight text-ink-strong sm:text-4xl">
              Три шага — и твой агент в Telegram
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

      {/* Тарифы (scroll-mt — чтобы якорь #tariffs не уезжал под липкую мобильную шапку) */}
      <TariffsSection
        profilePlan={profilePlan}
        proEndsAt={proEndsAt}
        pendingOrder={pendingOrder}
        user={user}
        accessToken={accessToken}
        login={login}
      />

      {/* Три инструмента доступа к живым аккаунтам */}
      <section className="bg-slate-950 px-6 py-16 sm:px-10 sm:py-20 lg:px-16">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-10 lg:grid-cols-2 lg:gap-14">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-indigo-300">Telegram Web · MCP · REST API</div>
            <h2 className="mt-3 text-balance text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Живой интерфейс к живым аккаунтам
            </h2>
            <p className="mt-4 text-pretty text-base font-medium leading-7 text-slate-400">
              Инструменты читают группы и историю, ищут сообщения, шлют ЛС
              и управляют чатами.
            </p>
            <div className="mt-7 flex flex-col gap-3">
              {accessTools.map((tool) => {
                const ToolIcon = tool.icon;
                return (
                  <button
                    key={tool.name}
                    type="button"
                    onClick={() => (user ? window.location.assign(tool.path) : login(tool.path))}
                    className="flex w-full items-center gap-4 rounded-xl border border-white/10 bg-white/10 px-4 py-3.5 text-left transition hover:bg-white/15"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10">
                      <ToolIcon className="h-5 w-5 text-indigo-300" strokeWidth={2.2} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold text-white">{tool.name}</span>
                      <span className="block text-sm font-medium text-slate-400">{tool.text}</span>
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-slate-400" strokeWidth={2.5} />
                  </button>
                );
              })}
            </div>
          </div>
          <McpExampleCard />
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
          <a
            href="/docs/quick-start/"
            className="group inline-flex items-center justify-center gap-2 rounded-full bg-action-primary px-8 py-4 text-base font-bold text-action-primary-text shadow-lg shadow-indigo-600/20 transition-all hover:bg-action-primary-hover hover:shadow-[0_8px_30px_rgba(79,70,229,0.24)] hover:-translate-y-0.5"
          >
            Quick Start
            <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" strokeWidth={2.5} />
          </a>
        </div>
      </section>
    </div>
  );
}
