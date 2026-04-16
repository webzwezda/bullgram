import { useMemo } from 'react';
import { getProductTierRules } from '../../app/productTier.js';
import {
  isOpenUserbotPurchase,
  isUserbotShopItem,
  normalizeOpenUserbotPurchaseGroup
} from './bots-accounts.utils.js';

export function useBotsAccountsDerivedState({
  state,
  storefrontState,
  selectedLiveUserbotId,
  selectedShopUserbotId,
  selectedOpenPurchaseId,
  profilePlan
}) {
  const userbots = useMemo(() => {
    return state.accounts.filter((account) => account.account_type === 'userbot');
  }, [state.accounts]);

  const channelsByBotId = useMemo(() => {
    return (state.channels || []).reduce((acc, channel) => {
      const key = String(channel.bot_id || '').trim();
      if (!key) return acc;
      if (!acc[key]) acc[key] = [];
      acc[key].push(channel);
      return acc;
    }, {});
  }, [state.channels]);

  const listedShopUserbots = useMemo(() => {
    return userbots.filter((account) => state.reservedUserbotIds.includes(String(account.id)));
  }, [state.reservedUserbotIds, userbots]);

  const liveUserbots = useMemo(() => {
    return userbots.filter((account) => !state.reservedUserbotIds.includes(String(account.id)));
  }, [state.reservedUserbotIds, userbots]);

  const selectedLiveUserbot = useMemo(() => {
    if (!liveUserbots.length) return null;
    return liveUserbots.find((account) => String(account.id) === String(selectedLiveUserbotId)) || liveUserbots[0];
  }, [liveUserbots, selectedLiveUserbotId]);

  const selectedShopUserbot = useMemo(() => {
    if (!listedShopUserbots.length) return null;
    return listedShopUserbots.find((account) => String(account.id) === String(selectedShopUserbotId)) || listedShopUserbots[0];
  }, [listedShopUserbots, selectedShopUserbotId]);

  const planRules = useMemo(() => getProductTierRules(profilePlan), [profilePlan]);

  const deadProxyUserbots = useMemo(() => {
    return liveUserbots.filter((account) => {
      if (!account.proxy_id) return true;
      const proxy = state.proxies.find((item) => String(item.id) === String(account.proxy_id));
      return proxy?.is_working === false;
    });
  }, [liveUserbots, state.proxies]);

  const usedUserbotProxyIds = useMemo(() => {
    return new Set(
      userbots
        .map((account) => String(account.proxy_id || ''))
        .filter(Boolean)
    );
  }, [userbots]);

  const availableOnboardingProxies = useMemo(() => {
    return state.proxies.filter((proxy) => {
      if (proxy.is_working === false) return false;
      if (state.proxySupport?.profile_role !== 'admin') return true;
      if (proxy.inventory_group !== 'self_use') return false;
      return !usedUserbotProxyIds.has(String(proxy.id));
    });
  }, [state.proxies, state.proxySupport?.profile_role, usedUserbotProxyIds]);

  const purchasedFreeProxies = useMemo(() => {
    return state.proxies.filter((proxy) => proxy.provision_source === 'purchased' && Number(proxy.userbot_count || 0) === 0);
  }, [state.proxies]);

  const selfUseProxies = useMemo(() => {
    if (state.proxySupport?.profile_role !== 'admin') return state.proxies;
    return state.proxies.filter((proxy) => proxy.inventory_group === 'self_use');
  }, [state.proxies, state.proxySupport?.profile_role]);

  const brokenSelfUseProxies = useMemo(() => {
    return selfUseProxies.filter((proxy) => proxy.is_working === false);
  }, [selfUseProxies]);

  const canSellUserbotAssets = state.proxySupport?.profile_role === 'admin';

  const openUserbotPurchases = useMemo(() => {
    const rows = (storefrontState.purchases || []).filter(isOpenUserbotPurchase);
    const grouped = new Map();
    for (const purchase of rows) {
      const key = purchase.payload?.batch_token || purchase.id;
      const bucket = grouped.get(key) || [];
      bucket.push(purchase);
      grouped.set(key, bucket);
    }
    return Array.from(grouped.values()).map((bucket) => normalizeOpenUserbotPurchaseGroup(bucket)).filter(Boolean);
  }, [storefrontState.purchases]);

  const selectedOpenPurchase = useMemo(() => {
    if (!openUserbotPurchases.length) return null;
    return openUserbotPurchases.find((purchase) => String(purchase.id) === String(selectedOpenPurchaseId)) || openUserbotPurchases[0];
  }, [openUserbotPurchases, selectedOpenPurchaseId]);

  const visibleUserbotLots = useMemo(() => {
    return (storefrontState.items || []).filter(isUserbotShopItem);
  }, [storefrontState.items]);

  const accountOnlyUserbotLots = useMemo(
    () => visibleUserbotLots.filter((item) => item?.item_type !== 'bundle'),
    [visibleUserbotLots]
  );

  const bundledUserbotLots = useMemo(
    () => visibleUserbotLots.filter((item) => item?.item_type === 'bundle'),
    [visibleUserbotLots]
  );

  const accountOnlyUserbotLot = useMemo(
    () => accountOnlyUserbotLots[0] || null,
    [accountOnlyUserbotLots]
  );

  const bundledUserbotLot = useMemo(
    () => bundledUserbotLots[0] || null,
    [bundledUserbotLots]
  );

  return {
    accountOnlyUserbotLot,
    accountOnlyUserbotLots,
    availableOnboardingProxies,
    brokenSelfUseProxies,
    bundledUserbotLot,
    bundledUserbotLots,
    canSellUserbotAssets,
    channelsByBotId,
    deadProxyUserbots,
    liveUserbots,
    listedShopUserbots,
    openUserbotPurchases,
    planRules,
    purchasedFreeProxies,
    selectedLiveUserbot,
    selectedOpenPurchase,
    selectedShopUserbot,
    selfUseProxies,
    usedUserbotProxyIds,
    userbots,
    visibleUserbotLots
  };
}
