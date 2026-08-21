import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../../app/providers/AuthProvider.jsx';
import { supabase } from '../../lib/supabase.js';

function formatDateOnly(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long' }).format(new Date(value));
}

function planMeta(plan, trialEndsAt, proEndsAt) {
  const lower = String(plan || '').toLowerCase();
  if (lower === 'pro' || lower === 'normal') {
    return { title: 'Pro', hint: proEndsAt ? `До ${formatDateOnly(proEndsAt)}` : 'Активен', pillClass: 'bg-amber-100 text-amber-800 border-amber-200' };
  }
  return { title: 'Trial', hint: trialEndsAt ? `До ${formatDateOnly(trialEndsAt)}` : 'Активирован', pillClass: 'bg-blue-100 text-blue-800 border-blue-200' };
}

export function ProfileIdentityCard() {
  const { user, profilePlan, trialEndsAt, proEndsAt } = useAuth();

  const [identities, setIdentities] = useState(null);
  const [linkingGoogle, setLinkingGoogle] = useState(false);
  const [unlinkingGoogle, setUnlinkingGoogle] = useState(false);
  const [linkError, setLinkError] = useState(null);

  useEffect(() => {
    let alive = true;
    supabase.auth.getUserIdentities()
      .then(({ data }) => { if (alive) setIdentities(data?.identities || []); })
      .catch(() => { if (alive) setIdentities([]); });
    return () => { alive = false; };
  }, [user?.id]);

  const handleLinkGoogle = async () => {
    setLinkingGoogle(true);
    setLinkError(null);
    try {
      const { data, error } = await supabase.auth.linkIdentity({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/app/profile` }
      });
      if (error) throw error;
      if (data?.url) {
        window.location.href = data.url;
        return;
      }
      throw new Error('Не удалось открыть Google');
    } catch (err) {
      setLinkError(err?.message || 'Не удалось привязать Google');
    } finally {
      setLinkingGoogle(false);
    }
  };

  const handleUnlinkGoogle = async () => {
    setUnlinkingGoogle(true);
    setLinkError(null);
    try {
      const { data, error } = await supabase.auth.getUserIdentities();
      if (error) throw error;
      const list = data?.identities || [];
      if (list.length <= 1) {
        throw new Error('Google — единственный способ входа. Сначала привяжите другой.');
      }
      const googleIdentity = list.find((i) => i.provider === 'google');
      if (!googleIdentity) throw new Error('Google не привязан');
      const { error: unlinkError } = await supabase.auth.unlinkIdentity({ identity_id: googleIdentity.identity_id || googleIdentity.id });
      if (unlinkError) throw unlinkError;
      setIdentities(list.filter((i) => i.provider !== 'google'));
    } catch (err) {
      setLinkError(err?.message || 'Не удалось отвязать Google');
    } finally {
      setUnlinkingGoogle(false);
    }
  };

  const hasGoogle = (identities || []).some((i) => i.provider === 'google');
  const hasTelegram = (identities || []).some((i) => i.provider === 'custom:telegram');

  const profileName = user?.user_metadata?.full_name || user?.user_metadata?.name || 'Без имени';
  const profileEmail = user?.email || '';
  const avatarUrl = user?.user_metadata?.avatar_url || '';
  const profileInitial = (profileEmail || profileName || 'U').trim().charAt(0).toUpperCase();
  const currentPlan = planMeta(profilePlan, trialEndsAt, proEndsAt);

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

      {identities ? (
        <div className="mt-6 pt-6 border-t border-slate-100 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-xs font-black uppercase tracking-wider text-slate-400">Способы входа</div>
            <p className="text-xs text-slate-400">Два способа — запасной вход, если один заблокируют</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {hasGoogle ? (
              <>
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 text-xs font-bold">
                  Google подключён
                </span>
                {identities.length > 1 ? (
                  <button
                    type="button"
                    onClick={handleUnlinkGoogle}
                    disabled={unlinkingGoogle}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-rose-50 hover:border-rose-200 text-slate-400 hover:text-rose-600 text-xs font-bold transition-all disabled:opacity-50"
                  >
                    {unlinkingGoogle ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                    Отвязать Google
                  </button>
                ) : (
                  <span className="text-xs text-slate-400 font-bold">единственный способ входа — не удалить</span>
                )}
              </>
            ) : (
              <button
                type="button"
                onClick={handleLinkGoogle}
                disabled={linkingGoogle}
                className="inline-flex items-center justify-center gap-2 px-3.5 py-1.5 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 hover:border-slate-300 text-slate-700 text-xs font-bold transition-all disabled:opacity-50"
              >
                {linkingGoogle ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                Привязать Google
              </button>
            )}
            {hasTelegram ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 text-xs font-bold">
                Telegram подключён
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-400 text-xs font-bold">
                Telegram не привязан — кнопка ниже
              </span>
            )}
          </div>
          {linkError ? <p className="text-xs text-rose-600 font-bold">{linkError}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
