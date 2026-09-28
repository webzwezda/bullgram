import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { LoadingState } from '../ui/LoadingState.jsx';
import { getProductTierRules } from '../app/productTier.js';
import { AdminLotsSection } from '../components/shop/AdminLotsSection.jsx';
import { ListedShopUserbotsSection } from './bots/ListedShopUserbotsSection.jsx';
import { UserbotOnboardingSection } from './bots/UserbotOnboardingSection.jsx';
import { UserbotStorefrontSection } from './bots/UserbotStorefrontSection.jsx';
import { useBotsAccountsData } from './bots/useBotsAccountsData.js';
import {
  formatWhen,
  isUserbotPurchase,
  isUserbotShopItem,
  proxyLabel,
  restrictedMarker
} from './bots/bots-accounts.utils.js';
import { useBotsAccountsDerivedState } from './bots/useBotsAccountsDerivedState.js';
import { useListedShopUserbotsController } from './bots/useListedShopUserbotsController.js';
import { useUserbotOnboarding } from './bots/useUserbotOnboarding.js';
import { useShopStorefront } from '../features/shop-storefront/useShopStorefront.js';

// Страница «Подключение» (композиция 2026-09-28): покупка аккаунта → онбординг
// (прокси → способ входа → авторизация) → лоты продавца («Выставлены в Shop»)
// и лоты платформы («Юзерботы на витрине»). Подключённый аккаунт появляется
// в витрине Юзерботов на /. Магазинный слой зеркалит UserbotsPage.

function showUiMessage(text, tone = 'default') {
  if (tone === 'success') return toast.success(text);
  if (tone === 'error') return toast.error(text);
  return toast(text);
}

function userbotBatchTitleFor(count, firstItem) {
  if (firstItem?.item_type === 'bundle') return `Аккаунты + прокси x${count}`;
  return `Аккаунты x${count}`;
}

function ConnectPageContent() {
  const { accessToken, user, profilePlan } = useAuth();
  const [selectedShopUserbotId, setSelectedShopUserbotId] = useState('');
  const { state, setState, reloadAccounts } = useBotsAccountsData({
    accessToken,
    ownerId: user?.id
  });

  const {
    buyQuantities,
    cancelCheckout,
    checkPurchase,
    checkoutState,
    createBatchCheckout,
    openCheckout,
    refreshPurchases,
    selectedOpenPurchaseId,
    setBuyQuantities,
    setCheckoutState,
    setSelectedOpenPurchaseId,
    showPurchaseInline,
    storefrontState
  } = useShopStorefront({
    accessToken,
    profileRole: state.proxySupport?.profile_role,
    showUiMessage,
    isShopItem: isUserbotShopItem,
    isPurchase: isUserbotPurchase,
    batchTitleFor: userbotBatchTitleFor
  });

  const planRules = useMemo(() => getProductTierRules(profilePlan), [profilePlan]);
  const userbotsCount = useMemo(
    () => state.accounts.filter((account) => account.account_type === 'userbot').length,
    [state.accounts]
  );

  const {
    availableOnboardingProxies,
    bundledUserbotLot,
    bundledUserbotLots,
    canSellUserbotAssets,
    listedShopUserbots,
    openUserbotPurchases,
    selectedShopUserbot
  } = useBotsAccountsDerivedState({
    state,
    storefrontState,
    selectedLiveUserbotId: '',
    selectedShopUserbotId,
    selectedOpenPurchaseId,
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

  const {
    deleteShopItem
  } = useListedShopUserbotsController({
    accessToken,
    reloadAccounts,
    setState,
    showUiMessage
  });

  useEffect(() => {
    if (!openUserbotPurchases.length) {
      setSelectedOpenPurchaseId('');
      return;
    }

    setSelectedOpenPurchaseId((prev) => {
      if (prev && openUserbotPurchases.some((purchase) => String(purchase.id) === String(prev))) {
        return prev;
      }
      return String(openUserbotPurchases[0].id);
    });
  }, [openUserbotPurchases]);

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

  const buyerStorefrontSectionProps = {
    openPurchases: openUserbotPurchases,
    setSelectedOpenPurchaseId,
    showPurchaseInline,
    storefrontState,
    bundledUserbotLot,
    bundledUserbotLots,
    buyQuantities,
    setBuyQuantities,
    checkoutState,
    setCheckoutState,
    cancelCheckout,
    checkPurchase,
    createBatchCheckout,
    openCheckout,
    refreshPurchases,
    reloadAssets: reloadAccounts
  };

  const listedShopUserbotsSectionProps = {
    deleteShopItem,
    formatWhen,
    listedShopUserbots,
    restrictedMarker,
    selectedShopUserbot,
    setSelectedShopUserbotId,
    state
  };

  if (state.loading) {
    return <LoadingState text="Тянем прокси, профили и лоты..." />;
  }

  if (state.error) {
    return (
      <section className="page page--flush">
        <div className="error-card">{state.error}</div>
      </section>
    );
  }

  return (
    <section className="page page--flush">
      <UserbotStorefrontSection {...buyerStorefrontSectionProps} />

      <UserbotOnboardingSection
        {...onboardingSectionProps}
        steps={{ proxy: 1, connect: 2, fingerprint: 3, authFiles: 3, authQr: 4 }}
      />

      {canSellUserbotAssets ? (
        <ListedShopUserbotsSection {...listedShopUserbotsSectionProps} />
      ) : null}

      {state.proxySupport?.profile_role === 'admin' ? (
        <AdminLotsSection
          accessToken={accessToken}
          types="bundle,userbot"
          title="Юзерботы на витрине"
          emptyText="Опубликованных лотов юзерботов сейчас нет."
        />
      ) : null}
    </section>
  );
}

export default function ConnectPage() {
  return <ConnectPageContent />;
}
