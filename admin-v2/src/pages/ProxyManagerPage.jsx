import { useEffect, useMemo, useState } from 'react';
import { Globe, Shield, AlertTriangle, Server, Plus, ShoppingBag, Wallet, QrCode, Copy, ExternalLink, Filter } from 'lucide-react';
import { toast } from 'sonner';
import { apiRequest } from '../api/client.js';
import { getProductTierRules } from '../app/productTier.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { APP_CONFIG } from '../config.js';
import { LoadingState } from '../ui/LoadingState.jsx';

const ADMIN_PROXY_GROUPS = ['self_use', 'shop_sale'];

const LANE_OPTIONS = [
  { id: 'self-use', label: 'Свои' },
  { id: 'on-sale', label: 'На продаже' },
  { id: 'sold', label: 'Продано' }
];

function resolveBackendAssetUrl(value) {
  const url = String(value || '').trim();
  if (!url) return '';
  if (/^(https?:|data:|blob:)/i.test(url)) return url;
  if (url.startsWith('/')) return `${APP_CONFIG.backendUrl}${url}`;
  return `${APP_CONFIG.backendUrl}/${url}`;
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

function getProxyLoad(proxy) {
  const linked = Array.isArray(proxy?.linked_userbots) ? proxy.linked_userbots : [];
  if (!linked.length) {
    return 'На этом прокси сейчас никто не сидит.';
  }
  const labels = linked
    .map((account) => account.tg_username ? `@${account.tg_username}` : `ID ${account.tg_account_id}`)
    .join(', ');
  if (linked.length === 1) {
    return `На нем сидит 1 юзербот: ${labels}`;
  }
  return `Опасная связка: на нем сидит ${linked.length} юзербота: ${labels}`;
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

function formatRub(value) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Number(value || 0));
}

function CopyRow({ label, value }) {
  if (!value) return null;

  async function copyValue() {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} скопирован.`);
    } catch {
      window.prompt(label, value);
    }
  }

  return (
    <button
      type="button"
      className="flex min-h-[44px] w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2 text-left shadow-sm hover:bg-slate-50 transition-colors"
      onClick={copyValue}
    >
      <span className="w-20 shrink-0 text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-xs font-bold text-slate-700">{value}</span>
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-slate-500">
        <Copy className="h-3.5 w-3.5" />
        Copy
      </span>
    </button>
  );
}

function isProxyShopItem(item) {
  if (!item) return false;
  return item.item_type === 'proxy';
}

function isProxyPurchase(purchase) {
  if (!purchase) return false;
  return purchase.item?.item_type === 'proxy';
}

function isOpenProxyPurchase(purchase) {
  if (!isProxyPurchase(purchase)) return false;
  if (purchase.status === 'awaiting_receipt') return true;
  if (purchase.status === 'pending') return true;
  if (purchase.status === 'paid' && purchase.ownership_transfer_status !== 'completed') return true;
  return false;
}

function normalizeOpenProxyPurchaseGroup(rows = []) {
  if (!rows.length) return null;
  const first = rows[0];
  const status = rows.some((purchase) => purchase.status === 'awaiting_receipt')
    ? 'awaiting_receipt'
    : rows.some((purchase) => purchase.status === 'paid' && purchase.ownership_transfer_status !== 'completed')
      ? 'paid'
      : 'pending';
  const amountTon = rows.reduce((sum, purchase) => sum + Number(purchase.amount_ton || 0), 0);
  const amountRub = rows.reduce((sum, purchase) => sum + Number(purchase.amount_rub || 0), 0);
  const assets = rows.flatMap((purchase) => purchase.assets || []);
  const uniqueLabels = Array.from(new Set(assets.map((asset) => asset.label || 'Proxy')));
  const sellerWallet = first.payload?.seller_wallet || '';
  const memo = first.payload?.memo || '';
  const expiresAt = rows
    .map((purchase) => purchase.expires_at ? new Date(purchase.expires_at).getTime() : null)
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right)[0];

  return {
    id: first.payload?.batch_token || first.id,
    purchase_ids: rows.map((purchase) => purchase.id),
    status,
    amount_ton: amountTon,
    amount_rub: amountRub,
    ownership_transfer_status: rows.every((purchase) => purchase.ownership_transfer_status === 'completed') ? 'completed' : 'pending',
    created_at: first.created_at,
    expires_at: expiresAt ? new Date(expiresAt).toISOString() : first.expires_at,
    payload: {
      ...(first.payload || {}),
      seller_wallet: sellerWallet,
      memo,
      ton_uri: sellerWallet ? `ton://transfer/${sellerWallet}?amount=${Math.round(amountTon * 1000000000)}&text=${encodeURIComponent(memo)}` : '',
      trust_wallet_uri: sellerWallet ? `https://link.trustwallet.com/send?${new URLSearchParams({
        asset: 'c607',
        address: sellerWallet,
        amount: String(amountTon),
        ...(memo ? { memo } : {})
      }).toString()}` : ''
    },
    item: {
      ...(first.item || {}),
      title: rows.length > 1 ? `Прокси x${rows.length}` : (first.item?.title || 'Прокси')
    },
    assets: uniqueLabels.map((label) => ({ label })),
    batch: rows.length > 1 || !!first.payload?.batch_token
  };
}

function itemPaymentMethods(item) {
  const source = Array.isArray(item?.available_payment_methods)
    ? item.available_payment_methods
    : Array.isArray(item?.payment_methods) && item.payment_methods.length
      ? item.payment_methods
      : ['ton', 'p2p'];
  return source.filter((method) => method === 'ton' || method === 'p2p');
}

function paymentMethodLabel(value) {
  return value === 'p2p' ? 'СБП' : 'TON';
}

function purchaseStatusMeta(status) {
  if (status === 'awaiting_receipt') {
    return { text: 'Оплата отмечена', className: 'pill pill--warning' };
  }
  if (status === 'paid') {
    return { text: 'Оплата есть', className: 'pill pill--ok' };
  }
  return { text: 'Ждет оплату', className: 'pill pill--info' };
}

function itemPriceSummary(item) {
  const methods = itemPaymentMethods(item);
  const parts = [];
  if (methods.includes('ton') && Number(item?.price_ton || 0) > 0) {
    parts.push(`${formatTon(item.price_ton)} TON`);
  }
  if (methods.includes('p2p') && Number(item?.price_rub || 0) > 0) {
    parts.push(`${formatRub(item.price_rub)} RUB`);
  }
  return parts.join(' / ') || 'Нужна цена в RUB';
}

function purchaseAmountSummary(purchase) {
  if (purchase?.payment_method === 'p2p' || purchase?.payload?.payment_method === 'p2p') {
    const rub = Number(purchase?.amount_rub || purchase?.payload?.amount_rub || purchase?.item?.price_rub || 0);
    return rub > 0 ? `${formatRub(rub)} RUB` : paymentMethodLabel(purchase?.payment_method || purchase?.payload?.payment_method);
  }
  return `${formatTon(purchase?.amount_ton || purchase?.item?.price_ton || 0)} TON`;
}

