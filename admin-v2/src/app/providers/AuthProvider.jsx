import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profileRole, setProfileRole] = useState(null);
  const [profilePlan, setProfilePlan] = useState('trial');
  const [trialStartedAt, setTrialStartedAt] = useState(null);
  const [trialEndsAt, setTrialEndsAt] = useState(null);
  const [normalEndsAt, setNormalEndsAt] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (userId) => {
    if (!userId) {
      setProfileRole(null);
      setProfilePlan('trial');
      setTrialStartedAt(null);
      setTrialEndsAt(null);
      setNormalEndsAt(null);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('role, product_tier, trial_started_at, trial_ends_at, normal_started_at, normal_ends_at')
        .eq('id', userId)
        .maybeSingle();

      if (error && ((error.message || '').includes('product_tier') || (error.message || '').includes('trial_started_at') || (error.message || '').includes('trial_ends_at') || (error.message || '').includes('normal_started_at') || (error.message || '').includes('normal_ends_at'))) {
        const fallback = await supabase
          .from('profiles')
          .select('role')
          .eq('id', userId)
          .maybeSingle();

        setProfileRole(fallback.data?.role || null);
        setProfilePlan('trial');
        setTrialStartedAt(null);
        setTrialEndsAt(null);
        setNormalEndsAt(null);
        return;
      }

      setProfileRole(data?.role || null);
      setProfilePlan(data?.product_tier || 'trial');
      setTrialStartedAt(data?.trial_started_at || null);
      setTrialEndsAt(data?.trial_ends_at || null);
      setNormalEndsAt(data?.normal_ends_at || null);
    } catch {
      setProfileRole(null);
      setProfilePlan('trial');
      setTrialStartedAt(null);
      setTrialEndsAt(null);
      setNormalEndsAt(null);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    async function bootstrap() {
      try {
        const { data } = await supabase.auth.getSession();
        if (!mounted) return;
        setSession(data.session || null);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    bootstrap();

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      if (!mounted) return;
      setSession(nextSession || null);
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (cancelled) return;
      await loadProfile(session?.user?.id);
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [session?.user?.id, loadProfile]);

  const value = useMemo(() => ({
    loading,
    session,
    user: session?.user || null,
    profileRole,
    profilePlan,
    trialStartedAt,
    trialEndsAt,
    normalEndsAt,
    accessToken: session?.access_token || '',
    refreshProfile: () => loadProfile(session?.user?.id),
    async login() {
      const redirectTo = `${window.location.origin}${window.location.pathname}`;
      await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo }
      });
    },
    async logout() {
      await supabase.auth.signOut();
      window.localStorage.clear();
      window.location.reload();
    }
  }), [loading, session, profileRole, profilePlan, trialStartedAt, trialEndsAt, normalEndsAt, loadProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return context;
}
