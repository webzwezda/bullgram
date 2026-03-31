import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase.js';
import { apiRequest } from '../../api/client.js';

const AuthContext = createContext(null);

function normalizeOfferCode(item) {
  return String(item?.offer_code || '').trim().toLowerCase();
}

function buildPackagePulse(rows) {
  const activeStatuses = ['pending', 'awaiting_receipt', 'paid'];
  const expiredStatuses = ['expired', 'rejected'];
  const textOfferPurchases = rows.filter((purchase) => purchase?.item?.item_type === 'text_offer');

  function stateFor(pkgId) {
    if (pkgId === 'trial') {
      const active = textOfferPurchases.find((purchase) => (normalizeOfferCode(purchase.item) === 'trial' || !normalizeOfferCode(purchase.item)) && activeStatuses.includes(purchase.status));
      if (active) return active;
      return textOfferPurchases.find((purchase) => (normalizeOfferCode(purchase.item) === 'trial' || !normalizeOfferCode(purchase.item)) && expiredStatuses.includes(purchase.status)) || null;
    }

    if (pkgId === 'normal') {
      const active = textOfferPurchases.find((purchase) => normalizeOfferCode(purchase.item) === 'normal' && activeStatuses.includes(purchase.status));
      if (active) return active;
      return textOfferPurchases.find((purchase) => normalizeOfferCode(purchase.item) === 'normal' && expiredStatuses.includes(purchase.status)) || null;
    }

    const active = rows.find((purchase) => {
      if (!activeStatuses.includes(purchase.status)) return false;
      if (purchase?.item?.item_type !== 'text_offer') return true;
      return normalizeOfferCode(purchase.item) === 'seller';
    });
    if (active) return active;
    return rows.find((purchase) => {
      if (!expiredStatuses.includes(purchase.status)) return false;
      if (purchase?.item?.item_type !== 'text_offer') return true;
      return normalizeOfferCode(purchase.item) === 'seller';
    }) || null;
  }

  function signalFor(pkgId) {
    const purchase = stateFor(pkgId);
    if (!purchase) {
      return {
        id: pkgId,
        state: 'idle',
        label: 'Еще не начат'
      };
    }

    if (purchase.ownership_transfer_status === 'failed') {
      return {
        id: pkgId,
        state: 'failed',
        label: 'Handoff сломан'
      };
    }

    if (purchase.status === 'awaiting_receipt') {
      return {
        id: pkgId,
        state: 'review',
        label: 'Ждет проверки'
      };
    }

    if (purchase.status === 'pending') {
      return {
        id: pkgId,
        state: 'pending',
        label: 'Checkout открыт'
      };
    }

    if (purchase.status === 'paid') {
      return {
        id: pkgId,
        state: 'paid',
        label: 'Куплен'
      };
    }

    return {
      id: pkgId,
      state: 'expired',
      label: 'Протух'
    };
  }

  return {
    trial: signalFor('trial'),
    normal: signalFor('normal'),
    seller: signalFor('seller')
  };
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profileRole, setProfileRole] = useState(null);
  const [profilePlan, setProfilePlan] = useState('trial');
  const [trialStartedAt, setTrialStartedAt] = useState(null);
  const [trialEndsAt, setTrialEndsAt] = useState(null);
  const [checkoutPulse, setCheckoutPulse] = useState(null);
  const [sellerPulse, setSellerPulse] = useState(null);
  const [packagePulse, setPackagePulse] = useState(null);

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
        return;
      }

      const { data, error } = await supabase
        .from('profiles')
        .select('role, product_tier, trial_started_at, trial_ends_at')
        .eq('id', session.user.id)
        .single();

      if (!mounted) return;

      if (error && (
        (error.message || '').includes('product_tier')
        || (error.message || '').includes('trial_started_at')
        || (error.message || '').includes('trial_ends_at')
      )) {
        setProfileRole(data?.role || null);
        setProfilePlan('trial');
        setTrialStartedAt(null);
        setTrialEndsAt(null);
        return;
      }

      if (error) {
        setProfileRole(null);
        setProfilePlan('trial');
        setTrialStartedAt(null);
        setTrialEndsAt(null);
        return;
      }

      setProfileRole(data?.role || null);
      setProfilePlan(data?.product_tier || 'trial');
      setTrialStartedAt(data?.trial_started_at || null);
      setTrialEndsAt(data?.trial_ends_at || null);
    }

    loadProfilePlan();

    return () => {
      mounted = false;
    };
  }, [session?.user?.id]);

  useEffect(() => {
    let mounted = true;

    async function loadCheckoutPulse() {
      if (!session?.access_token) {
        if (!mounted) return;
        setCheckoutPulse(null);
        setSellerPulse(null);
        setPackagePulse(null);
        return;
      }

      try {
        const data = await apiRequest('/api/shop/public/my-purchases', {
          accessToken: session.access_token
        });
        if (!mounted) return;

        const rows = data.purchases || [];
        const pending = rows.filter((purchase) => purchase.status === 'pending');
        const awaiting = rows.filter((purchase) => purchase.status === 'awaiting_receipt');
        const failed = rows.filter((purchase) => purchase.ownership_transfer_status === 'failed');
        const paid = rows.filter((purchase) => purchase.status === 'paid');
        const sellerRows = rows.filter((purchase) => (purchase.item?.offer_code || '') === 'seller');
        const sellerPending = sellerRows.filter((purchase) => purchase.status === 'pending');
        const sellerAwaiting = sellerRows.filter((purchase) => purchase.status === 'awaiting_receipt');
        const sellerFailed = sellerRows.filter((purchase) => purchase.ownership_transfer_status === 'failed');
        const sellerPaid = sellerRows.filter((purchase) => purchase.status === 'paid');

        const spotlight = failed[0] || awaiting[0] || pending[0] || null;
        const sellerSpotlight = sellerFailed[0] || sellerAwaiting[0] || sellerPending[0] || sellerPaid[0] || null;

        setCheckoutPulse({
          pendingCount: pending.length,
          awaitingReceiptCount: awaiting.length,
          failedCount: failed.length,
          paidCount: paid.length,
          spotlight
        });
        setSellerPulse({
          pendingCount: sellerPending.length,
          awaitingReceiptCount: sellerAwaiting.length,
          failedCount: sellerFailed.length,
          paidCount: sellerPaid.length,
          hasAny: sellerRows.length > 0,
          spotlight: sellerSpotlight
        });
        setPackagePulse(buildPackagePulse(rows));
      } catch {
        if (!mounted) return;
        setCheckoutPulse(null);
        setSellerPulse(null);
        setPackagePulse(null);
      }
    }

    loadCheckoutPulse();
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
    checkoutPulse,
    packagePulse,
    sellerPulse,
    async login() {
      const redirectTo = `${window.location.origin}/shop`;
      await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo }
      });
    },
    async logout() {
      await supabase.auth.signOut();
      window.location.reload();
    }
  }), [checkoutPulse, loading, packagePulse, profilePlan, profileRole, sellerPulse, session, trialEndsAt, trialStartedAt]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
