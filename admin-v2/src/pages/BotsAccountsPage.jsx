import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useTonConnectModal, useTonConnectUI, useTonWallet } from '@tonconnect/ui-react';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { getProductTierRules } from '../app/productTier.js';
import { APP_CONFIG } from '../config.js';
import { supabase } from '../lib/supabase.js';
import { buildTonConnectTransaction, normalizeTonConnectError } from '../utils/ton-checkout.js';
import { LoadingState } from '../ui/LoadingState.jsx';
import { StatCard } from '../ui/StatCard.jsx';

function formatWhen(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value));
}

function summarizeCheckStatus(result = {}, fallbackAccount = null) {
  const status = String(result?.status || fallbackAccount?.runtime_status || '').trim().toLowerCase();
  if (status === 'online') return { tone: 'success', title: 'Сессия жива' };
  if (status === 'restricted') return { tone: 'error', title: 'Есть ограничения Telegram' };
  if (status === 'expired') return { tone: 'error', title: 'Сессия умерла' };
  if (status === 'dead_proxy' || status === 'inactive_proxy') return { tone: 'error', title: 'Прокси мертвый' };
  if (status === 'pending_activation') return { tone: 'warning', title: 'Ждет активации' };
  return { tone: 'default', title: 'Статус проверки' };
}

function checkLine(label, value, tone = 'default') {
  return { label, value, tone };
}

function buildCheckLines(result = {}, fallbackAccount = null) {
  const details = result?.details || null;
  const lines = [];

  if (details?.session === 'alive') {
    lines.push(checkLine('Сессия', '', 'success'));
  } else if (details?.session === 'dead') {
    lines.push(checkLine('Сессия', '', 'error'));
  } else {
    lines.push(checkLine('Сессия', '', 'default'));
  }

  if (details?.restriction === 'restricted') {
    lines.push(checkLine('Ограничения', '', 'error'));
  } else if (details?.restriction === 'clear') {
    lines.push(checkLine('Ограничения', '', 'success'));
  } else {
    lines.push(checkLine('Ограничения', '', 'default'));
  }

  const spambotState = String(details?.spambot?.state || '').trim().toLowerCase();
  if (spambotState === 'blocked') {
    lines.push(checkLine('SpamBot', '', 'error'));
  } else if (spambotState === 'clear') {
    lines.push(checkLine('SpamBot', '', 'success'));
  } else if (spambotState === 'error') {
    lines.push(checkLine('SpamBot', '', 'warning'));
  } else {
    lines.push(checkLine('SpamBot', '', 'default'));
  }

  return lines;
}

function defaultCheckLines() {
  return [
    checkLine('Сессия', '', 'default'),
    checkLine('Ограничения', '', 'default'),
    checkLine('SpamBot', '', 'default')
  ];
}

function restrictedMarker(account) {
  if (account.runtime_status !== 'restricted') return null;
  const errorText = String(account.runtime_error || '').toLowerCase();
  if (errorText.includes('terms of service') || errorText.includes('blocked') || errorText.includes('spam')) {
    return {
      text: 'Отлетел',
      detail: 'Telegram подтвердил блокировку или spam-block.',
      className: 'pill pill--danger'
    };
  }
  return {
    text: 'Ограничен',
    detail: 'Аккаунт ограничен Telegram. В работу его пускать не надо.',
    className: 'pill pill--danger'
  };
}

function proxySourceBadge(proxy) {
  const source = proxy?.provision_source || 'manual_free';
  if (source === 'manual_admin') return { text: 'Инвентарь админа', className: 'pill pill--warning' };
  if (source === 'purchased') return { text: 'Купленный', className: 'pill pill--ok' };
  if (source === 'manual_owned') return { text: 'Свой', className: 'pill pill--info' };
  if (source === 'manual_trial') return { text: 'Старый trial', className: 'pill pill--warning' };
  return { text: 'Временный', className: 'pill' };
}

function proxyTelegramMode(proxy) {
  if (proxy?.is_working !== true) return proxy?.is_working === false ? 'broken' : 'unchecked';
  if (!proxy?.last_check_ip && !proxy?.last_check_country && !proxy?.last_check_city) {
    return 'telegram_only';
  }
  return 'full';
}

function proxyTelegramModeLabel(proxy) {
  const mode = proxyTelegramMode(proxy);
  if (mode === 'telegram_only') return 'Рабочий для Telegram';
  if (mode === 'full') return 'Полная web+geo проверка';
  if (mode === 'broken') return 'Не подходит для Telegram';
  return 'Еще не проверен';
}

function recoveryStatusBadge(recovery) {
  if (!recovery) return null;
  if (recovery.last_restore_status === 'failed') return { text: 'Восстановление упало', className: 'pill pill--danger' };
  if (recovery.last_restore_status === 'restored') return { text: 'Уже поднимали', className: 'pill pill--ok' };
  return { text: 'Файлы сохранены', className: 'pill pill--warning' };
}

function canRestoreFromFiles(account, recovery) {
  if (!recovery) return false;
  if (recovery.last_restore_status === 'failed') return true;
  return ['expired', 'error', 'dead_proxy'].includes(account.runtime_status);
}

function normalizeOnboardingErrorMessage(error) {
  const raw = String(error?.message || error || '').trim();
  if (!raw) return 'Подключение не прошло. Попробуй еще раз.';
  if (raw.includes('AUTH_KEY_UNREGISTERED')) {
    return 'Этот .session уже мертвый. Нужен свежий логин через QR или новый .session.';
  }
  if (raw.toLowerCase().includes('sqlite')) {
    return 'Файл .session не удалось прочитать. Проверь, что это нормальная Telegram session.';
  }
  return raw;
}

function resolveBackendAssetUrl(value) {
  const url = String(value || '').trim();
  if (!url) return '';
  if (/^(https?:|data:|blob:)/i.test(url)) return url;
  if (url.startsWith('/')) return `${APP_CONFIG.backendUrl}${url}`;
  return `${APP_CONFIG.backendUrl}/${url}`;
}

function formatTon(value) {
  return Number(value || 0).toFixed(2);
}

function formatRub(value) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Number(value || 0));
}

function userbotLotPaymentMethods(item) {
  const source = Array.isArray(item?.available_payment_methods) && item.available_payment_methods.length
    ? item.available_payment_methods
    : Array.isArray(item?.payment_methods) && item.payment_methods.length
      ? item.payment_methods
      : ['ton', 'p2p'];
  return source.filter((method) => method === 'ton' || method === 'p2p');
}

function batchUserbotLotPaymentMethods(items) {
  const batchItems = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!batchItems.length) return ['ton'];

  const methods = batchItems.reduce((allowed, item, index) => {
    const itemMethods = userbotLotPaymentMethods(item);
    if (index === 0) return itemMethods;
    return allowed.filter((method) => itemMethods.includes(method));
  }, []);

  return methods.length ? methods : userbotLotPaymentMethods(batchItems[0]);
}

function paymentMethodLabel(value) {
  return value === 'p2p' ? 'СБП' : 'TON';
}

function userbotItemPriceSummary(item) {
  const methods = userbotLotPaymentMethods(item);
  const parts = [];
  if (methods.includes('ton') && Number(item?.price_ton || 0) > 0) {
    parts.push(`${formatTon(item.price_ton)} TON`);
  }
  if (methods.includes('p2p') && Number(item?.price_rub || 0) > 0) {
    parts.push(`${formatRub(item.price_rub)} RUB`);
  }
  return parts.join(' / ') || `${formatTon(item?.price_ton || 0)} TON`;
}

function userbotPurchaseAmountSummary(purchase) {
  if (purchase?.payment_method === 'p2p' || purchase?.payload?.payment_method === 'p2p') {
    const rub = Number(purchase?.amount_rub || purchase?.payload?.amount_rub || purchase?.item?.price_rub || 0);
    return rub > 0 ? `${formatRub(rub)} RUB` : 'СБП';
  }
  return `${formatTon(purchase?.amount_ton || purchase?.item?.price_ton || 0)} TON`;
}

function purchaseStatusMeta(status) {
  if (status === 'awaiting_receipt') {
    return { text: 'Ждет чек', className: 'pill pill--warning' };
  }
  if (status === 'paid') {
    return { text: 'Оплата есть', className: 'pill pill--ok' };
  }
  return { text: 'Ждет оплату', className: 'pill pill--info' };
}

function isUserbotShopItem(item) {
  if (!item) return false;
  if (item.item_type === 'userbot' || item.item_type === 'bundle') return true;
  return Array.isArray(item.assets) && item.assets.some((asset) => asset.asset_type === 'userbot');
}

function isUserbotPurchase(purchase) {
  if (!purchase) return false;
  if (purchase.item?.item_type === 'userbot' || purchase.item?.item_type === 'bundle') return true;
  return Array.isArray(purchase.assets) && purchase.assets.some((asset) => asset.asset_type === 'userbot');
}

function isOpenUserbotPurchase(purchase) {
  if (!isUserbotPurchase(purchase)) return false;
  if (purchase.status === 'awaiting_receipt') return true;
  if (purchase.status === 'pending') return true;
  if (purchase.status === 'paid' && purchase.ownership_transfer_status !== 'completed') return true;
  return false;
}

function normalizeOpenUserbotPurchaseGroup(rows = []) {
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
  const expiresAt = rows
    .map((purchase) => purchase.expires_at ? new Date(purchase.expires_at).getTime() : null)
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right)[0];
  const itemType = first.item?.item_type || 'userbot';
  const count = rows.length;
  const title = count > 1
    ? (itemType === 'bundle' ? `Аккаунты + прокси x${count}` : `Аккаунты x${count}`)
    : (first.item?.title || userbotLotKindLabel(first.item));

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
      seller_wallet: first.payload?.seller_wallet || '',
      memo: first.payload?.memo || '',
      ton_uri: first.payload?.ton_uri || '',
      trust_wallet_uri: first.payload?.trust_wallet_uri || '',
      trust_wallet_qr: first.payload?.trust_wallet_qr || '',
      ton_qr: first.payload?.ton_qr || '',
      sbp_phone: first.payload?.sbp_phone || '',
      sbp_bank: first.payload?.sbp_bank || '',
      sbp_fio: first.payload?.sbp_fio || ''
    },
    item: {
      ...(first.item || {}),
      title
    },
    assets,
    batch: rows.length > 1 || !!first.payload?.batch_token
  };
}

function userbotLotKindLabel(item) {
  if (item?.item_type === 'bundle') return 'Аккаунт + прокси';
  return 'Только аккаунт';
}

const QR_FINGERPRINT_PROFILES = [
  {
    id: 'bullrun_android_a52',
    label: 'Samsung Galaxy A52',
    note: 'Рекомендуемый Android-профиль для QR-логина. Быстрый безопасный старт без родного .json.',
    fingerprint: {
      api_id: 4,
      api_hash: '014b35b6184100b085b0d0572f9b5103',
      device_model: 'Samsung SM-A525F',
      system_version: 'SDK 33',
      app_version: '12.3.0 (63772)',
      system_lang_code: 'en-us',
      lang_code: 'en'
    }
  },
  {
    id: 'bullrun_android_redmi_note_11',
    label: 'Xiaomi Redmi Note 11',
    note: 'Альтернативный Android-профиль с русской локалью.',
    fingerprint: {
      api_id: 4,
      api_hash: '014b35b6184100b085b0d0572f9b5103',
      device_model: 'Redmi Note 11',
      system_version: 'SDK 32',
      app_version: '12.3.0 (63772)',
      system_lang_code: 'ru-ru',
      lang_code: 'ru'
    }
  },
  {
    id: 'bullrun_android_a34',
    label: 'Samsung Galaxy A34',
    note: 'Запасной Android-профиль для QR-логина.',
    fingerprint: {
      api_id: 4,
      api_hash: '014b35b6184100b085b0d0572f9b5103',
      device_model: 'Samsung SM-A346B',
      system_version: 'SDK 34',
      app_version: '12.3.0 (63772)',
      system_lang_code: 'en-gb',
      lang_code: 'en'
    }
  },
  {
    id: 'bullrun_iphone_13',
    label: 'iPhone 13',
    note: 'Стабильный iPhone-профиль для QR-логина.',
    fingerprint: {
      api_id: 4,
      api_hash: '014b35b6184100b085b0d0572f9b5103',
      device_model: 'iPhone 13',
      system_version: 'iOS 17.4',
      app_version: '12.3 (30231)',
      system_lang_code: 'en-us',
      lang_code: 'en'
    }
  },
  {
    id: 'bullrun_iphone_15_pro',
    label: 'iPhone 15 Pro',
    note: 'Свежий iPhone-профиль для QR-логина.',
    fingerprint: {
      api_id: 4,
      api_hash: '014b35b6184100b085b0d0572f9b5103',
      device_model: 'iPhone 15 Pro',
      system_version: 'iOS 17.5',
      app_version: '12.3 (30231)',
      system_lang_code: 'en-us',
      lang_code: 'en'
    }
  }
];

function qrFingerprintProfileById(profileId, profiles = QR_FINGERPRINT_PROFILES) {
  return profiles.find((item) => item.id === profileId) || profiles[0] || QR_FINGERPRINT_PROFILES[0];
}

function maskSaleUsername(username = '') {
  const clean = String(username || '').replace(/^@+/, '').trim();
  if (!clean) return '';
  if (clean.length <= 3) return `@${clean[0]}***`;
  if (clean.length <= 6) return `@${clean.slice(0, 2)}***${clean.slice(-1)}`;
  return `@${clean.slice(0, 3)}***${clean.slice(-2)}`;
}

function saleTitleForAccount(account) {
  if (account?.tg_username) {
    return maskSaleUsername(account.tg_username);
  }
  if (account?.tg_account_id) {
    return `Аккаунт ${String(account.tg_account_id).slice(-4)}`;
  }
  return 'Аккаунт';
}

function botGroupsMeta(channels = []) {
  if (!Array.isArray(channels) || !channels.length) return 'Админ в группе не назначен';
  const titles = channels
    .map((channel) => String(channel?.title || channel?.tg_chat_id || '').trim())
    .filter(Boolean);
  if (!titles.length) return 'Админ в группе не назначен';
  const summary = titles.length <= 2 ? titles.join(', ') : `${titles.slice(0, 2).join(', ')} +${titles.length - 2}`;
  return `${titles.length > 1 ? 'Админ в группах' : 'Админ в группе'}: ${summary}`;
}

