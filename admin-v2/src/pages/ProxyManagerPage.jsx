import { useCallback, useEffect, useMemo, useState } from 'react';
import { Globe, Server, Plus, ExternalLink, Filter } from 'lucide-react';
import { toast } from 'sonner';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { LoadingState } from '../ui/LoadingState.jsx';
import { ProxyStorefrontSection, isProxyShopItem, isProxyPurchase } from '../features/shop-storefront/ProxyStorefrontSection.jsx';
import { useShopStorefront } from '../features/shop-storefront/useShopStorefront.js';
import { ProxyComposerDialog } from './shop/ProxyComposerDialog.jsx';
import { INITIAL_PROXY_COMPOSER } from './shop/shop.utils.js';
import { AdminLotsSection } from '../components/shop/AdminLotsSection.jsx';

const ADMIN_PROXY_GROUPS = ['self_use', 'shop_sale'];

const LANE_OPTIONS = [
  { id: 'self-use', label: 'Свои' },
  { id: 'on-sale', label: 'На продаже' },
  { id: 'sold', label: 'Продано' }
];

function showUiMessage(text, tone = 'default') {
  if (tone === 'success') return toast.success(text);
  if (tone === 'error') return toast.error(text);
  return toast(text);
}

function proxyBatchTitleFor(count) {
  return `Прокси x${count}`;
}

function formatWhen(value) {
  if (!value) return 'Еще не проверялся';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Дата неизвестна';
  return date.toLocaleString('ru-RU');
}

function countryFlag(countryCode) {
  if (!countryCode || typeof countryCode !== 'string') return '';
  return countryCode
    .trim()
    .toUpperCase()
    .split('')
    .map((char) => String.fromCodePoint(127397 + char.charCodeAt(0)))
    .join('');
}

function proxyHealthMode(proxy) {
  if (proxy?.status === 'checking') return 'checking';
  if (proxy?.is_working == null && (proxy?.last_check_error || '').includes('фоновую проверку Telegram')) return 'warming_up';
  if (proxy?.is_working !== true) return proxy?.is_working === false ? 'broken' : 'unchecked';
  if (!proxy?.last_check_ip && !proxy?.last_check_country && !proxy?.last_check_city) {
    return 'telegram_only';
  }
  return 'full';
}

function proxyBadge(proxy) {
  const mode = proxyHealthMode(proxy);
  if (mode === 'checking') return { text: 'Проверяется', className: 'pill pill--warning' };
  if (mode === 'warming_up') return { text: 'Поднимается', className: 'pill pill--warning' };
  if (mode === 'telegram_only') return { text: 'Рабочий для Telegram', className: 'pill pill--ok' };
  if (mode === 'full') return { text: 'Работает', className: 'pill pill--ok' };
  if (mode === 'broken') return { text: 'Ошибка', className: 'pill pill--danger' };
  return { text: 'Не проверен', className: 'pill' };
}

function buildServerProxyName(inventoryGroup, existingNames = []) {
  const prefix = inventoryGroup === 'self_use' ? 'Прокси сервера' : 'Прокси для Shop';
  const normalized = new Set(existingNames.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean));
  let index = 1;
  while (normalized.has(`${prefix.toLowerCase()} ${index}`)) {
    index += 1;
  }
  return `${prefix} ${index}`;
}

function formatTon(value) {
  return Number(value || 0).toFixed(2);
}

function inventoryGroupActionLabel(value) {
  if (value === 'self_use') return 'Использую сам';
  return 'На продажу';
}

function proxyEgressSummary(proxy) {
  if (proxy?.ipv6) return `IPv6 ${proxy.ipv6}`;
  if (proxy?.last_check_ip) return proxy.last_check_ip;
  return 'IP не зафиксирован';
}

