import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { LoadingState } from '../ui/LoadingState.jsx';
import { OfficialBotsSection } from './bots/OfficialBotsSection.jsx';
import { ListedShopUserbotsSection } from './bots/ListedShopUserbotsSection.jsx';
import { UserbotOnboardingSection } from './bots/UserbotOnboardingSection.jsx';
import { UserbotStorefrontSection } from './bots/UserbotStorefrontSection.jsx';
import { UserbotCenterSection } from './bots/UserbotCenterSection.jsx';
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

function showUiMessage(text, tone = 'default') {
  if (tone === 'success') return toast.success(text);
  if (tone === 'error') return toast.error(text);
  return toast(text);
}

const CONTOUR_ROLE_LABELS = {
  public_channel_id: 'Открытый канал',
  paid_channel_id: 'Закрытый канал',
  public_chat_id: 'Открытый чат',
  paid_chat_id: 'Закрытый чат'
};

// Shared inventory data lives in hooks; page still owns userbot mutations and selection sync outside official-bot slice.
function BotsAccountsPageContent({ mode = 'userbots' }) {
  const { accessToken, user, profilePlan, profileRole } = useAuth();
  const [searchParams] = useSearchParams();
  const [selectedLiveUserbotId, setSelectedLiveUserbotId] = useState('');
  const [selectedShopUserbotId, setSelectedShopUserbotId] = useState('');
  const [refreshingTelegramPlaceId, setRefreshingTelegramPlaceId] = useState('');
  const { state, setState, reloadAccounts, patchLiveUserbot } = useBotsAccountsData({
    accessToken,
    ownerId: user?.id
  });

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
    addingBotAdmin,
    botAdminDrafts,
    botAdmins,
    botAdminsLoading,
    botForm,
    handleAddBotAdmin,
    handleRemoveBotAdmin,
    handleRegenerateBotAdminInvite,
    inviteLink,
    newAdminTgId,
    officialBots,
    refreshOfficialBotWebhookStatus,
    regeneratingInvite,
    reregisterWebhook,
    saveBotAdmin,
    selectedOfficialBot,
    selectedOfficialBotId,
    setBotAdminDrafts,
    setBotForm,
    setNewAdminTgId,
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
    if (!window.confirm(`Удалить ${placeTitle} из Bullgram? В Telegram это ничего не удалит.`)) return;

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
      const data = await apiRequest(`/api/official-bot/channels/${placeId}/refresh`, {
        accessToken,
        method: 'POST'
      });
      await reloadAccounts();
      const change = data?.contourChange;
      if (change && change.from && change.to) {
        const from = CONTOUR_ROLE_LABELS[change.from] || change.from;
        const to = CONTOUR_ROLE_LABELS[change.to] || change.to;
        if (change.displacedChannelId) {
          showUiMessage(`Канал перенесён из «${from}» в «${to}». Предыдущий канал из «${to}» перемещён в свободные площадки.`, 'success');
        } else {
          showUiMessage(`Канал автоматически перенесён из «${from}» в «${to}».`, 'success');
        }
      } else {
        showUiMessage('Информация о Telegram-площадке обновлена.', 'success');
      }
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
    patchLiveUserbot,
    reloadAccounts,
    setState,
    state,
    usedUserbotProxyIds,
    userbots,
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
    refreshOfficialBotWebhookStatus,
    reregisterWebhook,
    channelsByBotId,
    deleteTelegramPlace,
    refreshTelegramPlaceInfo,
    refreshingTelegramPlaceId,
    salesContourSectionProps,
    addingBotAdmin,
    botAdmins,
    botAdminsLoading,
    handleAddBotAdmin,
    handleRemoveBotAdmin,
    handleRegenerateBotAdminInvite,
    inviteLink,
    newAdminTgId,
    regeneratingInvite,
    setNewAdminTgId,
    ownerId: user?.id
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

  const listedShopUserbotsSectionProps = {
    deleteShopItem,
    formatWhen,
    listedShopUserbots,
    restrictedMarker,
    selectedShopUserbot,
    setSelectedShopUserbotId,
    state
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
      {isOfficialMode ? (
        <OfficialBotsSection {...officialBotsSectionProps} />
      ) : (
        <>
          {profileRole === 'admin' && <UserbotStorefrontSection {...buyerStorefrontSectionProps} />}

          <UserbotOnboardingSection
            {...onboardingSectionCommonProps}
            steps={{ proxy: 1, connect: 2, fingerprint: 3, authFiles: 3, authQr: 4 }}
          />

          {canSellUserbotAssets ? (
            <ListedShopUserbotsSection {...listedShopUserbotsSectionProps} />
          ) : null}

          <UserbotCenterSection {...userbotCenterSectionProps} />
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
