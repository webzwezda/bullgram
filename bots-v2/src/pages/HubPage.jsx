import { Link } from 'react-router-dom';
import { Bot } from 'lucide-react';

// Хаб «Ботов» (план 2026-09-27-bots-app-split, Фаза 3). Решение владельца
// (2026-09-27): сетка карточек ботов снята — хаб это описание модуля,
// работа идёт на экране управления /autopost.
// Карточка — диалект Command Center /paywall (запрос владельца).

function AutoposterIntroCard() {
  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/20 shrink-0">
          <Bot className="w-6 h-6" />
        </div>
        <div>
          <div className="text-lg font-bold tracking-tight text-slate-900">
            Автопостер
          </div>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            Telegram-бот, который ведёт твои каналы: сам публикует посты по расписанию,
            принимает предложения от подписчиков и ставит реакции. Подключение и управление —{' '}
            <Link to="/autopost" className="font-semibold text-indigo-600 hover:text-indigo-700">в разделе «Автопостер»</Link>.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function HubPage() {
  return (
    <section className="page page--flush">
      <h1 className="sr-only">Боты</h1>
      <div className="section">
        <AutoposterIntroCard />
      </div>
    </section>
  );
}
