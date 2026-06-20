import { useAuth } from '../app/providers/AuthProvider.jsx';
import { Button } from '@/components/ui/button';
import { LoadingState } from './LoadingState.jsx';
import { ShieldCheck, Activity, Users, Lock, Sparkles, KeyRound } from 'lucide-react';

export function AuthGate({ children }) {
  const { loading, user, login } = useAuth();

  if (loading) {
    return <LoadingState text="Поднимаем новую админку..." />;
  }

  if (!user) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-[#07090e] p-4 relative overflow-hidden font-sans">
        {/* Background telemetry dots pattern */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.015)_1px,transparent_1px)] bg-[size:32px_32px] pointer-events-none" />

        {/* Ambient background glows */}
        <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-blue-600/10 rounded-full blur-[140px] pointer-events-none animate-pulse-slow -z-10" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[500px] h-[500px] bg-violet-600/8 rounded-full blur-[140px] pointer-events-none animate-pulse-slow -z-10" style={{ animationDelay: '3s' }} />
        <div className="absolute top-[40%] left-[40%] w-[400px] h-[400px] bg-sky-500/4 rounded-full blur-[120px] pointer-events-none -z-10" />

        <div className="w-full max-w-5xl overflow-hidden rounded-[32px] border border-white/[0.08] bg-slate-900/40 shadow-[0_32px_80px_rgba(0,0,0,0.65),inset_0_1px_1px_rgba(255,255,255,0.06)] backdrop-blur-2xl transition-all duration-500 hover:shadow-[0_48px_96px_rgba(0,0,0,0.75)]">
          <div className="grid lg:grid-cols-[minmax(0,1.2fr)_390px]">
            <section className="relative overflow-hidden px-6 py-8 sm:px-8 sm:py-10 flex flex-col justify-between">
              <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-sky-500/[0.03] to-transparent pointer-events-none" />
              
              <div className="relative space-y-8 my-auto">
                <div className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/20 bg-sky-500/10 px-3.5 py-1 text-[11px] font-black uppercase tracking-[0.2em] text-sky-400 shadow-[0_0_15px_rgba(56,189,248,0.1)]">
                  <Sparkles className="w-3.5 h-3.5 text-sky-400 animate-spin-slow" />
                  Панель управления
                </div>

                <div className="space-y-3">
                  <h1 className="max-w-2xl text-3xl font-black tracking-tight text-white sm:text-4xl leading-tight">
                    Вход в кабинет <span className="bg-clip-text text-transparent bg-gradient-to-r from-sky-400 via-blue-400 to-indigo-400 font-black">BullRun</span>
                  </h1>
                  <p className="max-w-2xl text-sm leading-relaxed text-slate-400 sm:text-base">
                    Авторизуйтесь, чтобы управлять платным доступом к вашим Telegram-каналам,
                    отслеживать заказы, настраивать автоматический прием платежей и CRM.
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  {/* Card 1 */}
                  <div className="group rounded-2xl border border-white/[0.04] bg-white/[0.02] p-5 shadow-2xs backdrop-blur-xs transition-all duration-300 hover:-translate-y-1 hover:bg-white/[0.04] hover:border-white/[0.08] hover:shadow-[0_12px_24px_rgba(0,0,0,0.3)]">
                    <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-sky-500/10 text-sky-400 shadow-sm transition-transform duration-300 group-hover:scale-110">
                      <Lock className="w-4.5 h-4.5" />
                    </div>
                    <div className="mt-3.5 text-sm font-bold text-white">Безопасность</div>
                    <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                      Быстрый вход через аккаунт Google без необходимости ввода паролей.
                    </p>
                  </div>

                  {/* Card 2 */}
                  <div className="group rounded-2xl border border-white/[0.04] bg-white/[0.02] p-5 shadow-2xs backdrop-blur-xs transition-all duration-300 hover:-translate-y-1 hover:bg-white/[0.04] hover:border-white/[0.08] hover:shadow-[0_12px_24px_rgba(0,0,0,0.3)]">
                    <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-400 shadow-sm transition-transform duration-300 group-hover:scale-110">
                      <Users className="w-4.5 h-4.5" />
                    </div>
                    <div className="mt-3.5 text-sm font-bold text-white">Клиенты и CRM</div>
                    <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                      База подписчиков, автоматический контроль лимитов и истории оплат.
                    </p>
                  </div>

                  {/* Card 3 */}
                  <div className="group rounded-2xl border border-white/[0.04] bg-white/[0.02] p-5 shadow-2xs backdrop-blur-xs transition-all duration-300 hover:-translate-y-1 hover:bg-white/[0.04] hover:border-white/[0.08] hover:shadow-[0_12px_24px_rgba(0,0,0,0.3)]">
                    <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400 shadow-sm transition-transform duration-300 group-hover:scale-110">
                      <Activity className="w-4.5 h-4.5" />
                    </div>
                    <div className="mt-3.5 text-sm font-bold text-white">Управление</div>
                    <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                      Живая статистика, shop-контур, настройка прокси и юзерботов.
                    </p>
                  </div>
                </div>
              </div>
            </section>

            <aside className="border-t border-white/[0.06] bg-slate-950/20 px-6 py-8 sm:px-8 sm:py-10 lg:border-t-0 lg:border-l border-white/[0.06] flex flex-col justify-center">
              <div className="space-y-6">
                <div className="space-y-2">
                  <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Авторизация</div>
                  <div className="text-2xl font-black tracking-tight text-white flex items-center gap-2">
                    <KeyRound className="w-6 h-6 text-sky-400 animate-pulse" />
                    Требуется вход
                  </div>
                  <p className="text-xs leading-relaxed text-slate-400">
                    Для доступа к инструментам администрирования, управлению продажами и ботами необходимо войти в аккаунт.
                  </p>
                </div>

                <Button className="h-12 w-full rounded-2xl text-sm font-black flex items-center justify-center gap-2 cursor-pointer shadow-lg active:scale-[0.98] transition-all bg-white hover:bg-slate-100 text-slate-950 border border-slate-200" onClick={login}>
                  <svg className="w-5 h-5 mr-1 shrink-0 bg-white p-0.5 rounded-sm" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  Войти через Google
                </Button>

                <div className="rounded-2xl border border-white/[0.04] bg-white/[0.01] p-4 text-sm leading-6 text-slate-400 shadow-2xs flex items-start gap-2.5">
                  <ShieldCheck className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                  <span className="text-[11px] text-slate-400">После успешного входа вы автоматически вернетесь к работе в вашем кабинете.</span>
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
