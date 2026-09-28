import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { LoadingState } from '../ui/LoadingState.jsx';
import { UserbotStorefrontSection } from './bots/UserbotStorefrontSection.jsx';
import { UserbotCenterSection } from './bots/UserbotCenterSection.jsx';
import { useBotsAccountsData } from './bots/useBotsAccountsData.js';
import {
  canRestoreFromFiles,
  defaultCheckLines,
  formatWhen,
  isUserbotPurchase,
  isUserbotShopItem,
  paymentMethodLabel,
  proxyLabel,
  purchaseStatusMeta,
  recoveryStatusBadge,
  resolveBackendAssetUrl,
  restrictedMarker,
  userbotItemPriceSummary,
  userbotLotKindLabel,
  userbotPurchaseAmountSummary
} from './bots/bots-accounts.utils.js';
import { useBotsAccountsDerivedState } from './bots/useBotsAccountsDerivedState.js';
import { useLiveUserbotsController } from './bots/useLiveUserbotsController.js';
import { useShopStorefront } from '../features/shop-storefront/useShopStorefront.js';

// Витрина аккаунтов юзербот-режима (план 2026-09-26-userbot-product-split,
// Фаза 3): покупка аккаунта (UserbotStorefrontSection) и центр управления
// (с чтением handoff-ключа bullgram_userbot_center_handoff и query
// ?tg_user_id= / ?userbot_id=). Покупка показывается всем ролям. Онбординг
// подключения и лоты продавца/платформы переехали на /connect (ConnectPage).
// Official-режим остался в paywall-кабине (/app/sales-bot).

function showUiMessage(text, tone = 'default') {
  if (tone === 'success') return toast.success(text);
  if (tone === 'error') return toast.error(text);
  return toast(text);
}

function userbotBatchTitleFor(count, firstItem) {
  if (firstItem?.item_type === 'bundle') return `Аккаунты + прокси x${count}`;
  return `Аккаунты x${count}`;
}

// Shared inventory data lives in hooks; page still owns userbot mutations and selection sync.
function UserbotsPageContent() {
  const { accessToken, user, profilePlan } = useAuth();
  const [searchParams] = useSearchParams();
  const [selectedLiveUserbotId, setSelectedLiveUserbotId] = useState('');
  const { state, setState, reloadAccounts, patchLiveUserbot } = useBotsAccountsData({
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

  const {
    bundledUserbotLot,
    bundledUserbotLots,
    canSellUserbotAssets,
    liveUserbots,
    openUserbotPurchases,
    selectedLiveUserbot,
    usedUserbotProxyIds,
    userbots
  } = useBotsAccountsDerivedState({
    state,
    storefrontState,
    selectedLiveUserbotId,
    selectedShopUserbotId: '',
    selectedOpenPurchaseId,
    profilePlan
  });

  const {
    accountBindingFeedback,
    accountCheckReport,
    accountDeleteFeedback,
    accountRestoreFeedback,
    availableBindingProxiesForAccount,
    availableFailoverProxiesForAccount,
    bindings,
    checkAccount,
    deleteAccount,
    openSaleComposer,
    resetSaleComposer,
    restoreAccount,
    saleComposer,
    saveBinding,
    saveUserbotSaleLot,
    setSaleComposer,
    toggleSafeMode,
    toggleSalePaymentMethod,
    updateBinding
  } = useLiveUserbotsController({
    accessToken,
    patchLiveUserbot,
    reloadAccounts,
    setState,
    state,
    usedUserbotProxyIds,
    userbots,
    showUiMessage
  });

  useEffect(() => {
    if (!liveUserbots.length) {
      setSelectedLiveUserbotId('');
      return;
    }

    setSelectedLiveUserbotId((prev) => {
      if (prev && liveUserbots.some((account) => String(account.id) === String(prev))) {
        return prev;
      }
      return String(liveUserbots[0].id);
    });
  }, [liveUserbots]);

  useEffect(() => {
    const ubId = searchParams.get('userbot_id');
    if (!ubId) return;
    if (ubId !== selectedLiveUserbotId && liveUserbots.some((account) => String(account.id) === String(ubId))) {
      setSelectedLiveUserbotId(ubId);
    }
  }, [searchParams, liveUserbots, selectedLiveUserbotId]);

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

  const userbotCenterSectionProps = {
    selectedLiveUserbot,
    selectedLiveUserbotId,
    binding: bindings[selectedLiveUserbotId] || (selectedLiveUserbot ? {
      proxy_id: selectedLiveUserbot.proxy_id ? String(selectedLiveUserbot.proxy_id) : '',
      allow_proxy_failover: !!selectedLiveUserbot.allow_proxy_failover,
      failover_proxy_ids: Array.isArray(selectedLiveUserbot.failover_proxy_ids)
        ? selectedLiveUserbot.failover_proxy_ids.map(String)
        : []
    } : null),
    recovery: state.recoveryMap[String(selectedLiveUserbotId)] || null,
    accountCheckReport,
    accountBindingFeedback,
    accountRestoreFeedback,
    bindingAccountId: state.bindingAccountId,
    checkingAccountId: state.checkingAccountId,
    togglingSafeModeId: state.togglingSafeModeId,
    restoringAccountId: state.restoringAccountId,
    saveBinding,
    updateBinding,
    checkAccount,
    toggleSafeMode,
    restoreAccount,
    patchLiveUserbot,
    proxyLabel,
    availableBindingProxiesForAccount,
    availableFailoverProxiesForAccount,
    canRestoreFromFiles,
    defaultCheckLines,
    formatWhen,
    liveUserbots,
    setSelectedLiveUserbotId,
    deleteAccount,
    deletingAccountId: state.deletingAccountId,
    restrictedMarker,
    recoveryStatusBadge,
    canSellUserbotAssets,
    saleComposer,
    setSaleComposer,
    saveUserbotSaleLot,
    toggleSalePaymentMethod,
    openSaleComposer
  };

  if (state.loading) {
    return <LoadingState text="Тянем ботов, прокси и failover..." />;
  }

  if (state.error) {
    return (
      <section className="page page--flush">
        <div className="page__header">
          <h1>Юзерботы</h1>
          <p>Экран собран, но загрузка аккаунтов вернула ошибку.</p>
        </div>
        <div className="error-card">{state.error}</div>
      </section>
    );
  }

  return (
    <section className="page page--flush">
      <UserbotStorefrontSection {...buyerStorefrontSectionProps} />

      <UserbotCenterSection {...userbotCenterSectionProps} />
    </section>
  );
}

export default function UserbotsPage() {
  return <UserbotsPageContent />;
}
