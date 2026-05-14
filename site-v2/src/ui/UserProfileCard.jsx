import { useAuth } from '../app/providers/AuthProvider.jsx';
import { LogOut, Zap } from 'lucide-react';

function planMeta(plan, trialEndsAt, normalEndsAt) {
  if (plan === 'pro') {
    return {
      title: 'Pro',
      pillClass: 'bg-amber-100/80 text-amber-700 border-amber-200/50'
    };
  }

  if (plan === 'normal') {
    const date = normalEndsAt ? new Date(normalEndsAt) : null;
    return {
      title: 'Normal',
      hint: date && Number.isFinite(date.getTime()) ? `До ${date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}` : 'Активен',
      pillClass: 'bg-emerald-100/80 text-emerald-700 border-emerald-200/50'
    };
  }

  const daysLeft = trialEndsAt ? Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : null;
  const expired = daysLeft !== null && daysLeft < 0;
  const dueSoon = daysLeft !== null && daysLeft <= 3;

  return {
    title: expired ? 'Trial истек' : 'Trial',
    hint: trialEndsAt ? (expired ? `Истек` : `До ${new Date(trialEndsAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}`) : 'Активирован',
    pillClass: dueSoon || expired ? 'bg-red-100/80 text-red-700 border-red-200/50' : 'bg-blue-100/80 text-blue-700 border-blue-200/50'
  };
}

export function UserProfileCard() {
  const { user, profilePlan, trialEndsAt, normalEndsAt, logout } = useAuth();

  if (!user) return null;

  const profileName = user?.user_metadata?.full_name || user?.user_metadata?.name || 'Оператор BullRun';
  const profileEmail = user?.email || '';
  const avatarUrl = user?.user_metadata?.avatar_url || '';
  const profileInitial = (profileEmail || profileName || 'U').trim().charAt(0).toUpperCase();

  const currentPlan = planMeta(profilePlan, trialEndsAt, normalEndsAt);

  return (
    <div className="flex flex-col mb-8 mt-2">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          {avatarUrl ? (
            <img src={avatarUrl} alt={profileName} className="w-10 h-10 rounded-full object-cover border border-slate-200/60 shadow-sm" />
          ) : (
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-blue-500 flex items-center justify-center text-white font-bold shadow-sm shadow-blue-500/20">
              {profileInitial}
            </div>
          )}
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-bold text-slate-900 truncate tracking-tight">{profileName}</span>
            <span className="text-xs font-medium text-slate-500 truncate">{profileEmail || 'Без email'}</span>
          </div>
        </div>

        <button
          className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
          type="button"
          onClick={() => logout()}
          title="Выйти"
        >
          <LogOut className="w-4 h-4" strokeWidth={2.5} />
        </button>
      </div>

      <div className="flex items-center justify-between p-3.5 bg-slate-50 rounded-2xl border border-slate-100/80">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-white rounded-lg shadow-sm border border-slate-200/50 text-slate-400">
            <Zap className="w-3.5 h-3.5" strokeWidth={2.5} />
          </div>
          <span className="text-xs font-extrabold text-slate-600 uppercase tracking-widest">Тариф</span>
        </div>
        <div className="flex flex-col items-end">
          <span className={`px-2.5 py-0.5 text-[11px] font-extrabold uppercase tracking-wide rounded-md border ${currentPlan.pillClass}`}>
            {currentPlan.title}
          </span>
          {currentPlan.hint && (
            <span className="text-[10px] text-slate-400 mt-1 font-semibold">{currentPlan.hint}</span>
          )}
        </div>
      </div>
    </div>
  );
}
