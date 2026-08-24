import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { TonWalletSidebarRow } from '../features/ton-checkout/TonWalletSidebarRow.jsx';
import { TelegramSidebarRow } from '../features/telegram/TelegramSidebarRow.jsx';
import { Crown, LogOut, LogIn, Send } from 'lucide-react';

function formatDateOnly(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium'
  }).format(new Date(value));
}

function getTrialDaysLeft(value) {
  if (!value) return null;
  const diffMs = new Date(value).getTime() - Date.now();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

function planMeta(plan, trialEndsAt) {
  if (plan === 'pro' || plan === 'normal') {
    return {
      title: 'Pro',
      hint: 'Без лимитов',
      pillClass: 'bg-amber-100 text-amber-800 border-amber-200'
    };
  }

  const daysLeft = getTrialDaysLeft(trialEndsAt);
  const expired = daysLeft !== null && daysLeft < 0;
  const dueSoon = daysLeft !== null && daysLeft <= 3;

  return {
    title: expired ? 'Trial истек' : 'Trial',
    hint: trialEndsAt ? (expired ? `Истек ${formatDateOnly(trialEndsAt)}` : `До ${formatDateOnly(trialEndsAt)}`) : 'Активирован',
    pillClass: dueSoon || expired ? 'bg-red-100 text-red-800 border-red-200' : 'bg-blue-100 text-blue-800 border-blue-200'
  };
}

export function OpsRail() {
  const { user, login, logout, profilePlan, trialEndsAt } = useAuth();

  const profileName = user?.user_metadata?.full_name || user?.user_metadata?.name || 'Оператор Bullgram';
  const profileEmail = user?.email || '';
  const avatarUrl = user?.user_metadata?.avatar_url || '';
  const profileInitial = (profileEmail || profileName || 'U').trim().charAt(0).toUpperCase();

  const currentPlan = useMemo(() => planMeta(profilePlan, trialEndsAt), [profilePlan, trialEndsAt]);

  return (
    <aside className="ops-rail font-sans">
      <div className="bg-white border border-slate-200/60 rounded-3xl p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] mb-4">
        <div className="flex items-center gap-3 mb-4">
          {avatarUrl ? (
            <img src={avatarUrl} alt={profileName} className="w-10 h-10 rounded-full object-cover border border-slate-200" />
          ) : (
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-teal-500 flex items-center justify-center text-white font-bold">
              {profileInitial}
            </div>
          )}
          <Link to="/profile" className="flex-1 min-w-0 block hover:opacity-80 transition-opacity">
            <div className="text-sm font-bold text-slate-900 truncate hover:underline">{profileName}</div>
            <div className="text-xs text-slate-500 truncate hover:underline">{profileEmail || 'Без email'}</div>
          </Link>
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
            <span className="text-[10px] text-slate-400 mt-1 font-medium">{currentPlan.hint}</span>
          </div>
        </div>

        {user ? <TonWalletSidebarRow /> : null}
        {user ? <TelegramSidebarRow /> : null}

        {user ? (
          <button
            onClick={logout}
            className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-white hover:bg-slate-50 text-slate-600 text-xs font-bold rounded-lg border border-slate-200 transition-colors shadow-sm"
          >
            <LogOut className="w-3.5 h-3.5" />
            Выйти из системы
          </button>
        ) : (
          <div className="flex flex-col gap-1.5">
            <button
              onClick={() => login()}
              className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-blue-500 hover:bg-blue-600 text-white text-xs font-bold rounded-lg transition-colors shadow-sm"
            >
              <LogIn className="w-3.5 h-3.5" />
              Войти через Google
            </button>
            <button
              onClick={() => login('custom:telegram')}
              className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-sky-500 hover:bg-sky-600 text-white text-xs font-bold rounded-lg transition-colors shadow-sm"
            >
              <Send className="w-3.5 h-3.5" />
              Войти через Telegram
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
