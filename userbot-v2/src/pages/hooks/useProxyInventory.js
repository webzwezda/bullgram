import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from '../../api/client.js';
import {
  showUiMessage,
  proxyBatchTitleFor,
  buildServerProxyName,
  proxyHealthMode,
} from '../sections/proxyShared.js';
import { isProxyShopItem, isProxyPurchase } from '../../features/shop-storefront/ProxyStorefrontSection.jsx';
import { useShopStorefront } from '../../features/shop-storefront/useShopStorefront.js';

export function useProxyInventory({ accessToken, profilePlan }) {
  const [filter, setFilter] = useState('all');
  const [selectedLane, setSelectedLane] = useState('self-use');
  const [formState, setFormState] = useState({
    name: '',
    host: '',
    port: '1080',
    username: '',
    password: '',
    inventory_group: 'self_use'
  });
  const [checkingIds, setCheckingIds] = useState(() => new Set());
  // Инлайн-подтверждение удаления: id прокси, у которого кнопка уже «Точно удалить?»
  const [armedDeleteId, setArmedDeleteId] = useState('');
  const [state, setState] = useState({
    loading: true,
    refreshing: false,
    saving: false,
    movingProxyId: '',
    error: '',
    proxies: [],
    support: null,
    updatedAt: null
  });
  // Защита от гонок по прецеденту CustomersPage: ответ поллинга, пришедший позже
  // свежей загрузки (например, после действия над строкой), не должен
  // перезаписывать свежий стейт.
  const proxiesReqIdRef = useRef(0);

  const reloadProxies = useCallback(async ({ silent = false } = {}) => {
    if (!accessToken) return;
    const reqId = ++proxiesReqIdRef.current;

    if (!silent) {
      setState((prev) => ({
        ...prev,
        loading: !prev.updatedAt,
        refreshing: !!prev.updatedAt,
        error: ''
      }));
    }

    try {
      const data = await apiRequest('/api/userbot/proxies', { accessToken });
      if (reqId !== proxiesReqIdRef.current) return;
      setState((prev) => ({
        ...prev,
        loading: false,
        refreshing: false,
        error: '',
        proxies: data.proxies || [],
        support: data.support || null,
        updatedAt: new Date().toISOString()
      }));
    } catch (error) {
      if (reqId !== proxiesReqIdRef.current) return;
      // Ошибка одного фонового полла не должна стирать список — сохраняем
      // предыдущие proxies/support и показываем только статус ошибки.
      setState((prev) => ({
        ...prev,
        loading: false,
        refreshing: false,
        error: error.message
      }));
    }
  }, [accessToken]);
  const [sellerItems, setSellerItems] = useState([]);
  const [bulkCount, setBulkCount] = useState('1');
  const [externalProxyMode, setExternalProxyMode] = useState(false);
  const [raisePriceTon, setRaisePriceTon] = useState('');
  const hasPendingProxyChecks = state.proxies.some((proxy) => {
    const mode = proxyHealthMode(proxy);
    return mode === 'checking' || mode === 'warming_up';
  });

  const {
    buyQuantities,
    cancelCheckout,
    checkPurchase,
    checkoutState,
    createBatchCheckout,
    openCheckout,
    refreshPurchases,
    setBuyQuantities,
    setCheckoutState,
    setSelectedOpenPurchaseId,
    showPurchaseInline,
    storefrontState
  } = useShopStorefront({
    accessToken,
    profileRole: state.support?.profile_role,
    showUiMessage,
    isShopItem: isProxyShopItem,
    isPurchase: isProxyPurchase,
    batchTitleFor: proxyBatchTitleFor,
    onAssetsChanged: reloadProxies
  });

  useEffect(() => {
    if (!accessToken) return undefined;

    reloadProxies();

    const refreshIntervalMs = hasPendingProxyChecks ? 10_000 : 60_000;
    const intervalId = window.setInterval(() => {
      reloadProxies({ silent: true });
    }, refreshIntervalMs);

    return () => window.clearInterval(intervalId);
  }, [accessToken, hasPendingProxyChecks, reloadProxies]);

  const isAdmin = state.support?.profile_role === 'admin';

  const loadSellerItems = useCallback(async () => {
    if (!(accessToken && isAdmin)) {
      setSellerItems([]);
      return;
    }
    try {
      const data = await apiRequest('/api/shop/seller/items', { accessToken });
      setSellerItems(data?.items || []);
    } catch {
      setSellerItems([]);
    }
  }, [accessToken, isAdmin]);

  useEffect(() => {
    loadSellerItems();
  }, [loadSellerItems]);

  function matchesStatusFilter(proxy) {
    if (filter === 'working') {
      return proxy.is_working === true;
    }
    if (filter === 'broken') {
      return proxy.is_working === false;
    }
    if (filter === 'shared_proxy') {
      return Number(proxy.userbot_count || 0) > 1;
    }
    if (filter === 'manual_free') {
      return ['manual_free', 'manual_trial'].includes(proxy.provision_source || 'manual_free');
    }
    if (filter === 'purchased') {
      return proxy.provision_source === 'purchased';
    }
    return true;
  }

  function getVisibleProxies() {
    if (selectedLane === 'sold') {
      return { items: soldProxyItems, isSold: true };
    }

    let baseArray;
    switch (selectedLane) {
      case 'self-use':
        baseArray = selfUseProxies;
        break;
      case 'on-sale':
        baseArray = shopSaleProxies;
        break;
      case 'purchased-given':
        baseArray = nonAdminInventoryProxies;
        break;
      default:
        baseArray = [];
    }

    return { items: baseArray, isSold: false };
  }

  // Лейны и фильтры считаем только при смене списка/фильтра, а не на каждый
  // рендер: список не пагинируется до фильтрации, проходов пять.
  // matchesStatusFilter читает только state filter — его и берём в зависимости.
  const {
    filteredProxies,
    selfUseProxies,
    shopSaleProxies,
    nonAdminInventoryProxies
  } = useMemo(() => {
    const filtered = state.proxies.filter(matchesStatusFilter);
    const adminInventory = filtered.filter((proxy) => proxy.provision_source === 'manual_admin');
    return {
      filteredProxies: filtered,
      selfUseProxies: adminInventory.filter((proxy) => (proxy.inventory_group || 'shop_sale') === 'self_use'),
      shopSaleProxies: adminInventory.filter((proxy) => (proxy.inventory_group || 'shop_sale') === 'shop_sale'),
      nonAdminInventoryProxies: filtered.filter((proxy) => proxy.provision_source !== 'manual_admin')
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.proxies, filter]);
  const shopOfferItems = useMemo(() => (storefrontState.items || []).slice(0, 6), [storefrontState.items]);
  const sellerProxyItemMap = useMemo(() => {
    const map = new Map();
    for (const item of sellerItems) {
      for (const asset of item.assets || []) {
        if (asset.asset_type !== 'proxy') continue;
        const key = String(asset.asset_id);
        const bucket = map.get(key) || [];
        bucket.push(item);
        map.set(key, bucket);
      }
    }
    return map;
  }, [sellerItems]);
  const soldProxyItems = useMemo(() => (
    sellerItems.filter((item) =>
      item.status === 'sold' && (item.assets || []).some((asset) => asset.asset_type === 'proxy')
    )
  ), [sellerItems]);
  const saleProxies = useMemo(() => {
    const listedProxyIds = new Set();
    for (const item of sellerItems) {
      if (item.status === 'sold') continue;
      for (const asset of item.assets || []) {
        if (asset.asset_type === 'proxy' && asset.asset_id) listedProxyIds.add(String(asset.asset_id));
      }
    }
    return shopSaleProxies.filter((proxy) => !listedProxyIds.has(String(proxy.id)));
  }, [sellerItems, shopSaleProxies]);
  const manualQuotaText = !state.support
    ? null
    : state.support.profile_role === 'admin'
      ? null
      : (() => {
          const total = Number(state.support.owned_proxy_quota_total || 0);
          const used = Number(state.support.owned_proxy_quota_used || 0);
          if (!total) return null;
          if (profilePlan === 'trial') {
            return `На Trial: ${used}/${total} свой proxy. Дальше либо покупай прокси, либо переходи на Pro.`;
          }
          return `Своих proxy: ${used}/${total}.`;
        })();

  const canCreateManualProxy = !!state.support?.can_create_manual_proxy;
  const canEditProxy = state.support?.profile_role === 'admin';
  const showQuotaLock = state.support?.profile_role !== 'admin' && !canCreateManualProxy;
  const isAdminCreate = state.support?.profile_role === 'admin';
  const serverProxyMode = isAdminCreate && !externalProxyMode;
  const serverBatchCount = Math.min(Math.max(Number.parseInt(bulkCount, 10) || 1, 1), 100);
  const proxyBuyLimit = useMemo(() => {
    if (!shopOfferItems.length) return 1;
    if (state.support?.profile_role === 'admin') return shopOfferItems.length;
    if (profilePlan !== 'trial') return shopOfferItems.length;
    return Math.max(0, Math.min(shopOfferItems.length, 1 - state.proxies.length));
  }, [shopOfferItems, profilePlan, state.proxies.length, state.support?.profile_role]);

  const suggestedServerProxyName = useMemo(() => {
    return buildServerProxyName(
      state.proxies
        .filter((proxy) => proxy.provision_source === 'manual_admin')
        .map((proxy) => proxy.name)
    );
  }, [state.proxies]);

  useEffect(() => {
    if (state.support?.profile_role !== 'admin') return;

    setFormState((prev) => {
      if (prev.name.trim()) return prev;
      return {
        ...prev,
        name: buildServerProxyName(
          state.proxies
            .filter((proxy) => proxy.provision_source === 'manual_admin')
            .map((proxy) => proxy.name)
        )
      };
    });
  }, [state.proxies, state.support?.profile_role]);
  return {
    filter,
    setFilter,
    selectedLane,
    setSelectedLane,
    formState,
    setFormState,
    checkingIds,
    setCheckingIds,
    armedDeleteId,
    setArmedDeleteId,
    state,
    setState,
    proxiesReqIdRef,
    reloadProxies,
    bulkCount,
    setBulkCount,
    externalProxyMode,
    setExternalProxyMode,
    raisePriceTon,
    setRaisePriceTon,
    isAdmin,
    loadSellerItems,
    getVisibleProxies,
    filteredProxies,
    sellerProxyItemMap,
    manualQuotaText,
    showQuotaLock,
    isAdminCreate,
    serverProxyMode,
    serverBatchCount,
    proxyBuyLimit,
    suggestedServerProxyName,
    saleProxies,
    buyQuantities,
    cancelCheckout,
    checkPurchase,
    checkoutState,
    createBatchCheckout,
    openCheckout,
    refreshPurchases,
    setBuyQuantities,
    setCheckoutState,
    setSelectedOpenPurchaseId,
    showPurchaseInline,
    storefrontState,
    canEditProxy,
  };
}
