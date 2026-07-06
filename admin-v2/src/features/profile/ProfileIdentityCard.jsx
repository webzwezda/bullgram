import { useAuth } from '../../app/providers/AuthProvider.jsx';

function formatDateOnly(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long' }).format(new Date(value));
}

function planMeta(plan, trialEndsAt, normalEndsAt) {
  const lower = String(plan || '').toLowerCase();
  if (lower === 'pro') {
    return { title: 'Pro', hint: 'Без лимитов', pillClass: 'bg-amber-100 text-amber-800 border-amber-200' };
  }
  if (lower === 'normal') {
    return { title: 'Normal', hint: normalEndsAt ? `До ${formatDateOnly(normalEndsAt)}` : 'Активен', pillClass: 'bg-emerald-100 text-emerald-800 border-emerald-200' };
  }
  return { title: 'Trial', hint: trialEndsAt ? `До ${formatDateOnly(trialEndsAt)}` : 'Активирован', pillClass: 'bg-blue-100 text-blue-800 border-blue-200' };
}

export function ProfileIdentityCard() {
  const { user, profilePlan, trialEndsAt, normalEndsAt } = useAuth();

  const profileName = user?.user_metadata?.full_name || user?.user_metadata?.name || 'Без имени';
  const profileEmail = user?.email || '';
  const avatarUrl = user?.user_metadata?.avatar_url || '';
  const profileInitial = (profileEmail || profileName || 'U').trim().charAt(0).toUpperCase();
  const currentPlan = planMeta(profilePlan, trialEndsAt, normalEndsAt);

  return (
    <div className="bg-white border border-slate-200/60 rounded-3xl p-6 md:p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
      <div className="flex items-center gap-5">
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={profileName}
            className="w-20 h-20 rounded-2xl object-cover border border-slate-200"
          />
        ) : (
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-500 to-teal-500 flex items-center justify-center text-white text-2xl font-black">
            {profileInitial}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-black text-slate-900 truncate">{profileName}</h2>
          <p className="text-sm text-slate-500 truncate mt-0.5">{profileEmail || 'Без email'}</p>
          <div className="mt-3 flex items-center gap-2">
            <span className={`px-2.5 py-0.5 text-xs font-bold rounded-md border ${currentPlan.pillClass}`}>
              {currentPlan.title}
            </span>
            <span className="text-xs text-slate-500">{currentPlan.hint}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
