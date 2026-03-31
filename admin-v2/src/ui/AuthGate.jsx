import { useAuth } from '../app/providers/AuthProvider.jsx';
import { Button } from '@/components/ui/button';
import { LoadingState } from './LoadingState.jsx';

export function AuthGate({ children }) {
  const { loading, user, login } = useAuth();

  if (loading) {
    return <LoadingState text="Поднимаем новую админку..." />;
  }

  if (!user) {
    return (
      <div className="mx-auto mt-6 w-full max-w-5xl">
        <div className="overflow-hidden rounded-[28px] border border-border bg-card shadow-[0_24px_64px_rgba(15,23,42,0.08)]">
          <div className="grid lg:grid-cols-[minmax(0,1.2fr)_360px]">
            <section className="relative overflow-hidden px-6 py-8 sm:px-8 sm:py-10">
              <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-r from-emerald-100/70 via-cyan-50 to-transparent" />
              <div className="relative space-y-6">
                <div className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-emerald-800">
                  BullRun admin-v2
                </div>

                <div className="space-y-3">
                  <h1 className="max-w-2xl text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
                    Сначала вход, потом живая Telegram-операционка
                  </h1>
                  <p className="max-w-2xl text-sm leading-7 text-slate-600 sm:text-base">
                    `admin-v2` работает поверх текущего backend и той же Supabase-сессии. После входа подтянутся
                    живые экраны, тариф, платежный контур и текущие операционные хвосты.
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl border border-slate-200 bg-white/90 p-4">
                    <div className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">01</div>
                    <div className="mt-2 text-sm font-semibold text-slate-900">Google-вход</div>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      Поднимаем ту же сессию, на которой уже живут кабинет и backend.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white/90 p-4">
                    <div className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">02</div>
                    <div className="mt-2 text-sm font-semibold text-slate-900">Профиль и тариф</div>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      Сразу увидишь свой план, текущие ограничения и куда вести следующий рабочий шаг.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white/90 p-4">
                    <div className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">03</div>
                    <div className="mt-2 text-sm font-semibold text-slate-900">Живые экраны</div>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      После логина подтянутся реквизиты, shop, userbot-контур, CRM и остальные боевые данные.
                    </p>
                  </div>
                </div>
              </div>
            </section>

            <aside className="border-t border-border bg-slate-50/80 px-6 py-8 sm:px-8 sm:py-10 lg:border-t-0 lg:border-l">
              <div className="space-y-5">
                <div className="space-y-2">
                  <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Вход</div>
                  <div className="text-2xl font-black tracking-tight text-slate-950">
                    Нужен вход через Google
                  </div>
                  <p className="text-sm leading-6 text-slate-600">
                    Это не демо-экран. Без авторизации админка не тянет реальные данные и не открывает рабочие
                    действия по кабинету.
                  </p>
                </div>

                <Button className="h-11 w-full rounded-xl text-sm font-semibold" onClick={login}>
                  Войти через Google
                </Button>

                <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-600">
                  После входа вернёшься на этот же route и сразу попадёшь в текущий рабочий контур без ручного
                  переключения.
                </div>
              </div>
            </aside>
          </div>
        </div>
      </div>
    );
  }

  return children;
}
