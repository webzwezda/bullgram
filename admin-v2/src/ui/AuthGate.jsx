import { useAuth } from '../app/providers/AuthProvider.jsx';
import { Button } from '@/components/ui/button';
import { LoadingState } from './LoadingState.jsx';
import { ShieldCheck, Activity, Users, Lock, Sparkles } from 'lucide-react';

export function AuthGate({ children }) {
  const { loading, user, login } = useAuth();

  if (loading) {
    return <LoadingState text="Поднимаем новую админку..." />;
  }

  if (!user) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-slate-50/50 p-4 relative overflow-hidden font-sans">
        {/* Premium animated-style glow circles */}
        <div className="absolute top-[10%] left-[10%] w-[450px] h-[450px] bg-blue-500/8 rounded-full blur-[120px] -z-10" />
        <div className="absolute bottom-[10%] right-[10%] w-[450px] h-[450px] bg-indigo-500/8 rounded-full blur-[120px] -z-10" />

        <div className="w-full max-w-5xl overflow-hidden rounded-[32px] border border-slate-200 bg-white/95 shadow-[0_32px_80px_-16px_rgba(15,23,42,0.08)] backdrop-blur-md transition-all duration-300 hover:shadow-[0_48px_96px_-12px_rgba(15,23,42,0.12)]">
          <div className="grid lg:grid-cols-[minmax(0,1.2fr)_380px]">
            <section className="relative overflow-hidden px-6 py-8 sm:px-8 sm:py-10 flex flex-col justify-between">
              <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-r from-blue-100/40 via-indigo-50/20 to-transparent" />
              <div className="relative space-y-8 my-auto">
                <div className="inline-flex items-center gap-1.5 rounded-full border border-blue-200/80 bg-blue-50/50 px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-blue-800 shadow-2xs">
                  <Sparkles className="w-3.5 h-3.5 text-blue-600" />
                  Панель управления
                </div>

                <div className="space-y-3">
                  <h1 className="max-w-2xl text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
                    Вход в кабинет BullRun
                  </h1>
                  <p className="max-w-2xl text-sm leading-7 text-slate-600 sm:text-base">
                    Авторизуйтесь, чтобы управлять платным доступом к вашим Telegram-каналам,
                    отслеживать заказы, настраивать автоматический прием платежей и CRM.
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="rounded-2xl border border-slate-200/80 bg-white/60 p-4 shadow-2xs backdrop-blur-xs transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xs hover:border-slate-300">
                    <div className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-blue-50 text-blue-600 shadow-2xs">
                      <Lock className="w-4 h-4" />
                    </div>
                    <div className="mt-3 text-sm font-semibold text-slate-900">Безопасность</div>
                    <p className="mt-1.5 text-xs leading-5 text-slate-500">
                      Быстрый вход через аккаунт Google без необходимости ввода паролей.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-200/80 bg-white/60 p-4 shadow-2xs backdrop-blur-xs transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xs hover:border-slate-300">
                    <div className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 shadow-2xs">
                      <Users className="w-4 h-4" />
                    </div>
                    <div className="mt-3 text-sm font-semibold text-slate-900">Клиенты и CRM</div>
                    <p className="mt-1.5 text-xs leading-5 text-slate-500">
                      База подписчиков, автоматический контроль лимитов и истории оплат.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-200/80 bg-white/60 p-4 shadow-2xs backdrop-blur-xs transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xs hover:border-slate-300">
                    <div className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 shadow-2xs">
                      <Activity className="w-4 h-4" />
                    </div>
                    <div className="mt-3 text-sm font-semibold text-slate-900">Управление</div>
                    <p className="mt-1.5 text-xs leading-5 text-slate-500">
                      Живая статистика, shop-контур, настройка прокси и юзерботов.
                    </p>
                  </div>
                </div>
              </div>
            </section>

            <aside className="border-t border-slate-200 bg-slate-50/40 px-6 py-8 sm:px-8 sm:py-10 lg:border-t-0 lg:border-l flex flex-col justify-center">
              <div className="space-y-6">
                <div className="space-y-2">
                  <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">Авторизация</div>
                  <div className="text-2xl font-black tracking-tight text-slate-950">
                    Требуется вход
                  </div>
                  <p className="text-sm leading-6 text-slate-500">
                    Для доступа к инструментам администрирования, управлению продажами и ботами необходимо войти в аккаунт.
                  </p>
                </div>

                <Button className="h-12 w-full rounded-2xl text-sm font-black flex items-center justify-center gap-2 cursor-pointer shadow-sm hover:shadow-md active:scale-[0.98] transition-all bg-slate-900 hover:bg-slate-800 text-white" onClick={login}>
                  <svg className="w-5 h-5 mr-1 shrink-0 bg-white p-0.5 rounded-sm" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  Войти через Google
                </Button>

                <div className="rounded-2xl border border-slate-200/80 bg-white/60 p-4 text-sm leading-6 text-slate-500 shadow-2xs flex items-start gap-2.5">
                  <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                  <span className="text-xs">После успешного входа вы автоматически вернетесь к работе в вашем кабинете.</span>
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
