import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { LoadingState } from '../ui/LoadingState.jsx';
import { getProductTierRules } from '../app/productTier.js';
import { UserbotOnboardingSection } from './bots/UserbotOnboardingSection.jsx';
import { useBotsAccountsData } from './bots/useBotsAccountsData.js';
import { useBotsAccountsDerivedState } from './bots/useBotsAccountsDerivedState.js';
import { useUserbotOnboarding } from './bots/useUserbotOnboarding.js';
import { proxyLabel } from './bots/bots-accounts.utils.js';

// Страница подключения аккаунта (вынесена из витрины UserbotsPage, 2026-09-28):
// прокси → способ входа → авторизация. Магазинный слой (покупки, лоты витрины)
// здесь не нужен, поэтому storefront — заглушка: derived-хуку из неё читаются
// только openUserbotPurchases/visibleUserbotLots, а странице нужны лишь
// availableOnboardingProxies, который строится из state.proxies/state.accounts.
const EMPTY_STOREFRONT = { purchases: [], items: [] };

function showUiMessage(text, tone = 'default') {
  if (tone === 'success') return toast.success(text);
  if (tone === 'error') return toast.error(text);
  return toast(text);
}

function ConnectPageContent() {
  const { accessToken, user, profilePlan } = useAuth();
  const { state, reloadAccounts } = useBotsAccountsData({
    accessToken,
    ownerId: user?.id
  });

  const planRules = useMemo(() => getProductTierRules(profilePlan), [profilePlan]);
  const userbotsCount = useMemo(
    () => state.accounts.filter((account) => account.account_type === 'userbot').length,
    [state.accounts]
  );

  const { availableOnboardingProxies } = useBotsAccountsDerivedState({
    state,
    storefrontState: EMPTY_STOREFRONT,
    selectedLiveUserbotId: '',
    selectedShopUserbotId: '',
    selectedOpenPurchaseId: '',
    profilePlan
  });

  const {
    currentQrFingerprintProfile,
    fingerprintProfiles,
    fingerprintProfilesState,
    handleJsonFileChange,
    handleSessionFileChange,
    importSession,
    onboarding,
    startQrLogin,
    switchFingerprintMode,
    updateOnboarding
  } = useUserbotOnboarding({
    accessToken,
    planRules,
    userbotCount: userbotsCount,
    reloadAccounts,
    showUiMessage
  });

  const onboardingSectionProps = {
    availableOnboardingProxies,
    currentQrFingerprintProfile,
    fingerprintProfiles,
    fingerprintProfilesState,
    handleJsonFileChange,
    handleSessionFileChange,
    importSession,
    onboarding,
    proxyLabel,
    startQrLogin,
    switchFingerprintMode,
    updateOnboarding
  };

  if (state.loading) {
    return <LoadingState text="Тянем прокси и профили..." />;
  }

  if (state.error) {
    return (
      <section className="page page--flush">
        <div className="page__header">
          <h1>Подключение аккаунта</h1>
          <p>Экран собран, но загрузка вернула ошибку.</p>
        </div>
        <div className="error-card">{state.error}</div>
      </section>
    );
  }

  return (
    <section className="page page--flush">
      <div className="page__header">
        <h1>Подключение аккаунта</h1>
        <p>Прокси → способ входа → авторизация. Подключённый аккаунт появится в витрине Юзерботов.</p>
        <Link
          to="/"
          className="mt-3 h-10 px-4 rounded-xl border border-border-default bg-surface-card text-ink-body hover:bg-surface-subtle inline-flex items-center gap-2 shadow-sm"
        >
          ← Витрина аккаунтов
        </Link>
      </div>

      <UserbotOnboardingSection
        {...onboardingSectionProps}
        steps={{ proxy: 1, connect: 2, fingerprint: 3, authFiles: 3, authQr: 4 }}
      />
    </section>
  );
}

export default function ConnectPage() {
  return <ConnectPageContent />;
}
