import { useEffect, useState } from 'react';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { LoadingState } from '../ui/LoadingState.jsx';
import { LiveUserbotsSection } from './bots/LiveUserbotsSection.jsx';
import { OfficialBotsSection } from './bots/OfficialBotsSection.jsx';
import { ListedShopUserbotsSection } from './bots/ListedShopUserbotsSection.jsx';
import { UserbotOnboardingSection } from './bots/UserbotOnboardingSection.jsx';
import { UserbotStorefrontSection } from './bots/UserbotStorefrontSection.jsx';
import { useBotsAccountsData } from './bots/useBotsAccountsData.js';
import {
  batchUserbotLotPaymentMethods,
  canRestoreFromFiles,
  defaultCheckLines,
  formatWhen,
  paymentMethodLabel,
  proxyLabel,
  purchaseStatusMeta,
  recoveryStatusBadge,
  resolveBackendAssetUrl,
  restrictedMarker,
  userbotItemPriceSummary,
  userbotLotKindLabel,
  userbotLotPaymentMethods,
  userbotPurchaseAmountSummary
} from './bots/bots-accounts.utils.js';
import { useBotsAccountsDerivedState } from './bots/useBotsAccountsDerivedState.js';
import { useListedShopUserbotsController } from './bots/useListedShopUserbotsController.js';
import { useLiveUserbotsController } from './bots/useLiveUserbotsController.js';
import { useOfficialBotsController } from './bots/useOfficialBotsController.js';
import { useSalesContourController } from './bots/useSalesContourController.js';
import { useUserbotOnboarding } from './bots/useUserbotOnboarding.js';
import { useUserbotStorefront } from './bots/useUserbotStorefront.js';

