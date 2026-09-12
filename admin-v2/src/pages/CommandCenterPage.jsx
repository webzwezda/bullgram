import { Link } from 'react-router-dom';
import { Rocket } from 'lucide-react';

export function CommandCenterPage() {
  return (
    <section className="page page--flush">
      <Link
        to="/app/userbots"
        className="group block rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
      >
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/20 shrink-0">
            <Rocket className="w-6 h-6" />
          </div>
          <div>
            <div className="text-lg font-bold tracking-tight text-slate-900 transition-colors group-hover:text-blue-600">
              Юзерботы
            </div>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              Заготовка: здесь будет управление юзерботами — выпуск, прокси, рассылки и мониторинг.
            </p>
          </div>
        </div>
      </Link>
    </section>
  );
}

export default CommandCenterPage;
