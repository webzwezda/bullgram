import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { apiRequest } from '../../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profileRole, setProfileRole] = useState(null);
  const [profilePlan, setProfilePlan] = useState('trial');
  const [trialStartedAt, setTrialStartedAt] = useState(null);
  const [trialEndsAt, setTrialEndsAt] = useState(null);
  const [proStartedAt, setProStartedAt] = useState(null);
  const [proEndsAt, setProEndsAt] = useState(null);
  const [billingOrder, setBillingOrder] = useState(null);

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
    let mounted = true;

    async function loadProfilePlan() {
      if (!session?.user?.id) {
        if (!mounted) return;
        setProfileRole(null);
        setProfilePlan('trial');
        setTrialStartedAt(null);
        setTrialEndsAt(null);
        setProStartedAt(null);
        setProEndsAt(null);
        return;
      }

      const { data, error } = await supabase
        .from('profiles')
        .select('role, product_tier, trial_started_at, trial_ends_at, pro_started_at, pro_ends_at')
        .eq('id', session.user.id)
        .single();

      if (!mounted) return;

      if (error && (
        (error.message || '').includes('product_tier')
        || (error.message || '').includes('trial_started_at')
        || (error.message || '').includes('trial_ends_at')
        || (error.message || '').includes('pro_started_at')
        || (error.message || '').includes('pro_ends_at')
      )) {
        setProfileRole(data?.role || null);
        setProfilePlan('trial');
        setTrialStartedAt(null);
        setTrialEndsAt(null);
        setProStartedAt(null);
        setProEndsAt(null);
        return;
      }

      if (error) {
        setProfileRole(null);
        setProfilePlan('trial');
        setTrialStartedAt(null);
        setTrialEndsAt(null);
        setProStartedAt(null);
        setProEndsAt(null);
        return;
      }

      setProfileRole(data?.role || null);
      setProfilePlan(data?.product_tier || 'trial');
      setTrialStartedAt(data?.trial_started_at || null);
      setTrialEndsAt(data?.trial_ends_at || null);
      setProStartedAt(data?.pro_started_at || null);
      setProEndsAt(data?.pro_ends_at || null);
    }

    loadProfilePlan();

    return () => {
      mounted = false;
    };
  }, [session?.user?.id]);

  useEffect(() => {
    let mounted = true;

    async function loadBillingOrder() {
      if (!session?.access_token) {
        if (!mounted) return;
        setBillingOrder(null);
        return;
      }

      try {
        const billingData = await apiRequest('/api/billing/orders/current', {
          accessToken: session.access_token
        });
        if (!mounted) return;
        setBillingOrder(billingData.order || null);
        if (billingData.profile) {
          setProfilePlan(billingData.profile.product_tier || 'trial');
          setTrialStartedAt(billingData.profile.trial_started_at || null);
          setTrialEndsAt(billingData.profile.trial_ends_at || null);
          setProStartedAt(billingData.profile.pro_started_at || null);
          setProEndsAt(billingData.profile.pro_ends_at || null);
        }
      } catch {
        if (!mounted) return;
        setBillingOrder(null);
      }
    }

    loadBillingOrder();
    return () => {
      mounted = false;
    };
  }, [session?.access_token]);

  const value = useMemo(() => ({
    loading,
    session,
    user: session?.user || null,
    accessToken: session?.access_token || '',
    profileRole,
    profilePlan,
    trialStartedAt,
    trialEndsAt,
    proStartedAt,
    proEndsAt,
    billingOrder,
    async login(targetPath = null, provider = 'google') {
      const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}` || '/';
      const requestedPath = targetPath || currentPath;
      const url = new URL(requestedPath, window.location.origin);
      const redirectTo = url.origin === window.location.origin ? url.toString() : `${window.location.origin}/`;
      await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo }
      });
    },
    async logout() {
      await supabase.auth.signOut();
      window.location.reload();
    }
  }), [billingOrder, loading, proEndsAt, proStartedAt, profilePlan, profileRole, session, trialEndsAt, trialStartedAt]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
