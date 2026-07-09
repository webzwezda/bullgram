import { APP_CONFIG } from '../../config.js';

export function formatWhen(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value));
}

export function summarizeCheckStatus(result = {}, fallbackAccount = null) {
  const status = String(result?.status || fallbackAccount?.runtime_status || '').trim().toLowerCase();
  if (status === 'online') return { tone: 'success', title: 'Сессия жива' };
  if (status === 'restricted') return { tone: 'error', title: 'Есть ограничения Telegram' };
  if (status === 'expired') return { tone: 'error', title: 'Сессия умерла' };
  if (status === 'dead_proxy' || status === 'inactive_proxy') return { tone: 'error', title: 'Прокси мертвый' };
  if (status === 'pending_activation') return { tone: 'warning', title: 'Ждет активации' };
  return { tone: 'default', title: 'Статус проверки' };
}

export function checkLine(label, value, tone = 'default') {
  return { label, value, tone };
}

export function buildCheckLines(result = {}, fallbackAccount = null) {
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

export function defaultCheckLines() {
  return [
    checkLine('Сессия', '', 'default'),
    checkLine('Ограничения', '', 'default'),
    checkLine('SpamBot', '', 'default')
  ];
}

export function restrictedMarker(account) {
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

export function proxySourceBadge(proxy) {
  const source = proxy?.provision_source || 'manual_free';
  if (source === 'manual_admin') return { text: 'Инвентарь админа', className: 'pill pill--warning' };
  if (source === 'purchased') return { text: 'Купленный', className: 'pill pill--ok' };
  if (source === 'manual_owned') return { text: 'Свой', className: 'pill pill--info' };
  if (source === 'manual_trial') return { text: 'Старый trial', className: 'pill pill--warning' };
  return { text: 'Временный', className: 'pill' };
}

export function proxyTelegramMode(proxy) {
  if (proxy?.is_working !== true) return proxy?.is_working === false ? 'broken' : 'unchecked';
  if (!proxy?.last_check_ip && !proxy?.last_check_country && !proxy?.last_check_city) {
    return 'telegram_only';
  }
  return 'full';
}

export function proxyTelegramModeLabel(proxy) {
  const mode = proxyTelegramMode(proxy);
  if (mode === 'telegram_only') return 'Рабочий для Telegram';
  if (mode === 'full') return 'Полная web+geo проверка';
  if (mode === 'broken') return 'Не подходит для Telegram';
  return 'Еще не проверен';
}

export function recoveryStatusBadge(recovery) {
  if (!recovery) return null;
  if (recovery.last_restore_status === 'failed') return { text: 'Восстановление упало', className: 'pill pill--danger' };
  if (recovery.last_restore_status === 'restored') return { text: 'Уже поднимали', className: 'pill pill--ok' };
  return { text: 'Файлы сохранены', className: 'pill pill--warning' };
}

export function canRestoreFromFiles(account, recovery) {
  if (!recovery) return false;
  if (recovery.last_restore_status === 'failed') return true;
  return ['expired', 'error', 'dead_proxy'].includes(account.runtime_status);
}

export function normalizeOnboardingErrorMessage(error) {
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

export function resolveBackendAssetUrl(value) {
  const url = String(value || '').trim();
  if (!url) return '';
  if (/^(https?:|data:|blob:)/i.test(url)) return url;
  if (url.startsWith('/')) return `${APP_CONFIG.backendUrl}${url}`;
  return `${APP_CONFIG.backendUrl}/${url}`;
}

export function formatTon(value) {
  return Number(value || 0).toFixed(2);
}

export function userbotLotPaymentMethods(item) {
  const source = Array.isArray(item?.available_payment_methods)
    ? item.available_payment_methods
    : Array.isArray(item?.payment_methods) && item.payment_methods.length
      ? item.payment_methods
      : ['ton'];
  return source.filter((method) => method === 'ton');
}

export function batchUserbotLotPaymentMethods(items) {
  const batchItems = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!batchItems.length) return ['ton'];

  const methods = batchItems.reduce((allowed, item, index) => {
    const itemMethods = userbotLotPaymentMethods(item);
    if (index === 0) return itemMethods;
    return allowed.filter((method) => itemMethods.includes(method));
  }, []);

  return methods.length ? methods : userbotLotPaymentMethods(batchItems[0]);
}

export function paymentMethodLabel(value) {
  void value;
  return 'TON';
}

export function userbotItemPriceSummary(item) {
  const methods = userbotLotPaymentMethods(item);
  const parts = [];
  if (methods.includes('ton') && Number(item?.price_ton || 0) > 0) {
    parts.push(`${formatTon(item.price_ton)} TON`);
  }
  return parts.join(' / ') || 'Нужна цена в TON';
}

export function userbotPurchaseAmountSummary(purchase) {
  return `${formatTon(purchase?.amount_ton || purchase?.item?.price_ton || 0)} TON`;
}

export function purchaseStatusMeta(status) {
  if (status === 'awaiting_receipt') {
    return { text: 'Ждет чек', className: 'pill pill--warning' };
  }
  if (status === 'paid') {
    return { text: 'Оплата есть', className: 'pill pill--ok' };
  }
  return { text: 'Ждет оплату', className: 'pill pill--info' };
}

export function isUserbotShopItem(item) {
  if (!item) return false;
  if (item.item_type === 'userbot' || item.item_type === 'bundle') return true;
  return Array.isArray(item.assets) && item.assets.some((asset) => asset.asset_type === 'userbot');
}

export function isUserbotPurchase(purchase) {
  if (!purchase) return false;
  if (purchase.item?.item_type === 'userbot' || purchase.item?.item_type === 'bundle') return true;
  return Array.isArray(purchase.assets) && purchase.assets.some((asset) => asset.asset_type === 'userbot');
}

export function isOpenUserbotPurchase(purchase) {
  if (!isUserbotPurchase(purchase)) return false;
  if (purchase.status === 'awaiting_receipt') return true;
  if (purchase.status === 'pending') return true;
  if (purchase.status === 'paid' && purchase.ownership_transfer_status !== 'completed') return true;
  return false;
}

export function normalizeOpenUserbotPurchaseGroup(rows = []) {
  if (!rows.length) return null;
  const first = rows[0];
  const status = rows.some((purchase) => purchase.status === 'awaiting_receipt')
    ? 'awaiting_receipt'
    : rows.some((purchase) => purchase.status === 'paid' && purchase.ownership_transfer_status !== 'completed')
      ? 'paid'
      : 'pending';
  const amountTon = rows.reduce((sum, purchase) => sum + Number(purchase.amount_ton || 0), 0);
  const amountRub = rows.reduce((sum, purchase) => sum + Number(purchase.amount_rub || 0), 0);
  const amountNanoParts = rows
    .map((purchase) => String(purchase.amount_nanoton || '').trim())
    .filter(Boolean);
  let amountNanoTon = '';
  if (amountNanoParts.length === rows.length) {
    try {
      amountNanoTon = amountNanoParts.reduce((sum, value) => sum + BigInt(value), 0n).toString();
    } catch {
      amountNanoTon = '';
    }
  }
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
    amount_nanoton: amountNanoTon,
    amount_rub: amountRub,
    network: first.network || 'mainnet',
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
      ton_qr: first.payload?.ton_qr || ''
    },
    item: {
      ...(first.item || {}),
      title
    },
    assets,
    batch: rows.length > 1 || !!first.payload?.batch_token
  };
}