// Shared inventory data lives in hooks; page still owns userbot mutations and selection sync outside official-bot slice.
function BotsAccountsPageContent({ mode = 'userbots' }) {
  const { accessToken, user, profilePlan } = useAuth();
  const [uiMessage, setUiMessage] = useState({ tone: 'default', text: '' });
  const [selectedLiveUserbotId, setSelectedLiveUserbotId] = useState('');
  const [selectedShopUserbotId, setSelectedShopUserbotId] = useState('');
  const [refreshingTelegramPlaceId, setRefreshingTelegramPlaceId] = useState('');
  const { state, setState, reloadAccounts } = useBotsAccountsData({
    accessToken,
    ownerId: user?.id
  });

  function showUiMessage(text, tone = 'default') {
    setUiMessage({ tone, text });
  }

  const {
    cancelUserbotCheckout,
    checkUserbotCheckout,
    checkoutState,
    createUserbotBatchCheckout,
    markUserbotCheckoutPaid,
    openUserbotCheckout,
    receiptNote,
    selectedOpenPurchaseId,
    setCheckoutState,
    setReceiptFile,
    setReceiptNote,
    setSelectedOpenPurchaseId,
    setUserbotBuyQuantity,
    showUserbotPurchaseInline,
    storefrontState,
    userbotBuyQuantity
  } = useUserbotStorefront({
    accessToken,
    profileRole: state.proxySupport?.profile_role,
    showUiMessage
  });

  const {
    accountOnlyUserbotLot,
    accountOnlyUserbotLots,
    availableOnboardingProxies,
    bundledUserbotLot,
    bundledUserbotLots,
    canSellUserbotAssets,
    channelsByBotId,
    liveUserbots,
    listedShopUserbots,
    openUserbotPurchases,
    planRules,
    selectedLiveUserbot,
    selectedOpenPurchase,
    selectedShopUserbot,
    usedUserbotProxyIds,
    userbots
  } = useBotsAccountsDerivedState({
    state,
    storefrontState,
    selectedLiveUserbotId,
    selectedShopUserbotId,
    selectedOpenPurchaseId,
    profilePlan
  });

  const {
    addOfficialBot,
    botAdminDrafts,
    botForm,
    officialBots,
    refreshOfficialBotWebhookStatus,
    saveBotAdmin,
    saveBotKind,
    selectedOfficialBot,
    selectedOfficialBotId,
    setBotAdminDrafts,
    setBotForm,
    setSelectedOfficialBotId
  } = useOfficialBotsController({
    accessToken,
    accounts: state.accounts,
    paymentAdminTgId: state.paymentAdminTgId,
    reloadAccounts,
    setState,
    showUiMessage
  });

  const salesContourSectionProps = useSalesContourController({
    accessToken,
    accounts: state.accounts,
    proxies: state.proxies,
    reservedUserbotIds: state.reservedUserbotIds,
    channelsByBotId,
    officialBotContoursPayload: state.officialBotContoursPayload,
    officialBotContoursError: state.officialBotContoursError,
    reloadAccounts,
    selectedOfficialBot,
    state,
    setState,
    showUiMessage
  });

  async function deleteTelegramPlace(place) {
    const placeId = String(place?.id || '').trim();
    if (!placeId) return;
    const placeTitle = String(place?.title || place?.tg_chat_id || 'Telegram-площадку');
    if (!window.confirm(`Удалить ${placeTitle} из BullRun? В Telegram это ничего не удалит.`)) return;

    try {
      await apiRequest(`/api/official-bot/channels/${placeId}`, {
        accessToken,
        method: 'DELETE'
      });
      await reloadAccounts();
    } catch (error) {
      showUiMessage(error.message, 'error');
    }
  }

  async function refreshTelegramPlaceInfo(place) {
    const placeId = String(place?.id || '').trim();
    if (!placeId) return;

    setRefreshingTelegramPlaceId(placeId);
    try {
      await apiRequest(`/api/official-bot/channels/${placeId}/refresh`, {
        accessToken,
        method: 'POST'
      });
      await reloadAccounts();
      showUiMessage('Информация о Telegram-площадке обновлена.', 'success');
    } catch (error) {
      showUiMessage(error.message, 'error');
    } finally {
      setRefreshingTelegramPlaceId('');
    }
  }

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
    userbotCount: userbots.length,
    reloadAccounts,
    showUiMessage
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
    reloadAccounts,
    setState,
    state,
    usedUserbotProxyIds,
    userbots
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

  const officialBotsSectionProps = {
    botForm,
    setBotForm,
    state,
    addOfficialBot,
    selectedOfficialBot,
    selectedOfficialBotId,
    setSelectedOfficialBotId,
    officialBots,
    botAdminDrafts,
    setBotAdminDrafts,
    saveBotAdmin,
    saveBotKind,
    refreshOfficialBotWebhookStatus,
    channelsByBotId,
    deleteTelegramPlace,
    refreshTelegramPlaceInfo,
    refreshingTelegramPlaceId,
    salesContourSectionProps
  };

  const onboardingSectionCommonProps = {
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
    openUserbotPurchases,
    selectedOpenPurchase,
    selectedOpenPurchaseId,
    setSelectedOpenPurchaseId,
    showUserbotPurchaseInline,
    storefrontState,
    accountOnlyUserbotLot,
    accountOnlyUserbotLots,
    bundledUserbotLot,
    bundledUserbotLots,
    userbotBuyQuantity,
    setUserbotBuyQuantity,
    checkoutState,
    setCheckoutState,
    receiptNote,
    setReceiptNote,
    setReceiptFile,
    checkUserbotCheckout,
    cancelUserbotCheckout,
    markUserbotCheckoutPaid,
    createUserbotBatchCheckout,
    openUserbotCheckout,
    formatWhen,
    resolveBackendAssetUrl,
    userbotPurchaseAmountSummary,
    paymentMethodLabel,
    purchaseStatusMeta,
    userbotLotKindLabel,
    userbotLotPaymentMethods,
    batchUserbotLotPaymentMethods,
    userbotItemPriceSummary
  };

  const sellerLiveUserbotsSectionProps = {
    accountBindingFeedback,
    accountCheckReport,
    accountDeleteFeedback,
    accountRestoreFeedback,
    availableBindingProxiesForAccount,
    availableFailoverProxiesForAccount,
    bindings,
    canRestoreFromFiles,
    canSellUserbotAssets,
    checkAccount,
    defaultCheckLines,
    deleteAccount,
    formatWhen,
    liveUserbots,
    openSaleComposer,
    proxyLabel,
    recoveryStatusBadge,
    resetSaleComposer,
    restoreAccount,
    restrictedMarker,
    saleComposer,
    saveBinding,
    saveUserbotSaleLot,
    selectedLiveUserbot,
    setSaleComposer,
    setSelectedLiveUserbotId,
    state,
    toggleSafeMode,
    toggleSalePaymentMethod,
    updateBinding
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
    return <LoadingState text="Тянем ботов, прокси и failover..." />;
  }

  if (state.error) {
    return (
      <section className="page page--flush">
        <div className="page__header">
          <h1>Боты и аккаунты</h1>
          <p>Новый экран уже собран, но загрузка контуров вернула ошибку.</p>
        </div>
        <div className="error-card">{state.error}</div>
      </section>
    );
  }

  const isOfficialMode = mode === 'official-bots';

  return (
    <section className="page page--flush">
      {uiMessage.text ? (
        <div className={`userbots-status-note userbots-status-note--${uiMessage.tone || 'default'}`}>
          {uiMessage.text}
        </div>
      ) : null}

      {isOfficialMode ? (
        <OfficialBotsSection {...officialBotsSectionProps} />
      ) : !canSellUserbotAssets ? (
        <>
          <UserbotStorefrontSection {...buyerStorefrontSectionProps} />

          <UserbotOnboardingSection
            {...onboardingSectionCommonProps}
            steps={{ proxy: 1, connect: 3, fingerprint: 4, authFiles: 4, authQr: 5 }}
          />
        </>
      ) : (
        <>
          <UserbotOnboardingSection
            {...onboardingSectionCommonProps}
            steps={{ proxy: 1, connect: 2, fingerprint: 3, authFiles: 3, authQr: 4 }}
          />

          <LiveUserbotsSection {...sellerLiveUserbotsSectionProps} />

          <ListedShopUserbotsSection {...listedShopUserbotsSectionProps} />
        </>
      )}
    </section>
  );
}

export function UserbotAccountsPage() {
  return <BotsAccountsPageContent mode="userbots" />;
}

export function OfficialBotsPage() {
  return <BotsAccountsPageContent mode="official-bots" />;
}