function BotsAccountsPageContent({ mode = 'userbots' }) {
  const { accessToken, user, profilePlan } = useAuth();
  const [tonConnectUI] = useTonConnectUI();
  const tonWallet = useTonWallet();
  const tonModal = useTonConnectModal();
  const qrPollingIntervalRef = useRef(null);
  const qrPollingTimeoutRef = useRef(null);
  const [botForm, setBotForm] = useState({
    botToken: '',
    botRole: 'sales'
  });
  const [onboarding, setOnboarding] = useState({
    proxyId: '',
    qrFingerprintProfileId: QR_FINGERPRINT_PROFILES[0].id,
    fingerprintMode: 'preset',
    connectMethod: 'qr',
    qrCodeUrl: '',
    qrStatus: '',
    qrStatusTone: 'default',
    isGeneratingQr: false,
    isImporting: false,
    customFingerprintLabel: 'Мой профиль',
    customFingerprintNote: '',
    customApiId: String(QR_FINGERPRINT_PROFILES[0].fingerprint.api_id),
    customApiHash: QR_FINGERPRINT_PROFILES[0].fingerprint.api_hash,
    customDeviceModel: QR_FINGERPRINT_PROFILES[0].fingerprint.device_model,
    customSystemVersion: QR_FINGERPRINT_PROFILES[0].fingerprint.system_version,
    customAppVersion: QR_FINGERPRINT_PROFILES[0].fingerprint.app_version,
    customSystemLangCode: QR_FINGERPRINT_PROFILES[0].fingerprint.system_lang_code,
    customLangCode: QR_FINGERPRINT_PROFILES[0].fingerprint.lang_code,
    sessionFile: null,
    sessionFileName: '',
    jsonFile: null,
    jsonFileName: ''
  });
  const [fingerprintProfilesState, setFingerprintProfilesState] = useState({
    loading: false,
    error: '',
    profiles: QR_FINGERPRINT_PROFILES
  });
  const [bindings, setBindings] = useState({});
  const [uiMessage, setUiMessage] = useState({ tone: 'default', text: '' });
  const [accountCheckFeedback, setAccountCheckFeedback] = useState({ accountId: '', tone: 'default', text: '' });
  const [accountCheckReport, setAccountCheckReport] = useState({ accountId: '', title: '', tone: 'default', lines: [], checkedAt: '' });
  const [accountBindingFeedback, setAccountBindingFeedback] = useState({ accountId: '', tone: 'default', text: '' });
  const [accountRestoreFeedback, setAccountRestoreFeedback] = useState({ accountId: '', tone: 'default', text: '' });
  const [accountDeleteFeedback, setAccountDeleteFeedback] = useState({ accountId: '', tone: 'default', text: '' });
  const [storefrontState, setStorefrontState] = useState({
    loading: true,
    error: '',
    items: [],
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
  const [saleComposer, setSaleComposer] = useState({
    accountId: '',
    title: '',
    sale_type: 'userbot',
    price_ton: '',
    price_rub: '',
    payment_methods: ['ton'],
    saving: false,
    error: ''
  });
  const [selectedLiveUserbotId, setSelectedLiveUserbotId] = useState('');
  const [selectedShopUserbotId, setSelectedShopUserbotId] = useState('');
  const [selectedOpenPurchaseId, setSelectedOpenPurchaseId] = useState('');
  const [userbotBuyQuantity, setUserbotBuyQuantity] = useState({
    userbot: 1,
    bundle: 1
  });
  const [state, setState] = useState({
    loading: true,
    refreshing: false,
    savingBot: false,
    checkingAccountId: '',
    togglingSafeModeId: '',
    bindingAccountId: '',
    deletingAccountId: '',
    deletingShopItemId: '',
    restoringAccountId: '',
    error: '',
    accounts: [],
    proxies: [],
    proxySupport: null,
    reservedUserbotIds: [],
    reservedItemsByAsset: {},
    sellerItemsById: {},
    channels: [],
    paymentAdminTgId: '',
    recoveryMap: {},
    recoverySupported: true,
    updatedAt: null
  });

  async function payUserbotCheckoutInBrowser() {
    const purchase = checkoutState.purchase;
    if (!purchase || purchase.payment_method !== 'ton' || !purchase.seller_wallet) {
      return;
    }

    try {
      if (!tonWallet) {
        await tonModal.open();
        return;
      }

      const transaction = await buildTonConnectTransaction({
        address: purchase.seller_wallet,
        amountTon: purchase.amount_ton,
        memo: purchase.memo
      });

      await tonConnectUI.sendTransaction(transaction);
    } catch (error) {
      setCheckoutState((prev) => ({
        ...prev,
        error: normalizeTonConnectError(error)
      }));
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function loadData({ silent = false } = {}) {
      if (!silent) {
        setState((prev) => ({
          ...prev,
          loading: !prev.accounts.length,
          refreshing: !!prev.accounts.length,
          error: ''
        }));
      }

      try {
        const [accountsResp, proxiesResp, reservedResp, sellerItemsResp, paymentResp, recoveryResp, channelsResp] = await Promise.all([
          supabase
            .from('tg_accounts')
            .select('*')
            .eq('owner_id', user.id)
            .order('created_at', { ascending: false }),
          apiRequest('/api/userbot/proxies', { accessToken }),
          apiRequest('/api/shop/seller/reserved-assets', { accessToken }),
          apiRequest('/api/shop/seller/items', { accessToken }).catch(() => ({ items: [] })),
          supabase
            .from('payment_settings')
            .select('admin_tg_id')
            .eq('owner_id', user.id)
            .maybeSingle(),
          apiRequest('/api/userbot/recovery-status', { accessToken }).catch(() => ({
            support: { recovery: false },
            rows: []
          })),
          supabase
            .from('channels')
            .select('id, title, tg_chat_id, bot_id')
            .eq('owner_id', user.id)
        ]);

        if (accountsResp.error) throw accountsResp.error;
        if (paymentResp.error) throw paymentResp.error;
        if (channelsResp.error) throw channelsResp.error;

        if (!cancelled) {
          setState({
            loading: false,
            refreshing: false,
            error: '',
            accounts: accountsResp.data || [],
            proxies: proxiesResp.proxies || [],
            proxySupport: proxiesResp.support || null,
            reservedUserbotIds: (reservedResp.userbot_ids || []).map(String),
            reservedItemsByAsset: Object.fromEntries((reservedResp.entries || []).map((entry) => [entry.key, entry])),
            sellerItemsById: Object.fromEntries((sellerItemsResp.items || []).map((item) => [String(item.id), item])),
            channels: channelsResp.data || [],
            paymentAdminTgId: paymentResp.data?.admin_tg_id || '',
            recoveryMap: Object.fromEntries((recoveryResp.rows || []).map((row) => [String(row.account_id), row])),
            recoverySupported: recoveryResp.support?.recovery !== false,
            updatedAt: new Date().toISOString()
          });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            loading: false,
            refreshing: false,
            error: error.message,
            accounts: [],
            proxies: [],
            proxySupport: null,
            reservedUserbotIds: [],
            reservedItemsByAsset: {},
            sellerItemsById: {},
            channels: [],
            paymentAdminTgId: '',
            recoveryMap: {},
            recoverySupported: true,
            updatedAt: null
          });
        }
      }
    }

    if (accessToken && user?.id) {
      loadData();
    }

    const intervalId = accessToken && user?.id
      ? window.setInterval(() => {
          loadData({ silent: true });
        }, 60_000)
      : null;

    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [accessToken, user?.id]);

  useEffect(() => {
    let cancelled = false;

    async function loadStorefront() {
      if (!accessToken || state.proxySupport?.profile_role === 'admin') {
        setStorefrontState({
          loading: false,
          error: '',
          items: [],
          purchases: []
        });
        return;
      }

      try {
        const [itemsData, purchasesData] = await Promise.all([
          apiRequest('/api/shop/app/items', { accessToken }),
          apiRequest('/api/shop/public/my-purchases', { accessToken })
        ]);

        if (cancelled) return;

        setStorefrontState({
          loading: false,
          error: '',
          items: (itemsData.items || []).filter(isUserbotShopItem),
          purchases: (purchasesData.purchases || []).filter(isUserbotPurchase)
        });
      } catch (error) {
        if (cancelled) return;
        setStorefrontState({
          loading: false,
          error: error.message,
          items: [],
          purchases: []
        });
      }
    }

    loadStorefront();

    return () => {
      cancelled = true;
    };
  }, [accessToken, state.proxySupport?.profile_role]);

  useEffect(() => {
    let cancelled = false;

    async function loadFingerprintProfiles() {
      if (!accessToken) return;
      setFingerprintProfilesState((prev) => ({ ...prev, loading: true, error: '' }));
      try {
        const result = await apiRequest('/api/userbot/fingerprint-profiles', { accessToken });
        if (cancelled) return;
        const profiles = Array.isArray(result.profiles) && result.profiles.length
          ? result.profiles
          : QR_FINGERPRINT_PROFILES;
        setFingerprintProfilesState({
          loading: false,
          error: '',
          profiles
        });
      } catch (error) {
        if (cancelled) return;
        setFingerprintProfilesState({
          loading: false,
          error: error.message || 'Не удалось загрузить fingerprint-пресеты.',
          profiles: QR_FINGERPRINT_PROFILES
        });
      }
    }

    loadFingerprintProfiles();

    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  const userbots = useMemo(() => {
    return state.accounts.filter((account) => account.account_type === 'userbot');
  }, [state.accounts]);

  const fingerprintProfiles = useMemo(() => (
    Array.isArray(fingerprintProfilesState.profiles) && fingerprintProfilesState.profiles.length
      ? fingerprintProfilesState.profiles
      : QR_FINGERPRINT_PROFILES
  ), [fingerprintProfilesState.profiles]);

  const officialBots = useMemo(() => {
    return state.accounts.filter((account) => account.account_type === 'bot' && (account.bot_role || 'sales') !== 'ops');
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
  const openUserbotPurchases = useMemo(() => (
    (() => {
      const rows = (storefrontState.purchases || []).filter(isOpenUserbotPurchase);
      const grouped = new Map();
      for (const purchase of rows) {
        const key = purchase.payload?.batch_token || purchase.id;
        const bucket = grouped.get(key) || [];
        bucket.push(purchase);
        grouped.set(key, bucket);
      }
      return Array.from(grouped.values()).map((bucket) => normalizeOpenUserbotPurchaseGroup(bucket)).filter(Boolean);
    })()
  ), [storefrontState.purchases]);
  const selectedOpenPurchase = useMemo(() => {
    if (!openUserbotPurchases.length) return null;
    return openUserbotPurchases.find((purchase) => String(purchase.id) === String(selectedOpenPurchaseId)) || openUserbotPurchases[0];
  }, [openUserbotPurchases, selectedOpenPurchaseId]);
  const visibleUserbotLots = useMemo(() => (
    storefrontState.items || []
  ), [storefrontState.items]);
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

  function showUiMessage(text, tone = 'default') {
    setUiMessage({ tone, text });
  }

  function openSaleComposer(account) {
    setSaleComposer({
      accountId: String(account.id),
      title: saleTitleForAccount(account),
      sale_type: account.proxy_id ? 'bundle' : 'userbot',
      price_ton: '15',
      price_rub: '',
      payment_methods: ['ton'],
      saving: false,
      error: ''
    });
  }

  function resetSaleComposer() {
    setSaleComposer({
      accountId: '',
      title: '',
      sale_type: 'userbot',
      price_ton: '',
      price_rub: '',
      payment_methods: ['ton'],
      saving: false,
      error: ''
    });
  }

  function toggleSalePaymentMethod(method, enabled) {
    setSaleComposer((prev) => {
      const nextMethods = enabled
        ? Array.from(new Set([...(prev.payment_methods || []), method]))
        : (prev.payment_methods || []).filter((item) => item !== method);
      return {
        ...prev,
        payment_methods: nextMethods,
        price_rub: method === 'p2p' && !enabled ? '' : prev.price_rub
      };
    });
  }

  function availableBindingProxiesForAccount(account) {
    return state.proxies.filter((proxy) => {
      if (proxy.is_working === false) return false;
      if (state.proxySupport?.profile_role === 'admin' && proxy.inventory_group !== 'self_use') {
        return false;
      }

      const proxyId = String(proxy.id);
      const accountProxyId = String(account.proxy_id || '');
      return proxyId === accountProxyId || !usedUserbotProxyIds.has(proxyId);
    });
  }

  function availableFailoverProxiesForAccount(account) {
    const currentPrimaryProxyId = String(bindings[account.id]?.proxy_id || account.proxy_id || '');

    return state.proxies.filter((proxy) => {
      if (proxy.is_working === false) return false;
      if (state.proxySupport?.profile_role === 'admin' && proxy.inventory_group !== 'self_use') {
        return false;
      }

      const proxyId = String(proxy.id);
      if (proxyId === currentPrimaryProxyId) return false;
      return !usedUserbotProxyIds.has(proxyId);
    });
  }

  useEffect(() => {
    setBindings((prev) => {
      const next = { ...prev };
      userbots.forEach((account) => {
        const primaryProxyId = account.proxy_id ? String(account.proxy_id) : '';
        const safeFailoverIds = Array.isArray(account.failover_proxy_ids)
          ? account.failover_proxy_ids.map(String).filter((id) => id && id !== primaryProxyId)
          : [];
        if (!next[account.id]) {
          next[account.id] = {
            proxy_id: primaryProxyId,
            allow_proxy_failover: !!account.allow_proxy_failover,
            failover_proxy_ids: safeFailoverIds
          };
          return;
        }

        next[account.id] = {
          ...next[account.id],
          proxy_id: primaryProxyId,
          allow_proxy_failover: !!account.allow_proxy_failover,
          failover_proxy_ids: safeFailoverIds
        };
      });
      return next;
    });
  }, [userbots]);

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

  async function reloadAccounts() {
    const [accountsResp, proxiesResp, reservedResp, sellerItemsResp, paymentResp, recoveryResp] = await Promise.all([
      supabase
        .from('tg_accounts')
        .select('*')
        .eq('owner_id', user.id)
        .order('created_at', { ascending: false }),
      apiRequest('/api/userbot/proxies', { accessToken }),
      apiRequest('/api/shop/seller/reserved-assets', { accessToken }),
      apiRequest('/api/shop/seller/items', { accessToken }).catch(() => ({ items: [] })),
      supabase
        .from('payment_settings')
        .select('admin_tg_id')
        .eq('owner_id', user.id)
        .maybeSingle(),
      apiRequest('/api/userbot/recovery-status', { accessToken }).catch(() => ({
        support: { recovery: false },
        rows: []
      }))
    ]);

    if (accountsResp.error) throw accountsResp.error;
    if (paymentResp.error) throw paymentResp.error;

    setState((prev) => ({
      ...prev,
      accounts: accountsResp.data || [],
      proxies: proxiesResp.proxies || [],
      proxySupport: proxiesResp.support || null,
      reservedUserbotIds: (reservedResp.userbot_ids || []).map(String),
      reservedItemsByAsset: Object.fromEntries((reservedResp.entries || []).map((entry) => [entry.key, entry])),
      sellerItemsById: Object.fromEntries((sellerItemsResp.items || []).map((item) => [String(item.id), item])),
      paymentAdminTgId: paymentResp.data?.admin_tg_id || '',
      recoveryMap: Object.fromEntries((recoveryResp.rows || []).map((row) => [String(row.account_id), row])),
      recoverySupported: recoveryResp.support?.recovery !== false,
      updatedAt: new Date().toISOString()
    }));
  }

  async function restoreAccount(account) {
    setAccountRestoreFeedback({ accountId: String(account.id), tone: 'default', text: '' });
    setState((prev) => ({ ...prev, restoringAccountId: String(account.id) }));
    try {
      const result = await apiRequest(`/api/userbot/restore/${account.id}`, {
        accessToken,
        method: 'POST'
      });
      await reloadAccounts();
      setAccountRestoreFeedback({
        accountId: String(account.id),
        tone: 'success',
        text: `Сессию восстановили: @${result.username || account.tg_username || 'без username'}`
      });
    } catch (error) {
      setAccountRestoreFeedback({
        accountId: String(account.id),
        tone: 'error',
        text: error.message
      });
    } finally {
      setState((prev) => ({ ...prev, restoringAccountId: '' }));
    }
  }

  async function addOfficialBot() {
    if (!botForm.botToken.trim()) {
      showUiMessage('Вставь токен бота.', 'error');
      return;
    }

    setState((prev) => ({ ...prev, savingBot: true }));
    try {
      await apiRequest('/api/official-bot/add', {
        accessToken,
        method: 'POST',
        body: {
          botToken: botForm.botToken.trim(),
          botRole: 'sales'
        }
      });
      setBotForm({ botToken: '', botRole: 'sales' });
      await reloadAccounts();
      showUiMessage('Бот подключен.', 'success');
    } catch (error) {
      showUiMessage(error.message, 'error');
    } finally {
      setState((prev) => ({ ...prev, savingBot: false }));
    }
  }

  async function deleteAccount(account) {
    if (!window.confirm(`Удалить ${account.account_type === 'userbot' ? 'юзербота' : 'бота'} и освободить его контур?`)) {
      return;
    }

    setAccountDeleteFeedback({ accountId: String(account.id), tone: 'default', text: '' });
    setState((prev) => ({ ...prev, deletingAccountId: String(account.id) }));
    try {
      await apiRequest(`/api/userbot/${account.id}`, {
        accessToken,
        method: 'DELETE'
      });
      await reloadAccounts();
      setAccountDeleteFeedback({
        accountId: String(account.id),
        tone: 'success',
        text: 'Аккаунт удален.'
      });
    } catch (error) {
      setAccountDeleteFeedback({
        accountId: String(account.id),
        tone: 'error',
        text: error.message
      });
    } finally {
      setState((prev) => ({ ...prev, deletingAccountId: '' }));
    }
  }

  async function deleteShopItem(itemId) {
    if (!itemId) return;
    if (!window.confirm('Удалить лот? Это сработает только если по нему нет живой или оплаченной покупки.')) {
      return;
    }

    setState((prev) => ({ ...prev, deletingShopItemId: String(itemId) }));
    try {
      await apiRequest(`/api/shop/seller/items/${itemId}`, {
        accessToken,
        method: 'DELETE'
      });
      await reloadAccounts();
      showUiMessage('Лот удален из Shop.', 'success');
    } catch (error) {
      showUiMessage(error.message, 'error');
    } finally {
      setState((prev) => ({ ...prev, deletingShopItemId: '' }));
    }
  }

  async function checkAccount(account) {
    const isFresh = String(account?.runtime_status || '') === 'pending_activation';
    const actionLabel = isFresh ? 'Активировать аккаунт' : 'Проверить Telegram';
    if (!window.confirm(`${actionLabel}: это живая Telegram-проверка, а не просто чтение локальной сессии. Мы проверим, отвечает ли сессия, есть ли ограничения у аккаунта и что показывает пассивная проверка через SpamBot. ${isFresh ? 'Для свежего импорта это снимет safe-mode и переведёт аккаунт в рабочий статус, если Telegram не видит проблем. ' : ''}Продолжить?`)) {
      return;
    }
    const accountId = account?.id;
    setAccountCheckFeedback({ accountId: String(accountId), tone: 'default', text: '' });
    setAccountCheckReport({ accountId: String(accountId), title: '', tone: 'default', lines: [], checkedAt: '' });
    setState((prev) => ({ ...prev, checkingAccountId: String(accountId) }));
    try {
      const result = await apiRequest(`/api/userbot/check/${accountId}?activate=true`, { accessToken });
      await reloadAccounts();
      const summary = summarizeCheckStatus(result, account);
      setAccountCheckFeedback({
        accountId: String(accountId),
        tone: summary.tone,
        text: result?.reason || summary.title
      });
      setAccountCheckReport({
        accountId: String(accountId),
        title: summary.title,
        tone: summary.tone,
        lines: buildCheckLines(result, account),
        checkedAt: new Date().toISOString()
      });
    } catch (error) {
      setAccountCheckFeedback({
        accountId: String(accountId),
        tone: 'error',
        text: error.message
      });
      setAccountCheckReport({
        accountId: String(accountId),
        title: 'Проверка упала',
        tone: 'error',
        lines: [
          checkLine('Сессия', '', 'error'),
          checkLine('Ограничения', '', 'default'),
          checkLine('SpamBot', '', 'default')
        ],
        checkedAt: new Date().toISOString()
      });
    } finally {
      setState((prev) => ({ ...prev, checkingAccountId: '' }));
    }
  }

  async function toggleSafeMode(account) {
    const accountId = String(account?.id || '');
    if (!accountId) return;

    const isSafeMode = String(account?.runtime_status || '') === 'pending_activation';

    if (isSafeMode) {
      await checkAccount(account);
      return;
    }

    if (!window.confirm('Вернуть аккаунт в safe-mode? Автоматика и живые Telegram-действия снова будут отключены до следующей ручной активации.')) {
      return;
    }

    setState((prev) => ({ ...prev, togglingSafeModeId: accountId }));
    try {
      await apiRequest(`/api/userbot/safe-mode/${accountId}`, {
        accessToken,
        method: 'POST',
        body: { enabled: true }
      });
      await reloadAccounts();
      setAccountCheckReport({
        accountId,
        title: 'Safe-mode включен',
        tone: 'warning',
        lines: [
          checkLine('Сессия', '', 'default'),
          checkLine('Ограничения', '', 'default'),
          checkLine('SpamBot', '', 'default')
        ],
        checkedAt: new Date().toISOString()
      });
    } catch (error) {
      setAccountCheckReport({
        accountId,
        title: 'Safe-mode не переключился',
        tone: 'error',
        lines: [
          checkLine('Сессия', '', 'error'),
          checkLine('Ограничения', '', 'default'),
          checkLine('SpamBot', '', 'default')
        ],
        checkedAt: new Date().toISOString()
      });
    } finally {
      setState((prev) => ({ ...prev, togglingSafeModeId: '' }));
    }
  }

  async function saveBinding(accountId) {
    const binding = bindings[accountId];
    setAccountBindingFeedback({ accountId: String(accountId), tone: 'default', text: '' });
    if (!binding?.proxy_id) {
      setAccountBindingFeedback({
        accountId: String(accountId),
        tone: 'error',
        text: 'Юзербот должен быть привязан к прокси. Пустое значение нельзя сохранить.'
      });
      return;
    }

    setState((prev) => ({ ...prev, bindingAccountId: String(accountId) }));
    try {
      await apiRequest('/api/userbot/bind-proxy', {
        accessToken,
        method: 'POST',
        body: {
          account_id: accountId,
          proxy_id: binding.proxy_id,
          allow_proxy_failover: !!binding.allow_proxy_failover,
          failover_proxy_ids: (binding.failover_proxy_ids || []).filter((id) => id && id !== binding.proxy_id)
        }
      });
      await reloadAccounts();
      setAccountBindingFeedback({
        accountId: String(accountId),
        tone: 'success',
        text: 'Привязка прокси обновлена.'
      });
    } catch (error) {
      setAccountBindingFeedback({
        accountId: String(accountId),
        tone: 'error',
        text: error.message
      });
    } finally {
      setState((prev) => ({ ...prev, bindingAccountId: '' }));
    }
  }

  async function saveUserbotSaleLot(account) {
    if (!saleComposer.title.trim()) {
      setSaleComposer((prev) => ({ ...prev, error: 'Укажи название лота.' }));
      return;
    }
    if ((saleComposer.payment_methods || []).length === 0) {
      setSaleComposer((prev) => ({ ...prev, error: 'Выбери хотя бы один способ оплаты.' }));
      return;
    }

    const wantsBundle = saleComposer.sale_type === 'bundle';
    if (wantsBundle && !account.proxy_id) {
      setSaleComposer((prev) => ({ ...prev, error: 'У этого юзербота нет привязанного прокси для bundle-продажи.' }));
      return;
    }
    const linkedProxy = wantsBundle
      ? state.proxies.find((proxy) => String(proxy.id) === String(account.proxy_id))
      : null;

    setSaleComposer((prev) => ({ ...prev, saving: true, error: '' }));
    try {
      await apiRequest('/api/shop/seller/items', {
        accessToken,
        method: 'POST',
        body: {
          title: saleComposer.title,
          description: wantsBundle
            ? (account.tg_username
                ? `Готовый seller userbot @${account.tg_username} вместе с его прокси.`
                : `Готовый seller userbot ${account.tg_account_id} вместе с его прокси.`)
            : (account.tg_username
                ? `Готовый seller userbot @${account.tg_username}.`
                : `Готовый seller userbot ${account.tg_account_id}.`),
          preview_text: wantsBundle
            ? 'Готовый Telegram-аккаунт BullRun вместе с его прокси.'
            : 'Готовый Telegram-аккаунт BullRun для seller-операционки.',
          payment_methods: saleComposer.payment_methods,
          post_purchase_message: null,
          offer_code: null,
          item_type: wantsBundle ? 'bundle' : 'userbot',
          sales_channel: 'admin_only',
          price_ton: Number(saleComposer.price_ton || 0),
          price_rub: Number(saleComposer.price_rub || 0),
          status: 'published',
          visibility: 'public',
          transfer_mode: 'ownership_transfer',
          assets: wantsBundle
            ? [
                {
                  asset_type: 'userbot',
                  asset_id: account.id,
                  label: account.tg_username ? `@${account.tg_username}` : `ID ${account.tg_account_id}`
                },
                {
                  asset_type: 'proxy',
                  asset_id: account.proxy_id,
                  label: linkedProxy ? proxyLabel(linkedProxy) : String(account.proxy_id)
                }
              ]
            : [{
                asset_type: 'userbot',
                asset_id: account.id,
                label: account.tg_username ? `@${account.tg_username}` : `ID ${account.tg_account_id}`
              }]
        }
      });

      resetSaleComposer();
      await reloadAccounts();
    } catch (error) {
      setSaleComposer((prev) => ({
        ...prev,
        saving: false,
        error: error.message
      }));
    }
  }

  async function openUserbotCheckout(item, preferredPaymentMethod = null) {
    const selectedPaymentMethod = userbotLotPaymentMethods(item).includes(preferredPaymentMethod)
      ? preferredPaymentMethod
      : userbotLotPaymentMethods(item).includes(checkoutState.paymentMethod)
        ? checkoutState.paymentMethod
        : (userbotLotPaymentMethods(item)[0] || 'ton');

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
      setStorefrontState((prev) => ({
        ...prev,
        purchases: (purchasesData.purchases || []).filter(isUserbotPurchase)
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
          seller_wallet: data.seller_wallet || '',
          memo: data.memo || '',
          ton_uri: data.ton_uri || '',
          trust_wallet_uri: data.trust_wallet_uri || '',
          trust_wallet_qr: data.trust_wallet_qr || '',
          ton_qr: data.ton_qr || '',
          expires_at: data.expires_at || null,
          status: 'pending',
          sbp_phone: data.sbp_phone || '',
          sbp_bank: data.sbp_bank || '',
          sbp_fio: data.sbp_fio || '',
          receipt_file_url: ''
        }
      });
    } catch (error) {
      let existingPurchase = null;
      try {
        const purchasesData = await apiRequest('/api/shop/public/my-purchases', { accessToken });
        existingPurchase = (purchasesData.purchases || []).find((purchase) => (
          String(purchase.item?.id || '') === String(item.id) &&
          (purchase.status === 'pending' || purchase.status === 'awaiting_receipt' || purchase.status === 'paid')
        )) || null;
        setStorefrontState((prev) => ({
          ...prev,
          purchases: (purchasesData.purchases || []).filter(isUserbotPurchase)
        }));
      } catch {
        existingPurchase = null;
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
          receipt_file_url: existingPurchase.payload?.receipt_file_url || ''
        } : null,
        loading: false,
        checking: false,
        error: error.message
      });
    }
  }

  async function createUserbotBatchCheckout(items, preferredPaymentMethod = null) {
    const batchItems = Array.isArray(items) ? items.filter(Boolean) : [];
    if (!batchItems.length) return;

    const availableMethods = batchUserbotLotPaymentMethods(batchItems);
    const selectedPaymentMethod = availableMethods.includes(preferredPaymentMethod)
      ? preferredPaymentMethod
      : (availableMethods[0] || 'ton');

    if (batchItems.length === 1) {
      await openUserbotCheckout(batchItems[0], selectedPaymentMethod);
      return;
    }

    setCheckoutState({
      item: {
        item_type: batchItems[0]?.item_type || 'userbot',
        title: batchItems[0]?.item_type === 'bundle' ? `Аккаунты + прокси x${batchItems.length}` : `Аккаунты x${batchItems.length}`
      },
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
      setStorefrontState((prev) => ({
        ...prev,
        purchases: (purchasesData.purchases || []).filter(isUserbotPurchase)
      }));
      setCheckoutState({
        item: {
          item_type: batchItems[0]?.item_type || 'userbot',
          title: batchItems[0]?.item_type === 'bundle' ? `Аккаунты + прокси x${batchItems.length}` : `Аккаунты x${batchItems.length}`
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
          status: 'pending',
          sbp_phone: data.sbp_phone || '',
          sbp_bank: data.sbp_bank || '',
          sbp_fio: data.sbp_fio || '',
          receipt_file_url: '',
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
        setStorefrontState((prev) => ({
          ...prev,
          purchases: (purchasesData.purchases || []).filter(isUserbotPurchase)
        }));
      }
      setCheckoutState({
        item: null,
        purchase: null,
        paymentMethod: selectedPaymentMethod,
        loading: false,
        checking: false,
        error: error.message || 'Не удалось создать общую покупку аккаунтов.'
      });
    }
  }

  async function checkUserbotCheckout() {
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

      const purchasesData = await apiRequest('/api/shop/public/my-purchases', { accessToken });
      setStorefrontState((prev) => ({
        ...prev,
        purchases: (purchasesData.purchases || []).filter(isUserbotPurchase)
      }));
      setCheckoutState({
        item: null,
        purchase: null,
        paymentMethod: 'ton',
        loading: false,
        checking: false,
        error: ''
      });
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

  function showUserbotPurchaseInline(purchase) {
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
        batch: !!purchase.batch
      },
      paymentMethod: purchase.payload?.payment_method || 'ton',
      loading: false,
      checking: false,
      error: ''
    });
  }

  async function markUserbotCheckoutPaid() {
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
      setStorefrontState((prev) => ({
        ...prev,
        purchases: (purchasesData.purchases || []).filter(isUserbotPurchase)
      }));
      setReceiptNote('');
      setReceiptFile(null);
      if (refreshed.length === 1) {
        showUserbotPurchaseInline(refreshed[0]);
      } else if (refreshed.length > 1) {
        showUserbotPurchaseInline(normalizeOpenUserbotPurchaseGroup(refreshed));
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

  function updateBinding(accountId, patch) {
    setBindings((prev) => ({
      ...prev,
      [accountId]: (() => {
        const next = {
          proxy_id: '',
          allow_proxy_failover: false,
          failover_proxy_ids: [],
          ...(prev[accountId] || {}),
          ...patch
        };
        if (next.proxy_id) {
          next.failover_proxy_ids = (next.failover_proxy_ids || []).filter((id) => String(id) !== String(next.proxy_id));
        }
        return next;
      })()
    }));
  }

  function proxyLabel(proxy) {
    const geo = proxy.last_check_country ? ` • ${proxy.last_check_country}` : '';
    return `${proxy.name} (${proxy.host}:${proxy.port})${geo} • ${proxyTelegramModeLabel(proxy)}`;
  }

  function currentQrFingerprintProfile(profileId = onboarding.qrFingerprintProfileId) {
    return qrFingerprintProfileById(profileId, fingerprintProfiles);
  }

  function primeCustomFingerprintFromProfile(profileId = onboarding.qrFingerprintProfileId) {
    const profile = currentQrFingerprintProfile(profileId);
    if (!profile) return;
    updateOnboarding({
      customFingerprintLabel: profile.label || 'Мой профиль',
      customFingerprintNote: profile.note || '',
      customApiId: String(profile.fingerprint?.api_id || ''),
      customApiHash: profile.fingerprint?.api_hash || '',
      customDeviceModel: profile.fingerprint?.device_model || profile.fingerprint?.deviceModel || '',
      customSystemVersion: profile.fingerprint?.system_version || profile.fingerprint?.systemVersion || '',
      customAppVersion: profile.fingerprint?.app_version || profile.fingerprint?.appVersion || '',
      customSystemLangCode: profile.fingerprint?.system_lang_code || profile.fingerprint?.systemLangCode || '',
      customLangCode: profile.fingerprint?.lang_code || profile.fingerprint?.langCode || ''
    });
  }

  function switchFingerprintMode(nextMode) {
    if (nextMode === 'custom') {
      primeCustomFingerprintFromProfile();
    }
    updateOnboarding({ fingerprintMode: nextMode });
  }

  function buildCustomFingerprintPayload() {
    return {
      label: onboarding.customFingerprintLabel.trim() || 'Мой профиль',
      note: onboarding.customFingerprintNote.trim(),
      api_id: Number(onboarding.customApiId || 0),
      api_hash: onboarding.customApiHash.trim(),
      device_model: onboarding.customDeviceModel.trim(),
      system_version: onboarding.customSystemVersion.trim(),
      app_version: onboarding.customAppVersion.trim(),
      system_lang_code: onboarding.customSystemLangCode.trim(),
      lang_code: onboarding.customLangCode.trim()
    };
  }

  function updateOnboarding(patch) {
    setOnboarding((prev) => ({ ...prev, ...patch }));
  }

  function handleSessionFileChange(event) {
    updateOnboarding({
      sessionFile: event.target.files?.[0] || null,
      sessionFileName: event.target.files?.[0]?.name || ''
    });
  }

  function handleJsonFileChange(event) {
    updateOnboarding({
      jsonFile: event.target.files?.[0] || null,
      jsonFileName: event.target.files?.[0]?.name || ''
    });
  }

  function stopQrPolling() {
    if (qrPollingIntervalRef.current) {
      window.clearInterval(qrPollingIntervalRef.current);
      qrPollingIntervalRef.current = null;
    }
    if (qrPollingTimeoutRef.current) {
      window.clearTimeout(qrPollingTimeoutRef.current);
      qrPollingTimeoutRef.current = null;
    }
  }

  async function pollQrStatus() {
    stopQrPolling();
    updateOnboarding({ qrStatus: 'Ждем скан и вход...', qrStatusTone: 'default' });

    qrPollingIntervalRef.current = window.setInterval(async () => {
      try {
        const result = await apiRequest('/api/userbot/qr-status', { accessToken });
        if (result.status === 'success') {
          stopQrPolling();
          const profileLabel = result.fingerprint_profile_label || currentQrFingerprintProfile(onboarding.qrFingerprintProfileId).label;
          updateOnboarding({
            qrStatus: `Аккаунт подключен в safe-mode. Профиль входа: ${profileLabel}. Сейчас подтянем его в список, а в работу его введешь отдельной живой активацией.`,
            qrCodeUrl: '',
            qrStatusTone: 'success'
          });
          await reloadAccounts();
        }
      } catch (error) {
        if (String(error.message).includes('404')) {
          stopQrPolling();
          updateOnboarding({ qrStatus: 'QR больше не активен. Сгенерируй новый.', qrStatusTone: 'error' });
          return;
        }
        stopQrPolling();
        updateOnboarding({
          qrStatus: error.message || 'Не удалось проверить статус QR. Остановили ожидание, чтобы не долбить API бесконечно.',
          qrStatusTone: 'error'
        });
      }
    }, 3000);

    qrPollingTimeoutRef.current = window.setTimeout(() => {
      stopQrPolling();
      updateOnboarding({
        qrStatus: 'QR-ожидание истекло. Сгенерируй новый код, если вход так и не завершился.',
        qrStatusTone: 'error'
      });
    }, 3 * 60 * 1000);
  }

  useEffect(() => () => {
    stopQrPolling();
  }, []);

  useEffect(() => {
    if (!fingerprintProfiles.length) return;
    if (fingerprintProfiles.some((profile) => profile.id === onboarding.qrFingerprintProfileId)) return;
    const firstProfile = fingerprintProfiles[0];
    if (!firstProfile) return;
    setOnboarding((prev) => ({
      ...prev,
      qrFingerprintProfileId: firstProfile.id
    }));
  }, [fingerprintProfiles, onboarding.qrFingerprintProfileId]);

  async function startQrLogin() {
    if (!planRules.canCreateMultipleUserbots && userbots.length >= planRules.maxUserbots) {
      showUiMessage(`На ${planRules.label} даем только ${planRules.maxUserbots} юзербота. Для следующего аккаунта переводи кабинет на Normal.`, 'error');
      return;
    }
    if (!onboarding.proxyId) {
      showUiMessage('Сначала выбери живой прокси. Юзерботы теперь подключаются только через прокси.', 'error');
      return;
    }
    const selectedQrFingerprint = currentQrFingerprintProfile(onboarding.qrFingerprintProfileId);
    const usingCustomFingerprint = onboarding.fingerprintMode === 'custom';
    const customFingerprint = usingCustomFingerprint ? buildCustomFingerprintPayload() : null;
    const fingerprintLabel = usingCustomFingerprint
      ? (customFingerprint.label || 'Свой профиль')
      : selectedQrFingerprint.label;

    if (!window.confirm(`Сгенерировать QR через выбранный прокси и профиль "${fingerprintLabel}"? Это живая Telegram-авторизация. После входа аккаунт сохранится в safe-mode, без автозапуска рабочих действий, а fingerprint закрепится за этой сессией.`)) {
      return;
    }

    updateOnboarding({
      isGeneratingQr: true,
      qrCodeUrl: '',
      qrStatus: '',
      qrStatusTone: 'default'
    });

    try {
      const result = await apiRequest('/api/userbot/qr-start', {
        accessToken,
        method: 'POST',
        body: {
          proxy_id: onboarding.proxyId,
          fingerprint_profile_id: usingCustomFingerprint ? '' : onboarding.qrFingerprintProfileId,
          custom_fingerprint: customFingerprint
        }
      });
      const profileLabel = result.fingerprint_profile_label || fingerprintLabel;
      updateOnboarding({
        qrCodeUrl: result.qrCode || '',
        qrStatus: result.qrCode ? `QR готов. Сканируй его в Telegram. Профиль входа: ${profileLabel}.` : 'QR не пришел.',
        qrStatusTone: result.qrCode ? 'success' : 'error'
      });
      if (result.qrCode) {
        pollQrStatus();
      }
    } catch (error) {
      updateOnboarding({
        qrStatus: normalizeOnboardingErrorMessage(error),
        qrStatusTone: 'error'
      });
    } finally {
      updateOnboarding({ isGeneratingQr: false });
    }
  }

  async function importSession() {
    if (!planRules.canCreateMultipleUserbots && userbots.length >= planRules.maxUserbots) {
      showUiMessage(`На ${planRules.label} даем только ${planRules.maxUserbots} юзербота. Для следующего аккаунта переводи кабинет на Normal.`, 'error');
      return;
    }
    if (!onboarding.sessionFile) {
      showUiMessage('Сначала выбери .session файл.', 'error');
      return;
    }
    if (!onboarding.jsonFile) {
      showUiMessage('Для безопасного импорта обязателен и .json с fingerprint. Без него импорт не даем.', 'error');
      return;
    }
    if (!onboarding.proxyId) {
      showUiMessage('Сначала выбери живой прокси.', 'error');
      return;
    }
    if (!window.confirm('Импорт `.session + .json` даёт сервису полный доступ к аккаунту. `tdata`, `Password2FA.txt`, `Accounts.txt` и другие соседние файлы сюда грузить не надо. После импорта аккаунт встанет в safe-mode и не пойдёт в автоматику до ручной активации. Продолжить?')) {
      return;
    }

    updateOnboarding({
      isImporting: true,
      qrStatus: '',
      qrStatusTone: 'default'
    });
    try {
      const formData = new FormData();
      formData.append('sessionFile', onboarding.sessionFile);
      formData.append('jsonFile', onboarding.jsonFile);
      formData.append('proxy_id', onboarding.proxyId);

      const response = await fetch('/api/userbot/import-session-file'.startsWith('http') ? '/api/userbot/import-session-file' : `${window.location.origin.replace(/\/$/, '')}/api/userbot/import-session-file`, {
        method: 'POST',
        headers: {
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
        },
        body: formData
      });

      let data = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }

      if (!response.ok || data?.error) {
        throw new Error(data?.error || `HTTP ${response.status}`);
      }

      updateOnboarding({
        sessionFile: null,
        sessionFileName: '',
        jsonFile: null,
        jsonFileName: '',
        qrStatus: '',
        qrStatusTone: 'default'
      });
      await reloadAccounts();
    } catch (error) {
      updateOnboarding({
        qrStatus: normalizeOnboardingErrorMessage(error),
        qrStatusTone: 'error'
      });
    } finally {
      updateOnboarding({ isImporting: false });
    }
  }

  async function cancelUserbotCheckout(purchaseOverride = null) {
    const targetPurchase = purchaseOverride || checkoutState.purchase;
    const targetIds = Array.isArray(targetPurchase?.purchase_ids) && targetPurchase.purchase_ids.length
      ? targetPurchase.purchase_ids
      : [targetPurchase?.id].filter(Boolean);
    if (!targetIds.length) return;
    if (!window.confirm('Отменить покупку и снять бронь?')) return;

    setCheckoutState((prev) => ({
      ...prev,
      checking: true,
      error: ''
    }));

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

      const purchasesData = await apiRequest('/api/shop/public/my-purchases', { accessToken });
      setStorefrontState((prev) => ({
        ...prev,
        purchases: (purchasesData.purchases || []).filter(isUserbotPurchase)
      }));
      setCheckoutState({
        item: null,
        purchase: null,
        paymentMethod: 'ton',
        loading: false,
        checking: false,
        error: ''
      });
      setReceiptNote('');
      setReceiptFile(null);
      showUiMessage('Покупка отменена, бронь снята.', 'success');
    } catch (error) {
      setCheckoutState((prev) => ({
        ...prev,
        checking: false,
        error: error.message
      }));
    }
  }

  function renderInlineCheckoutPanel() {
    if (!checkoutState.purchase) return null;

    return (
      <div className="mt-4 rounded-[18px] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-4 flex justify-end">
          <button
            type="button"
            className="inline-flex h-9 items-center justify-center rounded-[12px] border border-slate-200 px-3 text-[13px] font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
            onClick={() => {
              setCheckoutState({
                item: null,
                purchase: null,
                paymentMethod: 'ton',
                loading: false,
                checking: false,
                error: ''
              });
              setReceiptNote('');
              setReceiptFile(null);
            }}
          >
            Свернуть
          </button>
        </div>

        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-[14px] bg-slate-50 px-4 py-3">
            <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-400">Сумма</div>
            <div className="mt-1 text-[15px] font-semibold text-slate-900">{userbotPurchaseAmountSummary(checkoutState.purchase)}</div>
          </div>
          {checkoutState.purchase.expires_at ? (
            <div className="rounded-[14px] bg-slate-50 px-4 py-3">
              <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-400">До</div>
              <div className="mt-1 text-[15px] font-semibold text-slate-900">{formatWhen(checkoutState.purchase.expires_at)}</div>
            </div>
          ) : null}
        </div>

        {checkoutState.purchase.payment_method === 'ton' ? (
          <div className="space-y-4">
            <div className="rounded-[14px] border border-blue-100 bg-blue-50 px-4 py-3 text-[13px] text-blue-900">
              Переведи ровно эту сумму с этим memo. Иначе платеж не сматчится.
            </div>
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
              <div className="space-y-3">
                {checkoutState.purchase.seller_wallet ? (
                  <div className="rounded-[14px] bg-slate-50 px-4 py-3">
                    <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-400">Кошелек</div>
                    <div className="mt-1 break-all font-mono text-[13px] text-slate-900">{checkoutState.purchase.seller_wallet}</div>
                  </div>
                ) : null}
                {checkoutState.purchase.memo ? (
                  <div className="rounded-[14px] bg-slate-50 px-4 py-3">
                    <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-400">Memo</div>
                    <div className="mt-1 break-all font-mono text-[13px] text-slate-900">{checkoutState.purchase.memo}</div>
                  </div>
                ) : null}
              </div>
              {(checkoutState.purchase.trust_wallet_qr || checkoutState.purchase.ton_qr) ? (
                <div className="flex items-center justify-center rounded-[16px] border border-slate-200 bg-slate-50 p-3">
                  <img
                    src={checkoutState.purchase.trust_wallet_qr || checkoutState.purchase.ton_qr}
                    alt="TON QR"
                    className="w-full max-w-[180px]"
                  />
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                className="inline-flex h-11 items-center justify-center rounded-[14px] bg-blue-600 px-5 text-[14px] font-semibold text-white transition hover:bg-blue-700"
                type="button"
                onClick={payUserbotCheckoutInBrowser}
              >
                {tonWallet ? 'Оплатить в Chrome' : 'Подключить кошелек в Chrome'}
              </button>
              {checkoutState.purchase.ton_uri || checkoutState.purchase.trust_wallet_uri ? (
                <a
                  className="inline-flex h-11 items-center justify-center rounded-[14px] border border-slate-200 px-5 text-[14px] font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
                  href={checkoutState.purchase.trust_wallet_uri || checkoutState.purchase.ton_uri}
                >
                  Оплатить в Trust Wallet
                </a>
              ) : null}
              <button
                className="inline-flex h-11 items-center justify-center rounded-[14px] border border-slate-200 px-5 text-[14px] font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
                type="button"
                onClick={checkUserbotCheckout}
                disabled={checkoutState.checking}
              >
                {checkoutState.checking ? 'Проверяем...' : 'Проверить оплату'}
              </button>
              <button
                className="inline-flex h-11 items-center justify-center rounded-[14px] border border-rose-200 px-5 text-[14px] font-semibold text-rose-700 transition hover:border-rose-300 hover:text-rose-800"
                type="button"
                onClick={cancelUserbotCheckout}
                disabled={checkoutState.checking}
              >
                Отменить покупку
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-[14px] border border-blue-100 bg-blue-50 px-4 py-3 text-[13px] text-blue-900">
              Сначала переведи, потом кинь чек. Без чека продавец оплату не подтвердит.
            </div>
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
              <div className="space-y-3">
                {checkoutState.purchase.sbp_fio ? (
                  <div className="rounded-[14px] bg-slate-50 px-4 py-3">
                    <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-400">Получатель</div>
                    <div className="mt-1 text-[15px] font-semibold text-slate-900">{checkoutState.purchase.sbp_fio}</div>
                  </div>
                ) : null}
                {checkoutState.purchase.sbp_bank ? (
                  <div className="rounded-[14px] bg-slate-50 px-4 py-3">
                    <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-400">Банки</div>
                    <div className="mt-1 text-[15px] font-semibold text-slate-900">{checkoutState.purchase.sbp_bank}</div>
                  </div>
                ) : null}
                {checkoutState.purchase.sbp_phone ? (
                  <div className="rounded-[14px] bg-slate-50 px-4 py-3">
                    <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-400">Телефон</div>
                    <div className="mt-1 font-mono text-[13px] text-slate-900">{checkoutState.purchase.sbp_phone}</div>
                  </div>
                ) : null}
              </div>
            </div>
            {checkoutState.purchase.status === 'awaiting_receipt' ? (
              <div className="rounded-[14px] border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
                Чек уже отправлен. Жди ручную проверку.
                {checkoutState.purchase.receipt_file_url ? (
                  <>
                    {' '}<a href={resolveBackendAssetUrl(checkoutState.purchase.receipt_file_url)} target="_blank" rel="noreferrer">Открыть чек</a>
                  </>
                ) : null}
              </div>
            ) : (
              <>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="space-y-2">
                    <span className="text-[13px] font-semibold text-slate-800">Комментарий к чеку</span>
                    <input
                      className="h-11 w-full rounded-[14px] border border-slate-200 bg-white px-4 text-[14px] text-slate-950 outline-none transition focus:border-blue-300"
                      value={receiptNote}
                      onChange={(event) => setReceiptNote(event.target.value)}
                      placeholder="Например: оплатил со Сбера"
                    />
                  </label>
                  <label className="space-y-2">
                    <span className="text-[13px] font-semibold text-slate-800">Чек</span>
                    <input
                      className="h-11 w-full rounded-[14px] border border-slate-200 bg-white px-4 text-[14px] text-slate-950 file:mr-3 file:border-0 file:bg-transparent file:text-[13px] file:font-semibold"
                      type="file"
                      accept="image/*,.pdf"
                      onChange={(event) => setReceiptFile(event.target.files?.[0] || null)}
                    />
                    {checkoutState.purchase.receipt_file_url ? (
                      <span className="text-[12px] text-slate-500">
                        Уже отправлен: <a href={resolveBackendAssetUrl(checkoutState.purchase.receipt_file_url)} target="_blank" rel="noreferrer">открыть файл</a>
                      </span>
                    ) : null}
                  </label>
                </div>
                <div className="flex flex-wrap gap-3">
                  <button
                    className="inline-flex h-11 items-center justify-center rounded-[14px] bg-blue-600 px-5 text-[14px] font-semibold text-white transition hover:bg-blue-700"
                    type="button"
                    onClick={markUserbotCheckoutPaid}
                    disabled={checkoutState.checking}
                  >
                    {checkoutState.checking ? 'Отправляем...' : 'Отправить чек продавцу'}
                  </button>
                  <button
                    className="inline-flex h-11 items-center justify-center rounded-[14px] border border-rose-200 px-5 text-[14px] font-semibold text-rose-700 transition hover:border-rose-300 hover:text-rose-800"
                    type="button"
                    onClick={cancelUserbotCheckout}
                    disabled={checkoutState.checking}
                  >
                    Отменить покупку
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {checkoutState.error ? (
          <div className="mt-4 rounded-[14px] border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">
            {checkoutState.error}
          </div>
        ) : null}
      </div>
    );
  }

  function renderOpenPurchaseSummary(purchase) {
    if (!purchase) return null;
    const status = purchaseStatusMeta(purchase.status);
    const isActiveCheckout = String(checkoutState.purchase?.id || '') === String(purchase.id);
    const hasProxyInBundle = purchase.item?.item_type === 'bundle' || (Array.isArray(purchase.assets) && purchase.assets.some((asset) => asset.asset_type === 'proxy'));
    const purchaseItem = purchase.item || null;
    const purchasePaymentMethods = userbotLotPaymentMethods(purchaseItem);
    const canSwitchPaymentMethod = purchase.status === 'pending' && purchasePaymentMethods.length > 1;
    return (
      <div className="rounded-[18px] border border-blue-200 bg-blue-50/40 p-4 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="text-[15px] font-semibold text-slate-900">{purchase.item?.title || userbotLotKindLabel(purchase.item)}</div>
            <div className="mt-3 flex flex-wrap gap-2">
              <div className="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1.5">
                <div className="text-[12px] font-medium text-emerald-700">Аккаунт</div>
              </div>
              <div className={`inline-flex items-center rounded-full px-3 py-1.5 ${
                hasProxyInBundle ? 'bg-emerald-50' : 'bg-slate-100'
              }`}>
                <div className={`text-[12px] font-medium ${
                  hasProxyInBundle ? 'text-emerald-700' : 'text-slate-600'
                }`}>
                  Proxy
                </div>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className={status.className}>{status.text}</span>
            <button
              className="inline-flex h-10 items-center justify-center rounded-[13px] border border-rose-200 bg-white px-4 text-[14px] font-semibold text-rose-700 transition hover:border-rose-300 hover:text-rose-800"
              type="button"
              onClick={() => cancelUserbotCheckout(purchase)}
              disabled={checkoutState.checking && isActiveCheckout}
            >
              {checkoutState.checking && isActiveCheckout ? 'Отменяем...' : 'Отменить покупку'}
            </button>
          </div>
        </div>
        <div className="mt-4 rounded-[14px] bg-white px-4 py-3">
          <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-400">Выбор оплаты</div>
          {canSwitchPaymentMethod ? (
            <div className="mt-3 grid grid-cols-2 gap-3 rounded-[20px] bg-slate-100 p-2">
              {purchasePaymentMethods.map((method) => {
                const currentMethod = isActiveCheckout
                  ? (checkoutState.purchase?.payment_method || purchase.payload?.payment_method || purchase.payment_method || 'ton')
                  : (purchase.payload?.payment_method || purchase.payment_method || 'ton');
                const active = currentMethod === method;
                return (
                  <button
                    key={method}
                    type="button"
                    className={`flex items-center justify-center gap-2 rounded-[18px] px-5 py-4 text-[14px] font-semibold transition ${
                      active
                        ? 'bg-white text-slate-950 shadow-[0_8px_24px_rgba(15,23,42,0.10)]'
                        : 'bg-transparent text-slate-500'
                    }`}
                    onClick={() => {
                      if (checkoutState.loading || checkoutState.checking) return;
                      if (active) {
                        if (!isActiveCheckout) {
                          showUserbotPurchaseInline(purchase);
                        }
                        return;
                      }
                      openUserbotCheckout(purchaseItem, method);
                    }}
                    disabled={checkoutState.loading || checkoutState.checking}
                  >
                    <span>{paymentMethodLabel(method)}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="mt-1 text-[15px] font-semibold text-slate-900">{paymentMethodLabel(purchase.payload?.payment_method || purchase.payment_method || 'ton')}</div>
          )}
        </div>
        {isActiveCheckout ? renderInlineCheckoutPanel() : null}
      </div>
    );
  }

  function renderQrFingerprintConfigurator(stepNumber) {
    if (onboarding.connectMethod !== 'qr') return null;
    const selectedProfile = currentQrFingerprintProfile(onboarding.qrFingerprintProfileId);

    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2.5">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[12px] font-semibold text-white">
            {stepNumber}
          </div>
          <div className="text-[16px] leading-none font-semibold tracking-[-0.03em] text-slate-950">Fingerprint профиля</div>
        </div>
        <div className="grid grid-cols-2 gap-3 rounded-[20px] bg-slate-100 p-2">
          <button
            type="button"
            onClick={() => switchFingerprintMode('preset')}
            className={`flex items-center justify-center gap-2 rounded-[18px] px-4 py-3 text-[14px] font-semibold transition ${
              onboarding.fingerprintMode === 'preset'
                ? 'bg-white text-blue-600 shadow-[0_8px_24px_rgba(15,23,42,0.10)]'
                : 'bg-transparent text-slate-600'
            }`}
          >
            <span>Готовый пресет</span>
          </button>
          <button
            type="button"
            onClick={() => switchFingerprintMode('custom')}
            className={`flex items-center justify-center gap-2 rounded-[18px] px-4 py-3 text-[14px] font-semibold transition ${
              onboarding.fingerprintMode === 'custom'
                ? 'bg-white text-slate-950 shadow-[0_8px_24px_rgba(15,23,42,0.10)]'
                : 'bg-transparent text-slate-500'
            }`}
          >
            <span>Свой профиль</span>
          </button>
        </div>

        {onboarding.fingerprintMode === 'preset' ? (
          <div className="space-y-2">
            <select
              className="h-11 w-full rounded-[14px] border border-slate-200 bg-white px-4 text-[15px] text-slate-950 outline-none transition focus:border-blue-300"
              value={onboarding.qrFingerprintProfileId}
              onChange={(event) => updateOnboarding({ qrFingerprintProfileId: event.target.value })}
            >
              {fingerprintProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.owner_id ? `${profile.label} • мой` : profile.label}
                </option>
              ))}
            </select>
            {selectedProfile?.note ? (
              <div className="text-[12px] leading-5 text-slate-500">{selectedProfile.note}</div>
            ) : null}
            {fingerprintProfilesState.error ? (
              <div className="text-[12px] leading-5 text-amber-600">{fingerprintProfilesState.error}</div>
            ) : null}
          </div>
        ) : (
          <div className="space-y-3 rounded-[18px] bg-slate-50/80 p-4">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-[13px] font-semibold text-slate-800">Название профиля</span>
                <input
                  className="h-11 w-full rounded-[14px] border border-slate-200 bg-white px-4 text-[14px] text-slate-950 outline-none transition focus:border-blue-300"
                  value={onboarding.customFingerprintLabel}
                  onChange={(event) => updateOnboarding({ customFingerprintLabel: event.target.value })}
                  placeholder="Например: мой Android 15"
                />
              </label>
              <label className="space-y-2">
                <span className="text-[13px] font-semibold text-slate-800">api_id</span>
                <input
                  className="h-11 w-full rounded-[14px] border border-slate-200 bg-white px-4 text-[14px] text-slate-950 outline-none transition focus:border-blue-300"
                  value={onboarding.customApiId}
                  onChange={(event) => updateOnboarding({ customApiId: event.target.value })}
                  placeholder="2040"
                />
              </label>
              <label className="space-y-2 md:col-span-2">
                <span className="text-[13px] font-semibold text-slate-800">api_hash</span>
                <input
                  className="h-11 w-full rounded-[14px] border border-slate-200 bg-white px-4 text-[14px] text-slate-950 outline-none transition focus:border-blue-300"
                  value={onboarding.customApiHash}
                  onChange={(event) => updateOnboarding({ customApiHash: event.target.value })}
                  placeholder="32-символьный hash"
                />
              </label>
              <label className="space-y-2">
                <span className="text-[13px] font-semibold text-slate-800">Устройство</span>
                <input
                  className="h-11 w-full rounded-[14px] border border-slate-200 bg-white px-4 text-[14px] text-slate-950 outline-none transition focus:border-blue-300"
                  value={onboarding.customDeviceModel}
                  onChange={(event) => updateOnboarding({ customDeviceModel: event.target.value })}
                />
              </label>
              <label className="space-y-2">
                <span className="text-[13px] font-semibold text-slate-800">Система</span>
                <input
                  className="h-11 w-full rounded-[14px] border border-slate-200 bg-white px-4 text-[14px] text-slate-950 outline-none transition focus:border-blue-300"
                  value={onboarding.customSystemVersion}
                  onChange={(event) => updateOnboarding({ customSystemVersion: event.target.value })}
                />
              </label>
              <label className="space-y-2">
                <span className="text-[13px] font-semibold text-slate-800">Версия Telegram</span>
                <input
                  className="h-11 w-full rounded-[14px] border border-slate-200 bg-white px-4 text-[14px] text-slate-950 outline-none transition focus:border-blue-300"
                  value={onboarding.customAppVersion}
                  onChange={(event) => updateOnboarding({ customAppVersion: event.target.value })}
                />
              </label>
              <label className="space-y-2">
                <span className="text-[13px] font-semibold text-slate-800">system_lang_code</span>
                <input
                  className="h-11 w-full rounded-[14px] border border-slate-200 bg-white px-4 text-[14px] text-slate-950 outline-none transition focus:border-blue-300"
                  value={onboarding.customSystemLangCode}
                  onChange={(event) => updateOnboarding({ customSystemLangCode: event.target.value })}
                />
              </label>
              <label className="space-y-2">
                <span className="text-[13px] font-semibold text-slate-800">lang_code</span>
                <input
                  className="h-11 w-full rounded-[14px] border border-slate-200 bg-white px-4 text-[14px] text-slate-950 outline-none transition focus:border-blue-300"
                  value={onboarding.customLangCode}
                  onChange={(event) => updateOnboarding({ customLangCode: event.target.value })}
                />
              </label>
            </div>
          </div>
        )}
      </div>
    );
  }

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

  const isUserbotMode = mode === 'userbots';
  const isOfficialMode = mode === 'official-bots';

  return (
    <section className="page page--flush">
      {uiMessage.text ? (
        <div className={`userbots-status-note userbots-status-note--${uiMessage.tone || 'default'}`}>
          {uiMessage.text}
        </div>
      ) : null}

      {isOfficialMode ? (
        <>
          <div className="toolbar-card">
            <div className="toolbar-card__title">
              Подключить{' '}
              <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">
                @BotFather
              </a>
            </div>
            <div className="toolbar-card__body">
              <input
                className="field"
                type="text"
                value={botForm.botToken}
                onChange={(event) => setBotForm((prev) => ({ ...prev, botToken: event.target.value }))}
                placeholder="8123456789:AAE_x7v9Kq2LmN4pR8sTuVwXyZ0abCDeFg"
              />
              <button className="ghost-button ghost-button--primary" onClick={addOfficialBot} disabled={state.savingBot}>
                {state.savingBot ? 'Подключаем...' : 'Подключить'}
              </button>
            </div>
          </div>

          <div className="section">
            <div className="section__title">Подключенные боты</div>
            {officialBots.length === 0 ? (
              <div className="table-card">
                <div className="empty-inline">Ботов пока нет.</div>
              </div>
            ) : (
              <div className="grid gap-3">
                {officialBots.map((account) => (
                  <div key={account.id} className="list-item">
                    <div className="list-item__head">
                      <div>
                        <div className="list-item__title">@{account.tg_username || 'без username'}</div>
                        <div className="list-item__meta">
                          {botGroupsMeta(channelsByBotId[String(account.id)] || [])}
                        </div>
                      </div>
                    </div>
                    <div className="list-item__footer">
                      <div className="table-actions">
                        <button
                          className="inline-action inline-action--danger"
                          onClick={() => deleteAccount(account)}
                          disabled={state.deletingAccountId === String(account.id)}
                        >
                          {state.deletingAccountId === String(account.id) ? 'Удаляем...' : 'Удалить'}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      ) : !canSellUserbotAssets ? (
        <>
          <div className="userbots-market-shell">
            {openUserbotPurchases.length > 0 ? (
              <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[20px] font-semibold tracking-[-0.03em] text-slate-950">Нужно оплатить</div>
                    <div className="mt-1 text-[14px] text-slate-500">Открытые покупки, которые еще не закрыты оплатой.</div>
                  </div>
                  <span className="inline-flex min-w-7 items-center justify-center rounded-full bg-slate-100 px-2.5 py-1 text-[12px] font-semibold text-slate-700">
                    {openUserbotPurchases.length}
                  </span>
                </div>
                <div className="space-y-3">
                  <select
                    className="h-11 w-full rounded-[14px] border border-slate-200 bg-white px-4 text-[15px] font-medium text-slate-900 outline-none transition focus:border-blue-300"
                    value={selectedOpenPurchase ? String(selectedOpenPurchase.id) : ''}
                    onChange={(event) => {
                      const nextId = event.target.value;
                      setSelectedOpenPurchaseId(nextId);
                      const nextPurchase = openUserbotPurchases.find((purchase) => String(purchase.id) === String(nextId));
                      if (nextPurchase) {
                        showUserbotPurchaseInline(nextPurchase);
                      }
                    }}
                  >
                    {openUserbotPurchases.map((purchase) => (
                      <option key={purchase.id} value={purchase.id}>
                        {purchase.item?.title || userbotLotKindLabel(purchase.item)}
                      </option>
                    ))}
                  </select>
                  {selectedOpenPurchase ? renderOpenPurchaseSummary(selectedOpenPurchase) : null}
                </div>
              </div>
            ) : null}

            <div className="space-y-4">
              {storefrontState.error ? <div className="error-inline">{storefrontState.error}</div> : null}
              <div className="grid userbots-buy-grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4">
                {storefrontState.loading ? (
                  <div className="rounded-[20px] border border-slate-200 bg-white px-5 py-6 shadow-sm">
                    <div className="text-[14px] text-slate-500">Подтягиваем лоты из Shop...</div>
                  </div>
                ) : (
                  [
                    {
                      slotKey: 'userbot',
                      item: accountOnlyUserbotLot,
                      items: accountOnlyUserbotLots,
                      title: 'Аккаунт',
                      hasProxy: false,
                      emptyText: 'Свободного аккаунта без прокси сейчас нет.',
                      helperText: 'Чистая продажа аккаунта без прокси. После передачи прокси привяжешь уже у себя.'
                    },
                    {
                      slotKey: 'bundle',
                      item: bundledUserbotLot,
                      items: bundledUserbotLots,
                      title: 'Аккаунт + прокси',
                      hasProxy: true,
                      emptyText: 'Свободного аккаунта с прокси сейчас нет.',
                      helperText: 'После покупки аккаунт остается на своем прокси. Не нужно срочно пересаживать его на новый IP.'
                    }
                  ].map((slot) => {
                    const item = slot.item;
                    if (!item) {
                      return (
                        <article key={slot.slotKey} className="flex h-full flex-col gap-3 rounded-[18px] border border-slate-200 bg-white p-4 shadow-sm">
                          <div className="space-y-2">
                            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">{slot.title}</div>
                            <div className="flex flex-wrap gap-2">
                              <div className="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1.5">
                                <div className="text-[12px] font-medium text-emerald-700">Аккаунт</div>
                              </div>
                              <div className={`inline-flex items-center rounded-full px-3 py-1.5 ${
                                slot.hasProxy ? 'bg-emerald-50' : 'bg-slate-100'
                              }`}>
                                <div className={`text-[12px] font-medium ${
                                  slot.hasProxy ? 'text-emerald-700' : 'text-slate-600'
                                }`}>
                                  Proxy
                                </div>
                              </div>
                            </div>
                          </div>
                          <div className="space-y-1">
                            <div className="text-[20px] font-black leading-none tracking-[-0.04em] text-slate-900">Нет в наличии</div>
                            <div className="text-[12px] leading-5 text-slate-500">{slot.emptyText}</div>
                          </div>
                        </article>
                      );
                    }

                    const quantity = Math.min(
                      Math.max(Number(userbotBuyQuantity[slot.slotKey] || 1), 1),
                      Math.max(slot.items.length, 1)
                    );
                    const selectedItems = slot.items.slice(0, quantity);
                    const methods = batchUserbotLotPaymentMethods(selectedItems);
                    const assets = Array.isArray(item.assets) ? item.assets : [];
                    const hasProxy = item.item_type === 'bundle' || assets.some((asset) => asset.asset_type === 'proxy');
                    return (
                      <article key={item.id} className="flex h-full flex-col gap-3 rounded-[18px] border border-slate-200 bg-white p-4 shadow-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 space-y-2">
                            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">{slot.title}</div>
                            <div className="line-clamp-2 text-[17px] font-semibold leading-6 tracking-[-0.02em] text-slate-900">{item.title}</div>
                          </div>
                          <div className="shrink-0 flex flex-wrap justify-end gap-2">
                            <div className="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1.5">
                              <div className="text-[12px] font-medium text-emerald-700">Аккаунт</div>
                            </div>
                            <div className={`inline-flex items-center rounded-full px-3 py-1.5 ${
                              hasProxy ? 'bg-emerald-50' : 'bg-slate-100'
                            }`}>
                              <div className={`text-[12px] font-medium ${
                                hasProxy ? 'text-emerald-700' : 'text-slate-600'
                              }`}>
                                Proxy
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="space-y-1">
                          <div className="text-[22px] font-black leading-none tracking-[-0.04em] text-slate-900">{userbotItemPriceSummary(item)}</div>
                          <div className="text-[12px] leading-5 text-slate-500">
                            {slot.hasProxy ? 'С прокси. Можно запускать без пересадки.' : 'Без прокси. Подключишь свой позже.'}
                          </div>
                        </div>
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                className="flex h-9 w-9 items-center justify-center rounded-[11px] border border-slate-200 bg-white text-[18px] font-semibold text-slate-700 transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-40"
                                onClick={() => setUserbotBuyQuantity((prev) => ({
                                  ...prev,
                                  [slot.slotKey]: Math.max(Number(prev[slot.slotKey] || 1) - 1, 1)
                                }))}
                                disabled={quantity <= 1}
                                aria-label="Уменьшить количество"
                              >
                                -
                              </button>
                              <div className="flex h-9 min-w-[68px] items-center justify-center rounded-[11px] border border-slate-200 bg-white px-3 text-[13px] font-semibold text-slate-900">
                                {quantity} шт.
                              </div>
                              <button
                                type="button"
                                className="flex h-9 w-9 items-center justify-center rounded-[11px] border border-slate-200 bg-white text-[18px] font-semibold text-slate-700 transition hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-40"
                                onClick={() => setUserbotBuyQuantity((prev) => ({
                                  ...prev,
                                  [slot.slotKey]: Math.min(Number(prev[slot.slotKey] || 1) + 1, Math.max(slot.items.length, 1))
                                }))}
                                disabled={quantity >= Math.max(slot.items.length, 1)}
                                aria-label="Увеличить количество"
                              >
                                +
                              </button>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2 sm:justify-end">
                          {['ton', 'p2p'].map((method) => {
                            const enabled = methods.includes(method);
                            const loading = checkoutState.loading && checkoutState.item?.id === item.id;
                            return (
                              <button
                                key={`${item.id}:${method}`}
                                className={`inline-flex h-9 min-w-[82px] items-center justify-center rounded-[11px] px-4 text-[13px] font-semibold transition ${
                                  enabled
                                    ? method === 'ton'
                                      ? 'bg-blue-600 text-white hover:bg-blue-700'
                                      : 'border border-slate-200 bg-white text-slate-800 hover:border-slate-300 hover:bg-slate-50'
                                    : 'border border-slate-200 bg-slate-100 text-slate-400 opacity-60 cursor-not-allowed'
                                }`}
                                type="button"
                                onClick={() => {
                                  if (!enabled) return;
                                  createUserbotBatchCheckout(selectedItems, method);
                                }}
                                disabled={!enabled || loading}
                                title={!enabled ? 'Для выбранного количества этот способ недоступен' : undefined}
                              >
                                {loading && checkoutState.paymentMethod === method
                                  ? 'Открываем...'
                                  : paymentMethodLabel(method)}
                              </button>
                            );
                          })}
                          </div>
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </div>

            <div className="mb-6 rounded-[18px] border border-slate-200/80 bg-white/95 px-6 py-6 shadow-sm">
              <div className="space-y-4">
                <div className="text-[24px] leading-none font-semibold tracking-[-0.03em] text-slate-950">
                  Подключить самому
                </div>
                <div className="flex items-center gap-2.5">
                  <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[12px] font-semibold text-white">
                    1
                  </div>
                  <div className="text-[16px] leading-none font-semibold tracking-[-0.03em] text-slate-950">Выбор прокси</div>
                </div>
                <select
                  className="h-11 w-full rounded-[14px] border border-slate-200 bg-white px-4 text-[15px] text-slate-950 outline-none transition focus:border-blue-300"
                  value={onboarding.proxyId}
                  onChange={(event) => updateOnboarding({ proxyId: event.target.value })}
                >
                  <option value="">Выбери живой прокси</option>
                  {availableOnboardingProxies.map((proxy) => (
                    <option key={proxy.id} value={proxy.id}>
                      {proxyLabel(proxy)}{proxy.provision_source === 'purchased' && Number(proxy.userbot_count || 0) === 0 ? ' • куплен и свободен' : ''}
                    </option>
                  ))}
                </select>
                <div className="flex items-center gap-2.5">
                  <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[12px] font-semibold text-white">
                    3
                  </div>
                  <div className="text-[16px] leading-none font-semibold tracking-[-0.03em] text-slate-950">Способ входа</div>
                </div>
                <div className="grid grid-cols-2 gap-3 rounded-[20px] bg-slate-100 p-2">
                  <button
                    type="button"
                    onClick={() => updateOnboarding({ connectMethod: 'qr' })}
                    className={`flex items-center justify-center gap-2 rounded-[18px] px-5 py-4 text-[14px] font-semibold transition ${
                      onboarding.connectMethod === 'qr'
                        ? 'bg-white text-blue-600 shadow-[0_8px_24px_rgba(15,23,42,0.10)]'
                        : 'bg-transparent text-slate-600'
                    }`}
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                      className="shrink-0"
                    >
                      <path d="M4 9V5h4"></path>
                      <path d="M20 9V5h-4"></path>
                      <path d="M4 15v4h4"></path>
                      <path d="M20 15v4h-4"></path>
                      <path d="M9 4H7a3 3 0 0 0-3 3v2"></path>
                      <path d="M15 4h2a3 3 0 0 1 3 3v2"></path>
                      <path d="M9 20H7a3 3 0 0 1-3-3v-2"></path>
                      <path d="M15 20h2a3 3 0 0 0 3-3v-2"></path>
                      <rect x="9" y="9" width="6" height="6" rx="1.4"></rect>
                    </svg>
                    <span>Через QR</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => updateOnboarding({ connectMethod: 'files' })}
                    className={`flex items-center justify-center gap-2 rounded-[18px] px-5 py-4 text-[14px] font-semibold transition ${
                      onboarding.connectMethod === 'files'
                      ? 'bg-white text-slate-950 shadow-[0_8px_24px_rgba(15,23,42,0.10)]'
                      : 'bg-transparent text-slate-500'
                    }`}
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                      className="shrink-0"
                    >
                      <path d="M8 7.5h5l2.5 2.5H20a2 2 0 0 1 2 2v4.5a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9.5a2 2 0 0 1 2-2Z"></path>
                      <path d="M5 9.5H4a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h1"></path>
                      <path d="M9.5 13h5"></path>
                      <path d="M9.5 16h3"></path>
                    </svg>
                    <span>Из файлов</span>
                  </button>
                </div>
                {renderQrFingerprintConfigurator(4)}
                <div className="flex items-center gap-2.5">
                  <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[12px] font-semibold text-white">
                    {onboarding.connectMethod === 'files' ? '4' : '5'}
                  </div>
                  <div className="text-[16px] leading-none font-semibold tracking-[-0.03em] text-slate-950">
                    {onboarding.connectMethod === 'files' ? 'Загрузка файлов' : 'Вход через QR'}
                  </div>
                </div>
                {onboarding.connectMethod === 'files' ? (
                  <div className="space-y-3 rounded-[18px] bg-slate-50/80 p-4">
                    <div className="space-y-3">
                      <div className="space-y-2">
                        <div>
                          <div className="text-[13px] font-semibold text-slate-800">Файл `.session`</div>
                          <div className="text-[12px] leading-5 text-slate-500">Основная Telegram-сессия аккаунта</div>
                        </div>
                        <div className={`relative flex w-full items-center gap-3 rounded-[16px] border bg-white px-4 py-3 text-left transition hover:border-slate-300 hover:bg-slate-50 ${
                          onboarding.sessionFileName ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-200'
                        }`}>
                          <input
                            type="file"
                            accept=".session"
                            className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
                            onChange={handleSessionFileChange}
                          />
                          <div className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-slate-100 text-slate-500">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"></path>
                              <path d="M14 3v5h5"></path>
                            </svg>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[14px] font-medium text-slate-900">{onboarding.sessionFileName || 'Выбрать файл'}</div>
                          </div>
                          <div className="text-[12px] font-semibold text-slate-500">{onboarding.sessionFileName ? 'Заменить' : '.session'}</div>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div>
                          <div className="text-[13px] font-semibold text-slate-800">Файл `.json`</div>
                          <div className="text-[12px] leading-5 text-slate-500">Профиль устройства для этой же сессии</div>
                        </div>
                        <div className={`relative flex w-full items-center gap-3 rounded-[16px] border bg-white px-4 py-3 text-left transition hover:border-slate-300 hover:bg-slate-50 ${
                          onboarding.jsonFileName ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-200'
                        }`}>
                          <input
                            type="file"
                            accept=".json,application/json"
                            className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
                            onChange={handleJsonFileChange}
                          />
                          <div className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-slate-100 text-slate-500">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"></path>
                              <path d="M14 3v5h5"></path>
                              <path d="M9 13h6"></path>
                              <path d="M9 17h4"></path>
                            </svg>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[14px] font-medium text-slate-900">{onboarding.jsonFileName || 'Выбрать файл'}</div>
                          </div>
                          <div className="text-[12px] font-semibold text-slate-500">{onboarding.jsonFileName ? 'Заменить' : '.json'}</div>
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={importSession}
                      disabled={!onboarding.sessionFile || !onboarding.jsonFile || onboarding.isImporting}
                      className="inline-flex h-11 items-center justify-center rounded-[14px] bg-blue-600 px-5 text-[14px] font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
                    >
                      {onboarding.isImporting ? 'Подключаем...' : 'Подключить'}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {onboarding.qrCodeUrl ? (
                      <div>
                        <img src={onboarding.qrCodeUrl} alt="QR login" className="mx-auto w-full max-w-[220px]" />
                      </div>
                    ) : (
                      <div className="rounded-[16px] border border-dashed border-slate-300 bg-white px-4 py-6">
                        <button
                          type="button"
                          onClick={startQrLogin}
                          disabled={onboarding.isGeneratingQr}
                          className="inline-flex h-11 w-full items-center justify-center rounded-[14px] bg-blue-600 px-5 text-[14px] font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                        >
                          {onboarding.isGeneratingQr ? 'Генерируем QR...' : 'Получить QR'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {onboarding.qrStatus ? (
              <div className={`table-subtext userbots-status-note userbots-status-note--${onboarding.qrStatusTone || 'default'}`}>
                {onboarding.qrStatus}
              </div>
            ) : null}

          </div>
        </>
      ) : (
        <>
          <div className="mb-6 rounded-[18px] border border-slate-200/80 bg-white/95 px-6 py-6 shadow-sm">
            <div className="space-y-4">
              <div className="text-[24px] leading-none font-semibold tracking-[-0.03em] text-slate-950">
                Подключить самому
              </div>
              <div className="flex items-center gap-2.5">
                <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[12px] font-semibold text-white">
                  1
                </div>
                <div className="text-[16px] leading-none font-semibold tracking-[-0.03em] text-slate-950">Выбор прокси</div>
              </div>
              <select
                className="h-11 w-full rounded-[14px] border border-slate-200 bg-white px-4 text-[15px] text-slate-950 outline-none transition focus:border-blue-300"
                value={onboarding.proxyId}
                onChange={(event) => updateOnboarding({ proxyId: event.target.value })}
              >
                <option value="">Выбери живой прокси</option>
                {availableOnboardingProxies.map((proxy) => (
                  <option key={proxy.id} value={proxy.id}>
                    {proxyLabel(proxy)}{proxy.provision_source === 'purchased' && Number(proxy.userbot_count || 0) === 0 ? ' • куплен и свободен' : ''}
                  </option>
                ))}
              </select>
              <div className="flex items-center gap-2.5">
                <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[12px] font-semibold text-white">
                  2
                </div>
                <div className="text-[16px] leading-none font-semibold tracking-[-0.03em] text-slate-950">Способ входа</div>
              </div>
              <div className="grid grid-cols-2 gap-3 rounded-[20px] bg-slate-100 p-2">
                <button
                  type="button"
                  onClick={() => updateOnboarding({ connectMethod: 'qr' })}
                  className={`flex items-center justify-center gap-2 rounded-[18px] px-5 py-4 text-[14px] font-semibold transition ${
                    onboarding.connectMethod === 'qr'
                      ? 'bg-white text-blue-600 shadow-[0_8px_24px_rgba(15,23,42,0.10)]'
                      : 'bg-transparent text-slate-600'
                  }`}
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    className="shrink-0"
                  >
                    <path d="M4 9V5h4"></path>
                    <path d="M20 9V5h-4"></path>
                    <path d="M4 15v4h4"></path>
                    <path d="M20 15v4h-4"></path>
                    <path d="M9 4H7a3 3 0 0 0-3 3v2"></path>
                    <path d="M15 4h2a3 3 0 0 1 3 3v2"></path>
                    <path d="M9 20H7a3 3 0 0 1-3-3v-2"></path>
                    <path d="M15 20h2a3 3 0 0 0 3-3v-2"></path>
                    <rect x="9" y="9" width="6" height="6" rx="1.4"></rect>
                  </svg>
                  <span>Через QR</span>
                </button>
                <button
                  type="button"
                  onClick={() => updateOnboarding({ connectMethod: 'files' })}
                  className={`flex items-center justify-center gap-2 rounded-[18px] px-5 py-4 text-[14px] font-semibold transition ${
                    onboarding.connectMethod === 'files'
                      ? 'bg-white text-slate-950 shadow-[0_8px_24px_rgba(15,23,42,0.10)]'
                      : 'bg-transparent text-slate-500'
                  }`}
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    className="shrink-0"
                  >
                    <path d="M8 7.5h5l2.5 2.5H20a2 2 0 0 1 2 2v4.5a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9.5a2 2 0 0 1 2-2Z"></path>
                    <path d="M5 9.5H4a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h1"></path>
                    <path d="M9.5 13h5"></path>
                    <path d="M9.5 16h3"></path>
                  </svg>
                  <span>Из файлов</span>
                </button>
              </div>
              {renderQrFingerprintConfigurator(3)}
              <div className="flex items-center gap-2.5">
                <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[12px] font-semibold text-white">
                  {onboarding.connectMethod === 'files' ? '3' : '4'}
                </div>
                <div className="text-[16px] leading-none font-semibold tracking-[-0.03em] text-slate-950">
                  {onboarding.connectMethod === 'files' ? 'Загрузка файлов' : 'Вход через QR'}
                </div>
              </div>
              {onboarding.connectMethod === 'files' ? (
                <div className="space-y-3 rounded-[18px] bg-slate-50/80 p-4">
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <div>
                        <div className="text-[13px] font-semibold text-slate-800">Файл `.session`</div>
                        <div className="text-[12px] leading-5 text-slate-500">Основная Telegram-сессия аккаунта</div>
                      </div>
                      <div className={`relative flex w-full items-center gap-3 rounded-[16px] border bg-white px-4 py-3 text-left transition hover:border-slate-300 hover:bg-slate-50 ${
                        onboarding.sessionFileName ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-200'
                      }`}>
                        <input
                          type="file"
                          accept=".session"
                          className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
                          onChange={handleSessionFileChange}
                        />
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-slate-100 text-slate-500">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"></path>
                            <path d="M14 3v5h5"></path>
                          </svg>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[14px] font-medium text-slate-900">{onboarding.sessionFileName || 'Выбрать файл'}</div>
                        </div>
                        <div className="text-[12px] font-semibold text-slate-500">{onboarding.sessionFileName ? 'Заменить' : '.session'}</div>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div>
                        <div className="text-[13px] font-semibold text-slate-800">Файл `.json`</div>
                        <div className="text-[12px] leading-5 text-slate-500">Профиль устройства для этой же сессии</div>
                      </div>
                      <div className={`relative flex w-full items-center gap-3 rounded-[16px] border bg-white px-4 py-3 text-left transition hover:border-slate-300 hover:bg-slate-50 ${
                        onboarding.jsonFileName ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-200'
                      }`}>
                        <input
                          type="file"
                          accept=".json,application/json"
                          className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
                          onChange={handleJsonFileChange}
                        />
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-slate-100 text-slate-500">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"></path>
                            <path d="M14 3v5h5"></path>
                            <path d="M9 13h6"></path>
                            <path d="M9 17h4"></path>
                          </svg>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[14px] font-medium text-slate-900">{onboarding.jsonFileName || 'Выбрать файл'}</div>
                        </div>
                        <div className="text-[12px] font-semibold text-slate-500">{onboarding.jsonFileName ? 'Заменить' : '.json'}</div>
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={importSession}
                    disabled={!onboarding.sessionFile || !onboarding.jsonFile || onboarding.isImporting}
                    className="inline-flex h-11 items-center justify-center rounded-[14px] bg-blue-600 px-5 text-[14px] font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
                  >
                    {onboarding.isImporting ? 'Подключаем...' : 'Подключить'}
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {onboarding.qrCodeUrl ? (
                    <div>
                      <img src={onboarding.qrCodeUrl} alt="QR login" className="mx-auto w-full max-w-[220px]" />
                    </div>
                  ) : (
                    <div className="rounded-[16px] border border-dashed border-slate-300 bg-white px-4 py-6">
                      <button
                        type="button"
                        onClick={startQrLogin}
                        disabled={onboarding.isGeneratingQr}
                        className="inline-flex h-11 w-full items-center justify-center rounded-[14px] bg-blue-600 px-5 text-[14px] font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                      >
                        {onboarding.isGeneratingQr ? 'Генерируем QR...' : 'Получить QR'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {onboarding.qrStatus ? (
            <div className={`table-subtext userbots-status-note userbots-status-note--`}>
              {onboarding.qrStatus}
            </div>
          ) : null}

          <div className="section">
            <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              {liveUserbots.length === 0 || !selectedLiveUserbot ? (
                <div className="rounded-[18px] border border-dashed border-slate-200 bg-slate-50/60 px-5 py-6">
                  <div className="text-[16px] font-semibold text-slate-900">Боевых юзерботов пока нет</div>
                  <div className="mt-1 text-[14px] text-slate-500">Сначала подключи аккаунт выше.</div>
                </div>
              ) : (
                (() => {
                  const account = selectedLiveUserbot;
                  const proxy = state.proxies.find((item) => String(item.id) === String(account.proxy_id));
                  const restrictedBadge = restrictedMarker(account);
                  const recovery = state.recoveryMap[String(account.id)];
                  const recoveryBadge = recoveryStatusBadge(recovery);
                  const failoverOptions = availableFailoverProxiesForAccount(account);
                  const selectedBinding = bindings[account.id] || {
                    proxy_id: account.proxy_id ? String(account.proxy_id) : '',
                    allow_proxy_failover: !!account.allow_proxy_failover,
                    failover_proxy_ids: Array.isArray(account.failover_proxy_ids) ? account.failover_proxy_ids.map(String) : []
                  };
                  const runtimeStatus = String(account.runtime_status || '');
                  const hasRecoveryInfo = !!(recovery?.last_restored_at || recovery?.last_restore_error);
                  const showRecoveryNextStep = !recovery && ['expired', 'error'].includes(runtimeStatus);

                  return (
                    <div className="space-y-5">
                      <div>
                        <div className="flex flex-col gap-2">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center">
                              <span className="text-[12px] font-medium uppercase tracking-[0.08em] text-slate-400">Боевые аккаунты</span>
                              <span className="ml-2 inline-flex min-w-6 items-center justify-center rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                                {liveUserbots.length}
                              </span>
                            </div>
                            <button
                              className="inline-flex h-9 items-center justify-center rounded-[12px] border border-rose-200 bg-rose-50 px-3 text-[13px] font-medium text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                              onClick={() => deleteAccount(account)}
                              disabled={state.deletingAccountId === String(account.id)}
                            >
                              {state.deletingAccountId === String(account.id) ? 'Удаляем...' : 'Удалить'}
                            </button>
                          </div>
                          <div className="w-full lg:max-w-[420px]">
                            <select
                              className="h-12 w-full rounded-[16px] border border-slate-200 bg-white px-4 text-[15px] font-medium text-slate-900 outline-none transition focus:border-blue-500"
                              value={String(account.id)}
                              onChange={(event) => setSelectedLiveUserbotId(event.target.value)}
                            >
                              {liveUserbots.map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.tg_username ? `@${item.tg_username}` : `TG ID ${item.tg_account_id}`}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>

                      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
                        <div className="space-y-4">
                          <div className="rounded-[20px] bg-slate-50/70 p-5">
                            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <div className="text-[26px] font-semibold tracking-[-0.03em] text-slate-950">
                                  {account.tg_username ? `@${account.tg_username}` : 'без username'}
                                </div>
                                <div className="mt-1 text-[14px] text-slate-500">TG ID {account.tg_account_id}</div>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {restrictedBadge ? <span className={restrictedBadge.className}>{restrictedBadge.text}</span> : null}
                                {recoveryBadge ? <span className={recoveryBadge.className}>{recoveryBadge.text}</span> : null}
                              </div>
                            </div>
                            {runtimeStatus === 'pending_activation' ? (
                              <div className="mt-4 rounded-[14px] border border-amber-200 bg-amber-50 px-4 py-3 text-[14px] text-amber-800">
                                Сейчас это safe-mode. В работу зайдет только после живой активации.
                              </div>
                            ) : restrictedBadge?.detail ? (
                              <div className="mt-4 text-[14px] text-rose-600">{restrictedBadge.detail}</div>
                            ) : account.runtime_error && ['restricted', 'dead_proxy', 'expired', 'error'].includes(runtimeStatus) ? (
                              <div className="mt-4 rounded-[14px] border border-rose-200 bg-rose-50 px-4 py-3 text-[14px] text-rose-700">
                                {account.runtime_error}
                              </div>
                            ) : null}

                            <div className="mt-4 rounded-[18px] border border-slate-200 bg-white p-4">
                              <div className="text-[15px] font-semibold text-slate-900">Прокси сейчас</div>
                              {proxy ? (
                                <div className="mt-3 space-y-3 text-[14px]">
                                  <div className="rounded-[14px] bg-slate-50 px-3 py-3">
                                    <div className="font-medium text-slate-900">{proxy.name}</div>
                                    <div className="mt-1 text-[13px] text-slate-500">
                                      Выпадающее меню ниже показывает текущий прокси и позволяет сразу сменить его без лишних деталей.
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                <div className="mt-3 rounded-[14px] border border-amber-200 bg-amber-50 px-4 py-3 text-[14px] text-amber-800">
                                  <div className="font-medium">Прокси не назначен</div>
                                  <div className="mt-1">Без него этот аккаунт в работу не пускай.</div>
                                </div>
                              )}

                              <label className="mt-4 block">
                                <select
                                  className="h-11 w-full rounded-[14px] border border-slate-200 bg-white px-4 text-[14px] text-slate-900 outline-none transition focus:border-blue-500"
                                  value={selectedBinding.proxy_id || ''}
                                  onChange={(event) => updateBinding(account.id, { proxy_id: event.target.value })}
                                >
                                  <option value="">Выбери живой прокси</option>
                                  {availableBindingProxiesForAccount(account).map((item) => (
                                    <option key={item.id} value={item.id}>
                                      {proxyLabel(item)}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            </div>

                            {hasRecoveryInfo ? (
                              <div className="mt-4 rounded-[18px] border border-slate-200 bg-white p-4 text-[14px] text-slate-600">
                                <div className="text-[15px] font-semibold text-slate-900">Восстановление</div>
                                <div className="mt-3 space-y-2">
                                  {recovery?.last_restored_at ? (
                                    <div>Последний подъем: <span className="text-slate-900">{formatWhen(recovery.last_restored_at)}</span></div>
                                  ) : null}
                                  {recovery?.last_restore_error ? (
                                    <div className="text-rose-600">Последняя ошибка: {recovery.last_restore_error}</div>
                                  ) : null}
                                </div>
                              </div>
                            ) : null}

                            {showRecoveryNextStep ? (
                              <div className="mt-4 rounded-[14px] border border-amber-200 bg-amber-50 px-4 py-3 text-[14px] text-amber-800">
                                Для подъема нужен импорт `.session` и, если есть, `.json`.
                              </div>
                            ) : null}
                          </div>
                        </div>

                        <div className="space-y-4">
                          <div className="space-y-4">
                            <div className="rounded-[18px] border border-slate-200 bg-white p-4">
                              <div className="flex items-start justify-between gap-4">
                                <div className="min-w-0">
                                  <div className="text-[15px] font-semibold text-slate-900">Проверка Telegram</div>
                                  <div className="mt-1 text-[12px] text-slate-500">
                                    Здесь запускается живая проверка сессии или активация fresh-аккаунта.
                                  </div>
                                </div>
                                <div className="shrink-0 flex items-center gap-2">
                                  {(() => {
                                    const isSafeMode = String(account.runtime_status || '') === 'pending_activation';
                                    const isCombatMode = !isSafeMode;
                                    return (
                                      <>
                                  <div className="text-[12px] font-medium text-slate-500">Боевой режим</div>
                                  <button
                                    type="button"
                                    role="switch"
                                    aria-checked={isCombatMode}
                                    aria-label="Боевой режим"
                                    onClick={() => toggleSafeMode(account)}
                                    disabled={state.togglingSafeModeId === String(account.id) || state.checkingAccountId === String(account.id)}
                                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full p-[2px] transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:cursor-not-allowed disabled:opacity-50 ${
                                      isCombatMode ? 'bg-emerald-500' : 'bg-amber-500'
                                    }`}
                                  >
                                    <span
                                      className={`size-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                                        isCombatMode ? 'translate-x-5' : 'translate-x-0'
                                      }`}
                                    />
                                  </button>
                                      </>
                                    );
                                  })()}
                                </div>
                              </div>
                              <div className="mt-4 flex flex-wrap gap-2">
                                <button
                                  className="inline-flex h-11 items-center justify-center rounded-[14px] bg-slate-900 px-4 text-[14px] font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
                                  onClick={() => checkAccount(account)}
                                  disabled={state.checkingAccountId === String(account.id) || state.togglingSafeModeId === String(account.id)}
                                >
                                  {state.checkingAccountId === String(account.id)
                                    ? 'Проверяем Telegram...'
                                    : (account.runtime_status === 'pending_activation' ? 'Активировать' : 'Проверить Telegram')}
                                </button>
                              </div>
                              <div className="mt-4 flex flex-wrap gap-2">
                                {(accountCheckReport.accountId === String(account.id) && accountCheckReport.lines.length
                                  ? accountCheckReport.lines
                                  : defaultCheckLines()
                                ).map((line, index) => (
                                  <div
                                    key={`${line.label}-${index}`}
                                    className={`inline-flex items-center rounded-full px-3 py-1.5 ${
                                      line.tone === 'error'
                                        ? 'bg-rose-50'
                                        : line.tone === 'warning'
                                          ? 'bg-amber-50'
                                          : line.tone === 'success'
                                            ? 'bg-emerald-50'
                                            : 'bg-slate-100'
                                    }`}
                                  >
                                    <div className={`text-[12px] font-medium ${
                                      line.tone === 'error'
                                        ? 'text-rose-700'
                                        : line.tone === 'warning'
                                          ? 'text-amber-700'
                                          : line.tone === 'success'
                                            ? 'text-emerald-700'
                                            : 'text-slate-600'
                                    }`}>
                                      {line.label}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>

                            <div className="rounded-[18px] border border-slate-200 bg-white p-4">
                              <div className="flex items-start justify-between gap-4">
                                <div className="min-w-0">
                                  <div className="text-[15px] font-semibold text-slate-900">Автозамена прокси</div>
                                  <div className="mt-1 text-[12px] text-slate-500">
                                    Если основной прокси умрет, можно быстро переехать на запасной.
                                  </div>
                                </div>
                                <div className="shrink-0">
                                  <button
                                    type="button"
                                    role="switch"
                                    aria-checked={selectedBinding.allow_proxy_failover}
                                    aria-label="Автозамена прокси"
                                    onClick={() => updateBinding(account.id, { allow_proxy_failover: !selectedBinding.allow_proxy_failover })}
                                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full p-[2px] transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${
                                      selectedBinding.allow_proxy_failover ? 'bg-emerald-500' : 'bg-slate-300'
                                    }`}
                                  >
                                    <span
                                      className={`size-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                                        selectedBinding.allow_proxy_failover ? 'translate-x-5' : 'translate-x-0'
                                      }`}
                                    />
                                  </button>
                                </div>
                              </div>

                              {selectedBinding.allow_proxy_failover ? (
                                <div className="mt-4 rounded-[16px] bg-slate-50/80 p-4">
                                  <div className="mb-2 text-[13px] font-medium text-slate-700">Запасные прокси</div>
                                  {failoverOptions.length ? (
                                    <>
                                      <select
                                        className="min-h-[120px] w-full rounded-[14px] border border-slate-200 bg-white px-4 py-3 text-[14px] text-slate-900 outline-none transition focus:border-blue-500"
                                        multiple
                                        value={(selectedBinding.failover_proxy_ids || []).filter((id) =>
                                          failoverOptions.some((item) => String(item.id) === String(id))
                                        )}
                                        onChange={(event) => updateBinding(account.id, {
                                          failover_proxy_ids: Array.from(event.target.selectedOptions).map((option) => option.value)
                                        })}
                                      >
                                        {failoverOptions.map((item) => (
                                          <option key={item.id} value={item.id}>{proxyLabel(item)}</option>
                                        ))}
                                      </select>
                                      <div className="mt-2 text-[12px] text-slate-500">
                                        Выбери, куда можно переехать, если основной прокси умрет.
                                      </div>
                                    </>
                                  ) : (
                                    <div className="text-[14px] text-slate-500">Других живых прокси сейчас нет</div>
                                  )}
                                </div>
                              ) : (
                                <div className="mt-4 text-[13px] text-slate-500">Сейчас запасные прокси не используются.</div>
                              )}
                            </div>

                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-3">
                        <button
                          className="inline-flex h-11 items-center justify-center rounded-[14px] bg-emerald-600 px-5 text-[14px] font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-200"
                          onClick={() => saveBinding(account.id)}
                          disabled={state.bindingAccountId === String(account.id)}
                        >
                          {state.bindingAccountId === String(account.id) ? 'Сохраняем...' : 'Сохранить'}
                        </button>
                        <div className="flex items-center gap-2">
                          {canRestoreFromFiles(account, recovery) ? (
                            <button
                              className="inline-flex h-11 items-center justify-center rounded-[14px] border border-slate-200 bg-white px-4 text-[14px] font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                              onClick={() => restoreAccount(account)}
                              disabled={state.restoringAccountId === String(account.id)}
                            >
                              {state.restoringAccountId === String(account.id) ? 'Поднимаем...' : 'Восстановить'}
                            </button>
                          ) : null}
                          {canSellUserbotAssets ? (
                            <button
                              type="button"
                              className="inline-flex h-11 items-center justify-center rounded-[14px] border border-slate-200 bg-white px-4 text-[14px] font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                              onClick={() => {
                                if (saleComposer.accountId === String(account.id)) {
                                  resetSaleComposer();
                                } else {
                                  openSaleComposer(account);
                                }
                              }}
                            >
                              {saleComposer.accountId === String(account.id) ? 'Скрыть продажу' : 'Продать'}
                            </button>
                          ) : null}
                          <button
                            className="inline-flex h-11 items-center justify-center rounded-[14px] border border-slate-200 bg-white px-4 text-[14px] font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                            onClick={() => { window.location.href = `/app/userbot-center?userbot_id=${encodeURIComponent(account.id)}`; }}
                          >
                            Центр
                          </button>
                        </div>
                      </div>

                      <div className="space-y-3">
                        {accountBindingFeedback.accountId === String(account.id) && accountBindingFeedback.text ? (
                          <div className={`userbots-status-note userbots-status-note--${accountBindingFeedback.tone || 'default'}`}>
                            {accountBindingFeedback.text}
                          </div>
                        ) : null}
                        {accountRestoreFeedback.accountId === String(account.id) && accountRestoreFeedback.text ? (
                          <div className={`userbots-status-note userbots-status-note--${accountRestoreFeedback.tone || 'default'}`}>
                            {accountRestoreFeedback.text}
                          </div>
                        ) : null}
                        {accountDeleteFeedback.accountId === String(account.id) && accountDeleteFeedback.text ? (
                          <div className={`userbots-status-note userbots-status-note--${accountDeleteFeedback.tone || 'default'}`}>
                            {accountDeleteFeedback.text}
                          </div>
                        ) : null}
                      </div>

                      {canSellUserbotAssets && saleComposer.accountId === String(account.id) ? (
                        <div className="rounded-[20px] border border-slate-200 bg-slate-50/70 p-5">
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <div className="text-[18px] font-semibold tracking-[-0.02em] text-slate-900">Продажа юзербота</div>
                              <div className="mt-1 text-[14px] text-slate-500">После публикации аккаунт уходит в Shop и резервируется под продажу.</div>
                            </div>
                          </div>
                          <div className="mt-5">
                            <div className="mb-3 text-[13px] font-semibold uppercase tracking-[0.08em] text-slate-400">Что продаем</div>
                            <div className="grid gap-3 md:grid-cols-2">
                              <button
                                type="button"
                                className={`rounded-[18px] border px-4 py-4 text-left transition ${
                                  saleComposer.sale_type === 'userbot'
                                    ? 'border-slate-900 bg-slate-900 text-white shadow-[0_12px_32px_rgba(15,23,42,0.18)]'
                                    : 'border-slate-200 bg-white text-slate-800 hover:border-slate-300'
                                }`}
                                onClick={() => setSaleComposer((prev) => ({
                                  ...prev,
                                  sale_type: 'userbot',
                                  title: saleTitleForAccount(account),
                                  error: ''
                                }))}
                              >
                                <div className="text-[15px] font-semibold">Только аккаунт</div>
                                <div className={`mt-1 text-[13px] ${saleComposer.sale_type === 'userbot' ? 'text-slate-200' : 'text-slate-500'}`}>
                                  В Shop уйдет только этот юзербот.
                                </div>
                              </button>
                              <button
                                type="button"
                                className={`rounded-[18px] border px-4 py-4 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${
                                  saleComposer.sale_type === 'bundle'
                                    ? 'border-blue-600 bg-blue-600 text-white shadow-[0_12px_32px_rgba(37,99,235,0.22)]'
                                    : 'border-slate-200 bg-white text-slate-800 hover:border-slate-300'
                                }`}
                                onClick={() => {
                                  if (!account.proxy_id) return;
                                setSaleComposer((prev) => ({
                                  ...prev,
                                  sale_type: 'bundle',
                                  title: saleTitleForAccount(account),
                                  error: ''
                                }));
                              }}
                                disabled={!account.proxy_id}
                              >
                                <div className="text-[15px] font-semibold">Аккаунт + прокси</div>
                                <div className={`mt-1 text-[13px] ${saleComposer.sale_type === 'bundle' ? 'text-blue-100' : 'text-slate-500'}`}>
                                  Вместе с аккаунтом уходит и его текущий прокси.
                                </div>
                              </button>
                            </div>
                          </div>
                          <div className="mt-5 grid gap-4 md:grid-cols-2">
                            <label className="block md:col-span-2">
                              <span className="mb-2 block text-[13px] font-semibold uppercase tracking-[0.08em] text-slate-400">Название лота</span>
                              <input
                                className="h-11 w-full rounded-[14px] border border-slate-200 bg-white px-4 text-[14px] text-slate-900 outline-none transition focus:border-blue-500"
                                value={saleComposer.title}
                                onChange={(event) => setSaleComposer((prev) => ({ ...prev, title: event.target.value }))}
                              />
                            </label>
                            <div className="md:col-span-2">
                              <div className="mb-3 text-[13px] font-semibold uppercase tracking-[0.08em] text-slate-400">Цена и оплата</div>
                              <div className="grid gap-3">
                                <div className="rounded-[18px] border border-slate-200 bg-white p-4">
                                  <div className="flex items-start justify-between gap-4">
                                    <div className="min-w-0">
                                      <div className="text-[15px] font-semibold text-slate-900">TON</div>
                                      <div className="mt-1 text-[13px] text-slate-500">Покупатель оплачивает лот напрямую в TON.</div>
                                    </div>
                                    <button
                                      type="button"
                                      role="switch"
                                      aria-checked={(saleComposer.payment_methods || []).includes('ton')}
                                      aria-label="Оплата TON"
                                      onClick={() => toggleSalePaymentMethod('ton', !(saleComposer.payment_methods || []).includes('ton'))}
                                      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full p-[2px] transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${
                                        (saleComposer.payment_methods || []).includes('ton') ? 'bg-emerald-500' : 'bg-slate-300'
                                      }`}
                                    >
                                      <span
                                        className={`size-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                                          (saleComposer.payment_methods || []).includes('ton') ? 'translate-x-5' : 'translate-x-0'
                                        }`}
                                      />
                                    </button>
                                  </div>
                                  {(saleComposer.payment_methods || []).includes('ton') ? (
                                    <label className="mt-4 block">
                                      <span className="mb-2 block text-[13px] font-medium text-slate-600">Цена в TON</span>
                                      <input
                                        className="h-11 w-full rounded-[14px] border border-slate-200 bg-slate-50 px-4 text-[14px] text-slate-900 outline-none transition focus:border-blue-500 focus:bg-white"
                                        inputMode="decimal"
                                        value={saleComposer.price_ton}
                                        onChange={(event) => setSaleComposer((prev) => ({ ...prev, price_ton: event.target.value }))}
                                      />
                                    </label>
                                  ) : null}
                                </div>
                                <div className="rounded-[18px] border border-slate-200 bg-white p-4">
                                  <div className="flex items-start justify-between gap-4">
                                    <div className="min-w-0">
                                      <div className="text-[15px] font-semibold text-slate-900">СБП</div>
                                      <div className="mt-1 text-[13px] text-slate-500">Покупатель получает реквизиты и оплачивает лот в рублях.</div>
                                    </div>
                                    <button
                                      type="button"
                                      role="switch"
                                      aria-checked={(saleComposer.payment_methods || []).includes('p2p')}
                                      aria-label="Оплата СБП"
                                      onClick={() => toggleSalePaymentMethod('p2p', !(saleComposer.payment_methods || []).includes('p2p'))}
                                      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full p-[2px] transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${
                                        (saleComposer.payment_methods || []).includes('p2p') ? 'bg-emerald-500' : 'bg-slate-300'
                                      }`}
                                    >
                                      <span
                                        className={`size-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                                          (saleComposer.payment_methods || []).includes('p2p') ? 'translate-x-5' : 'translate-x-0'
                                        }`}
                                      />
                                    </button>
                                  </div>
                                  {(saleComposer.payment_methods || []).includes('p2p') ? (
                                    <label className="mt-4 block">
                                      <span className="mb-2 block text-[13px] font-medium text-slate-600">Цена в RUB для СБП</span>
                                      <input
                                        className="h-11 w-full rounded-[14px] border border-slate-200 bg-slate-50 px-4 text-[14px] text-slate-900 outline-none transition focus:border-blue-500 focus:bg-white"
                                        inputMode="numeric"
                                        value={saleComposer.price_rub}
                                        onChange={(event) => setSaleComposer((prev) => ({ ...prev, price_rub: event.target.value }))}
                                      />
                                    </label>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          </div>
                          {saleComposer.error ? (
                            <div className="mt-4 userbots-status-note userbots-status-note--error">
                              {saleComposer.error}
                            </div>
                          ) : null}
                          <div className="mt-4 flex flex-wrap gap-2">
                            <button
                              className="inline-flex h-11 items-center justify-center rounded-[14px] bg-blue-600 px-4 text-[14px] font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-200"
                              type="button"
                              onClick={() => saveUserbotSaleLot(account)}
                              disabled={saleComposer.saving}
                            >
                              {saleComposer.saving ? 'Сохраняем лот...' : 'Опубликовать лот'}
                            </button>
                            <button
                              className="inline-flex h-11 items-center justify-center rounded-[14px] border border-slate-200 bg-white px-4 text-[14px] font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                              type="button"
                              onClick={resetSaleComposer}
                              disabled={saleComposer.saving}
                            >
                              Отмена
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })()
              )}
            </div>
          </div>

          <div className="mt-6 rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="flex items-center">
                <span className="text-[12px] font-medium uppercase tracking-[0.08em] text-slate-400">Выставлены в Shop</span>
                <span className="ml-2 inline-flex min-w-6 items-center justify-center rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                  {listedShopUserbots.length}
                </span>
              </div>
              {selectedShopUserbot && state.reservedItemsByAsset[`userbot:${String(selectedShopUserbot.id)}`]?.item_id ? (
                <button
                  type="button"
                  className="inline-flex h-10 items-center justify-center rounded-[13px] border border-rose-200 bg-rose-50 px-4 text-[14px] font-semibold text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => deleteShopItem(state.reservedItemsByAsset[`userbot:${String(selectedShopUserbot.id)}`].item_id)}
                  disabled={state.deletingShopItemId === String(state.reservedItemsByAsset[`userbot:${String(selectedShopUserbot.id)}`].item_id)}
                >
                  {state.deletingShopItemId === String(state.reservedItemsByAsset[`userbot:${String(selectedShopUserbot.id)}`].item_id) ? 'Удаляем...' : 'Удалить лот'}
                </button>
              ) : null}
            </div>
            {listedShopUserbots.length === 0 ? (
              <div className="rounded-[18px] border border-dashed border-slate-200 bg-slate-50/60 px-5 py-6 text-[14px] text-slate-500">
                Юзерботов в shop-резерве сейчас нет.
              </div>
            ) : (
              <div className="space-y-4">
                <div className="w-full lg:max-w-[420px]">
                  <select
                    className="h-12 w-full rounded-[16px] border border-slate-200 bg-white px-4 text-[15px] font-medium text-slate-900 outline-none transition focus:border-blue-500"
                    value={selectedShopUserbot ? String(selectedShopUserbot.id) : ''}
                    onChange={(event) => setSelectedShopUserbotId(event.target.value)}
                  >
                    {listedShopUserbots.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.tg_username ? `@${account.tg_username}` : `TG ID ${account.tg_account_id}`}
                      </option>
                    ))}
                  </select>
                </div>
                {(() => {
                  const account = selectedShopUserbot;
                  if (!account) return null;
                  const item = state.reservedItemsByAsset[`userbot:${String(account.id)}`];
                  const sellerItem = item?.item_id ? state.sellerItemsById[String(item.item_id)] : null;
                  const activeReservation = sellerItem?.recent_purchase && sellerItem.recent_purchase.status === 'pending'
                    ? sellerItem.recent_purchase
                    : null;
                  const restrictedBadge = restrictedMarker(account);
                  const itemTypeLabel = item?.item_title || 'Лот не нашли';
                  const hasProxyInBundle = /прокси/i.test(itemTypeLabel) || false;
                  return (
                    <div className="rounded-[20px] border border-slate-200 bg-slate-50/70 p-4">
                      <div className="flex flex-col gap-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="text-[16px] font-semibold tracking-[-0.02em] text-slate-900">
                                @{account.tg_username || 'без username'}
                              </div>
                              {restrictedBadge ? <span className={restrictedBadge.className}>{restrictedBadge.text}</span> : null}
                            </div>
                            <div className="mt-1 text-[13px] text-slate-500">TG ID {account.tg_account_id}</div>
                            {restrictedBadge?.detail ? (
                              <div className="mt-2 text-[13px] leading-5 text-rose-600">{restrictedBadge.detail}</div>
                            ) : null}
                          </div>
                          <a
                            className="inline-flex h-10 items-center justify-center rounded-[13px] border border-slate-200 bg-white px-4 text-[14px] font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                            href="/app/shop"
                          >
                            Shop
                          </a>
                        </div>

                        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(220px,0.9fr)]">
                          <div className="rounded-[16px] bg-white px-4 py-3">
                            <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-400">Лот</div>
                            <div className="mt-2 text-[15px] font-semibold leading-6 text-slate-900">{itemTypeLabel}</div>
                          </div>
                          <div className="rounded-[16px] bg-white px-4 py-3">
                            <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-400">Состав</div>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <div className="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1.5">
                                <div className="text-[12px] font-medium text-emerald-700">Аккаунт</div>
                              </div>
                              <div className={`inline-flex items-center rounded-full px-3 py-1.5 ${
                                hasProxyInBundle ? 'bg-emerald-50' : 'bg-slate-100'
                              }`}>
                                <div className={`text-[12px] font-medium ${
                                  hasProxyInBundle ? 'text-emerald-700' : 'text-slate-600'
                                }`}>
                                  Proxy
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {activeReservation ? (
                        <div className="mt-4 rounded-[16px] border border-amber-200 bg-amber-50 px-4 py-3">
                          <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-amber-700">Бронь</div>
                          <div className="mt-2 grid gap-3 sm:grid-cols-2">
                            <div>
                              <div className="text-[12px] text-amber-700/80">Покупатель</div>
                              <div className="mt-1 text-[14px] font-semibold text-amber-900">
                                {activeReservation.buyer_name || `owner ${String(activeReservation.buyer_owner_id || '').slice(0, 8)}`}
                              </div>
                            </div>
                            <div>
                              <div className="text-[12px] text-amber-700/80">Истекает</div>
                              <div className="mt-1 text-[14px] font-semibold text-amber-900">
                                {activeReservation.expires_at ? formatWhen(activeReservation.expires_at) : 'Без срока'}
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
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
