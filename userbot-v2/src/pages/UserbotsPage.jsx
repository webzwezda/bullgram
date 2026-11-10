import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { LoadingState } from '../ui/LoadingState.jsx';
import { UserbotCenterSection } from './bots/UserbotCenterSection.jsx';
import { SessionsQuarantineSection } from './bots/SessionsQuarantineSection.jsx';
import { OpenPurchasesSlimRow, ShopInlineRow } from './bots/ShopInlineRow.jsx';
import { useBotsAccountsData } from './bots/useBotsAccountsData.js';
import {
  canRestoreFromFiles,
  defaultCheckLines,
  formatWhen,
  isUserbotPurchase,
  isUserbotShopItem,
  proxyLabel,
  restrictedMarker,
  recoveryStatusBadge
} from './bots/bots-accounts.utils.js';
import { useBotsAccountsDerivedState } from './bots/useBotsAccountsDerivedState.js';
import { useLiveUserbotsController } from './bots/useLiveUserbotsController.js';
import { useShopStorefront } from '../features/shop-storefront/useShopStorefront.js';

// Витрина аккаунтов юзербот-режима: магазин ужат до одной строки в шапке
// основной карточки (план 2026-11-11-userbot-shop-inline-row.md), оплата —
// редирект на страницу счёта /pay/:id. Центр управления читает handoff-ключ
// bullgram_userbot_center_handoff и query ?tg_user_id= / ?userbot_id=.
// Онбординг подключения и лоты продавца/платформы живут на /connect.
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
  const [selectedQuarantinedUserbotId, setSelectedQuarantinedUserbotId] = useState('');
  const { state, setState, reloadAccounts, patchLiveUserbot } = useBotsAccountsData({
    accessToken,
    ownerId: user?.id
  });

  const {
    openCheckout,
    createBatchCheckout,
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
    accountOnlyUserbotLots,
    availableOnboardingProxies,
    bundledUserbotLots,
    canSellUserbotAssets,
    liveUserbots,
    openUserbotPurchases,
    quarantinedUserbots,
    selectedLiveUserbot,
    selectedQuarantinedUserbot,
    usedUserbotProxyIds,
    userbots
  } = useBotsAccountsDerivedState({
    state,
    storefrontState,
    selectedLiveUserbotId,
    selectedShopUserbotId: '',
    selectedQuarantinedUserbotId,
    selectedOpenPurchaseId: '',
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

  // Один магазин — одна полка: комплекты (флагман) плюс одиночные лоты
  // (account/userbot). Прокси живут на своей витрине /userbot/proxies.
  const storefrontLots = useMemo(
    () => [...bundledUserbotLots, ...accountOnlyUserbotLots],
    [bundledUserbotLots, accountOnlyUserbotLots]
  );

  // Магазин одной строкой в шапке CenterAccountCard + slim-строка неоплаченных
  // покупок (оплата/отмена — на странице счёта /pay).
  const shopInlineSlot = storefrontLots.length || openUserbotPurchases.length ? (
    <div className="flex flex-col gap-2">
      <OpenPurchasesSlimRow groups={openUserbotPurchases} />
      {storefrontLots.length ? (
        <ShopInlineRow
          lot={storefrontLots[0]}
          lots={storefrontLots}
          openCheckout={openCheckout}
          createBatchCheckout={createBatchCheckout}
        />
      ) : null}
    </div>
  ) : null;

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
    availableOnboardingProxies,
    availableBindingProxiesForAccount,
    availableFailoverProxiesForAccount,
    canRestoreFromFiles,
    defaultCheckLines,
    formatWhen,
    liveUserbots,
    reloadAccounts,
    setSelectedLiveUserbotId,
    userbotCount: userbots.length,
    deleteAccount,
    deletingAccountId: state.deletingAccountId,
    restrictedMarker,
    recoveryStatusBadge
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
      <UserbotCenterSection {...userbotCenterSectionProps} shopInlineSlot={shopInlineSlot} />

      <SessionsQuarantineSection
        accessToken={accessToken}
        selectedLiveUserbotId={selectedLiveUserbotId}
        quarantinedUserbots={quarantinedUserbots}
        selectedQuarantinedUserbot={selectedQuarantinedUserbot}
        setSelectedQuarantinedUserbotId={setSelectedQuarantinedUserbotId}
        restrictedMarker={restrictedMarker}
        formatWhen={formatWhen}
        checkAccount={checkAccount}
        checkingAccountId={state.checkingAccountId}
        deleteAccount={deleteAccount}
        deletingAccountId={state.deletingAccountId}
      />
    </section>
  );
}

export default function UserbotsPage() {
  return <UserbotsPageContent />;
}
