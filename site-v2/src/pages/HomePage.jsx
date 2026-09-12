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
    price: '0 GRAM',
    period: 'бессрочно',
    description: 'Пробный доступ к Bullgram, чтобы собрать первый рабочий контур и проверить сценарии без оплаты.',
    href: '/app/profile',
    action: 'Начать Trial',
    features: [
      '100 запросов к API и MCP',
      'Самостоятельное подключение юзербота',
      '1 userbot на аккаунт'
    ]
  },
  {
    id: 'pro',
    label: 'Полный доступ',
    title: 'Pro',
    price: '10 GRAM',
    period: 'за 365 дней доступа',
    description: 'Основной платный тариф Bullgram: рабочий режим без лимитов на запросы и активы, рассылки и продажи.',
    highlighted: true,
    features: [
      'безлимит по API и MCP',
      'уже готовый к работе тг-аккаунт',
      'неограниченное количество ботов'
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
            Оплатить GRAM
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

function ScreenSection({ id, className = '', children }) {
  return (
    <section id={id} className={`flex min-h-screen snap-start snap-always flex-col ${className}`}>
      {children}
    </section>
  );
}

function UserbotCardMock() {
  const rows = [
    ['Статус', 'Активен', 'text-emerald-300'],
    ['Прокси', 'Выделенный', 'text-sky-300'],
    ['Рассылки', 'По расписанию', 'text-slate-200'],
    ['Мониторинг', 'Группы и чаты', 'text-slate-200']
  ];
  return (
    <div className="rounded-2xl bg-slate-900 p-6 ring-1 ring-white/10 shadow-2xl shadow-black/40">
      <div className="flex items-center gap-3 border-b border-white/10 pb-4">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15 text-sm font-black text-emerald-300">ЮБ</span>
        <div>
          <div className="text-base font-black text-white">erik-barber</div>
          <div className="text-xs font-semibold text-slate-400">живой аккаунт · передан тебе</div>
        </div>
      </div>
      <dl className="space-y-3 py-5">
        {rows.map(([key, value, tone]) => (
          <div key={key} className="flex items-center justify-between text-sm">
            <dt className="font-semibold text-slate-400">{key}</dt>
            <dd className={`font-bold ${tone}`}>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="rounded-lg bg-emerald-500/10 px-4 py-3 text-sm font-bold text-emerald-300 ring-1 ring-inset ring-emerald-500/20">
        Готов к работе. Ничего настраивать не нужно.
      </div>
    </div>
  );
}

function PaywallBotMock() {
  const messages = [
    ['Оплата получена', '10 TON · тариф «Месяц»', 'text-emerald-600'],
    ['Инвайт выдан', '@private_channel', 'text-sky-600'],
    ['Подписка активна', 'до 14 мая', 'text-slate-900']
  ];
  return (
    <div className="rounded-2xl bg-slate-50 p-6 ring-1 ring-slate-200">
      <div className="flex items-center gap-3 border-b border-slate-200 pb-4">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-sky-500/10 text-sm font-black text-sky-600">Б</span>
        <div>
          <div className="text-base font-black text-slate-900">бот paywall</div>
          <div className="text-xs font-semibold text-slate-500">подключён к @private_channel</div>
        </div>
      </div>
      <div className="space-y-2.5 py-5">
        {messages.map(([title, detail, tone]) => (
          <div key={title} className="rounded-lg bg-white px-4 py-2.5 ring-1 ring-slate-200">
            <div className={`text-sm font-bold ${tone}`}>{title}</div>
            <div className="text-xs font-semibold text-slate-500">{detail}</div>
          </div>
        ))}
      </div>
      <div className="rounded-lg bg-sky-50 px-4 py-3 text-sm font-bold text-sky-700 ring-1 ring-inset ring-sky-200">
        Доступ выдаётся сам. Ты пишешь контент.
      </div>
    </div>
  );
}

export function HomePage() {
  const { user, accessToken, profilePlan, proEndsAt, billingOrder, login } = useAuth();
  const pendingOrder = billingOrder?.status === 'pending' ? billingOrder : null;
  const { hash } = useLocation();
  const [stars, setStars] = useState(null);

  useEffect(() => {
    let alive = true;
    fetch('https://api.github.com/repos/webzwezda/bullgram')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('github api'))))
      .then((data) => {
        if (alive && typeof data?.stargazers_count === 'number') setStars(data.stargazers_count);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

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
      {/* Экран 1 — герой (чуть ниже вьюпорта, чтобы тарифы приходили раньше) */}
      <section className="relative flex min-h-[86vh] snap-start snap-always flex-col">
        <div className="relative isolate flex w-full flex-1 flex-col items-center justify-center overflow-hidden px-4 pt-20 pb-16 text-center sm:px-6 lg:pt-28 lg:pb-24">
          <div className="absolute inset-0 -z-10 h-full w-full bg-white bg-[linear-gradient(to_right,#f0f0f0_1px,transparent_1px),linear-gradient(to_bottom,#f0f0f0_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_80%_50%_at_50%_0%,#000_70%,transparent_100%)]" />
          <div className="absolute top-0 -z-10 w-full h-[600px] bg-[radial-gradient(circle_800px_at_50%_-200px,#e0e7ff,transparent)]" />
          <div className="absolute top-40 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-blue-400/20 blur-[100px] rounded-full mix-blend-multiply pointer-events-none -z-10" />

          <div className="flex flex-wrap items-center justify-center gap-3 mb-8">
          <a
            href="https://github.com/webzwezda/bullgram"
            target="_blank"
            rel="noreferrer"
            className="group inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border border-slate-200/60 shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] transition-all hover:shadow-[0_2px_15px_-3px_rgba(6,81,237,0.2)] hover:border-blue-200"
            aria-label="Bullgram на GitHub — проект с открытым кодом"
          >
            <svg className="w-4 h-4 text-slate-900" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.91-1.03 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
            </svg>
            <span className="text-[13px] font-bold tracking-wide text-slate-700 uppercase group-hover:text-blue-600 transition-colors">
              Bullgram 2.0
            </span>
            <span className="w-1 h-1 rounded-full bg-slate-300" aria-hidden="true" />
            <span className="text-[13px] font-bold tracking-wide text-slate-500 group-hover:text-blue-600 transition-colors">
              Open Source
            </span>
            {stars !== null && stars > 0 ? (
              <>
                <span className="w-px h-3.5 bg-slate-200" aria-hidden="true" />
                <svg className="w-3.5 h-3.5 text-amber-400" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 2l2.9 6.26 6.6.72-4.9 4.55 1.35 6.47L12 16.9 6.05 20l1.35-6.47-4.9-4.55 6.6-.72L12 2z" />
                </svg>
                <span className="text-[13px] font-bold text-slate-600 pr-1">{stars}</span>
              </>
            ) : null}
          </a>

          <span
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border border-slate-200/60 shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)]"
            title="Принимаем оплату только в криптовалюте — GRAM"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="11" fill="#0098EA" />
              <path d="M12 5.5 17.5 11 12 18.5 6.5 11 12 5.5Z" fill="#fff" />
            </svg>
            <span className="text-[13px] font-bold tracking-wide text-slate-700 uppercase">
              Crypto Friendly
            </span>
          </span>
          </div>

          <h1 className="text-6xl sm:text-7xl lg:text-[5.5rem] font-black tracking-tighter text-slate-900 leading-[0.95] max-w-5xl mb-8">
            Юзерботы для Telegram <br className="hidden sm:block" />
            с <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 via-indigo-500 to-violet-500">API и MCP</span>
          </h1>

          <p className="text-xl sm:text-2xl text-slate-500 font-medium max-w-[44rem] leading-relaxed mb-10 tracking-tight">
            <span className="text-slate-800 font-bold">Купи юзербота</span> или подключи свой — и делегируй рутину: мониторинг, рассылки и действия в группах от имени живого аккаунта.
          </p>

          <button
            type="button"
            onClick={() => (user ? window.location.assign('/app/userbots') : login('/app/userbots'))}
            className="group relative z-10 inline-flex w-full items-center justify-center gap-2 rounded-full bg-blue-600 px-8 py-4 text-base font-bold text-white transition-all hover:bg-blue-700 hover:shadow-[0_8px_30px_rgba(37,99,235,0.24)] hover:-translate-y-0.5 sm:w-auto"
          >
            Купить готового юзербота
            <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
          </button>
        </div>
      </section>

      {/* Экран 2 — тарифы */}
      <ScreenSection id="tariffs">
        <div className="flex w-full flex-1 flex-col justify-center bg-white px-6 pb-16 pt-6 sm:px-10 lg:px-16">
          <div className="mx-auto w-full max-w-5xl">
            <div className="mb-8">
              <div className="text-xs font-black uppercase tracking-[0.16em] text-blue-600">Тарифы</div>
              <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
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
                        className="mt-auto inline-flex w-full items-center justify-center gap-2 rounded-lg bg-white px-5 py-4 text-base font-black text-slate-800 ring-1 ring-inset ring-slate-200 transition hover:bg-slate-50 hover:ring-slate-300"
                      >
                        Открыть кабинет
                        <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
                      </a>
                    ) : (
                      <button
                        type="button"
                        onClick={() => login('/app/profile')}
                        className="mt-auto inline-flex w-full items-center justify-center gap-2 rounded-lg bg-white px-5 py-4 text-base font-black text-slate-800 ring-1 ring-inset ring-slate-200 transition hover:bg-slate-50 hover:ring-slate-300"
                      >
                        {plan.action}
                        <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
                      </button>
                    )
                  )}
                </PlanCard>
              ))}
            </div>
            <p className="mt-6 text-center text-sm font-medium leading-6 text-slate-500">
              Людям с инвалидностью — предоставим специальный тариф:{' '}
              <a href="/access-request" className="font-bold text-blue-600 underline decoration-2 underline-offset-2 hover:text-blue-700">
                заявка на оформление.
              </a>
            </p>
          </div>
        </div>
      </ScreenSection>

      {/* Экран 3 — флагман: готовый юзербот */}
      <ScreenSection id="userbots">
        <div className="flex w-full flex-1 flex-col justify-center bg-slate-950 px-6 py-16 sm:px-10 lg:px-16">
          <div className="mx-auto grid w-full max-w-6xl items-center gap-12 lg:grid-cols-5 lg:gap-16">
            <div className="lg:col-span-3">
              <div className="text-xs font-black uppercase tracking-[0.16em] text-sky-400">Флагман</div>
              <h2 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-4xl">
                Готовый юзербот
              </h2>
          <p className="mt-4 text-base font-medium leading-7 text-slate-400">
            Живой Telegram-аккаунт, которым можно управлять через AI-Agents или n8n
          </p>
              <ul className="mt-6 space-y-3">
                {['Администрирование ваших групп', 'Мониторинг чужих групп и чатов', 'Участие в рассылках'].map((feature) => (
                  <li key={feature} className="flex gap-3 text-sm font-semibold leading-6 text-slate-200">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-sky-400" strokeWidth={2.5} />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-8 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => (user ? window.location.assign('/app/userbots') : login('/app/userbots'))}
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-blue-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700"
                >
                  Купить готового юзербота
                  <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
                </button>
                <a
                  href="/docs"
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-white/10 px-5 py-3 text-sm font-black text-white ring-1 ring-inset ring-white/20 transition hover:bg-white/15"
                >
                  Документация
                  <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
                </a>
              </div>
            </div>
            <div className="lg:col-span-2">
              <UserbotCardMock />
            </div>
          </div>
        </div>
      </ScreenSection>

      {/* Экран 5 — paywall бот */}
      <ScreenSection id="paywall">
        <div className="flex w-full flex-1 flex-col justify-center bg-white px-6 py-16 sm:px-10 lg:px-16">
          <div className="mx-auto grid w-full max-w-6xl items-center gap-12 lg:grid-cols-5 lg:gap-16">
            <div className="lg:col-span-3">
              <div className="text-xs font-black uppercase tracking-[0.16em] text-blue-600">Paywall бот</div>
              <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
                Платный доступ в твой канал
              </h2>
              <p className="mt-4 text-base font-medium leading-7 text-slate-500">
                Бот принимает оплату, выдаёт инвайт и следит за подписками.
                Ты занимаешься контентом, доступом занимается бот.
              </p>
              <ul className="mt-6 space-y-3">
                {['автоматическая выдача доступа после оплаты', 'тарифы и подписки внутри бота', 'напоминания и удаление тех, кто не продлил'].map((feature) => (
                  <li key={feature} className="flex gap-3 text-sm font-semibold leading-6 text-slate-700">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" strokeWidth={2.5} />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-8 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => (user ? window.location.assign('/app/sales-bot') : login('/app/sales-bot'))}
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-blue-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700"
                >
                  Подключить бота
                  <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
                </button>
              </div>
            </div>
            <div className="lg:col-span-2">
              <PaywallBotMock />
            </div>
          </div>
        </div>
      </ScreenSection>

      {/* Экран 6 — быстрый старт */}
      <ScreenSection id="quick-start">
        <div className="relative isolate flex w-full flex-1 flex-col items-center justify-center overflow-hidden bg-white px-4 text-center sm:px-6">
          <div className="absolute inset-0 -z-10 h-full w-full bg-white bg-[linear-gradient(to_right,#f0f0f0_1px,transparent_1px),linear-gradient(to_bottom,#f0f0f0_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_80%_50%_at_50%_0%,#000_70%,transparent_100%)]" />
          <div className="absolute top-0 -z-10 h-[600px] w-full bg-[radial-gradient(circle_800px_at_50%_-200px,#e0e7ff,transparent)]" />

          <h2 className="max-w-4xl text-6xl font-black tracking-tighter text-slate-900 sm:text-7xl">
            Готов начать?
          </h2>
          <a
            href="/docs/quick-start/"
            className="group mt-12 inline-flex items-center justify-center gap-3 rounded-full bg-blue-600 px-14 py-6 text-xl font-bold text-white transition-all hover:-translate-y-0.5 hover:bg-blue-700 hover:shadow-[0_12px_40px_rgba(37,99,235,0.28)]"
          >
            Quick Start
            <ArrowRight className="h-6 w-6 transition-transform group-hover:translate-x-1" />
          </a>
        </div>
      </ScreenSection>

    </div>
  );
}