function inventoryGroupActionLabel(value) {
  if (value === 'self_use') return 'Использую сам';
  return 'На продажу';
}

function summaryTone(value, { danger = false, warning = false } = {}) {
  if (danger) return 'danger';
  if (warning) return 'warning';
  return value > 0 ? 'ok' : 'neutral';
}

function proxyEgressSummary(proxy) {
  if (proxy?.ipv6) return `IPv6 ${proxy.ipv6}`;
  if (proxy?.last_check_ip) return proxy.last_check_ip;
  return 'IP не зафиксирован';
}

function preferredTonCheckoutView(purchase) {
  if (purchase?.trust_wallet_qr || purchase?.trust_wallet_uri) return 'trust';
  if (purchase?.ton_qr || purchase?.ton_uri) return 'ton';
  return 'trust';
}

export function ProxyManagerPage() {
  const { accessToken, profilePlan } = useAuth();
  const [filter, setFilter] = useState('all');
  const [selectedLane, setSelectedLane] = useState('self-use');
  const [purchaseView, setPurchaseView] = useState('shop');
  const [proxyBuyQuantity, setProxyBuyQuantity] = useState(1);
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

  const [shopState, setShopState] = useState({
    loading: true,
    error: '',
    items: [],
    sellerItems: [],
    purchases: []
  });
  const [checkoutState, setCheckoutState] = useState({
    item: null,
    purchase: null,
    paymentMethod: 'ton',
    loading: false,
    checking: false,
    error: ''
  });
  const [receiptNote, setReceiptNote] = useState('');
  const [receiptFile, setReceiptFile] = useState(null);
  const [tonCheckoutView, setTonCheckoutView] = useState('trust');
  const hasPendingProxyChecks = state.proxies.some((proxy) => {
    const mode = proxyHealthMode(proxy);
    return mode === 'checking' || mode === 'warming_up';
  });

  function sourceBadge(proxy) {
    const source = proxy?.provision_source || 'manual_free';
    if (source === 'manual_admin') {
      return { text: 'Инвентарь админа', className: 'pill pill--warning' };
    }
    if (source === 'purchased') {
      return { text: 'Купленный', className: 'pill pill--ok' };
    }
    if (source === 'manual_owned') {
      return { text: 'Свой', className: 'pill pill--info' };
    }
    if (source === 'manual_trial') {
      return { text: 'Старый trial', className: 'pill pill--warning' };
    }
    return { text: 'Временный', className: 'pill' };
  }

  function inventoryGroupBadge(proxy) {
    if (proxy?.inventory_group === 'self_use') {
      return { text: 'Использую сам', className: 'pill' };
    }
    if (proxy?.inventory_group === 'shop_sale') {
      return { text: 'На продажу', className: 'pill pill--warning' };
    }
    return null;
  }

  useEffect(() => {
    let cancelled = false;

    async function loadProxies({ silent = false } = {}) {
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
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            loading: false,
            refreshing: false,
            error: '',
            proxies: data.proxies || [],
            support: data.support || null,
            updatedAt: new Date().toISOString()
          }));
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            loading: false,
            refreshing: false,
            error: error.message,
            proxies: [],
            support: null,
            updatedAt: null
          });
        }
      }
    }

    if (accessToken) {
      loadProxies();
    }

    const refreshIntervalMs = hasPendingProxyChecks ? 10_000 : 60_000;
    const intervalId = accessToken
      ? window.setInterval(() => {
          loadProxies({ silent: true });
        }, refreshIntervalMs)
      : null;

    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [accessToken, hasPendingProxyChecks]);

  useEffect(() => {
    let cancelled = false;

    async function loadShopItems() {
      try {
        const requests = [];
        if (accessToken) {
          requests.push(apiRequest('/api/shop/app/items', { accessToken }));
          requests.push(apiRequest('/api/shop/public/my-purchases', { accessToken }));
        } else {
          requests.push(apiRequest('/api/shop/public/items'));
        }
        if (state.support?.profile_role === 'admin' && accessToken) {
          requests.push(apiRequest('/api/shop/seller/items', { accessToken }));
        }
        const [itemsData, purchasesData, sellerData] = await Promise.all(requests);
        if (cancelled) return;
        setShopState({
          loading: false,
          error: '',
          items: (itemsData.items || []).filter(isProxyShopItem),
          sellerItems: sellerData?.items || [],
          purchases: purchasesData?.purchases || []
        });
      } catch (error) {
        if (cancelled) return;
        setShopState({
          loading: false,
          error: error.message,
          items: [],
          sellerItems: [],
          purchases: []
        });
      }
    }

    loadShopItems();

    return () => {
      cancelled = true;
    };
  }, [accessToken, state.support?.profile_role]);

  const stats = {
    total: state.proxies.length,
    working: state.proxies.filter((proxy) => proxy.is_working === true).length,
    broken: state.proxies.filter((proxy) => proxy.is_working === false).length,
    unchecked: state.proxies.filter((proxy) => proxy.is_working !== true && proxy.is_working !== false).length,
    shared: state.proxies.filter((proxy) => Number(proxy.userbot_count || 0) > 1).length,
    purchasedReady: state.proxies.filter((proxy) => proxy.provision_source === 'purchased' && Number(proxy.userbot_count || 0) === 0).length
  };
  const isAdmin = state.support?.profile_role === 'admin';

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
  const visibleProxyItems = shopState.items.slice(0, 6);
  const proxyBatchOffer = useMemo(() => {
    if (!visibleProxyItems.length) return null;
    const first = visibleProxyItems[0];
    const paymentSignature = JSON.stringify(itemPaymentMethods(first));
    const samePrice = visibleProxyItems.every((item) =>
      Number(item.price_ton || 0) === Number(first.price_ton || 0)
      && Number(item.price_rub || 0) === Number(first.price_rub || 0)
      && JSON.stringify(itemPaymentMethods(item)) === paymentSignature
    );

    const tonValues = visibleProxyItems
      .filter((item) => itemPaymentMethods(item).includes('ton'))
      .map((item) => Number(item.price_ton || 0))
      .filter((value) => value > 0);
    const rubValues = visibleProxyItems
      .filter((item) => {
        const methods = itemPaymentMethods(item);
        return methods.includes('p2p');
      })
      .map((item) => Number(item.price_rub || 0))
      .filter((value) => value > 0);

    return {
      title: 'Прокси Bullgram',
      previewText: 'Один живой seller-лот с выбором количества. После брони оплаты появятся ниже в блоке «Нужно оплатить».',
      items: visibleProxyItems,
      unitPriceText: samePrice
        ? itemPriceSummary(first)
        : `${tonValues.length ? `от ${formatTon(Math.min(...tonValues))} TON` : ''}${tonValues.length && rubValues.length ? ' / ' : ''}${rubValues.length ? `от ${formatRub(Math.min(...rubValues))} RUB` : ''}` || 'Нужна цена в RUB',
      paymentMethods: itemPaymentMethods(first),
      samePrice
    };
  }, [visibleProxyItems]);
  const openProxyPurchases = useMemo(() => (
    (() => {
      const rows = (shopState.purchases || []).filter(isOpenProxyPurchase);
      const grouped = new Map();
      for (const purchase of rows) {
        const key = purchase.payload?.batch_token || purchase.id;
        const bucket = grouped.get(key) || [];
        bucket.push(purchase);
        grouped.set(key, bucket);
      }
      return Array.from(grouped.values()).map((bucket) => normalizeOpenProxyPurchaseGroup(bucket)).filter(Boolean);
    })()
  ), [shopState.purchases]);
  const sellerProxyItemMap = useMemo(() => {
    const map = new Map();
    for (const item of shopState.sellerItems || []) {
      for (const asset of item.assets || []) {
        if (asset.asset_type !== 'proxy') continue;
        const key = String(asset.asset_id);
        const bucket = map.get(key) || [];
        bucket.push(item);
        map.set(key, bucket);
      }
    }
    return map;
  }, [shopState.sellerItems]);
  const soldProxyItems = useMemo(() => (
    (shopState.sellerItems || []).filter((item) =>
      item.status === 'sold' && (item.assets || []).some((asset) => asset.asset_type === 'proxy')
    )
  ), [shopState.sellerItems]);
  const proxySummaryCards = useMemo(() => {
    if (isAdmin) {
      return [
        {
          label: 'Свои',
          value: selfUseProxies.length,
          hint: 'Прокси под свои userbot-задачи.',
          tone: summaryTone(selfUseProxies.length)
        },
        {
          label: 'На продаже',
          value: shopSaleProxies.length,
          hint: 'Прокси для shop — созданные и опубликованные.',
          tone: summaryTone(shopSaleProxies.length)
        },
        {
          label: 'С ошибкой',
          value: stats.broken,
          hint: 'Надо перепроверить или убрать из контура.',
          tone: summaryTone(stats.broken, { danger: stats.broken > 0 })
        }
      ];
    }

    const planRules = getProductTierRules(profilePlan);
    const planHint = Number.isFinite(state.support?.owned_proxy_quota_total)
      ? `На вашем тарифе только ${state.support?.owned_proxy_quota_total} proxy.`
      : 'На вашем тарифе лимит по proxy не режет базовую работу.';

    return [
      {
        label: 'Мои прокси',
        value: filteredProxies.length,
        hint: 'Все прокси, которые сейчас закреплены за тобой.',
        tone: summaryTone(filteredProxies.length)
      },
      {
        label: 'Нужно оплатить',
        value: openProxyPurchases.length,
        hint: 'Открытые покупки, которые еще ждут TON или СБП чек.',
        tone: summaryTone(openProxyPurchases.length, { warning: openProxyPurchases.length > 0 })
      },
      {
        label: 'Тариф',
        value: planRules.label,
        hint: planHint,
        tone: summaryTone(Number.isFinite(state.support?.owned_proxy_quota_total) ? state.support.owned_proxy_quota_total : 1)
      },
    ];
  }, [
    filteredProxies.length,
    isAdmin,
    openProxyPurchases.length,
    profilePlan,
    selfUseProxies.length,
    shopSaleProxies.length,
    state.support?.max_owned_userbots,
    state.support?.owned_proxy_quota_total,
    state.support?.owned_proxy_quota_used,
    stats.broken,
  ]);

  const manualQuotaText = !state.support
    ? null
    : state.support.profile_role === 'admin'
      ? null
      : (() => {
          const total = Number(state.support.owned_proxy_quota_total || 0);
          const used = Number(state.support.owned_proxy_quota_used || 0);
          if (!total) return null;
          if (profilePlan === 'trial') {
            return `На Trial: ${used}/${total} свой proxy. Дальше либо покупай прокси, либо переходи на Normal.`;
          }
          return `Своих proxy: ${used}/${total}.`;
        })();

  const canCreateManualProxy = !!state.support?.can_create_manual_proxy;
  const canEditProxy = state.support?.profile_role === 'admin';
  const showQuotaLock = !formState.id && state.support?.profile_role !== 'admin' && !canCreateManualProxy;
  const proxyBuyLimit = useMemo(() => {
    if (!proxyBatchOffer) return 1;
    if (state.support?.profile_role === 'admin') return proxyBatchOffer.items.length;
    if (profilePlan !== 'trial') return proxyBatchOffer.items.length;
    return Math.max(0, Math.min(proxyBatchOffer.items.length, 1 - state.proxies.length));
  }, [profilePlan, proxyBatchOffer, state.proxies.length, state.support?.profile_role]);

  useEffect(() => {
    if (!proxyBatchOffer) {
      setProxyBuyQuantity(1);
      return;
    }
    setProxyBuyQuantity((prev) => Math.min(Math.max(prev, 1), Math.max(proxyBuyLimit, 1)));
  }, [proxyBatchOffer, proxyBuyLimit]);
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

  async function openCheckout(item, preferredPaymentMethod = null) {
    const selectedPaymentMethod = itemPaymentMethods(item).includes(preferredPaymentMethod)
      ? preferredPaymentMethod
      : itemPaymentMethods(item).includes(checkoutState.paymentMethod)
        ? checkoutState.paymentMethod
      : (itemPaymentMethods(item)[0] || 'ton');

    if (!accessToken) {
      setCheckoutState({
        item,
        purchase: null,
        paymentMethod: selectedPaymentMethod,
        loading: false,
        checking: false,
        error: 'Сначала войди через Google, чтобы купить прокси.'
      });
      return;
    }

    setCheckoutState({
      item,
      purchase: null,
      paymentMethod: selectedPaymentMethod,
      loading: true,
      checking: false,
      error: ''
    });

    try {
      const data = await apiRequest('/api/shop/public/purchase', {
        accessToken,
        method: 'POST',
        body: {
          item_id: item.id,
          payment_method: selectedPaymentMethod
        }
      });
      const purchasesData = await apiRequest('/api/shop/public/my-purchases', { accessToken });
      setShopState((prev) => ({
        ...prev,
        purchases: purchasesData.purchases || prev.purchases
      }));

      setCheckoutState({
        item,
        paymentMethod: selectedPaymentMethod,
        loading: false,
        checking: false,
        error: '',
        purchase: {
          id: data.purchase_id,
          amount_ton: data.amount_ton,
          amount_rub: data.amount_rub || item.price_rub || 0,
          payment_method: data.payment_method || selectedPaymentMethod,
          seller_wallet: data.seller_wallet,
          memo: data.memo,
          ton_uri: data.ton_uri,
          trust_wallet_uri: data.trust_wallet_uri || '',
          trust_wallet_qr: data.trust_wallet_qr || '',
          ton_qr: data.ton_qr,
          expires_at: data.expires_at,
          sbp_phone: data.sbp_phone || '',
          sbp_bank: data.sbp_bank || '',
          sbp_fio: data.sbp_fio || '',
          payment_url: data.payment_url || ''
        }
      });
    } catch (error) {
      let existingPurchase = null;
      if (accessToken) {
        try {
          const purchasesData = await apiRequest('/api/shop/public/my-purchases', { accessToken });
          existingPurchase = (purchasesData.purchases || []).find((purchase) => (
            String(purchase.item?.id || '') === String(item.id) &&
            (purchase.status === 'pending' || purchase.status === 'awaiting_receipt' || purchase.status === 'paid')
          )) || null;
        } catch {
          existingPurchase = null;
        }
      }

      setCheckoutState({
        item,
        paymentMethod: selectedPaymentMethod,
        purchase: existingPurchase ? {
          id: existingPurchase.id,
          amount_ton: existingPurchase.amount_ton,
          amount_rub: existingPurchase.amount_rub || 0,
          payment_method: existingPurchase.payload?.payment_method || selectedPaymentMethod,
          seller_wallet: existingPurchase.payload?.seller_wallet || '',
          memo: existingPurchase.payload?.memo || '',
          ton_uri: existingPurchase.payload?.ton_uri || '',
          trust_wallet_uri: existingPurchase.payload?.trust_wallet_uri || '',
          trust_wallet_qr: existingPurchase.payload?.trust_wallet_qr || '',
          ton_qr: existingPurchase.payload?.ton_qr || '',
          expires_at: existingPurchase.expires_at || null,
          status: existingPurchase.status,
          sbp_phone: existingPurchase.payload?.sbp_phone || '',
          sbp_bank: existingPurchase.payload?.sbp_bank || '',
          sbp_fio: existingPurchase.payload?.sbp_fio || '',
          receipt_file_url: existingPurchase.payload?.receipt_file_url || '',
          payment_url: ''
        } : null,
        loading: false,
        checking: false,
        error: error.message
      });
    }
  }

  async function createProxyBatchCheckout(preferredPaymentMethod) {
    if (!proxyBatchOffer?.items?.length) return;

    if (proxyBuyLimit <= 0) {
      setCheckoutState((prev) => ({
        ...prev,
        error: 'На Trial ты уже упёрся в лимит по прокси. Сначала перейди на Normal или освободи текущий proxy.'
      }));
      return;
    }

    const quantity = Math.min(Math.max(Number(proxyBuyQuantity || 1), 1), Math.max(proxyBuyLimit, 1));
    const batchItems = proxyBatchOffer.items.slice(0, quantity);
    const selectedPaymentMethod = proxyBatchOffer.paymentMethods.includes(preferredPaymentMethod)
      ? preferredPaymentMethod
      : (proxyBatchOffer.paymentMethods[0] || 'ton');

    if (batchItems.length === 1) {
      await openCheckout(batchItems[0], selectedPaymentMethod);
      return;
    }

    setCheckoutState({
      item: null,
      purchase: null,
      paymentMethod: selectedPaymentMethod,
      loading: true,
      checking: false,
      error: ''
    });

    try {
      const data = await apiRequest('/api/shop/public/purchase/batch', {
        accessToken,
        method: 'POST',
        body: {
          item_ids: batchItems.map((item) => item.id),
          payment_method: selectedPaymentMethod
        }
      });
      const purchasesData = await apiRequest('/api/shop/public/my-purchases', { accessToken });
      setShopState((prev) => ({
        ...prev,
        purchases: purchasesData.purchases || prev.purchases
      }));
      setCheckoutState({
        item: {
          title: `Прокси x${batchItems.length}`
        },
        purchase: {
          id: data.batch_token || data.purchase_ids?.[0] || '',
          purchase_ids: data.purchase_ids || [],
          amount_ton: data.amount_ton,
          amount_rub: data.amount_rub || 0,
          payment_method: data.payment_method || selectedPaymentMethod,
          seller_wallet: data.seller_wallet || '',
          memo: data.memo || '',
          ton_uri: data.ton_uri || '',
          trust_wallet_uri: data.trust_wallet_uri || '',
          trust_wallet_qr: data.trust_wallet_qr || '',
          ton_qr: data.ton_qr || '',
          expires_at: data.expires_at || null,
          sbp_phone: data.sbp_phone || '',
          sbp_bank: data.sbp_bank || '',
          sbp_fio: data.sbp_fio || '',
          payment_url: '',
          status: 'pending',
          batch: true
        },
        paymentMethod: selectedPaymentMethod,
        loading: false,
        checking: false,
        error: ''
      });
    } catch (error) {
      const purchasesData = await apiRequest('/api/shop/public/my-purchases', { accessToken }).catch(() => null);
      if (purchasesData?.purchases) {
        setShopState((prev) => ({
          ...prev,
          purchases: purchasesData.purchases
        }));
      }
      setCheckoutState({
        item: null,
        purchase: null,
        paymentMethod: selectedPaymentMethod,
        loading: false,
        checking: false,
        error: error.message || 'Не удалось создать покупки по прокси.'
      });
    }
  }

  async function checkCheckout() {
    if (!checkoutState.purchase?.id) return;

    setCheckoutState((prev) => ({
      ...prev,
      checking: true,
      error: ''
    }));

    try {
      if (Array.isArray(checkoutState.purchase?.purchase_ids) && checkoutState.purchase.purchase_ids.length > 1) {
        await apiRequest('/api/shop/public/purchase/check-batch', {
          accessToken,
          method: 'POST',
          body: {
            purchase_ids: checkoutState.purchase.purchase_ids
          }
        });
      } else {
        await apiRequest('/api/shop/public/purchase/check', {
          accessToken,
          method: 'POST',
          body: {
            purchase_id: checkoutState.purchase.id
          }
        });
      }
      const [data, purchasesData] = await Promise.all([
        apiRequest('/api/userbot/proxies', { accessToken }),
        apiRequest('/api/shop/public/my-purchases', { accessToken })
      ]);
      setState((prev) => ({
        ...prev,
        proxies: data.proxies || [],
        support: data.support || prev.support,
        updatedAt: new Date().toISOString()
      }));
      toast.success('Оплата найдена. Прокси скоро появится в кабинете.');
      setShopState((prev) => ({
        ...prev,
        purchases: purchasesData.purchases || prev.purchases
      }));
      setCheckoutState((prev) => ({
        ...prev,
        checking: false,
        item: null,
        purchase: null,
        paymentMethod: 'ton',
        error: ''
      }));
      setReceiptNote('');
      setReceiptFile(null);
    } catch (error) {
      setCheckoutState((prev) => ({
        ...prev,
        checking: false,
        error: error.message
      }));
    }
  }

  function showPurchaseInline(purchase) {
    setCheckoutState({
      item: purchase.item || null,
      purchase: {
        id: purchase.id,
        purchase_ids: purchase.purchase_ids || [purchase.id],
        amount_ton: purchase.amount_ton,
        amount_rub: purchase.amount_rub || 0,
        payment_method: purchase.payload?.payment_method || 'ton',
        seller_wallet: purchase.payload?.seller_wallet || '',
        memo: purchase.payload?.memo || '',
        ton_uri: purchase.payload?.ton_uri || '',
        trust_wallet_uri: purchase.payload?.trust_wallet_uri || '',
        trust_wallet_qr: purchase.payload?.trust_wallet_qr || '',
        ton_qr: purchase.payload?.ton_qr || '',
        expires_at: purchase.expires_at || null,
        status: purchase.status,
        sbp_phone: purchase.payload?.sbp_phone || '',
        sbp_bank: purchase.payload?.sbp_bank || '',
        sbp_fio: purchase.payload?.sbp_fio || '',
        receipt_file_url: purchase.payload?.receipt_file_url || '',
        payment_url: '',
        batch: !!purchase.batch
      },
      paymentMethod: purchase.payload?.payment_method || 'ton',
      loading: false,
      checking: false,
      error: ''
    });
  }

  async function markCheckoutPaid() {
    if (!checkoutState.purchase?.id) return;

    setCheckoutState((prev) => ({
      ...prev,
      checking: true,
      error: ''
    }));

    try {
      const formData = new FormData();
      formData.append('receipt_note', receiptNote);
      if (receiptFile) {
        formData.append('receipt_file', receiptFile);
      }
      if (Array.isArray(checkoutState.purchase?.purchase_ids) && checkoutState.purchase.purchase_ids.length > 1) {
        formData.append('purchase_ids', checkoutState.purchase.purchase_ids.join(','));
        await apiRequest('/api/shop/public/purchase/mark-paid-batch', {
          accessToken,
          method: 'POST',
          body: formData
        });
      } else {
        formData.append('purchase_id', checkoutState.purchase.id);
        await apiRequest('/api/shop/public/purchase/mark-paid', {
          accessToken,
          method: 'POST',
          body: formData
        });
      }
      const purchasesData = await apiRequest('/api/shop/public/my-purchases', { accessToken });
      const refreshed = (purchasesData.purchases || []).filter((purchase) =>
        (checkoutState.purchase.purchase_ids || [checkoutState.purchase.id]).includes(purchase.id)
      );
      setShopState((prev) => ({
        ...prev,
        purchases: purchasesData.purchases || prev.purchases
      }));
      setReceiptNote('');
      setReceiptFile(null);
      if (refreshed.length === 1) {
        showPurchaseInline(refreshed[0]);
      } else if (refreshed.length > 1) {
        showPurchaseInline(normalizeOpenProxyPurchaseGroup(refreshed));
      }
      setCheckoutState((prev) => ({
        ...prev,
        checking: false
      }));
    } catch (error) {
      setCheckoutState((prev) => ({
        ...prev,
        checking: false,
        error: error.message
      }));
    }
  }

  async function cancelCheckoutPurchase(target = checkoutState.purchase) {
    const targetIds = Array.isArray(target?.purchase_ids) && target.purchase_ids.length
      ? target.purchase_ids
      : [target?.id].filter(Boolean);
    if (!targetIds.length) return;

    try {
      if (targetIds.length > 1) {
        await apiRequest('/api/shop/public/purchase/cancel-batch', {
          accessToken,
          method: 'POST',
          body: {
            purchase_ids: targetIds
          }
        });
      } else {
        await apiRequest('/api/shop/public/purchase/cancel', {
          accessToken,
          method: 'POST',
          body: {
            purchase_id: targetIds[0]
          }
        });
      }

      const [data, purchasesData] = await Promise.all([
        apiRequest('/api/userbot/proxies', { accessToken }),
        apiRequest('/api/shop/public/my-purchases', { accessToken })
      ]);

      setState((prev) => ({
        ...prev,
        error: '',
        proxies: data.proxies || [],
        support: data.support || prev.support,
        updatedAt: new Date().toISOString()
      }));
      toast.success('Бронь снята.');
      setShopState((prev) => ({
        ...prev,
        purchases: purchasesData.purchases || prev.purchases
      }));
      setCheckoutState((prev) => (
        targetIds.includes(String(prev.purchase?.id || '')) || targetIds.some((id) => (prev.purchase?.purchase_ids || []).includes(id))
          ? {
              item: null,
              purchase: null,
              paymentMethod: 'ton',
              loading: false,
              checking: false,
              error: ''
            }
          : prev
      ));
      setReceiptNote('');
      setReceiptFile(null);
    } catch (error) {
      setCheckoutState((prev) => ({
        ...prev,
        error: error.message || 'Не удалось снять бронь.'
      }));
    }
  }