export function ProxyManagerPage() {
  const { accessToken, profilePlan } = useAuth();
  const [filter, setFilter] = useState('all');
  const [selectedLane, setSelectedLane] = useState('self-use');
  const [formState, setFormState] = useState({
    id: '',
    name: '',
    host: '',
    port: '1080',
    username: '',
    password: '',
    inventory_group: 'self_use'
  });
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
  const [sellerItems, setSellerItems] = useState([]);
  const [showProxyDialog, setShowProxyDialog] = useState(false);
  const [proxyComposer, setProxyComposer] = useState({ ...INITIAL_PROXY_COMPOSER });
  const hasPendingProxyChecks = state.proxies.some((proxy) => {
    const mode = proxyHealthMode(proxy);
    return mode === 'checking' || mode === 'warming_up';
  });

  const reloadProxies = useCallback(async ({ silent = false } = {}) => {
    if (!accessToken) return;
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
      setState({
        loading: false,
        refreshing: false,
        error: error.message,
        proxies: [],
        support: null,
        updatedAt: null
      });
    }
  }, [accessToken]);

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

  const filteredProxies = state.proxies.filter(matchesStatusFilter);
  const adminInventoryProxies = filteredProxies.filter((proxy) => proxy.provision_source === 'manual_admin');
  const selfUseProxies = adminInventoryProxies.filter((proxy) => (proxy.inventory_group || 'shop_sale') === 'self_use');
  const shopSaleProxies = adminInventoryProxies.filter((proxy) => (proxy.inventory_group || 'shop_sale') === 'shop_sale');
  const nonAdminInventoryProxies = filteredProxies.filter((proxy) => proxy.provision_source !== 'manual_admin');
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

  const resetProxyComposer = useCallback(() => {
    setProxyComposer({ ...INITIAL_PROXY_COMPOSER });
  }, []);

  const saveProxyComposer = useCallback(async () => {
    const proxy = saleProxies.find((p) => String(p.id) === String(proxyComposer.proxyId));
    if (!proxy) {
      setProxyComposer((prev) => ({ ...prev, error: 'Прокси не найден.' }));
      return;
    }
    setProxyComposer((prev) => ({ ...prev, saving: true, error: '' }));
    try {
      await apiRequest('/api/shop/seller/items', {
        accessToken,
        method: 'POST',
        body: {
          title: proxyComposer.title,
          description: proxyComposer.description,
          preview_text: proxyComposer.preview_text,
          payment_methods: proxyComposer.payment_methods,
          post_purchase_message: null,
          offer_code: null,
          item_type: 'proxy',
          sales_channel: proxyComposer.sales_channel,
          price_ton: Number(proxyComposer.price_ton || 0),
          status: proxyComposer.status,
          visibility: 'public',
          transfer_mode: 'ownership_transfer',
          assets: [{ asset_type: 'proxy', asset_id: proxy.id, label: proxy.name || `${proxy.host}:${proxy.port}` }]
        }
      });
      await loadSellerItems();
      resetProxyComposer();
      toast.success('Прокси выставлен на продажу');
    } catch (error) {
      setProxyComposer((prev) => ({ ...prev, saving: false, error: error.message }));
      toast.error(error.message);
    }
  }, [accessToken, loadSellerItems, proxyComposer, resetProxyComposer, saleProxies]);
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
  const showQuotaLock = !formState.id && state.support?.profile_role !== 'admin' && !canCreateManualProxy;
  const proxyBuyLimit = useMemo(() => {
    if (!shopOfferItems.length) return 1;
    if (state.support?.profile_role === 'admin') return shopOfferItems.length;
    if (profilePlan !== 'trial') return shopOfferItems.length;
    return Math.max(0, Math.min(shopOfferItems.length, 1 - state.proxies.length));
  }, [shopOfferItems, profilePlan, state.proxies.length, state.support?.profile_role]);

  const latestServerProxy = useMemo(() => {
    return state.proxies.find((proxy) => proxy.provision_source === 'manual_admin') || null;
  }, [state.proxies]);
  const suggestedServerProxyName = useMemo(() => {
    return buildServerProxyName(
      formState.inventory_group,
      state.proxies
        .filter((proxy) => proxy.provision_source === 'manual_admin')
        .map((proxy) => proxy.name)
    );
  }, [formState.inventory_group, state.proxies]);

  useEffect(() => {
    if (state.support?.profile_role !== 'admin') return;
    if (formState.id) return;

    setFormState((prev) => {
      const next = { ...prev };
      let changed = false;

      if (!next.name.trim()) {
        next.name = buildServerProxyName(
          next.inventory_group,
          state.proxies
            .filter((proxy) => proxy.provision_source === 'manual_admin')
            .map((proxy) => proxy.name)
        );
        changed = true;
      }

      if (!next.port) {
        next.port = latestServerProxy?.port ? String(latestServerProxy.port) : '1080';
        changed = true;
      }

      if (!next.username && latestServerProxy?.username) {
        next.username = latestServerProxy.username;
        changed = true;
      }

      if (!next.password && latestServerProxy?.password) {
        next.password = latestServerProxy.password;
        changed = true;
      }

      return changed ? next : prev;
    });
  }, [formState.id, latestServerProxy, state.proxies, state.support?.profile_role]);

  async function checkProxy(proxyId) {
    try {
      setState((prev) => ({
        ...prev,
        proxies: prev.proxies.map((proxy) => (
          proxy.id === proxyId ? { ...proxy, status: 'checking' } : proxy
        ))
      }));
      await apiRequest(`/api/userbot/proxies/check/${proxyId}`, { accessToken });
      const data = await apiRequest('/api/userbot/proxies', { accessToken });
      setState((prev) => ({
        ...prev,
        proxies: data.proxies || [],
        support: data.support || prev.support,
        updatedAt: new Date().toISOString()
      }));
    } catch (error) {
      toast.error(error.message);
      const data = await apiRequest('/api/userbot/proxies', { accessToken });
      setState((prev) => ({
        ...prev,
        proxies: data.proxies || [],
        support: data.support || prev.support,
        updatedAt: new Date().toISOString()
      }));
    }
  }

  async function saveProxy() {
    setState((prev) => ({ ...prev, saving: true, error: '' }));
    try {
      const isAdminCreate = state.support?.profile_role === 'admin' && !formState.id;
      const normalizedName = formState.name.trim();
      const normalizedHost = formState.host.trim();
      const normalizedPort = Number.parseInt(formState.port, 10);

      if (!normalizedName) {
        throw new Error('Сначала задай имя прокси.');
      }
      if (!isAdminCreate && !normalizedHost) {
        throw new Error('Сначала укажи host или IP прокси.');
      }
      if (!isAdminCreate && (!Number.isInteger(normalizedPort) || normalizedPort <= 0 || normalizedPort > 65535)) {
        throw new Error('Укажи корректный порт прокси.');
      }

      const result = await apiRequest('/api/userbot/proxies', {
        accessToken,
        method: 'POST',
        body: {
          id: formState.id || undefined,
          name: normalizedName,
          host: normalizedHost || undefined,
          port: Number.isInteger(normalizedPort) ? normalizedPort : undefined,
          username: formState.username.trim() || null,
          password: formState.password.trim() || null,
          inventory_group: formState.inventory_group
        }
      });
      const data = await apiRequest('/api/userbot/proxies', { accessToken });
      setFormState({
        id: '',
        name: '',
        host: '',
        port: '',
        username: '',
        password: '',
        inventory_group: 'self_use'
      });
      setState((prev) => ({
        ...prev,
        saving: false,
        proxies: data.proxies || [],
        support: data.support || prev.support,
        updatedAt: new Date().toISOString()
      }));
      toast.success(result?.message || 'Прокси сохранен.');
    } catch (error) {
      setState((prev) => ({ ...prev, saving: false, error: error.message }));
      toast.error(error.message);
    }
  }

  function editProxy(proxy) {
    if (state.support?.profile_role === 'admin') {
    } else if ((proxy.provision_source || 'manual_free') !== 'manual_owned') {
      return;
    }
    setFormState({
      id: proxy.id,
      name: proxy.name || '',
      host: proxy.host || '',
      port: proxy.port ? String(proxy.port) : '',
      username: proxy.username || '',
      password: proxy.password || '',
      inventory_group: proxy.inventory_group || 'shop_sale'
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function resetForm() {
    setFormState({
      id: '',
      name: '',
      host: '',
      port: latestServerProxy?.port ? String(latestServerProxy.port) : '1080',
      username: '',
      password: '',
      inventory_group: 'self_use'
    });
  }

  function fillFromLatestServerProxy() {
    if (!latestServerProxy) {
      toast('Серверных прокси пока нет. Нечего брать как шаблон.');
      return;
    }

    setFormState((prev) => ({
      ...prev,
      name: buildServerProxyName(
        prev.inventory_group,
        state.proxies
          .filter((proxy) => proxy.provision_source === 'manual_admin')
          .map((proxy) => proxy.name)
      ),
      port: latestServerProxy.port ? String(latestServerProxy.port) : '1080',
      username: latestServerProxy.username || '',
      password: latestServerProxy.password || ''
    }));
  }

  async function deleteProxy(proxyId) {
    if (!window.confirm('Удалить прокси? Если он уже привязан к юзерботу, сначала перепривяжи аккаунт.')) {
      return;
    }

    try {
      await apiRequest(`/api/userbot/proxies/${proxyId}`, {
        accessToken,
        method: 'DELETE'
      });
      const data = await apiRequest('/api/userbot/proxies', { accessToken });
      if (String(formState.id) === String(proxyId)) {
        resetForm();
      }
      setState((prev) => ({
        ...prev,
        proxies: data.proxies || [],
        support: data.support || prev.support,
        updatedAt: new Date().toISOString()
      }));
    } catch (error) {
      toast.error(error.message);
    }
  }

  async function moveProxyToGroup(proxy, targetGroup) {
    if (!canEditProxy) return;
    if (!ADMIN_PROXY_GROUPS.includes(targetGroup)) return;
    if ((proxy.inventory_group || 'shop_sale') === targetGroup) return;

    setState((prev) => ({ ...prev, movingProxyId: String(proxy.id), error: '' }));
    try {
      await apiRequest('/api/userbot/proxies', {
        accessToken,
        method: 'POST',
        body: {
          id: proxy.id,
          name: proxy.name,
          host: proxy.host,
          port: proxy.port,
          username: proxy.username || null,
          password: proxy.password || null,
          inventory_group: targetGroup
        }
      });
      const data = await apiRequest('/api/userbot/proxies', { accessToken });
      setState((prev) => ({
        ...prev,
        movingProxyId: '',
        proxies: data.proxies || [],
        support: data.support || prev.support,
        updatedAt: new Date().toISOString()
      }));
      toast.success(`Прокси "${proxy.name}" перенесен в новую группу.`);
    } catch (error) {
      setState((prev) => ({
        ...prev,
        movingProxyId: '',
        error: error.message
      }));
      toast.error(error.message);
    }
  }

  function ProxyTableSection() {
    const { items: visibleItems, isSold } = getVisibleProxies();
    const laneInfo = LANE_OPTIONS.find(l => l.id === selectedLane);

    return (
      <div className="bg-white border border-slate-200/60 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
        {/* Unified header with filters */}
        <div className="p-6 md:p-8 border-b border-slate-100">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500 to-violet-600 flex items-center justify-center text-white shadow-lg shadow-violet-500/20">
                <Filter className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-900">Прокси</h2>
                <p className="text-sm text-slate-500 font-medium mt-0.5">
                  {laneInfo ? laneInfo.label : 'Все прокси'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {selectedLane === 'on-sale' && isAdmin ? (
                <button
                  type="button"
                  className="h-10 px-4 rounded-xl bg-indigo-600 text-white text-[13px] font-bold hover:bg-indigo-700 transition-all disabled:opacity-50"
                  disabled={!saleProxies.length}
                  onClick={() => setShowProxyDialog(true)}
                >
                  Выставить прокси
                </button>
              ) : null}
              <div className="px-4 py-2 bg-violet-50 text-violet-700 rounded-xl text-sm font-bold border border-violet-100">
                {visibleItems.length}
              </div>
            </div>
          </div>

          {/* Row 1: Lane selection */}
          <div className="mb-3">
            <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
              Категория
            </div>
            <div className="flex gap-2 p-1.5 bg-slate-100 rounded-2xl overflow-x-auto">
              {LANE_OPTIONS.map((lane) => (
                <button
                  key={lane.id}
                  type="button"
                  className={`px-4 py-2 text-xs font-black uppercase tracking-wider rounded-xl transition-all whitespace-nowrap ${
                    selectedLane === lane.id
                      ? 'bg-white text-violet-600 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                  onClick={() => setSelectedLane(lane.id)}
                >
                  {lane.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {visibleItems.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-16 h-16 rounded-full bg-slate-50 flex items-center justify-center text-slate-300 mx-auto mb-4">
              <Globe className="w-8 h-8" />
            </div>
            <p className="text-slate-400 font-bold">
              {isSold ? 'Проданных прокси пока нет' : 'Прокси с этим фильтром нет'}
            </p>
          </div>
        ) : isSold ? (
          <div className="divide-y divide-slate-100">
            {visibleItems.map((item) => {
              const proxyAssets = (item.assets || []).filter((asset) => asset.asset_type === 'proxy');
              return (
                <div key={item.id} className="p-5 md:px-8 md:py-5 hover:bg-slate-50/50 transition-colors">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-1.5">
                        <div className="text-[15px] font-bold text-slate-900 truncate">{item.title}</div>
                        <span className="shrink-0 text-xs font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">TON {formatTon(item.price_ton)}</span>
                      </div>
                      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
                        <span>{proxyAssets.map((a) => a.label || 'Proxy').join(', ') || 'Proxy'}</span>
                        <span>Продаж: <strong className="text-slate-700">{item.stats?.paid_purchases || 0}</strong></span>
                        <span>Handoff: <strong className="text-slate-700">{item.stats?.completed_transfers || 0}</strong></span>
                      </div>
                    </div>
                    <a
                      className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 transition-all"
                      href="/app/shop"
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ExternalLink className="w-3.5 h-3.5" strokeWidth={2.5} />
                      Shop
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {visibleItems.map((proxy) => {
              const badge = proxyBadge(proxy);
              const mode = proxyHealthMode(proxy);
              const geo = proxy.last_check_country
                ? `${countryFlag(proxy.last_check_country_code) ? `${countryFlag(proxy.last_check_country_code)} ` : ''}${proxy.last_check_country}${proxy.last_check_city ? `, ${proxy.last_check_city}` : ''}`
                : mode === 'telegram_only'
                  ? 'Telegram only'
                  : '—';
              const statusDotColor = badge.className === 'pill pill--ok'
                ? 'bg-emerald-400'
                : badge.className === 'pill pill--warning'
                  ? 'bg-amber-400'
                  : badge.className === 'pill pill--danger'
                    ? 'bg-red-400'
                    : 'bg-slate-300';
              const statusBgColor = badge.className === 'pill pill--ok'
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : badge.className === 'pill pill--warning'
                  ? 'bg-amber-50 text-amber-700 border-amber-200'
                  : badge.className === 'pill pill--danger'
                    ? 'bg-red-50 text-red-700 border-red-200'
                    : 'bg-slate-50 text-slate-600 border-slate-200';
              const shopItems = selectedLane === 'on-sale'
                ? (sellerProxyItemMap.get(String(proxy.id)) || [])
                : [];
              const isListed = shopItems.some((i) => i.status === 'published' && i.visibility !== 'private');
              const hasDraft = shopItems.some((i) => i.status === 'draft' || i.visibility === 'private');
              return (
                <div key={proxy.id} className="p-5 md:px-8 md:py-5 hover:bg-slate-50/50 transition-colors">
                  <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                    <div className="flex-1 min-w-0 space-y-2.5">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: statusDotColor === 'bg-emerald-400' ? '#34d399' : statusDotColor === 'bg-amber-400' ? '#fbbf24' : statusDotColor === 'bg-red-400' ? '#f87171' : '#cbd5e1' }} />
                        <div className="text-[15px] font-bold text-slate-900">{proxy.name}</div>
                        <span className={`inline-flex px-2.5 py-0.5 rounded-md text-[11px] font-bold uppercase tracking-wide border ${statusBgColor}`}>
                          {badge.text}
                        </span>
                        {selectedLane === 'on-sale' ? (
                          isListed ? (
                            <span className="inline-flex px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-black uppercase">На витрине</span>
                          ) : hasDraft ? (
                            <span className="inline-flex px-2 py-0.5 rounded-md bg-slate-100 text-slate-500 border border-slate-200 text-[10px] font-black uppercase">Черновик</span>
                          ) : (
                            <span className="inline-flex px-2 py-0.5 rounded-md bg-amber-50 text-amber-600 border border-amber-200 text-[10px] font-black uppercase">Не выставлен</span>
                          )
                        ) : null}
                        {Number(proxy.userbot_count || 0) > 1 ? (
                          <span className="inline-flex px-2 py-0.5 rounded-md bg-red-50 text-red-600 border border-red-100 text-[10px] font-black uppercase">Shared</span>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Адрес</span>
                          <span className="font-mono text-[13px] font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded">{proxy.host}:{proxy.port}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Гео</span>
                          <span className="font-medium text-slate-700">{geo}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Нагрузка</span>
                          <span className={`font-bold ${Number(proxy.userbot_count || 0) > 0 ? 'text-slate-900' : 'text-emerald-600'}`}>
                            {Number(proxy.userbot_count || 0) > 0 ? `${proxy.userbot_count} userbot` : 'Свободен'}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Исходящий</span>
                          <span className="font-mono text-[13px] text-slate-700">{proxyEgressSummary(proxy)}</span>
                        </div>
                        {proxy.ipv6 ? (
                          <span className="text-xs font-bold text-slate-400 bg-slate-50 px-2 py-0.5 rounded-md">IPv6</span>
                        ) : null}
                      </div>

                      <div className="text-xs text-slate-400">
                        Проверен: {formatWhen(proxy.last_checked_at)}
                      </div>

                      {proxy.last_check_error ? (
                        <div className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg border border-red-100">
                          {proxy.last_check_error}
                        </div>
                      ) : null}
                      {mode === 'telegram_only' ? (
                        <div className="text-xs text-slate-500 bg-slate-50 px-3 py-2 rounded-lg border border-slate-100">
                          Работает только для Telegram-подключений
                        </div>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        className="h-9 px-4 rounded-xl bg-blue-600 text-white text-[13px] font-bold hover:bg-blue-700 transition-all"
                        type="button"
                        onClick={() => checkProxy(proxy.id)}
                      >
                        Проверить
                      </button>
                      {state.support?.profile_role === 'admin' && proxy.provision_source === 'manual_admin' ? (
                        <select
                          className="h-9 px-3 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 bg-white"
                          value={proxy.inventory_group || 'shop_sale'}
                          disabled={state.movingProxyId === String(proxy.id)}
                          onChange={(event) => moveProxyToGroup(proxy, event.target.value)}
                        >
                          {ADMIN_PROXY_GROUPS.map((group) => (
                            <option key={group} value={group}>{inventoryGroupActionLabel(group)}</option>
                          ))}
                        </select>
                      ) : null}
                      <button
                        className="h-9 px-4 rounded-xl border border-red-200 text-red-600 text-[13px] font-bold hover:bg-red-50 transition-all"
                        type="button"
                        onClick={() => deleteProxy(proxy.id)}
                      >
                        Удалить
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }



  if (state.loading) {
    return <LoadingState text="Загружаем прокси..." />;
  }

  return (
    <section className="page proxy-page">

      {state.error ? <div className="error-card" style={{ marginTop: 20 }}>{state.error}</div> : null}

      {manualQuotaText && state.support?.profile_role === 'admin' ? (
        <div className="toolbar-card proxy-surface-card">
          <div className="proxy-surface-card__head">
            <div className="toolbar-card__title">Правило по прокси</div>
          </div>
          <p style={{ margin: 0 }}>{manualQuotaText}</p>
          {state.support?.profile_role === 'admin' ? (
            <p className="table-subtext" style={{ marginTop: 8 }}>
              Следующее имя для выбранной группы: <strong>{suggestedServerProxyName}</strong>
            </p>
          ) : null}
        </div>
      ) : null}

      {state.support?.profile_role !== 'admin' ? (
        <ProxyStorefrontSection
          buyLimit={proxyBuyLimit}
          buyQuantities={buyQuantities}
          cancelCheckout={cancelCheckout}
          checkPurchase={checkPurchase}
          checkoutState={checkoutState}
          createBatchCheckout={createBatchCheckout}
          openCheckout={openCheckout}
          refreshPurchases={refreshPurchases}
          reloadProxies={reloadProxies}
          setBuyQuantities={setBuyQuantities}
          setCheckoutState={setCheckoutState}
          setSelectedOpenPurchaseId={setSelectedOpenPurchaseId}
          showPurchaseInline={showPurchaseInline}
          storefrontState={storefrontState}
        />
      ) : null}

      {state.support?.profile_role !== 'admin' ? (
        <div className="bg-white border border-slate-200/60 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
          <div className="p-6 md:p-8 border-b border-slate-100">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/20">
                <Plus className="w-6 h-6" />
              </div>
              <div className="flex-1">
                <h2 className="text-xl font-bold text-slate-900">
                  {formState.id ? 'Редактировать прокси' : 'Добавить свой прокси'}
                </h2>
                <p className="text-sm text-slate-500 font-medium mt-0.5">
                  {formState.id ? 'Измени параметры своего прокси' : 'Укажи данные SOCKS5 прокси, который будешь использовать для юзербота'}
                </p>
              </div>
              {formState.id ? (
                <button
                  type="button"
                  className="px-4 py-2 rounded-xl border border-slate-200 text-slate-700 text-sm font-bold hover:bg-slate-50 transition-all"
                  onClick={resetForm}
                >
                  Отмена
                </button>
              ) : null}
            </div>
          </div>

          <div className="p-6 md:p-8">
            {showQuotaLock ? (
              <div className="p-4 rounded-2xl bg-red-50 border border-red-200 text-red-800 font-medium">
                На Trial можно держать только один свой прокси. Чтобы добавить ещё, сначала перейди на Pro.
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">Название</label>
                  <input
                    className="h-11 w-full px-4 rounded-[14px] border border-slate-200 bg-slate-50 text-[14px] font-medium text-slate-950 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10 shadow-sm"
                    type="text"
                    value={formState.name}
                    onChange={(event) => setFormState((prev) => ({ ...prev, name: event.target.value }))}
                    placeholder="Например: Мой SOCKS5"
                  />
                </div>

                <div className="rounded-[16px] bg-slate-50/50 p-4 border border-slate-100">
                  <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400 mb-3">Подключение</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[13px] font-semibold text-slate-700">Host / IP</label>
                      <input
                        className="h-11 w-full px-4 rounded-[14px] border border-slate-200 bg-white text-[14px] font-medium text-slate-950 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10"
                        type="text"
                        value={formState.host}
                        onChange={(event) => setFormState((prev) => ({ ...prev, host: event.target.value }))}
                        placeholder="192.168.1.1"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[13px] font-semibold text-slate-700">Порт</label>
                      <input
                        className="h-11 w-full px-4 rounded-[14px] border border-slate-200 bg-white text-[14px] font-medium text-slate-950 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10"
                        type="number"
                        min="1"
                        max="65535"
                        value={formState.port}
                        onChange={(event) => setFormState((prev) => ({ ...prev, port: event.target.value }))}
                        placeholder="1080"
                      />
                    </div>
                  </div>
                </div>

                <div className="rounded-[16px] bg-slate-50/50 p-4 border border-slate-100">
                  <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400 mb-3">Авторизация</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[13px] font-semibold text-slate-700">Username</label>
                      <input
                        className="h-11 w-full px-4 rounded-[14px] border border-slate-200 bg-white text-[14px] font-medium text-slate-950 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10"
                        type="text"
                        value={formState.username}
                        onChange={(event) => setFormState((prev) => ({ ...prev, username: event.target.value }))}
                        placeholder="Если нужен"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[13px] font-semibold text-slate-700">Password</label>
                      <input
                        className="h-11 w-full px-4 rounded-[14px] border border-slate-200 bg-white text-[14px] font-medium text-slate-950 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10"
                        type="text"
                        value={formState.password}
                        onChange={(event) => setFormState((prev) => ({ ...prev, password: event.target.value }))}
                        placeholder="Если нужен"
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-100">
                  <button
                    className="w-full h-11 rounded-[14px] bg-blue-600 text-[14px] font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                    onClick={saveProxy}
                    disabled={state.saving}
                  >
                    {state.saving ? 'Сохраняем...' : (formState.id ? 'Сохранить изменения' : 'Добавить прокси')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}



      {state.proxies.length > 0 && state.support?.profile_role !== 'admin' ? (
        <div className="bg-white border border-slate-200/60 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
          <div className="p-6 md:p-8 border-b border-slate-100">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500 to-violet-600 flex items-center justify-center text-white shadow-lg shadow-violet-500/20">
                  <Globe className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-slate-900">Мои прокси</h2>
                  <p className="text-sm text-slate-500 font-medium mt-0.5">
                    Отфильтруй битые, shared и купленные
                  </p>
                </div>
              </div>

              <div className="px-4 py-2 bg-violet-50 text-violet-700 rounded-xl text-sm font-bold border border-violet-100">
                {filteredProxies.length}
              </div>
            </div>

            <div className="flex gap-2 p-1.5 bg-slate-100 rounded-2xl overflow-x-auto">
              {[
                { id: 'all', label: 'Все' },
                { id: 'working', label: 'Работают' },
                { id: 'broken', label: 'С ошибкой' }
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`px-4 py-2 text-xs font-black uppercase tracking-wider rounded-xl transition-all whitespace-nowrap ${
                    filter === item.id
                      ? 'bg-white text-violet-600 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                  onClick={() => setFilter(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="divide-y divide-slate-100">
            {filteredProxies.length === 0 ? (
              <div className="p-12 text-center">
                <div className="w-16 h-16 rounded-full bg-slate-50 flex items-center justify-center text-slate-300 mx-auto mb-4">
                  <Globe className="w-8 h-8" />
                </div>
                <p className="text-slate-400 font-bold">Прокси с этим фильтром нет</p>
              </div>
            ) : (
              filteredProxies.map((proxy) => {
                const badge = proxyBadge(proxy);
                const mode = proxyHealthMode(proxy);
                const geo = proxy.last_check_country
                  ? `${countryFlag(proxy.last_check_country_code) ? `${countryFlag(proxy.last_check_country_code)} ` : ''}${proxy.last_check_country}${proxy.last_check_city ? `, ${proxy.last_check_city}` : ''}`
                  : mode === 'telegram_only'
                    ? 'Telegram only'
                    : '—';
                const statusDotColor = badge.className === 'pill pill--ok'
                  ? '#34d399'
                  : badge.className === 'pill pill--warning'
                    ? '#fbbf24'
                    : badge.className === 'pill pill--danger'
                      ? '#f87171'
                      : '#cbd5e1';
                const statusBgColor = badge.className === 'pill pill--ok'
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : badge.className === 'pill pill--warning'
                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                    : badge.className === 'pill pill--danger'
                      ? 'bg-red-50 text-red-700 border-red-200'
                      : 'bg-slate-50 text-slate-600 border-slate-200';

                return (
                  <div key={proxy.id} className="p-5 md:px-8 md:py-5 hover:bg-slate-50/50 transition-colors">
                    <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                      <div className="flex-1 min-w-0 space-y-2.5">
                        <div className="flex items-center gap-2.5 flex-wrap">
                          <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: statusDotColor }} />
                          <div className="text-[15px] font-bold text-slate-900">{proxy.name}</div>
                          <span className={`inline-flex px-2.5 py-0.5 rounded-md text-[11px] font-bold uppercase tracking-wide border ${statusBgColor}`}>
                            {badge.text}
                          </span>
                          {Number(proxy.userbot_count || 0) > 1 ? (
                            <span className="inline-flex px-2 py-0.5 rounded-md bg-red-50 text-red-600 border border-red-100 text-[10px] font-black uppercase">Shared</span>
                          ) : null}
                        </div>

                        <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Адрес</span>
                            <span className="font-mono text-[13px] font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded">{proxy.host}:{proxy.port}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Гео</span>
                            <span className="font-medium text-slate-700">{geo}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Нагрузка</span>
                            <span className={`font-bold ${Number(proxy.userbot_count || 0) > 0 ? 'text-slate-900' : 'text-emerald-600'}`}>
                              {Number(proxy.userbot_count || 0) > 0 ? `${proxy.userbot_count} userbot` : 'Свободен'}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Исходящий</span>
                            <span className="font-mono text-[13px] text-slate-700">{proxyEgressSummary(proxy)}</span>
                          </div>
                        </div>

                        <div className="text-xs text-slate-400">
                          Проверен: {formatWhen(proxy.last_checked_at)}
                        </div>

                        {proxy.last_check_error ? (
                          <div className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg border border-red-100">
                            {proxy.last_check_error}
                          </div>
                        ) : null}
                        {mode === 'telegram_only' ? (
                          <div className="text-xs text-slate-500 bg-slate-50 px-3 py-2 rounded-lg border border-slate-100">
                            Работает только для Telegram-подключений
                          </div>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <button
                          className="h-9 px-4 rounded-xl bg-blue-600 text-white text-[13px] font-bold hover:bg-blue-700 transition-all"
                          type="button"
                          onClick={() => checkProxy(proxy.id)}
                        >
                          Проверить
                        </button>
                        {proxy.provision_source !== 'manual_admin' ? (
                            <button
                              className="h-9 px-4 rounded-xl border border-red-200 text-red-600 text-[13px] font-bold hover:bg-red-50 transition-all"
                              type="button"
                              onClick={() => deleteProxy(proxy.id)}
                            >
                              Удалить
                            </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      ) : null}

      {state.support?.profile_role === 'admin' ? (
        <div className="bg-white border border-slate-200/60 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
          <div className="p-6 md:p-8 border-b border-slate-100">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/20">
                {formState.id ? <Server className="w-6 h-6" /> : <Plus className="w-6 h-6" />}
              </div>
              <div className="flex-1">
                <h2 className="text-xl font-bold text-slate-900">
                  {formState.id ? 'Редактировать прокси' : 'Поднять серверный прокси'}
                </h2>
                <p className="text-sm text-slate-500 font-medium mt-0.5">
                  {formState.id
                    ? 'Измени параметры прокси или перемести его в другую группу'
                    : 'Создай новый прокси на сервере или добавь внешний'}
                </p>
              </div>
              {!formState.id ? (
                <div className="px-3 py-1.5 rounded-lg bg-blue-100 text-blue-700 text-sm font-semibold">
                  {suggestedServerProxyName}
                </div>
              ) : null}
            </div>
          </div>

          <div className="p-6 md:p-8">
            {showQuotaLock ? (
              <div className="mb-6 p-4 rounded-2xl bg-red-50 border border-red-200 text-red-800 font-medium">
                На Trial можно держать только один свой прокси. Чтобы добавить следующий, сначала перейди на Pro.
              </div>
            ) : null}

            <div className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">Название</label>
                  <input
                    className="h-11 w-full px-4 rounded-[14px] border border-slate-200 bg-slate-50 text-[14px] font-medium text-slate-950 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10 shadow-sm"
                    type="text"
                    value={formState.name}
                    onChange={(event) => setFormState((prev) => ({ ...prev, name: event.target.value }))}
                    placeholder="Например: Прокси сервера 1"
                  />
                </div>

                {state.support?.profile_role === 'admin' ? (
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">Группа</label>
                    <select
                      className="h-11 w-full px-4 rounded-[14px] border border-slate-200 bg-slate-50 text-[14px] font-medium text-slate-950 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10 shadow-sm"
                      value={formState.inventory_group}
                      onChange={(event) => setFormState((prev) => ({
                        ...prev,
                        inventory_group: event.target.value,
                        name: prev.id ? prev.name : buildServerProxyName(
                          event.target.value,
                          state.proxies
                            .filter((proxy) => proxy.provision_source === 'manual_admin')
                            .map((proxy) => proxy.name)
                        )
                      }))}
                    >
                      <option value="shop_sale">На продажу в shop</option>
                      <option value="self_use">Использую сам</option>
                    </select>
                  </div>
                ) : null}
              </div>

              <div className="rounded-[16px] bg-slate-50/50 p-4 border border-slate-100">
                <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400 mb-3">Подключение</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[13px] font-semibold text-slate-700">Host / IP</label>
                    <input
                      className="h-11 w-full px-4 rounded-[14px] border border-slate-200 bg-white text-[14px] font-medium text-slate-950 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10"
                      type="text"
                      value={formState.host}
                      onChange={(event) => setFormState((prev) => ({ ...prev, host: event.target.value }))}
                      placeholder={state.support?.profile_role === 'admin' && !formState.id ? 'Оставь пустым — поднимется на сервере' : '192.168.1.1'}
                    />
                    {state.support?.profile_role === 'admin' && !formState.id && !formState.host.trim() ? (
                      <div className="text-[12px] text-blue-600 font-medium">Прокси будет создан автоматически на сервере Bullgram</div>
                    ) : null}
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[13px] font-semibold text-slate-700">Порт</label>
                    <input
                      className="h-11 w-full px-4 rounded-[14px] border border-slate-200 bg-white text-[14px] font-medium text-slate-950 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10"
                      type="number"
                      min="1"
                      max="65535"
                      value={formState.port}
                      onChange={(event) => setFormState((prev) => ({ ...prev, port: event.target.value }))}
                      placeholder={state.support?.profile_role === 'admin' && !formState.id ? 'Авто' : '1080'}
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-[16px] bg-slate-50/50 p-4 border border-slate-100">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">Авторизация</div>
                  {state.support?.profile_role === 'admin' && !formState.id && latestServerProxy ? (
                    <button
                      type="button"
                      className="text-[12px] font-semibold text-blue-600 hover:text-blue-700 transition"
                      onClick={fillFromLatestServerProxy}
                    >
                      Подставить из последнего
                    </button>
                  ) : null}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[13px] font-semibold text-slate-700">Username</label>
                    <input
                      className="h-11 w-full px-4 rounded-[14px] border border-slate-200 bg-white text-[14px] font-medium text-slate-950 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10"
                      type="text"
                      value={formState.username}
                      onChange={(event) => setFormState((prev) => ({ ...prev, username: event.target.value }))}
                      placeholder="Если нужен"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[13px] font-semibold text-slate-700">Password</label>
                    <input
                      className="h-11 w-full px-4 rounded-[14px] border border-slate-200 bg-white text-[14px] font-medium text-slate-950 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10"
                      type="text"
                      value={formState.password}
                      onChange={(event) => setFormState((prev) => ({ ...prev, password: event.target.value }))}
                      placeholder="Если нужен"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-3 pt-6 border-t border-slate-100">
              <button
                className="flex-1 min-w-[200px] h-11 inline-flex items-center justify-center rounded-[14px] bg-blue-600 text-[14px] font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                onClick={saveProxy}
                disabled={state.saving || showQuotaLock}
              >
                {state.saving ? 'Сохраняем...' : (formState.host.trim() ? 'Сохранить внешний прокси' : 'Поднять прокси на сервере')}
              </button>

              {formState.id ? (
                <button
                  className="h-11 px-5 rounded-[14px] border border-slate-200 text-slate-700 text-[14px] font-bold hover:bg-slate-50 transition"
                  onClick={resetForm}
                >
                  Сбросить форму
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}


      {state.support?.profile_role === 'admin' ? (
        <ProxyTableSection />
      ) : null}

      {isAdmin ? (
        <AdminLotsSection
          accessToken={accessToken}
          types="proxy"
          title="Прокси на витрине"
          onChanged={loadSellerItems}
        />
      ) : null}

      <ProxyComposerDialog
        open={showProxyDialog}
        onOpenChange={setShowProxyDialog}
        composer={proxyComposer}
        setComposer={setProxyComposer}
        saleProxies={saleProxies}
        onSave={saveProxyComposer}
        onReset={resetProxyComposer}
      />

    </section>
  );
}
