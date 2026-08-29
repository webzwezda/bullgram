import { ArrowRight, Bot, CheckCircle2, CreditCard, KeyRound, Send, TrendingUp } from 'lucide-react';
import { useAuth } from '../app/providers/AuthProvider.jsx';

const steps = [
  {
    icon: KeyRound,
    title: 'Создайте аккаунт',
    text: 'Вход через Google или Telegram. Trial — 14 дней бесплатно, без карты: 500 запросов к API и MCP, 1 юзербот, 1 автопост-бот.'
  },
  {
    icon: Bot,
    title: 'Подключите юзербота',
    text: 'Импорт сессии по QR-коду или файлу. Каждый юзербот идёт через выделенный прокси и стартует в safe-mode — вы сами активируете его вручную.'
  },
  {
    icon: CreditCard,
    title: 'Соберите кассу',
    text: 'Создайте бота через @BotFather и вставьте токен. Задайте тариф: цена, период, реквизиты P2P или TON-кошелёк — клиент увидит готовую страницу оплаты.'
  },
  {
    icon: TrendingUp,
    title: 'Получите первую оплату',
    text: 'Клиент платит — доступ в закрытую группу выдаётся автоматически. Подписка истекла — бот исключит сам. Дальше подключайте REST API и MCP.'
  }
];

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

export function QuickStartPage() {
  const { user, login } = useAuth();

  return (
    <div className="w-full max-w-6xl mx-auto px-4 py-12 sm:px-6 lg:px-8">
      <section className="text-center">
        <div className="text-xs font-black uppercase tracking-[0.16em] text-blue-700">Quick Start</div>
        <h1 className="mt-3 text-4xl font-black tracking-tight text-slate-950 sm:text-5xl">
          От нуля до первой оплаты — за один вечер
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-base font-medium leading-7 text-slate-600">
          Четыре шага: аккаунт, юзербот, касса, первая оплата. Читать можно без регистрации —
          логин понадобится, когда начнёте делать.
        </p>
      </section>

      <section className="mt-12 grid gap-4 md:grid-cols-2">
        {steps.map((step, index) => {
          const Icon = step.icon;
          return (
            <article key={step.title} className="relative rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
              <span className="absolute right-5 top-5 text-4xl font-black text-slate-100">{index + 1}</span>
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                <Icon className="h-5 w-5" strokeWidth={2.5} />
              </span>
              <h2 className="mt-4 text-lg font-black text-slate-950">{step.title}</h2>
              <p className="mt-2 text-sm font-medium leading-6 text-slate-600">{step.text}</p>
            </article>
          );
        })}
      </section>

      <section className="mt-10 rounded-lg bg-slate-950 p-6 sm:p-8">
        <div className="text-xs font-black uppercase tracking-[0.16em] text-sky-400">Для разработчиков</div>
        <h2 className="mt-2 text-xl font-black text-white">Управление из кода или от AI-агента</h2>
        <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-slate-400">
          После входа получите токен и работайте с юзерботами и кассой через REST API или Bullgram MCP.
        </p>
        <pre className="mt-5 overflow-x-auto rounded-lg bg-slate-900 px-4 py-3 font-mono text-[13px] leading-6 text-slate-300 ring-1 ring-white/10">
          <code>
            <span className="text-sky-400">curl</span> https://bullgram.xyz/api/external/v1/me {'\n'}
            {'  '}-H <span className="text-emerald-300">"Authorization: Bearer $TOKEN"</span>
          </code>
        </pre>
        <div className="mt-5 flex flex-wrap gap-3">
          <a
            href="/docs"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-white/10 px-4 py-2.5 text-sm font-black text-white ring-1 ring-inset ring-white/20 transition hover:bg-white/15"
          >
            Документация
            <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
          </a>
          <a
            href="/api/external/v1/docs"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-white/10 px-4 py-2.5 text-sm font-black text-white ring-1 ring-inset ring-white/20 transition hover:bg-white/15"
          >
            API-справочник
            <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
          </a>
        </div>
      </section>

      <section className="mt-10 rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm sm:p-8">
        {user ? (
          <>
            <div className="inline-flex items-center gap-2 text-sm font-bold text-emerald-700">
              <CheckCircle2 className="h-5 w-5" strokeWidth={2.5} />
              Вы уже вошли — продолжайте настройку в кабинете
            </div>
            <div className="mt-4">
              <a
                href="/app"
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-6 py-3.5 text-sm font-black text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700"
              >
                Открыть кабинет
                <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
              </a>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-xl font-black text-slate-950">Готовы попробовать?</h2>
            <p className="mt-2 text-sm font-medium text-slate-600">Trial 14 дней — бесплатно и без карты.</p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
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
            </div>
            <p className="mt-5 text-xs font-bold text-slate-400">
              Нет задачи на автоматизацию?{' '}
              <a href="/create" className="text-blue-600 underline hover:text-blue-700">
                Создайте одиночный TON-счёт без регистрации
              </a>
            </p>
          </>
        )}
      </section>
    </div>
  );
}
