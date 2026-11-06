// Онбординг-состояния AutopostManagePage (behavior-preserving разрезка
// 2026-11-07): ожидание активации администратором и ожидание подключения
// каналов. Обе карточки дословно перенесены из страницы.
import { AlertTriangle, ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '../../../components/ui/button.jsx';
import { Card } from '../../../components/ui/card.jsx';

export default function OnboardingStates({ createdBot, hasAdmin, hasChannels }) {
  return (
    <>
      {/* Onboarding State: Ожидание администратора */}
      {createdBot && !hasAdmin && (
        <Card className="border-0 shadow-lg shadow-indigo-100 ring-2 ring-indigo-500 bg-white overflow-hidden rounded-2xl p-6 sm:p-8 space-y-6">
          <div className="flex items-center gap-4 text-indigo-600">
            <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center shrink-0">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900">Шаг 1 — активируй бота</h3>
              <p className="text-sm text-slate-500 mt-0.5">Откройте бота в Telegram и привяжите свой аккаунт как администратор.</p>
            </div>
          </div>
          <div className="bg-slate-50 rounded-xl p-5 border border-slate-100 space-y-3">
            <p className="text-sm font-semibold text-slate-700">Пошаговая инструкция:</p>
            <ol className="list-decimal list-inside text-sm text-slate-600 space-y-2">
              <li>Нажми кнопку <span className="font-bold text-slate-800">«Открыть @{createdBot.bot_username}»</span> ниже — откроется чат с ботом.</li>
              <li>В чате нажмите <span className="font-bold text-slate-800">«Запустить»</span> (или отправьте <code className="font-mono text-[12px] bg-white px-1.5 py-0.5 rounded border border-slate-200">/start</code>).</li>
              <li>Бот ответит сообщением с кнопкой <span className="font-bold text-slate-800">«✅ Я администратор»</span> — нажмите её.</li>
              <li>Эта страница автоматически обновится и покажет настройку каналов.</li>
            </ol>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-4 pt-1">
            <Button asChild size="lg" className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-8 py-6 text-base shadow-lg shadow-indigo-200 w-full sm:w-auto">
              <a href={`https://t.me/${createdBot.bot_username}`} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2">
                Открыть @{createdBot.bot_username} <ExternalLink className="w-5 h-5" />
              </a>
            </Button>
            <div className="flex items-center gap-2 text-xs text-slate-500 font-semibold">
              <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
              Ожидание активации...
            </div>
          </div>
        </Card>
      )}

      {/* Onboarding State: Ожидание подключения каналов */}
      {createdBot && hasAdmin && !hasChannels && (
        <Card className="border-0 shadow-lg shadow-amber-100 ring-2 ring-amber-500 bg-white overflow-hidden rounded-2xl p-6 sm:p-8 space-y-6">
          <div className="flex items-center gap-4 text-amber-600">
            <div className="w-12 h-12 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900">Подключение каналов</h3>
              <p className="text-sm text-slate-500">Администратор успешно привязан. Теперь подключи свои каналы к автопостеру.</p>
            </div>
          </div>
          <div className="bg-slate-50 rounded-xl p-5 border border-slate-100 space-y-3">
            <p className="text-sm font-semibold text-slate-700">Инструкция по подключению:</p>
            <ol className="list-decimal list-inside text-sm text-slate-600 space-y-2">
              <li>Добавь бота <span className="font-bold text-slate-800">@{createdBot.bot_username}</span> в любой канал (публичный или приватный) в качестве администратора с правами на публикацию сообщений.</li>
              <li>Можно подключить сколько угодно каналов: например, два публичных для разных тем. Каждый получит свои кнопки, реакции и расписание.</li>
              <li>Бот автоматически поймает добавление и покажет канал на этой странице.</li>
            </ol>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500 font-semibold">
            <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
            Ожидание добавления в каналы...
          </div>
        </Card>
      )}
    </>
  );
}
