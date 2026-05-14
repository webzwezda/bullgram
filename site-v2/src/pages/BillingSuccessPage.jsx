import { CheckCircle2, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';

export function BillingSuccessPage() {
  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-3xl items-center justify-center px-4 py-12">
      <section className="w-full rounded-lg border border-emerald-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
            <CheckCircle2 className="h-7 w-7" strokeWidth={2.5} />
          </div>
          <div>
            <div className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700">Robokassa</div>
            <h1 className="text-3xl font-black tracking-tight text-slate-950">Оплата принята</h1>
          </div>
        </div>

        <p className="mt-5 text-base font-semibold leading-7 text-slate-600">
          Если Robokassa уже отправила Result callback, Normal включен. Если страница открылась быстрее callback,
          обнови статус через пару секунд в billing.
        </p>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Link className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-3 text-sm font-black text-white transition hover:bg-blue-700" to="/billing/normal">
            <RefreshCw className="h-4 w-4" strokeWidth={2.5} />
            Проверить статус
          </Link>
          <a className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-700 transition hover:bg-slate-50" href="/app">
            Открыть кабинет
          </a>
        </div>
      </section>
    </div>
  );
}
