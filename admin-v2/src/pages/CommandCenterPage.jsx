import { Link } from 'react-router-dom';
import { Bot, Braces, MessageSquare, Rocket } from 'lucide-react';

const SHOWCASE = [
  {
    to: '/app/userbots',
    icon: Rocket,
    gradient: 'from-indigo-500 to-indigo-600',
    shadow: 'shadow-indigo-500/20',
    title: 'Юзерботы',
    text: 'Готовые юзерботы и свои аккаунты: рассылки, приглашения, мониторинг групп.'
  },
  {
    to: '/app/mcp',
    icon: MessageSquare,
    gradient: 'from-blue-500 to-blue-600',
    shadow: 'shadow-blue-500/20',
    title: 'MCP для ИИ-агентов',
    text: 'Подключи Claude, Cursor или своего агента к Bullgram — промпт и конфиг готовы.'
  },
  {
    to: '/app/api',
    icon: Braces,
    gradient: 'from-amber-500 to-amber-600',
    shadow: 'shadow-amber-500/20',
    title: 'REST API',
    text: 'Весь Bullgram по HTTPS: справочник эндпоинтов и Bearer-ключи рядом.'
  },
  {
    to: '/app/sales-bot',
    icon: Bot,
    gradient: 'from-emerald-500 to-emerald-600',
    shadow: 'shadow-emerald-500/20',
    title: 'Бот продаж',
    text: 'Платный доступ в твой канал: оплата — и инвайт выдаётся автоматически.'
  }
];

export function CommandCenterPage() {
  return (
    <section className="page page--flush">
      <div className="page__header">
        <h1>Командный центр</h1>
        <p>Всё управление Bullgram в одном окне.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {SHOWCASE.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              className="group rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
            >
              <div className="flex items-start gap-4">
                <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${item.gradient} flex items-center justify-center text-white shadow-lg ${item.shadow} shrink-0`}>
                  <Icon className="w-6 h-6" />
                </div>
                <div>
                  <div className="text-lg font-bold tracking-tight text-slate-900 transition-colors group-hover:text-blue-600">
                    {item.title}
                  </div>
                  <p className="mt-1 text-sm leading-6 text-slate-500">{item.text}</p>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

export default CommandCenterPage;
