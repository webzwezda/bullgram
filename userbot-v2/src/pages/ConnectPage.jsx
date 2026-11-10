import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { LoadingState } from '../ui/LoadingState.jsx';
import { getProductTierRules } from '../app/productTier.js';
import { AdminLotsSection } from '../components/shop/AdminLotsSection.jsx';
import { BatchIntakeSection } from './bots/BatchIntakeSection.jsx';
import { AccountLotsSection } from './bots/AccountLotsSection.jsx';
import { UserbotOnboardingSection } from './bots/UserbotOnboardingSection.jsx';
import { UserbotStorefrontSection } from './bots/UserbotStorefrontSection.jsx';
import { useBotsAccountsData } from './bots/useBotsAccountsData.js';
import {
  isUserbotPurchase,
  isUserbotShopItem,
  proxyLabel
} from './bots/bots-accounts.utils.js';
import { useBotsAccountsDerivedState } from './bots/useBotsAccountsDerivedState.js';
import { useUserbotOnboarding } from './bots/useUserbotOnboarding.js';
import { useShopStorefront } from '../features/shop-storefront/useShopStorefront.js';

// Страница «Подключение» (композиция 2026-09-28): покупка аккаунта → онбординг
// (прокси → способ входа → авторизация). Продажа аккаунтов — одна карточка
// «Продажа аккаунтов» (скан → витрина → снятие), секция «Выставлены в Shop»
// убрана 2026-11-03 (слияние складов). Подключённый аккаунт появляется
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
  const { accessToken, user, profilePlan, profileRole } = useAuth();
  // Селектор «выбрать юзербот на витрине» остался от убранной секции
  // «Выставлены в Shop»: производное состояние ждёт его — держим пустым.
  const [selectedShopUserbotId] = useState('');
  const { state, reloadAccounts } = useBotsAccountsData({
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
    accountOnlyUserbotLots,
    availableOnboardingProxies,
    bundledUserbotLots,
    openUserbotPurchases
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

  // Один магазин — одна полка (зеркалит UserbotsPage): комплекты плюс
  // одиночные лоты account/userbot.
  const storefrontLots = useMemo(
    () => [...bundledUserbotLots, ...accountOnlyUserbotLots],
    [bundledUserbotLots, accountOnlyUserbotLots]
  );

  const buyerStorefrontSectionProps = {
    openPurchases: openUserbotPurchases,
    setSelectedOpenPurchaseId,
    showPurchaseInline,
    storefrontState,
    storefrontLot: storefrontLots[0] || null,
    storefrontLots,
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

      {/* Партия аккаунтов — приёмка пачек, только платформенный админ. */}
      {profileRole === 'admin' ? (
        <BatchIntakeSection
          accessToken={accessToken}
          reloadAccounts={reloadAccounts}
          showUiMessage={showUiMessage}
        />
      ) : null}

      {/* Продажа аккаунтов пачкой — рядом с приёмкой: скан → выбор живых → витрина. */}
      {profileRole === 'admin' ? (
        <AccountLotsSection
          accessToken={accessToken}
          showUiMessage={showUiMessage}
        />
      ) : null}

      {state.proxySupport?.profile_role === 'admin' ? (
        <AdminLotsSection
          accessToken={accessToken}
          types="bundle"
          title="Наборы (Pro-стартовые комплекты)"
          emptyText="Наборов сейчас нет."
        />
      ) : null}
    </section>
  );
}

export default function ConnectPage() {
  return <ConnectPageContent />;
}
