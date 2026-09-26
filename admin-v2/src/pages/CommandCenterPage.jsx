import { Rocket } from 'lucide-react';

export function CommandCenterPage() {
  return (
    <section className="page page--flush">
      <div className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/20 shrink-0">
            <Rocket className="w-6 h-6" />
          </div>
          <div>
            <div className="text-lg font-bold tracking-tight text-slate-900">
              Command Center — заготовка
            </div>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              Сводный экран в работе. Управление юзерботами живёт в отдельном приложении{' '}
              <a href="/userbot/userbots" className="font-semibold text-indigo-600 hover:text-indigo-700">Юзербот</a>.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

export default CommandCenterPage;
