import { useMemo } from 'react';
import { ArrowUpRight, Crown, Landmark, LogOut } from 'lucide-react';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { TonWalletSidebarRow } from '../features/ton-checkout/TonWalletSidebarRow.jsx';
import { TelegramSidebarRow } from '../features/telegram/TelegramSidebarRow.jsx';

// Карточка профиля в сайдбаре сайта — байт-в-байт первый блок рельса OpsRail
// (канон admin-v2/src/ui/OpsRail.jsx, 2026-09-30): имя-ссылка на /profile/,
// тариф, «Казна проекта» для админа, кошелёк TON, Telegram, выход.

function planMeta(plan) {
  if (plan === 'pro' || plan === 'normal') {
    return {
      title: 'Pro',
      hint: '',
      pillClass: 'bg-amber-100 text-amber-800 border-amber-200'
    };
  }

  return {
    title: 'Trial',
    hint: 'Бессрочно',
    pillClass: 'bg-indigo-50 text-indigo-700 border-indigo-200'
  };
}

export function RailProfileCard() {
  const { user, logout, profilePlan, profileRole } = useAuth();

  const profileName = user?.user_metadata?.full_name || user?.user_metadata?.name || 'Оператор Bullgram';
  const profileEmail = user?.email || '';
  const avatarUrl = user?.user_metadata?.avatar_url || '';
  const profileInitial = (profileEmail || profileName || 'U').trim().charAt(0).toUpperCase();

  const currentPlan = useMemo(() => planMeta(profilePlan), [profilePlan]);

  return (
    <div className="px-3 mb-6">
      <div className="flex items-center gap-3 mb-4">
        {avatarUrl ? (
          <img src={avatarUrl} alt={profileName} className="w-10 h-10 rounded-full object-cover border border-slate-200" />
        ) : (
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center text-white font-bold">
            {profileInitial}
          </div>
        )}
        {/* Имя — явная ссылка на профиль: цвет, подчёркивание и иконка, чтобы читалось как кликабельное. */}
        <a href="/profile/" className="group flex-1 min-w-0 block">
          <span className="flex items-center gap-1.5 min-w-0 text-sm font-bold text-indigo-600 hover:text-indigo-700 transition-colors">
            <span className="truncate underline decoration-indigo-300 underline-offset-2 group-hover:decoration-indigo-500">{profileName}</span>
            <ArrowUpRight className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          </span>
          <span className="block text-xs text-slate-500 truncate">{profileEmail || 'Без email'}</span>
        </a>
        {user ? (
          <button
            type="button"
            onClick={logout}
            title="Выйти"
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
          >
            <LogOut className="w-4 h-4" strokeWidth={2.5} />
          </button>
        ) : null}
      </div>

      <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100 mb-4">
        <div className="flex items-center gap-2">
          <Crown className="w-4 h-4 text-slate-400" />
          <span className="text-xs font-bold text-slate-600 uppercase tracking-wide">Тариф</span>
        </div>
        <div className="flex flex-col items-end">
          <span className={`px-2 py-0.5 text-xs font-bold rounded-md border ${currentPlan.pillClass}`}>
            {currentPlan.title}
          </span>
          {currentPlan.hint ? <span className="text-xs text-slate-500 mt-1 font-medium">{currentPlan.hint}</span> : null}
        </div>
      </div>

      {/* Казна — деньги платформы, только для платформенного админа. */}
      {profileRole === 'admin' ? (
        <a href="/treasury" className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100 mb-4 transition-colors hover:bg-slate-100/70">
          <div className="flex items-center gap-2">
            <Landmark className="w-4 h-4 text-slate-400" />
            <span className="text-xs font-bold text-slate-600 uppercase tracking-wide">Казна проекта</span>
          </div>
          <span className="text-slate-400 text-xs font-bold" aria-hidden="true">→</span>
        </a>
      ) : null}

      {user ? <TonWalletSidebarRow /> : null}
      {user ? <TelegramSidebarRow /> : null}


    </div>
  );
}