function renderOpenProxyPurchases(rows) {
    return (
      <div className="bg-white border border-slate-200/60 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
        <div className="p-6 md:p-8 border-b border-slate-100">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white shadow-lg shadow-orange-500/20">
              <ShoppingBag className="w-6 h-6" />
            </div>
            <div className="flex-1">
              <h2 className="text-xl font-bold text-slate-900">Нужно оплатить</h2>
              <p className="text-sm text-slate-500 font-medium mt-0.5">
                Открытые покупки не пропадают после брони. Отсюда можно вернуться в оплату.
              </p>
            </div>
            <div className="px-4 py-2 bg-amber-50 text-amber-700 rounded-xl text-sm font-bold border border-amber-100">
              {rows.length}
            </div>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-16 h-16 rounded-full bg-slate-50 flex items-center justify-center text-slate-300 mx-auto mb-4">
              <ShoppingBag className="w-8 h-8" />
            </div>
            <p className="text-slate-400 font-bold">Открытых покупок по прокси сейчас нет</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {rows.map((purchase) => {
              const statusMeta = purchaseStatusMeta(purchase.status);
              return (
                <div key={purchase.id} className="p-6 md:p-8 hover:bg-slate-50/50 transition-colors">
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                    <div className="flex-1 space-y-3">
                      <div>
                        <div className="text-lg font-black text-slate-900">{purchase.item?.title || 'Прокси'}</div>
                        <div className="text-sm text-slate-500 mt-1">
                          {(purchase.assets || []).map((asset) => asset.label || 'Proxy').join(' • ') || 'Proxy'}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-4 text-sm">
                        <div>
                          <span className="text-slate-500">Сумма:</span>{' '}
                          <span className="font-bold text-slate-900">{purchaseAmountSummary(purchase)}</span>
                        </div>
                        <div>
                          <span className="text-slate-500">Способ:</span>{' '}
                          <span className="font-bold text-slate-900">{paymentMethodLabel(purchase.payload?.payment_method || 'ton')}</span>
                        </div>
                        <div>
                          <span className="text-slate-500">Дедлайн:</span>{' '}
                          <span className="font-bold text-slate-900">{formatWhen(purchase.expires_at)}</span>
                        </div>
                      </div>

                      <div>
                        <span className={`inline-flex px-3 py-1 rounded-lg text-xs font-black uppercase tracking-wide border ${
                          statusMeta.className === 'pill pill--ok'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                            : statusMeta.className === 'pill pill--warning'
                              ? 'bg-amber-50 text-amber-700 border-amber-100'
                              : 'bg-slate-100 text-slate-600 border-slate-200'
                        }`}>
                          {statusMeta.text}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-3">
                      <button
                        className="px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 shadow-lg shadow-blue-500/20 transition-all"
                        type="button"
                        onClick={() => showPurchaseInline(purchase)}
                      >
                        Открыть оплату
                      </button>
                      <button
                        className="px-5 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-sm font-bold hover:bg-slate-50 transition-all"
                        type="button"
                        onClick={() => cancelCheckoutPurchase(purchase)}
                      >
                        Снять бронь
                      </button>
                      {purchase.payload?.ton_uri ? (
                        <a
                          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-sm font-bold hover:bg-slate-50 transition-all"
                          href={purchase.payload.ton_uri}
                          target="_blank"
                          rel="noreferrer"
                        >
                          TON
                        </a>
                      ) : null}
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
            <div className="px-4 py-2 bg-violet-50 text-violet-700 rounded-xl text-sm font-bold border border-violet-100">
              {visibleItems.length}
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



  function ProxyPurchaseSection() {
    return (
      <div className="bg-white border border-slate-200/60 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
        {/* VIEW TABS - навигация между состояниями */}
        <div className="flex border-b border-slate-100">
          <button
            type="button"
            className={`flex-1 px-6 py-4 text-sm font-bold transition-all ${
              purchaseView === 'shop'
                ? 'text-emerald-600 border-b-2 border-emerald-600 bg-emerald-50/50'
                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
            }`}
            onClick={() => setPurchaseView('shop')}
          >
            <ShoppingBag className="w-5 h-5 inline mr-2" />
            Купить прокси
          </button>
          <button
            type="button"
            className={`flex-1 px-6 py-4 text-sm font-bold transition-all ${
              purchaseView === 'checkout'
                ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50'
                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
            }`}
            onClick={() => setPurchaseView('checkout')}
            disabled={!checkoutState.item}
          >
            <Wallet className="w-5 h-5 inline mr-2" />
            Оплата прокси
            {checkoutState.item ? <span className="ml-2 px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs">1</span> : null}
          </button>
          <button
            type="button"
            className={`flex-1 px-6 py-4 text-sm font-bold transition-all ${
              purchaseView === 'open-purchases'
                ? 'text-amber-600 border-b-2 border-amber-600 bg-amber-50/50'
                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
            }`}
            onClick={() => setPurchaseView('open-purchases')}
          >
            <ShoppingBag className="w-5 h-5 inline mr-2" />
            Нужно оплатить
            {openProxyPurchases.length > 0 ? <span className="ml-2 px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-xs">{openProxyPurchases.length}</span> : null}
          </button>
        </div>

        {/* SHOP VIEW */}
        {purchaseView === 'shop' && (
          <div className="p-6 md:p-8">
            {shopState.loading ? (
              <div className="text-center py-12 text-slate-500">Загружаем предложения...</div>
            ) : shopState.error ? (
              <div className="p-4 rounded-2xl bg-red-50 border border-red-200 text-red-800">
                {shopState.error}
              </div>
            ) : !proxyBatchOffer ? (
              <div className="text-center py-12 text-slate-500">Сейчас готовых лотов нет.</div>
            ) : (
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="md:col-span-2">
                    <div className="text-sm text-slate-600 mb-1">{proxyBatchOffer.title}</div>
                    <div className="text-3xl font-black text-slate-900 mb-2">{proxyBatchOffer.unitPriceText}</div>
                    <div className="text-sm text-slate-500">{proxyBatchOffer.previewText}</div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-600">Свободно</span>
                      <span className="font-bold text-slate-900">{proxyBatchOffer.items.length}</span>
                    </div>
                    {profilePlan === 'trial' && (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-600">Лимит</span>
                        <span className="font-bold text-amber-600">{proxyBuyLimit}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="border-t border-slate-200 pt-6">
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-4">
                      <label className="text-sm font-semibold text-slate-700">Количество</label>
                      <div className="flex items-center gap-2">
                        <button
                          className="w-12 h-12 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center text-xl font-bold"
                          type="button"
                          disabled={proxyBuyQuantity <= 1}
                          onClick={() => setProxyBuyQuantity((prev) => Math.max(1, prev - 1))}
                        >
                          −
                        </button>
                        <input
                          className="w-20 px-3 py-2 text-center border border-slate-200 rounded-xl text-xl font-bold text-slate-900"
                          type="number"
                          min="1"
                          max={Math.max(proxyBuyLimit, 1)}
                          value={proxyBuyQuantity}
                          disabled={proxyBuyLimit <= 0}
                          onChange={(event) => {
                            const next = Number.parseInt(event.target.value, 10);
                            if (Number.isNaN(next)) {
                              setProxyBuyQuantity(1);
                              return;
                            }
                            setProxyBuyQuantity(Math.min(Math.max(next, 1), Math.max(proxyBuyLimit, 1)));
                          }}
                        />
                        <button
                          className="w-12 h-12 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center text-xl font-bold"
                          type="button"
                          disabled={proxyBuyQuantity >= Math.max(proxyBuyLimit, 1) || proxyBuyLimit <= 0}
                          onClick={() => setProxyBuyQuantity((prev) => Math.min(Math.max(proxyBuyLimit, 1), prev + 1))}
                        >
                          +
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      {proxyBatchOffer.paymentMethods.map((method) => (
                        <button
                          key={method}
                          className={`px-6 py-3 rounded-xl text-sm font-bold transition-all ${
                            method === 'ton'
                              ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-500/20'
                              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                          }`}
                          type="button"
                          disabled={checkoutState.loading || proxyBuyLimit <= 0}
                          onClick={() => createProxyBatchCheckout(method)}
                        >
                          {checkoutState.loading ? 'Готовим...' : paymentMethodLabel(method)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* CHECKOUT VIEW */}
        {purchaseView === 'checkout' && checkoutState.item ? (
          <div>
            <div className="p-6 md:p-8 border-b border-slate-100">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center text-white shadow-lg shadow-green-500/20">
                    <Wallet className="w-6 h-6" />
                  </div>
                  <div className="flex-1">
                    <h2 className="text-xl font-bold text-slate-900">Оплата прокси</h2>
                    <p className="text-sm text-slate-500 font-medium mt-0.5">
                      {checkoutState.item?.title || 'Прокси'} • {itemPriceSummary(checkoutState.item)}
                    </p>
                  </div>
                </div>

                <div className="flex gap-2 p-1.5 bg-slate-100 rounded-2xl">
                  {itemPaymentMethods(checkoutState.item).map((method) => (
                    <button
                      key={method}
                      type="button"
                      className={`px-4 py-2 text-xs font-black uppercase tracking-wider rounded-xl transition-all ${
                        checkoutState.paymentMethod === method
                          ? 'bg-white text-blue-600 shadow-sm'
                          : 'text-slate-500 hover:text-slate-700'
                      }`}
                      disabled={checkoutState.loading}
                      onClick={() => {
                        openCheckout(checkoutState.item, method);
                      }}
                    >
                      {paymentMethodLabel(method)}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="p-6 md:p-8">
              {checkoutState.loading ? (
                <div className="text-center py-12 text-slate-500">Готовим оплату...</div>
              ) : checkoutState.error && !checkoutState.purchase ? (
                <div className="p-4 rounded-2xl bg-red-50 border border-red-200 text-red-800 mb-6">
                  {checkoutState.error}
                </div>
              ) : checkoutState.purchase ? (
                <div className="space-y-6">
                  {checkoutState.error ? (
                    <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-800">
                      {checkoutState.error}
                    </div>
                  ) : null}

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                    <div>
                      <div className="text-slate-500 mb-1">Метод оплаты</div>
                      <div className="font-semibold text-slate-900">{paymentMethodLabel(checkoutState.purchase.payment_method)}</div>
                    </div>
                    <div>
                      <div className="text-slate-500 mb-1">Сумма</div>
                      <div className="font-semibold text-slate-900">{purchaseAmountSummary(checkoutState.purchase)}</div>
                    </div>
                    <div>
                      <div className="text-slate-500 mb-1">Дедлайн</div>
                      <div className="font-semibold text-slate-900">{formatWhen(checkoutState.purchase.expires_at)}</div>
                    </div>
                  </div>

                  {checkoutState.purchase.payment_method === 'ton' ? (
                    <div className="flex flex-col md:flex-row gap-6 p-6 sm:p-8 rounded-[2rem] bg-slate-50/50 border border-slate-200 mt-8 mb-4">
                      <div className="flex-1 flex flex-col">
                        <div className="flex items-center gap-3 mb-4">
                          <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center text-blue-600 shadow-inner">
                            <Wallet className="w-5 h-5" strokeWidth={2.5} />
                          </div>
                          <h3 className="text-xl font-extrabold text-slate-900 tracking-tight">Оплата через кошелек</h3>
                        </div>

                        <p className="text-base text-slate-600 font-medium mb-8 leading-relaxed max-w-md">
                          Переведи ровно с этим memo. QR ставит сумму <strong className="text-slate-900 font-bold bg-slate-200/50 px-1.5 py-0.5 rounded-md">{purchaseAmountSummary(checkoutState.purchase)}</strong>.
                        </p>

                        <div className="mb-6 flex w-full flex-col gap-2">
                          <CopyRow label="Кошелек" value={checkoutState.purchase.seller_wallet} />
                          <CopyRow label="Memo" value={checkoutState.purchase.memo || ''} />
                        </div>

                        <div className="flex flex-wrap gap-3 mt-auto">
                          {checkoutState.purchase.trust_wallet_uri && (
                            <a className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 !text-white text-sm font-bold shadow-md shadow-blue-500/20 hover:bg-blue-700 hover:-translate-y-0.5 transition-all" href={checkoutState.purchase.trust_wallet_uri} target="_blank" rel="noreferrer">
                              <ExternalLink className="w-4 h-4" strokeWidth={2.5} /> Trust Wallet
                            </a>
                          )}
                          {checkoutState.purchase.ton_uri && (
                            <a className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-900 !text-white text-sm font-bold shadow-md shadow-slate-900/10 hover:bg-slate-800 hover:-translate-y-0.5 transition-all" href={checkoutState.purchase.ton_uri} target="_blank" rel="noreferrer">
                              <ExternalLink className="w-4 h-4" strokeWidth={2.5} /> TON
                            </a>
                          )}
                        </div>
                      </div>

                      {(checkoutState.purchase.trust_wallet_qr || checkoutState.purchase.ton_qr) && (
                        <div className="shrink-0 flex flex-col bg-white p-5 rounded-3xl border border-slate-200 shadow-sm w-full md:w-[260px]">
                          {checkoutState.purchase.trust_wallet_qr && checkoutState.purchase.ton_qr && (
                            <div className="flex p-1 bg-slate-100 rounded-xl mb-5 w-full">
                              <button
                                type="button"
                                className={`flex-1 px-3 py-2 text-xs font-extrabold uppercase tracking-wide rounded-lg transition-all ${tonCheckoutView === 'trust' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                                onClick={() => setTonCheckoutView('trust')}
                              >
                                Trust
                              </button>
                              <button
                                type="button"
                                className={`flex-1 px-3 py-2 text-xs font-extrabold uppercase tracking-wide rounded-lg transition-all ${tonCheckoutView === 'ton' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                                onClick={() => setTonCheckoutView('ton')}
                              >
                                TON
                              </button>
                            </div>
                          )}
                          <div className="flex items-center justify-center gap-1.5 text-[11px] font-extrabold uppercase tracking-widest text-slate-400 mb-3">
                            <QrCode className="w-3.5 h-3.5" />
                            {tonCheckoutView === 'ton' ? 'QR для TON' : 'QR для Trust Wallet'}
                          </div>
                          <div className="w-full aspect-square rounded-2xl border border-slate-100 p-2 bg-slate-50/50">
                            <img
                              className="w-full h-full object-contain mix-blend-multiply"
                              src={tonCheckoutView === 'ton'
                                ? (checkoutState.purchase.ton_qr || checkoutState.purchase.trust_wallet_qr)
                                : (checkoutState.purchase.trust_wallet_qr || checkoutState.purchase.ton_qr)}
                              alt={tonCheckoutView === 'ton' ? 'QR для TON' : 'QR для Trust Wallet'}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 space-y-4">
                      <div className="space-y-3 text-sm">
                        <div>
                          <div className="text-slate-500">Телефон для СБП</div>
                          <div className="font-semibold text-slate-900">{checkoutState.purchase.sbp_phone || '—'}</div>
                        </div>
                        {checkoutState.purchase.sbp_fio ? (
                          <div>
                            <div className="text-slate-500">Получатель</div>
                            <div className="font-semibold text-slate-900">{checkoutState.purchase.sbp_fio}</div>
                          </div>
                        ) : null}
                        <div>
                          <div className="text-slate-500">Банки</div>
                          <div className="font-semibold text-slate-900">{checkoutState.purchase.sbp_bank || 'СБП'}</div>
                        </div>
                        {checkoutState.purchase.receipt_file_url ? (
                          <div>
                            <div className="text-slate-500">Чек</div>
                            <a
                              className="text-blue-600 hover:text-blue-700 font-semibold underline"
                              href={resolveBackendAssetUrl(checkoutState.purchase.receipt_file_url)}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Открыть файл
                            </a>
                          </div>
                        ) : null}
                      </div>

                      {checkoutState.purchase.status === 'pending' ? (
                        <div className="space-y-3">
                          <div className="font-semibold text-slate-900">Отметь оплату</div>
                          <div className="text-sm text-slate-600">После перевода нажми “Я оплатил”. Чек можно приложить, но он не обязателен, если у продавца включена автосверка.</div>
                          <textarea
                            className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                            rows="3"
                            placeholder="Банк, сумма, время перевода"
                            value={receiptNote}
                            onChange={(event) => setReceiptNote(event.target.value)}
                          />
                          <input
                            className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                            type="file"
                            accept="image/*,.pdf"
                            onChange={(event) => setReceiptFile(event.target.files?.[0] || null)}
                          />
                        </div>
                      ) : checkoutState.purchase.status === 'awaiting_receipt' ? (
                        <div className="p-4 rounded-xl bg-blue-50 border border-blue-200 text-blue-800 text-sm">
                          Ждем подтверждение продавца или банковское уведомление. Чек не обязателен, если оплата найдется через автосверку.
                        </div>
                      ) : null}
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-6 border-t border-slate-100">
                    <button
                      className="px-5 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-sm font-bold hover:bg-slate-50 transition-all"
                      type="button"
                      onClick={() => {
                        setCheckoutState({
                          item: null,
                          purchase: null,
                          paymentMethod: 'ton',
                          loading: false,
                          checking: false,
                          error: ''
                        });
                        setPurchaseView('shop');
                      }}
                    >
                      Скрыть
                    </button>

                    <div className="flex gap-3">
                      {(checkoutState.purchase.status === 'pending' || checkoutState.purchase.status === 'awaiting_receipt') ? (
                        <button
                          className="px-5 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-sm font-bold hover:bg-slate-50 transition-all"
                          type="button"
                          onClick={() => cancelCheckoutPurchase(checkoutState.purchase)}
                        >
                          Снять бронь
                        </button>
                      ) : null}

                      {checkoutState.purchase.payment_method === 'ton' ? (
                        <button
                          className="px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 shadow-lg shadow-blue-500/20 transition-all"
                          type="button"
                          disabled={checkoutState.checking}
                          onClick={checkCheckout}
                        >
                          {checkoutState.checking ? 'Проверяем...' : 'Проверить оплату'}
                        </button>
                      ) : checkoutState.purchase.status === 'pending' ? (
                        <button
                          className="px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 shadow-lg shadow-blue-500/20 transition-all"
                          type="button"
                          disabled={checkoutState.checking}
                          onClick={markCheckoutPaid}
                        >
                          {checkoutState.checking ? 'Отправляем...' : 'Я оплатил'}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* OPEN PURCHASES VIEW */}
        {purchaseView === 'open-purchases' && (
          <div>
            <div className="p-6 md:p-8 border-b border-slate-100">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white shadow-lg shadow-orange-500/20">
                  <ShoppingBag className="w-6 h-6" />
                </div>
                <div className="flex-1">
                  <h2 className="text-xl font-bold text-slate-900">Нужно оплатить</h2>
                  <p className="text-sm text-slate-500 font-medium mt-0.5">
                    Открытые покупки не пропадают после брони. Отсюда можно вернуться в оплату.
                  </p>
                </div>
                <div className="px-4 py-2 bg-amber-50 text-amber-700 rounded-xl text-sm font-bold border border-amber-100">
                  {openProxyPurchases.length}
                </div>
              </div>
            </div>

            <div className="divide-y divide-slate-50">
              {openProxyPurchases.length === 0 ? (
                <div className="p-12 text-center">
                  <div className="w-16 h-16 rounded-full bg-slate-50 flex items-center justify-center text-slate-300 mx-auto mb-4">
                    <ShoppingBag className="w-8 h-8" />
                  </div>
                  <p className="text-slate-400 font-bold">Открытых покупок по прокси сейчас нет</p>
                </div>
              ) : (
                openProxyPurchases.map((purchase) => {
                  const statusMeta = purchaseStatusMeta(purchase.status);
                  return (
                    <div key={purchase.id} className="p-6 md:p-8 hover:bg-slate-50/50 transition-colors">
                      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                        <div className="flex-1 space-y-3">
                          <div>
                            <div className="text-lg font-black text-slate-900">{purchase.item?.title || 'Прокси'}</div>
                            <div className="text-sm text-slate-500 mt-1">
                              {(purchase.assets || []).map((asset) => asset.label || 'Proxy').join(' • ') || 'Proxy'}
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-4 text-sm">
                            <div>
                              <span className="text-slate-500">Сумма:</span>{' '}
                              <span className="font-bold text-slate-900">{purchaseAmountSummary(purchase)}</span>
                            </div>
                            <div>
                              <span className="text-slate-500">Способ:</span>{' '}
                              <span className="font-bold text-slate-900">{paymentMethodLabel(purchase.payload?.payment_method || 'ton')}</span>
                            </div>
                            <div>
                              <span className="text-slate-500">Дедлайн:</span>{' '}
                              <span className="font-bold text-slate-900">{formatWhen(purchase.expires_at)}</span>
                            </div>
                          </div>

                          <div>
                            <span className={`inline-flex px-3 py-1 rounded-lg text-xs font-black uppercase tracking-wide border ${
                              statusMeta.className === 'pill pill--ok'
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                                : statusMeta.className === 'pill pill--warning'
                                  ? 'bg-amber-50 text-amber-700 border-amber-100'
                                  : 'bg-slate-100 text-slate-600 border-slate-200'
                            }`}>
                              {statusMeta.text}
                            </span>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-3">
                          <button
                            className="px-5 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 shadow-lg shadow-blue-500/20 transition-all"
                            type="button"
                            onClick={() => {
                              showPurchaseInline(purchase);
                              setPurchaseView('checkout');
                            }}
                          >
                            Открыть оплату
                          </button>
                          <button
                            className="px-5 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-sm font-bold hover:bg-slate-50 transition-all"
                            type="button"
                            onClick={() => cancelCheckoutPurchase(purchase)}
                          >
                            Снять бронь
                          </button>
                          {purchase.payload?.ton_uri ? (
                            <a
                              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-sm font-bold hover:bg-slate-50 transition-all"
                              href={purchase.payload.ton_uri}
                              target="_blank"
                              rel="noreferrer"
                            >
                              TON
                            </a>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
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

      <ProxyPurchaseSection />

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
                На Trial можно держать только один свой прокси. Чтобы добавить ещё, сначала перейди на Normal.
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
                На Trial можно держать только один свой прокси. Чтобы добавить следующий, сначала перейди на Normal.
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

    </section>
  );
}
