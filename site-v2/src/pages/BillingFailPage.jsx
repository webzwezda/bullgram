import { AlertCircle, ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';

export function BillingFailPage() {
  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-3xl items-center justify-center px-4 py-12">
      <section className="w-full rounded-lg border border-amber-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
            <AlertCircle className="h-7 w-7" strokeWidth={2.5} />
          </div>
          <div>
            <div className="text-xs font-black uppercase tracking-[0.16em] text-amber-700">Robokassa</div>
            <h1 className="text-3xl font-black tracking-tight text-slate-950">Оплата не завершена</h1>
          </div>
        </div>

        <p className="mt-5 text-base font-semibold leading-7 text-slate-600">
          Деньги не списались или Robokassa вернула отмену. Можно вернуться к Normal checkout и создать новый счет.
        </p>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Link className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-3 text-sm font-black text-white transition hover:bg-blue-700" to="/billing/normal">
            <ArrowLeft className="h-4 w-4" strokeWidth={2.5} />
            Вернуться к оплате
          </Link>
          <Link className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-700 transition hover:bg-slate-50" to="/pricing">
            Открыть тарифы
          </Link>
        </div>
      </section>
    </div>
  );
}