export function userbotLotKindLabel(item) {
  if (item?.item_type === 'bundle') return 'Аккаунт + прокси';
  return 'Только аккаунт';
}

export const QR_FINGERPRINT_PROFILES = [
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

export function qrFingerprintProfileById(profileId, profiles = QR_FINGERPRINT_PROFILES) {
  return profiles.find((item) => item.id === profileId) || profiles[0] || QR_FINGERPRINT_PROFILES[0];
}

export function maskSaleUsername(username = '') {
  const clean = String(username || '').replace(/^@+/, '').trim();
  if (!clean) return '';
  if (clean.length <= 3) return `@${clean[0]}***`;
  if (clean.length <= 6) return `@${clean.slice(0, 2)}***${clean.slice(-1)}`;
  return `@${clean.slice(0, 3)}***${clean.slice(-2)}`;
}

export function saleTitleForAccount(account) {
  if (account?.tg_username) {
    return maskSaleUsername(account.tg_username);
  }
  if (account?.tg_account_id) {
    return `Аккаунт ${String(account.tg_account_id).slice(-4)}`;
  }
  return 'Аккаунт';
}

export function proxyLabel(proxy) {
  const geo = proxy.last_check_country ? ` • ${proxy.last_check_country}` : '';
  return `${proxy.name} (${proxy.host}:${proxy.port})${geo} • ${proxyTelegramModeLabel(proxy)}`;
}
