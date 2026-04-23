import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../api/client.js';
import { useAuth } from '../app/providers/AuthProvider.jsx';
import { getProductTierRules } from '../app/productTier.js';
import { LoadingState } from '../ui/LoadingState.jsx';
import { PlanBanner } from '../ui/PlanBanner.jsx';
import { StatCard } from '../ui/StatCard.jsx';
import { UpgradeCallout } from '../ui/UpgradeCallout.jsx';

const ITEM_FILTERS = [
  { id: 'all', label: 'Все лоты' },
  { id: 'published', label: 'На витрине' },
  { id: 'draft', label: 'Черновики' },
  { id: 'reserved', label: 'С бронью' },
  { id: 'sold', label: 'Проданные' },
  { id: 'unlisted', label: 'Только по ссылке' },
  { id: 'private', label: 'Private' }
];

const PURCHASE_FILTERS = [
  { id: 'all', label: 'Все продажи' },
  { id: 'pending', label: 'Ждут оплату' },
  { id: 'awaiting_receipt', label: 'Ждут чек' },
  { id: 'rejected', label: 'Отклонены' },
  { id: 'paid', label: 'Оплачены' },
  { id: 'expired', label: 'Протухли' },
  { id: 'completed', label: 'Права доехали' },
  { id: 'failed', label: 'Передача сломалась' }
];

const TEXT_OFFER_TEMPLATES = [
  {
    id: 'trial',
    offerCode: 'trial',
    title: 'Trial вход',
    priceTon: '5',
    preview: 'Быстрый вход в BullRun Trial: первый checkout, hidden message и стартовый Telegram-контур.',
    description: 'Покупатель получает входной оффер под Trial: базовый TON/P2P checkout, скрытое сообщение после оплаты и понятный следующий шаг внутри BullRun.',
    postPurchaseMessage: 'Спасибо за покупку Trial. Открой /app, забери бесплатный прокси, подключи первый юзербот и закрой свой первый checkout внутри BullRun.'
  },
  {
    id: 'p2p',
    offerCode: 'p2p',
    title: 'P2P скрытый оффер',
    priceTon: '10',
    preview: 'После оплаты покупатель получает скрытое сообщение, ссылку или инструкцию прямо на сайте.',
    description: 'Это простой P2P/TON-оффер без передачи owner_id. Подходит для текстов, гайдов, ссылок, сигналов и разовых услуг.',
    postPurchaseMessage: 'Оплата получена. Вот твой скрытый результат: вставь сюда ссылку, инструкцию или текст, который должен увидеть покупатель после закрытия оплаты.'
  },
  {
    id: 'normal',
    offerCode: 'normal',
    title: 'Normal апгрейд',
    priceTon: '29',
    preview: 'Апгрейд с Trial на рабочий money ops stack: больше юзерботов, больше прокси, CRM и дожим без trial-стопоров.',
    description: 'Покупатель получает следующий продуктовый слой BullRun: рабочий контур для денег, доступа, CRM, рассылок и seller-операционки.',
    postPurchaseMessage: 'Normal открыт. Теперь переходи в /app, подключай боевой контур и запускай CRM, рассылки и seller-flow без trial-лимитов.'
  }
];

const SELLER_UNLOCK_STEPS = [
  {
    id: 'inventory',
    title: 'Подготовь seller inventory',
    description: 'Разведи прокси по группам: что уходит в бесплатный пул, а что идет в продажу как платный инвентарь.',
    href: '/app/proxies'
  },
  {
    id: 'bots',
    title: 'Собери seller-аккаунт',
    description: 'Подними или восстанови seller userbot, проверь прокси и убедись, что Telegram-контур не висит на мертвой сессии.',
    href: '/app/userbots'
  },
  {
    id: 'catalog',
    title: 'Собери первые лоты',
    description: 'Начни с простого: hidden-message оффер, потом комплект userbot + proxy, и только потом усложняй каталог.',
    href: '#create-lot'
  },
  {
    id: 'handoff',
    title: 'Проверь handoff и платежи',
    description: 'Убедись, что seller wallet указан, TON/P2P контур живой, а handoff не развалится на первой покупке.',
    href: '/app/payments'
  }
];

const TEXT_SERVICE_UNLOCK_STEPS = [
  {
    id: 'wallet',
    title: 'Подключи TON и P2P',
    description: 'Сначала seller должен уметь принимать деньги: TON-кошелек, P2P-реквизиты и рабочий checkout-контур.',
    href: '/app/payments'
  },
  {
    id: 'offer',
    title: 'Собери первый скрытый оффер',
    description: 'Начни не с каталога активов, а с простого hidden-message оффера: текст, ссылка, инструкция или разовая услуга.',
    href: '#create-lot'
  },
  {
    id: 'buyer',
    title: 'Проверь buyer-side шаги',
    description: 'Покупатель после оплаты должен увидеть понятный следующий шаг, а не потеряться в checkout и handoff.',
    href: '/shop?offer=p2p'
  },
  {
    id: 'handoff',
    title: 'Добей handoff после оплаты',
    description: 'Сразу смотри, как закрывается чек, как выдается скрытое сообщение и не ломается ли post-purchase flow.',
    href: '/app/payments'
  }
];

const SELLER_BLOCKER_COPY = {
  asset_marketplace: {
    no_wallet: {
      title: 'Не указан TON-кошелек',
      text: 'Без seller wallet checkout не закроется нормально. Сначала проверь платежный контур, потом уже собирай лоты и handoff.'
    },
    no_inventory: {
      title: 'Нет готового инвентаря',
      text: 'У тебя нет свободного прокси для продажи. Разведи server inventory по группам и освободи seller stock.'
    },
    no_items: {
      title: 'Нет опубликованных лотов',
      text: 'Маркетплейс уже открыт, но витрина пустая. Собери хотя бы один комплект userbot + proxy или другой asset-лот.'
    },
    no_paid: {
      title: 'Пока нет первой оплаты',
      text: 'Контур собран, но первую продажу еще не закрыли. Проверь витрину, offer fit и seller story на сайте.'
    },
    failed_handoff: {
      title: 'Есть сломанный handoff',
      text: 'Сначала почини передачу прав по активам и buyer-side шаги. Иначе новая продажа только усилит бардак и недоверие.'
    }
  },
  text_service: {
    no_wallet: {
      title: 'Не указан TON-кошелек',
      text: 'Без seller wallet hidden-message checkout не закроется нормально. Сначала подними TON/P2P контур, потом уже продавай офферы.'
    },
    no_items: {
      title: 'Нет опубликованных P2P-офферов',
      text: 'P2P seller уже открыт, но витрина пустая. Собери хотя бы один hidden-message оффер, чтобы buyer-side flow вообще заработал.'
    },
    no_paid: {
      title: 'Пока нет первой оплаты',
      text: 'P2P-контур уже собран, но первую продажу еще не закрыли. Проверь витрину, тексты оффера и что buyer действительно доходит до скрытого сообщения.'
    },
    failed_handoff: {
      title: 'Есть сломанный handoff',
      text: 'Оплата уже была, но buyer не получил скрытый результат. Сначала добей post-purchase flow, иначе новые продажи только усилят недоверие.'
    }
  }
};

function sellerPackageTitle(sellerCanSellAssets) {
  return sellerCanSellAssets ? 'Seller пакет' : 'P2P seller пакет';
}

function formatWhen(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value));
}

function formatTon(value) {
  return Number(value || 0).toFixed(4);
}

function formatRub(value) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Number(value || 0));
}

function itemBadgeClass(item) {
  if (item.status === 'sold') return 'pill pill--ok';
  if (item.status === 'published') return 'pill pill--warning';
  return 'pill';
}

function visibilityLabel(value) {
  if (value === 'unlisted') return 'Только по ссылке';
  if (value === 'private') return 'Private';
  return 'Публичный';
}

function offerCodeLabel(value) {
  if (value === 'trial') return 'Trial checkout';
  if (value === 'normal') return 'Normal checkout';
  if (value === 'seller') return 'Seller checkout';
  if (value === 'p2p') return 'P2P / скрытый оффер';
  return '';
}

function packageSignalStatusText(status) {
  if (status === 'failed') return 'Handoff сломан';
  if (status === 'awaiting_receipt') return 'Ждет ручной проверки';
  if (status === 'pending') return 'Checkout открыт';
  if (status === 'paid') return 'Уже куплено';
  if (status === 'expired') return 'Протухший checkout';
  return 'Нет движения';
}

function packageSignalToneClass(tone) {
  if (tone === 'danger') return 'pill pill--danger';
  if (tone === 'warning') return 'pill pill--warning';
  if (tone === 'ok') return 'pill pill--ok';
  return 'pill';
}

function packageSignalGuide(signal, profilePlan) {
  if (signal.id === 'trial') {
    if (signal.status === 'paid') {
      return 'Trial уже куплен. Теперь не продавай второй входной оффер, а веди человека в первый контур и апгрейд на Normal.';
    }
    if (signal.status === 'pending') {
      return 'Входной Trial checkout уже открыт. Дальше задача не плодить новый лот, а закрыть этот входной чек.';
    }
    if (signal.status === 'awaiting_receipt') {
      return 'Trial уже ждет ручной проверки. Сначала добей этот хвост, потом возвращайся к новым сделкам.';
    }
    if (signal.status === 'failed') {
      return 'Оплата по Trial уже была, но handoff сломан. Сначала восстанови передачу, иначе новый трафик только усилит бардак.';
    }
    return 'Trial нужен как входной оффер: первый checkout, скрытый результат и первый контур внутри BullRun.';
  }

  if (signal.id === 'normal') {
    if (signal.status === 'paid' || profilePlan === 'normal' || profilePlan === 'pro') {
      return 'Normal уже куплен. Следующий шаг — собирать seller-инвентарь, прокси и рабочий money ops stack, а не продавать Trial поверх него.';
    }
    if (signal.status === 'pending') {
      return 'Апгрейд на Normal уже открыт. Добей этот checkout и только потом тащи человека в seller-flow.';
    }
    if (signal.status === 'awaiting_receipt') {
      return 'Normal уже ждет ручной проверки. Не плодись новыми апгрейдами, пока этот хвост не закрыт.';
    }
    if (signal.status === 'failed') {
      return 'Normal уже оплачен, но handoff сломан. Сначала почини апгрейд, потом веди в seller mode.';
    }
    return 'Normal — основной апгрейд после Trial: снимает лимиты и открывает рабочий seller/money ops слой.';
  }

  if (signal.status === 'paid') {
    return 'Seller mode уже куплен. Дальше важны inventory, опубликованные лоты и чистый handoff после оплаты.';
  }
  if (signal.status === 'pending') {
    return 'Seller checkout уже открыт. Задача сейчас — добить покупку, а не крутить новые seller-обещания.';
  }
  if (signal.status === 'awaiting_receipt') {
    return 'Seller уже ждет ручной проверки. Пока чек не закрыт, новый seller-flow будет только мешать.';
  }
  if (signal.status === 'failed') {
    return 'Seller mode уже оплачен, но handoff сломан. Сначала добей передачу прав, потом открывай продажи.';
  }
  return 'Seller mode нужен, когда Trial и Normal уже собраны и пора продавать офферы, активы и базы.';
}

function packageSignalNextHref(signal, profilePlan) {
  if (signal.id === 'trial') {
    return signal.status === 'paid' ? '/app' : '/shop?offer=trial';
  }
  if (signal.id === 'normal') {
    if (signal.status === 'paid' || profilePlan === 'normal' || profilePlan === 'pro') return '/app';
    return '/shop?offer=normal';
  }
  if (signal.status === 'paid' || profilePlan === 'pro') return '/app/shop';
  return '/shop?offer=seller';
}

function proxyInventoryBadge(proxy) {
  if (proxy.is_working === false) return { text: 'Битый', className: 'pill pill--danger' };
  if (Number(proxy.userbot_count || 0) > 0) return { text: 'Занят юзерботом', className: 'pill pill--warning' };
  return { text: 'Готов к продаже', className: 'pill pill--ok' };
}

function proxySourceText(proxy) {
  if (proxy.provision_source === 'purchased') return 'Купленный';
  if (proxy.provision_source === 'manual_free') return 'Бесплатный';
  return 'Инвентарь админа';
}

function proxySaleStatusText(proxy) {
  if (proxy.is_working === false) return 'Битый, сначала чини';
  if (Number(proxy.userbot_count || 0) > 0) return `Занят: ${proxy.userbot_count} userbot`;
  if (proxy.is_ready_for_sale) return 'Готов к продаже';
  return 'Нужно проверить';
}

function purchaseStatusBadge(row) {
  if (row.ownership_transfer_status === 'failed') return 'pill pill--danger';
  if (row.status === 'paid' && row.ownership_transfer_status === 'completed') return 'pill pill--ok';
  if (row.status === 'awaiting_receipt') return 'pill pill--warning';
  if (row.status === 'rejected') return 'pill pill--danger';
  if (row.status === 'pending') return 'pill pill--warning';
  if (row.status === 'expired') return 'pill';
  return 'pill';
}

function purchaseStatusText(row) {
  if (row.ownership_transfer_status === 'failed') return 'Передача сломалась';
  if (row.status === 'paid' && row.ownership_transfer_status === 'completed') return 'Оплата и handoff ок';
  if (row.status === 'awaiting_receipt') return 'Ждет ручной проверки';
  if (row.status === 'rejected') return 'P2P отклонен';
  if (row.status === 'paid') return 'Оплата есть, handoff висит';
  if (row.status === 'pending') return 'Ждет оплату';
  if (row.status === 'expired') return 'Счет протух';
  return row.status || '—';
}

function purchaseAttentionHint(row) {
  if (row._bucket === 'failed_transfer') {
    return 'Деньги уже есть. Нужно руками добить перевод актива.';
  }
  if (row._bucket === 'pending_transfer') {
    return 'Покупатель оплатил, но ownership transfer еще не завершен.';
  }
  if (row._bucket === 'pending_expiring') {
    return 'Бронь вот-вот протухнет. Если клиент теплый, надо добивать.';
  }
  return 'Счет уже протух. Можно перезапускать продажу или закрывать хвост.';
}

function purchaseAttentionBadge(row) {
  if (row._bucket === 'failed_transfer') return { text: 'Права не доехали', className: 'pill pill--danger' };
  if (row._bucket === 'pending_transfer') return { text: 'Оплата есть', className: 'pill pill--warning' };
  if (row._bucket === 'pending_expiring') return { text: 'Бронь догорает', className: 'pill pill--warning' };
  return { text: 'Протухло', className: 'pill' };
}

function assetText(row) {
  return (row.assets || []).map((asset) => asset.label || asset.asset_type).join(' • ');
}

function purchaseAssetText(row) {
  return (row.item?.assets || []).map((asset) => asset.label || asset.asset_type).join(' • ');
}

function purchaseHasAssetType(row, type) {
  return (row.item?.assets || []).some((asset) => asset.asset_type === type);
}

function paymentMethodsLabel(value) {
  const methods = Array.isArray(value) ? value : [];
  if (!methods.length) return 'TON + СБП';
  return methods.map((method) => (method === 'p2p' ? 'СБП' : 'TON')).join(' + ');
}

function salesChannelLabel(value) {
  if (value === 'admin_only') return 'Только админка';
  if (value === 'both') return 'Сайт + админка';
  return 'Публичный сайт';
}

function itemPriceSummary(item) {
  const methods = Array.isArray(item?.payment_methods) ? item.payment_methods : [];
  const parts = [];
  if ((!methods.length || methods.includes('ton')) && Number(item?.price_ton || 0) > 0) {
    parts.push(`${formatTon(item.price_ton)} TON`);
  }
  if (methods.includes('p2p') && Number(item?.price_rub || 0) > 0) {
    parts.push(`${formatRub(item.price_rub)} RUB`);
  }
  return parts.join(' / ') || `${formatTon(item?.price_ton || 0)} TON`;
}

function purchaseAmountSummary(purchase) {
  if (purchase?.payload?.payment_method === 'p2p') {
    const rub = Number(purchase?.amount_rub || purchase?.payload?.amount_rub || purchase?.item?.price_rub || 0);
    return rub > 0 ? `${formatRub(rub)} RUB` : 'СБП';
  }
  return `${formatTon(purchase?.amount_ton || purchase?.item?.price_ton || 0)} TON`;
}

function normalizeSellerPurchaseGroup(rows = []) {
  if (!rows.length) return null;
  const first = rows[0];
  const status = rows.some((purchase) => purchase.ownership_transfer_status === 'failed')
    ? 'paid'
    : rows.some((purchase) => purchase.status === 'awaiting_receipt')
      ? 'awaiting_receipt'
      : rows.some((purchase) => purchase.status === 'pending')
        ? 'pending'
        : rows.some((purchase) => purchase.status === 'rejected')
          ? 'rejected'
          : rows.some((purchase) => purchase.status === 'expired')
            ? 'expired'
            : 'paid';
  const amountTon = rows.reduce((sum, purchase) => sum + Number(purchase.amount_ton || 0), 0);
  const amountRub = rows.reduce((sum, purchase) => sum + Number(purchase.amount_rub || purchase.payload?.amount_rub || purchase.item?.price_rub || 0), 0);
  const createdAt = rows
    .map((purchase) => purchase.created_at ? new Date(purchase.created_at).getTime() : null)
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => right - left)[0];
  const expiresAt = rows
    .map((purchase) => purchase.expires_at ? new Date(purchase.expires_at).getTime() : null)
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right)[0];
  const assets = rows.flatMap((purchase) => purchase.item?.assets || []);
  const uniqueAssets = Array.from(new Map(
    assets.map((asset) => [`${asset.asset_type}:${asset.asset_id || asset.label || ''}`, asset])
  ).values());
  const uniqueBuyers = Array.from(new Set(rows.map((purchase) => String(purchase.buyer_owner_id || '')).filter(Boolean)));

  return {
    ...first,
    id: first.payload?.batch_token || first.id,
    purchase_ids: rows.map((purchase) => purchase.id),
    buyer_owner_id: uniqueBuyers.length === 1 ? uniqueBuyers[0] : uniqueBuyers.join(', '),
    status,
    amount_ton: amountTon,
    amount_rub: amountRub,
    created_at: createdAt ? new Date(createdAt).toISOString() : first.created_at,
    expires_at: expiresAt ? new Date(expiresAt).toISOString() : first.expires_at,
    ownership_transfer_status: rows.some((purchase) => purchase.ownership_transfer_status === 'failed')
      ? 'failed'
      : rows.every((purchase) => purchase.ownership_transfer_status === 'completed')
        ? 'completed'
        : rows.some((purchase) => purchase.status === 'paid')
          ? 'pending'
          : 'pending',
    ownership_transfer_error: rows.find((purchase) => purchase.ownership_transfer_error)?.ownership_transfer_error || null,
    payload: {
      ...(first.payload || {}),
      amount_rub: amountRub,
      receipt_file_url: rows.find((purchase) => purchase.payload?.receipt_file_url)?.payload?.receipt_file_url || first.payload?.receipt_file_url || null,
      receipt_note: rows.find((purchase) => purchase.payload?.receipt_note)?.payload?.receipt_note || first.payload?.receipt_note || null
    },
    item: {
      ...(first.item || {}),
      title: rows.length > 1 ? `${first.item?.title || 'Лот'} x${rows.length}` : (first.item?.title || 'Лот'),
      assets: uniqueAssets
    },
    batch: rows.length > 1 || !!first.payload?.batch_token
  };
}

export function ShopAdminPage() {
  const { accessToken, profilePlan, profileRole, trialEndsAt } = useAuth();
  const [itemFilter, setItemFilter] = useState('all');
  const [purchaseFilter, setPurchaseFilter] = useState('all');
  const [itemSearch, setItemSearch] = useState('');
  const [purchaseSearch, setPurchaseSearch] = useState('');
  const [formState, setFormState] = useState({
    title: '',
    description: '',
    preview_text: '',
    post_purchase_message: '',
    offer_code: '',
    item_type: 'text_offer',
    sales_channel: 'site',
    payment_methods: ['ton', 'p2p'],
    price_ton: '',
    price_rub: '',
    status: 'draft',
    visibility: 'public',
    selectedProxyId: '',
    selectedUserbotId: '',
    selectedBaseId: ''
  });
  const [state, setState] = useState({
    loading: true,
    refreshing: false,
    saving: false,
    error: '',
    items: [],
    purchases: [],
    assets: null,
    updatedAt: null
  });
  const [prefillApplied, setPrefillApplied] = useState(false);
  const [proxyComposer, setProxyComposer] = useState({
    proxyId: '',
    title: '',
    preview_text: '',
    description: '',
    sales_channel: 'admin_only',
    payment_methods: ['ton', 'p2p'],
    price_ton: '',
    price_rub: '',
    status: 'published',
    visibility: 'public',
    saving: false,
    error: ''
  });
  const trialHoursLeft = useMemo(() => {
    if (!trialEndsAt) return null;
    const diffMs = new Date(trialEndsAt).getTime() - Date.now();
    if (diffMs <= 0) return 0;
    return Math.ceil(diffMs / (1000 * 60 * 60));
  }, [trialEndsAt]);
  const trialUpgradeUrgent = profilePlan === 'trial' && trialHoursLeft !== null && trialHoursLeft > 0 && trialHoursLeft <= 72;

  const loadShop = useCallback(async ({ silent = false } = {}) => {
    if (!accessToken) return;

    if (!silent) {
      setState((prev) => ({
        ...prev,
        loading: !prev.items.length && !prev.assets,
        refreshing: !!prev.items.length || !!prev.assets,
        error: ''
      }));
    }

    try {
      const [itemsData, purchasesData, assetsData] = await Promise.all([
        apiRequest('/api/shop/seller/items', { accessToken }),
        apiRequest('/api/shop/seller/purchases', { accessToken }),
        apiRequest('/api/shop/seller/assets', { accessToken })
      ]);

      setState((prev) => ({
        ...prev,
        loading: false,
        refreshing: false,
        error: '',
        items: itemsData.items || [],
        purchases: purchasesData.purchases || [],
        assets: assetsData,
        updatedAt: new Date().toISOString()
      }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        loading: false,
        refreshing: false,
        error: error.message,
        items: [],
        purchases: [],
        assets: null,
        updatedAt: null
      }));
    }
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken) return undefined;

    loadShop();

    const intervalId = window.setInterval(() => {
      loadShop({ silent: true });
    }, 60_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [accessToken, loadShop]);

  const filteredItems = useMemo(() => {
    const needle = itemSearch.trim().toLowerCase();
    return state.items.filter((item) => {
      if (itemFilter === 'published' && item.status !== 'published') return false;
      if (itemFilter === 'draft' && item.status !== 'draft') return false;
      if (itemFilter === 'reserved' && !(item.stats?.pending_purchases > 0)) return false;
      if (itemFilter === 'sold' && item.status !== 'sold') return false;
      if (itemFilter === 'unlisted' && item.visibility !== 'unlisted') return false;
      if (itemFilter === 'private' && item.visibility !== 'private') return false;

      if (!needle) return true;

      return [
        item.title,
        item.description,
        item.preview_text,
        item.item_type,
        item.status,
        item.visibility,
        assetText(item)
      ].filter(Boolean).join(' ').toLowerCase().includes(needle);
    });
  }, [itemFilter, itemSearch, state.items]);

  const groupedPurchases = useMemo(() => {
    const buckets = new Map();
    for (const purchase of state.purchases) {
      const key = purchase.payload?.batch_token || purchase.id;
      const bucket = buckets.get(key) || [];
      bucket.push(purchase);
      buckets.set(key, bucket);
    }
    return Array.from(buckets.values()).map((rows) => normalizeSellerPurchaseGroup(rows)).filter(Boolean);
  }, [state.purchases]);

  const filteredPurchases = useMemo(() => {
    const needle = purchaseSearch.trim().toLowerCase();
    return groupedPurchases.filter((purchase) => {
      if (purchaseFilter === 'pending' && purchase.status !== 'pending') return false;
      if (purchaseFilter === 'awaiting_receipt' && purchase.status !== 'awaiting_receipt') return false;
      if (purchaseFilter === 'rejected' && purchase.status !== 'rejected') return false;
      if (purchaseFilter === 'paid' && purchase.status !== 'paid') return false;
      if (purchaseFilter === 'expired' && purchase.status !== 'expired') return false;
      if (purchaseFilter === 'completed' && purchase.ownership_transfer_status !== 'completed') return false;
      if (purchaseFilter === 'failed' && purchase.ownership_transfer_status !== 'failed') return false;

      if (!needle) return true;

      return [
        purchase.item?.title,
        purchase.item?.item_type,
        purchase.buyer_owner_id,
        purchase.payload?.memo,
        purchase.payload?.seller_wallet,
        purchase.status,
        purchase.ownership_transfer_status,
        purchaseAssetText(purchase),
        purchase.purchase_ids?.length ? `x${purchase.purchase_ids.length}` : ''
      ].filter(Boolean).join(' ').toLowerCase().includes(needle);
    });
  }, [groupedPurchases, purchaseFilter, purchaseSearch]);

  const sellerStats = useMemo(() => {
    const paidPurchases = groupedPurchases.filter((purchase) => purchase.status === 'paid');
    const completedPurchases = paidPurchases.filter((purchase) => purchase.ownership_transfer_status === 'completed');
    const pendingPurchases = groupedPurchases.filter((purchase) => purchase.status === 'pending');
    const awaitingReceiptPurchases = groupedPurchases.filter((purchase) => purchase.status === 'awaiting_receipt');
    const expiredPurchases = groupedPurchases.filter((purchase) => purchase.status === 'expired');
    const failedTransfers = paidPurchases.filter((purchase) => purchase.ownership_transfer_status === 'failed');

    const paidTon = paidPurchases.reduce((sum, purchase) => sum + Number(purchase.amount_ton || 0), 0);
    const pendingTon = pendingPurchases.reduce((sum, purchase) => sum + Number(purchase.amount_ton || 0), 0);
    const conversion = groupedPurchases.length > 0
      ? Math.round((paidPurchases.length / groupedPurchases.length) * 100)
      : 0;
    const transferSuccessRate = paidPurchases.length > 0
      ? Math.round((completedPurchases.length / paidPurchases.length) * 100)
      : 0;

    return {
      paidTon: Number(paidTon.toFixed(4)),
      pendingTon: Number(pendingTon.toFixed(4)),
      awaitingReceiptCount: awaitingReceiptPurchases.length,
      expiredCount: expiredPurchases.length,
      failedTransferCount: failedTransfers.length,
      conversion,
      transferSuccessRate
    };
  }, [groupedPurchases]);

  const availableAssets = state.assets || {};
  const planRules = useMemo(() => getProductTierRules(profilePlan), [profilePlan]);
  const support = availableAssets.support || {};
  const sellerMode = availableAssets.seller_mode || 'asset_marketplace';
  const sellerCanSellAssets = !!support.asset_marketplace || profileRole === 'admin';
  const canUseAssetSeller = profileRole === 'admin' || (sellerCanSellAssets && planRules.canUseShopAdmin);
  const listedProxyIds = useMemo(() => {
    const ids = new Set();
    for (const item of state.items) {
      if (item.status === 'sold') continue;
      for (const asset of item.assets || []) {
        if (asset.asset_type === 'proxy' && asset.asset_id) {
          ids.add(String(asset.asset_id));
        }
      }
    }
    return ids;
  }, [state.items]);
  const saleProxies = useMemo(() => (
    (availableAssets.proxies || []).filter((proxy) => (
      (proxy.inventory_group || 'shop_sale') === 'shop_sale' &&
      !listedProxyIds.has(String(proxy.id))
    ))
  ), [availableAssets.proxies, listedProxyIds]);
  const proxyInventoryStats = useMemo(() => {
    const rows = saleProxies;
    const rawStats = availableAssets.stats?.proxies || null;

    if (rows.length > 0) {
      return {
        total: rows.length,
        ready_for_sale: rows.filter((proxy) => proxy.is_ready_for_sale).length,
        occupied: rows.filter((proxy) => Number(proxy.userbot_count || 0) > 0).length,
        broken: rows.filter((proxy) => proxy.is_working === false).length,
        purchased: rows.filter((proxy) => proxy.provision_source === 'purchased').length
      };
    }

    return rawStats || {
      total: 0,
      ready_for_sale: 0,
      occupied: 0,
      broken: 0,
      purchased: 0
    };
  }, [availableAssets.stats?.proxies, saleProxies]);
  const activeProxyComposerProxy = useMemo(
    () => saleProxies.find((item) => String(item.id) === String(proxyComposer.proxyId)) || null,
    [proxyComposer.proxyId, saleProxies]
  );

  const packageSignals = useMemo(() => {
    const textOfferPurchases = state.purchases.filter((purchase) => purchase.item?.item_type === 'text_offer');

    function buildSignal(code, title, href) {
      const related = textOfferPurchases.filter((purchase) => String(purchase.item?.offer_code || '').trim().toLowerCase() === code);
      if (!related.length) return null;

      const failed = related.find((purchase) => purchase.ownership_transfer_status === 'failed');
      if (failed) {
        return {
          id: code,
          title,
          tone: 'danger',
          status: 'failed',
          href,
          hint: 'Оплата уже пришла, но handoff сломался. Не гони новый трафик в этот пакет, пока не добьешь передачу.'
        };
      }

      const awaitingReceipt = related.find((purchase) => purchase.status === 'awaiting_receipt');
      if (awaitingReceipt) {
        return {
          id: code,
          title,
          tone: 'warning',
          status: 'awaiting_receipt',
          href,
          hint: 'Покупка ждет ручного подтверждения продавцом. Сначала закрой этот хвост, потом уже зови в новый checkout.'
        };
      }

      const pending = related.find((purchase) => purchase.status === 'pending');
      if (pending) {
        return {
          id: code,
          title,
          tone: 'warning',
          status: 'pending',
          href,
          hint: 'Checkout уже открыт и ждет оплату. Дублирующий оффер здесь только усилит бардак.'
        };
      }

      const paid = related.find((purchase) => purchase.status === 'paid');
      if (paid) {
        return {
          id: code,
          title,
          tone: 'ok',
          status: 'paid',
          href,
          hint: 'Пакет уже куплен. Следующий шаг — продавать следующий слой, а не звать сюда заново.'
        };
      }

      const expired = related.find((purchase) => purchase.status === 'expired' || purchase.status === 'rejected');
      if (expired) {
        return {
          id: code,
          title,
          tone: 'default',
          status: 'expired',
          href,
          hint: 'Раньше здесь уже был checkout, но он протух или был отклонен. Если сценарий еще нужен, его надо перезапускать.'
        };
      }

      return null;
    }

    return [
      buildSignal('trial', 'Trial пакет', '/shop?offer=trial'),
      buildSignal('normal', 'Normal пакет', '/shop?offer=normal'),
      buildSignal('seller', sellerPackageTitle(canUseAssetSeller), '/shop?offer=seller')
    ].filter(Boolean);
  }, [canUseAssetSeller, state.purchases]);

  const attentionPurchases = useMemo(() => {
    const now = Date.now();
    return state.purchases
      .map((purchase) => {
        const expiresAt = purchase.expires_at ? new Date(purchase.expires_at).getTime() : null;
        const timeLeftMs = expiresAt ? expiresAt - now : null;
        let priority = 0;
        let bucket = 'ok';

        if (purchase.ownership_transfer_status === 'failed') {
          priority = 100;
          bucket = 'failed_transfer';
        } else if (purchase.status === 'paid' && purchase.ownership_transfer_status !== 'completed') {
          priority = 90;
          bucket = 'pending_transfer';
        } else if (purchase.status === 'pending' && timeLeftMs !== null && timeLeftMs <= 10 * 60 * 1000) {
          priority = 80;
          bucket = 'pending_expiring';
        } else if (purchase.status === 'expired') {
          priority = 60;
          bucket = 'expired';
        }

        return {
          ...purchase,
          _priority: priority,
          _bucket: bucket
        };
      })
      .filter((purchase) => purchase._priority > 0)
      .sort((a, b) => b._priority - a._priority || new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 8);
  }, [state.purchases]);

  const itemSummary = useMemo(() => ({
    total: state.items.length,
    published: state.items.filter((item) => item.status === 'published').length,
    reserved: state.items.filter((item) => (item.stats?.pending_purchases || 0) > 0).length,
    sold: state.items.filter((item) => item.status === 'sold').length,
    unlisted: state.items.filter((item) => item.visibility === 'unlisted').length
  }), [state.items]);

  const purchaseSummary = useMemo(() => ({
    total: groupedPurchases.length,
    pending: groupedPurchases.filter((purchase) => purchase.status === 'pending').length,
    awaiting_receipt: groupedPurchases.filter((purchase) => purchase.status === 'awaiting_receipt').length,
    rejected: groupedPurchases.filter((purchase) => purchase.status === 'rejected').length,
    paid: groupedPurchases.filter((purchase) => purchase.status === 'paid').length,
    expired: groupedPurchases.filter((purchase) => purchase.status === 'expired').length,
    completed: groupedPurchases.filter((purchase) => purchase.ownership_transfer_status === 'completed').length,
    failed: groupedPurchases.filter((purchase) => purchase.ownership_transfer_status === 'failed').length
  }), [groupedPurchases]);
  const receiptQueue = useMemo(
    () => groupedPurchases.filter((purchase) => purchase.status === 'awaiting_receipt'),
    [groupedPurchases]
  );
  const sellerUnlockSteps = canUseAssetSeller ? SELLER_UNLOCK_STEPS : TEXT_SERVICE_UNLOCK_STEPS;
  const sellerUnlockReady = useMemo(() => (
    canUseAssetSeller
      ? {
          inventory: proxyInventoryStats.ready_for_sale > 0,
          bots: (availableAssets.userbots?.length || 0) > 0,
          catalog: itemSummary.total > 0,
          handoff: !!availableAssets.seller_wallet
        }
      : {
          wallet: !!availableAssets.seller_wallet,
          offer: itemSummary.total > 0,
          buyer: itemSummary.published > 0,
          handoff: !!availableAssets.seller_wallet
        }
  ), [
    availableAssets.seller_wallet,
    availableAssets.userbots,
    itemSummary.published,
    itemSummary.total,
    proxyInventoryStats.ready_for_sale,
    canUseAssetSeller
  ]);
  const sellerPrimaryBlocker = useMemo(() => {
    if (!availableAssets.seller_wallet) return 'no_wallet';
    if (sellerStats.failedTransferCount > 0) return 'failed_handoff';
    if (canUseAssetSeller && proxyInventoryStats.ready_for_sale <= 0) return 'no_inventory';
    if (itemSummary.published <= 0) return 'no_items';
    if (sellerStats.paidTon <= 0) return 'no_paid';
    return null;
  }, [
    availableAssets.seller_wallet,
    itemSummary.published,
    proxyInventoryStats.ready_for_sale,
    canUseAssetSeller,
    sellerStats.failedTransferCount,
    sellerStats.paidTon
  ]);
  const sellerBlockerCopy = useMemo(() => (
    canUseAssetSeller
      ? SELLER_BLOCKER_COPY.asset_marketplace
      : SELLER_BLOCKER_COPY.text_service
  ), [canUseAssetSeller]);

  const formHints = useMemo(() => {
    if (!canUseAssetSeller) {
      return planRules.canUseShopAdmin
        ? 'В этом режиме доступны только P2P-офферы с текстом после оплаты.'
        : 'На Trial уже можно собирать P2P-офферы с текстом после оплаты. Витрина активов BullRun откроется после перехода на Normal.';
    }

    if (formState.item_type === 'bundle') {
      return 'Комплект = один юзербот, у которого уже есть свой прокси. Отдельно прокси выбирать не нужно.';
    }

    if (formState.item_type === 'userbot') {
      return 'Продается только сам юзербот. Если у него есть прокси, он не уйдет автоматически как комплект.';
    }

    if (formState.item_type === 'proxy') {
      return 'Прокси можно продавать только если на нем не сидит несколько юзерботов.';
    }

    if (formState.item_type === 'customer_base_asset') {
      return 'После оплаты buyer получит базу в свой кабинет и сможет открыть ее в CRM, Orders, Access и Broadcast.';
    }

    return 'После оплаты покупатель увидит скрытое сообщение. Это простой P2P-оффер без передачи owner_id.';
  }, [canUseAssetSeller, formState.item_type, planRules.canUseShopAdmin]);

  useEffect(() => {
    if (!canUseAssetSeller && formState.item_type !== 'text_offer') {
      setFormState((prev) => ({
        ...prev,
        item_type: 'text_offer',
        offer_code: prev.offer_code || 'p2p',
        selectedProxyId: '',
        selectedUserbotId: '',
        selectedBaseId: ''
      }));
    }
  }, [canUseAssetSeller, formState.item_type]);

  useEffect(() => {
    if (prefillApplied) return;
    if (!canUseAssetSeller) return;
    if (!saleProxies) return;
    if (typeof window === 'undefined') return;

    const params = new URLSearchParams(window.location.search);
    if (params.get('asset') !== 'proxy') {
      setPrefillApplied(true);
      return;
    }

    const proxyId = params.get('proxyId');
    if (!proxyId) {
      setPrefillApplied(true);
      return;
    }

    const proxy = saleProxies.find((item) => String(item.id) === String(proxyId));
    if (!proxy) {
      setState((prev) => ({
        ...prev,
        error: 'Этот прокси еще не готов для продажи в Shop. Сначала переведи его в группу "На продажу".'
      }));
      setPrefillApplied(true);
      return;
    }

    openProxyComposer(proxy);
    window.history.replaceState({}, '', '/app/shop');
    setPrefillApplied(true);
  }, [canUseAssetSeller, prefillApplied, saleProxies]);

  function applyTextOfferTemplate(template) {
    setFormState((prev) => ({
      ...prev,
      item_type: 'text_offer',
      title: template.title,
      price_ton: template.priceTon,
      price_rub: prev.price_rub || '',
      preview_text: template.preview,
      description: template.description,
      post_purchase_message: template.postPurchaseMessage,
      offer_code: template.offerCode,
      sales_channel: 'site',
      selectedProxyId: '',
      selectedUserbotId: '',
      selectedBaseId: ''
    }));
  }

  function openProxyComposer(proxy) {
    setProxyComposer({
      proxyId: String(proxy.id),
      title: proxy.name || `Прокси ${proxy.host}:${proxy.port}`,
      preview_text: 'Готовый серверный SOCKS5-прокси для одного Telegram-аккаунта.',
      description: `Прокси ${proxy.host}:${proxy.port}${proxy.last_check_country ? ` • ${proxy.last_check_country}` : ''}. Один прокси = один юзербот.`,
      sales_channel: 'admin_only',
      payment_methods: ['ton', 'p2p'],
      price_ton: '5',
      price_rub: '',
      status: 'published',
      visibility: 'public',
      saving: false,
      error: ''
    });
  }

  function resetProxyComposer() {
    setProxyComposer({
      proxyId: '',
      title: '',
      preview_text: '',
      description: '',
      sales_channel: 'admin_only',
      payment_methods: ['ton', 'p2p'],
      price_ton: '',
      price_rub: '',
      status: 'published',
      visibility: 'public',
      saving: false,
      error: ''
    });
  }

  async function saveProxyComposer() {
    const proxy = saleProxies.find((item) => String(item.id) === String(proxyComposer.proxyId));
    if (!proxy) {
      setProxyComposer((prev) => ({ ...prev, error: 'Прокси не найден в seller-инвентаре.' }));
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
          price_rub: Number(proxyComposer.price_rub || 0),
          status: proxyComposer.status,
          visibility: 'public',
          transfer_mode: 'ownership_transfer',
          assets: [{
            asset_type: 'proxy',
            asset_id: proxy.id,
            label: proxy.name || `${proxy.host}:${proxy.port}`
          }]
        }
      });

      await loadShop();
      resetProxyComposer();
    } catch (error) {
      setProxyComposer((prev) => ({
        ...prev,
        saving: false,
        error: error.message
      }));
    }
  }

  const prioritySignals = useMemo(() => ([
    {
      title: 'TON закрыто',
      value: formatTon(sellerStats.paidTon),
      tone: sellerStats.paidTon > 0 ? 'ok' : 'default',
      hint: `Конверсия в оплату: ${sellerStats.conversion}%`
    },
    {
      title: 'Передача сломалась',
      value: sellerStats.failedTransferCount,
      tone: sellerStats.failedTransferCount > 0 ? 'danger' : 'ok',
      hint: `Успех handoff: ${sellerStats.transferSuccessRate}%`
    },
    {
      title: 'Бронь TON',
      value: formatTon(sellerStats.pendingTon),
      tone: sellerStats.pendingTon > 0 ? 'warning' : 'default',
      hint: `Ждут оплату: ${purchaseSummary.pending}`
    },
    {
      title: 'Протухшие счета',
      value: sellerStats.expiredCount,
      tone: sellerStats.expiredCount > 0 ? 'warning' : 'ok',
      hint: 'Это хвост, который нужно либо дожимать, либо чистить'
    }
  ]), [purchaseSummary.pending, sellerStats]);

  const eligibleBundleUserbots = useMemo(() => {
    const proxiesById = new Map((availableAssets.proxies || []).map((proxy) => [String(proxy.id), proxy]));
    return (availableAssets.userbots || []).filter((userbot) => userbot.proxy_id && proxiesById.has(String(userbot.proxy_id)));
  }, [availableAssets.proxies, availableAssets.userbots]);

  const selectedBundleProxy = useMemo(() => {
    if (formState.item_type !== 'bundle') return null;
    const userbot = eligibleBundleUserbots.find((item) => String(item.id) === String(formState.selectedUserbotId));
    if (!userbot?.proxy_id) return null;
    return (availableAssets.proxies || []).find((proxy) => String(proxy.id) === String(userbot.proxy_id)) || null;
  }, [availableAssets.proxies, eligibleBundleUserbots, formState.item_type, formState.selectedUserbotId]);

  const formAssets = useMemo(() => {
    if (formState.item_type === 'bundle') {
      const userbot = eligibleBundleUserbots.find((item) => String(item.id) === String(formState.selectedUserbotId));
      if (!userbot || !selectedBundleProxy) return [];
      return [
        {
          asset_type: 'userbot',
          asset_id: userbot.id,
          label: userbot.tg_username ? `@${userbot.tg_username}` : `ID ${userbot.tg_account_id}`
        },
        {
          asset_type: 'proxy',
          asset_id: selectedBundleProxy.id,
          label: selectedBundleProxy.name || `${selectedBundleProxy.host}:${selectedBundleProxy.port}`
        }
      ];
    }

    if (formState.item_type === 'userbot') {
      const userbot = (availableAssets.userbots || []).find((item) => String(item.id) === String(formState.selectedUserbotId));
      return userbot ? [{
        asset_type: 'userbot',
        asset_id: userbot.id,
        label: userbot.tg_username ? `@${userbot.tg_username}` : `ID ${userbot.tg_account_id}`
      }] : [];
    }

    if (formState.item_type === 'proxy') {
      const proxy = (availableAssets.proxies || []).find((item) => String(item.id) === String(formState.selectedProxyId));
      return proxy ? [{
        asset_type: 'proxy',
        asset_id: proxy.id,
        label: proxy.name || `${proxy.host}:${proxy.port}`
      }] : [];
    }

    if (formState.item_type === 'customer_base_asset') {
      const base = (availableAssets.customer_bases || []).find((item) => String(item.id) === String(formState.selectedBaseId));
      return base ? [{
        asset_type: 'customer_base_asset',
        asset_id: base.id,
        label: base.title
      }] : [];
    }

    return [];
  }, [availableAssets.customer_bases, availableAssets.proxies, availableAssets.userbots, eligibleBundleUserbots, formState.item_type, formState.selectedBaseId, formState.selectedProxyId, formState.selectedUserbotId, selectedBundleProxy]);

  async function saveItem() {
    const effectiveItemType = 'text_offer';
    setState((prev) => ({ ...prev, saving: true, error: '' }));
    try {
      await apiRequest('/api/shop/seller/items', {
        accessToken,
        method: 'POST',
        body: {
          title: formState.title,
          description: formState.description,
          preview_text: formState.preview_text,
          post_purchase_message: formState.post_purchase_message,
          offer_code: effectiveItemType === 'text_offer' ? formState.offer_code : null,
          item_type: effectiveItemType,
          sales_channel: formState.sales_channel,
          payment_methods: formState.payment_methods,
          price_ton: Number(formState.price_ton || 0),
          price_rub: Number(formState.price_rub || 0),
          status: formState.status,
          visibility: formState.visibility,
          transfer_mode: effectiveItemType !== 'text_offer' ? 'ownership_transfer' : 'post_purchase_message',
          assets: formAssets
        }
      });

      setFormState({
        title: '',
        description: '',
        preview_text: '',
        post_purchase_message: '',
        offer_code: '',
        item_type: 'text_offer',
        sales_channel: 'site',
        payment_methods: ['ton', 'p2p'],
        price_ton: '',
        price_rub: '',
        status: 'draft',
        visibility: 'public',
        selectedProxyId: '',
        selectedUserbotId: '',
        selectedBaseId: ''
      });
      await loadShop();
      setState((prev) => ({ ...prev, saving: false }));
      window.alert('Лот сохранен.');
    } catch (error) {
      setState((prev) => ({ ...prev, saving: false, error: error.message }));
    }
  }

  async function unpublishItem(itemId) {
    const item = state.items.find((entry) => String(entry.id) === String(itemId));
    if (item?.item_type !== 'text_offer' && !canUseAssetSeller) {
      window.alert(`На ${planRules.label} seller-mode закрыт.`);
      return;
    }
    try {
      await apiRequest(`/api/shop/seller/items/${itemId}/unpublish`, {
        accessToken,
        method: 'POST'
      });
      await loadShop();
    } catch (error) {
      window.alert(error.message);
    }
  }

  async function deleteItem(itemId) {
    const item = state.items.find((entry) => String(entry.id) === String(itemId));
    if (item?.item_type !== 'text_offer' && !canUseAssetSeller) {
      window.alert(`На ${planRules.label} seller-mode закрыт.`);
      return;
    }
    if (!window.confirm('Удалить лот? Это сработает только если по нему нет живой или оплаченной покупки.')) {
      return;
    }
    try {
      const result = await apiRequest(`/api/shop/seller/items/${itemId}`, {
        accessToken,
        method: 'DELETE'
      });
      setState((prev) => ({
        ...prev,
        items: prev.items.filter((entry) => String(entry.id) !== String(result.deleted_item_id || itemId))
      }));
      await loadShop();
    } catch (error) {
      window.alert(error.message);
    }
  }

  async function checkPurchase(target) {
    const purchaseIds = Array.isArray(target?.purchase_ids) && target.purchase_ids.length
      ? target.purchase_ids
      : [target?.id || target].filter(Boolean);
    const purchase = state.purchases.find((entry) => purchaseIds.includes(entry.id) || String(entry.id) === String(target?.id || target));
    const itemType = purchase?.item?.item_type || purchase?.item_type || null;
    if (itemType !== 'text_offer' && !canUseAssetSeller) {
      window.alert(`На ${planRules.label} seller-mode закрыт.`);
      return;
    }
    try {
      if (purchaseIds.length > 1) {
        await apiRequest('/api/shop/seller/purchases/check-batch', {
          accessToken,
          method: 'POST',
          body: { purchase_ids: purchaseIds }
        });
      } else {
        await apiRequest(`/api/shop/seller/purchases/${purchaseIds[0]}/check`, {
          accessToken,
          method: 'POST'
        });
      }
      await loadShop();
    } catch (error) {
      window.alert(error.message);
    }
  }

  async function approvePurchase(target) {
    const purchaseIds = Array.isArray(target?.purchase_ids) && target.purchase_ids.length
      ? target.purchase_ids
      : [target?.id || target].filter(Boolean);
    const purchase = state.purchases.find((entry) => purchaseIds.includes(entry.id) || String(entry.id) === String(target?.id || target));
    const itemType = purchase?.item?.item_type || purchase?.item_type || null;
    if (itemType !== 'text_offer' && !canUseAssetSeller) {
      window.alert(`На ${planRules.label} seller-mode закрыт.`);
      return;
    }
    try {
      if (purchaseIds.length > 1) {
        await apiRequest('/api/shop/seller/purchases/approve-batch', {
          accessToken,
          method: 'POST',
          body: { purchase_ids: purchaseIds }
        });
      } else {
        await apiRequest(`/api/shop/seller/purchases/${purchaseIds[0]}/approve`, {
          accessToken,
          method: 'POST'
        });
      }
      await loadShop();
    } catch (error) {
      window.alert(error.message);
    }
  }

  async function rejectPurchase(target) {
    const purchaseIds = Array.isArray(target?.purchase_ids) && target.purchase_ids.length
      ? target.purchase_ids
      : [target?.id || target].filter(Boolean);
    const purchase = state.purchases.find((entry) => purchaseIds.includes(entry.id) || String(entry.id) === String(target?.id || target));
    const itemType = purchase?.item?.item_type || purchase?.item_type || null;
    if (itemType !== 'text_offer' && !canUseAssetSeller) {
      window.alert(`На ${planRules.label} seller-mode закрыт.`);
      return;
    }
    try {
      if (purchaseIds.length > 1) {
        await apiRequest('/api/shop/seller/purchases/reject-batch', {
          accessToken,
          method: 'POST',
          body: { purchase_ids: purchaseIds }
        });
      } else {
        await apiRequest(`/api/shop/seller/purchases/${purchaseIds[0]}/reject`, {
          accessToken,
          method: 'POST',
          body: {}
        });
      }
      await loadShop();
    } catch (error) {
      window.alert(error.message);
    }
  }

  if (state.loading) {
    return <LoadingState text="Тянем seller-side Shop..." />;
  }

  if (state.error) {
    return (
      <section className="page">
        <div className="page__header">
          <h1>Shop admin</h1>
          <p>Новый seller-side экран уже сидит на живом backend, но этот запрос вернул ошибку.</p>
        </div>
        <div className="error-card">{state.error}</div>
      </section>
    );
  }

  return (
    <section className="page">
      <div className="page__header shop-admin-head">
        <div>
          <div className="shop-admin-head__eyebrow">BullRun Shop</div>
          <h1>Shop admin</h1>
          <p>Один экран для лотов, оплат и handoff.</p>
        </div>
        <div className="shop-admin-head__summary">
          <div className="shop-admin-head__stat">
            <strong>{itemSummary.published}</strong>
            <span>на витрине</span>
          </div>
          <div className="shop-admin-head__stat">
            <strong>{purchaseSummary.awaiting_receipt}</strong>
            <span>ждут чек</span>
          </div>
          <div className="shop-admin-head__stat">
            <strong>{purchaseSummary.failed}</strong>
            <span>handoff fail</span>
          </div>
        </div>
      </div>

      <div className="shop-admin-surface">
        <div className="shop-admin-summary-grid">
          <article className="shop-admin-summary-card">
            <div className="shop-admin-summary-card__label">Продажа прокси</div>
            <strong>{saleProxies.length}</strong>
            <span>готово в группе продажи</span>
          </article>
          <article className="shop-admin-summary-card">
            <div className="shop-admin-summary-card__label">P2P лоты</div>
            <strong>{state.items.filter((item) => item.item_type === 'text_offer').length}</strong>
            <span>текст после оплаты</span>
          </article>
          <article className="shop-admin-summary-card">
            <div className="shop-admin-summary-card__label">Продажи</div>
            <strong>{purchaseSummary.total}</strong>
            <span>всего за текущий seller flow</span>
          </article>
          <article className="shop-admin-summary-card">
            <div className="shop-admin-summary-card__label">Оплаты</div>
            <strong>{formatTon(sellerStats.paidTon)} TON</strong>
            <span>{purchaseSummary.paid} успешных оплат</span>
          </article>
        </div>
      </div>

      {!canUseAssetSeller ? (
        <>
          <PlanBanner
            tone={planRules.canUseShopAdmin ? 'info' : 'warning'}
            title={planRules.canUseShopAdmin ? 'P2P seller mode активен' : 'На Trial уже открыт P2P seller mode'}
            text={planRules.canUseShopAdmin
              ? 'В этом режиме доступны P2P-офферы с текстом после оплаты. Для маркетплейса активов BullRun нужен seller-контур admin.'
              : 'Trial уже позволяет собирать P2P-офферы и принимать оплату. Витрина активов и handoff ownership_transfer откроются на Normal.'}
          />
          {!planRules.canUseShopAdmin ? (
            <UpgradeCallout
              title={trialUpgradeUrgent ? `Trial скоро сгорит: осталось около ${trialHoursLeft} ч` : undefined}
              text={trialUpgradeUrgent
                ? 'P2P-офферы уже доступны, но если тебе нужен маркетплейс активов BullRun, не жди дедлайна trial. Переходи на Normal прямо сейчас.'
                : 'P2P-офферы уже можно продавать. Для витрины активов BullRun следующий шаг — Normal.'}
            />
          ) : null}
        </>
      ) : null}

      {canUseAssetSeller ? (
        <div className="section">
          <div className="shop-admin-section-head">
            <div>
              <div className="section__title">Proxy</div>
              <div className="shop-admin-section-head__text">
                Только те прокси, которые ты перевёл в группу продажи на странице <a href="/app/proxies">Прокси</a>.
              </div>
            </div>
          </div>
          <div className="toolbar-card">
            <div className="toolbar-card__title">Лот с ownership transfer</div>
            {saleProxies.length === 0 ? (
              <div className="empty-inline shop-admin-empty">В группе продажи пока нет прокси. Добавь их на странице `/app/proxies`.</div>
            ) : (
              <>
                {proxyComposer.error ? (
                  <div className="error-inline">{proxyComposer.error}</div>
                ) : null}
                <div className="toolbar-card__body shop-admin-form-grid">
                  <select
                    className="field"
                    value={proxyComposer.proxyId}
                    onChange={(event) => {
                      const nextProxy = saleProxies.find((item) => String(item.id) === String(event.target.value));
                      if (nextProxy) {
                        openProxyComposer(nextProxy);
                      } else {
                        resetProxyComposer();
                      }
                    }}
                  >
                    <option value="">Какой прокси продавать</option>
                    {saleProxies.map((proxy) => (
                      <option key={proxy.id} value={proxy.id}>
                        {proxy.name || `${proxy.host}:${proxy.port}`} ({proxy.host}:{proxy.port})
                      </option>
                    ))}
                  </select>
                  <input
                    className="field"
                    type="text"
                    value={proxyComposer.title}
                    onChange={(event) => setProxyComposer((prev) => ({ ...prev, title: event.target.value }))}
                    placeholder="Название лота"
                  />
                  <input
                    className="field"
                    type="number"
                    min="0"
                    step="0.01"
                    value={proxyComposer.price_ton}
                    onChange={(event) => setProxyComposer((prev) => ({ ...prev, price_ton: event.target.value }))}
                    placeholder="Цена в TON"
                  />
                  <input
                    className="field"
                    type="number"
                    min="0"
                    step="1"
                    value={proxyComposer.price_rub}
                    onChange={(event) => setProxyComposer((prev) => ({ ...prev, price_rub: event.target.value }))}
                    placeholder="Цена в RUB для СБП"
                  />
                  <select
                    className="field"
                    value={proxyComposer.status}
                    onChange={(event) => setProxyComposer((prev) => ({ ...prev, status: event.target.value }))}
                  >
                    <option value="draft">Черновик</option>
                    <option value="published">Опубликовать</option>
                  </select>
                  <select
                    className="field"
                    value={proxyComposer.sales_channel}
                    onChange={(event) => setProxyComposer((prev) => ({ ...prev, sales_channel: event.target.value }))}
                  >
                    <option value="admin_only">Только админка</option>
                    <option value="both">Сайт + админка</option>
                    <option value="site">Публичный сайт</option>
                  </select>
                </div>
                <div className="payment-method-row">
                  <div className="payment-method-row__options">
                    {[
                      ['ton', 'TON'],
                      ['p2p', 'СБП']
                    ].map(([method, label]) => (
                      <label key={method} className="checkbox-pill">
                        <input
                          type="checkbox"
                          checked={proxyComposer.payment_methods.includes(method)}
                          onChange={(event) => {
                            setProxyComposer((prev) => {
                              const next = event.target.checked
                                ? Array.from(new Set([...prev.payment_methods, method]))
                                : prev.payment_methods.filter((item) => item !== method);
                              return { ...prev, payment_methods: next.length ? next : ['ton'] };
                            });
                          }}
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="form-grid">
                  <label className="field-group">
                    <span>Preview</span>
                    <textarea
                      className="field"
                      rows="3"
                      value={proxyComposer.preview_text}
                      onChange={(event) => setProxyComposer((prev) => ({ ...prev, preview_text: event.target.value }))}
                      placeholder="Короткий текст, который видно на витрине"
                    />
                  </label>
                  <label className="field-group">
                    <span>Описание</span>
                    <textarea
                      className="field"
                      rows="4"
                      value={proxyComposer.description}
                      onChange={(event) => setProxyComposer((prev) => ({ ...prev, description: event.target.value }))}
                      placeholder="Что получает покупатель и зачем ему это"
                    />
                  </label>
                </div>
                <div className="toolbar-card__body">
                  <button
                    className="ghost-button ghost-button--primary"
                    type="button"
                    onClick={saveProxyComposer}
                    disabled={proxyComposer.saving || !proxyComposer.proxyId}
                  >
                    {proxyComposer.saving ? 'Сохраняем...' : 'Сохранить лот'}
                  </button>
                  <button className="ghost-button" type="button" onClick={resetProxyComposer}>
                    Сбросить
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}

      <div className="section" id="create-lot">
        <div className="shop-admin-section-head">
          <div>
            <div className="section__title">P2P оффер</div>
            <div className="shop-admin-section-head__text">Простой лот с оплатой через TON или СБП и выдачей текста после подтверждения оплаты.</div>
          </div>
        </div>
        <div className="toolbar-card">
          <div className="toolbar-card__title">Текст после оплаты</div>
          <div className="toolbar-card__body shop-admin-form-grid">
            <input
              className="field"
              type="text"
              value={formState.title}
              onChange={(event) => setFormState((prev) => ({ ...prev, title: event.target.value }))}
              placeholder="Название лота"
            />
              <input
                className="field"
                type="number"
                min="0"
                step="0.01"
                value={formState.price_ton}
                onChange={(event) => setFormState((prev) => ({ ...prev, price_ton: event.target.value }))}
                placeholder="Цена в TON"
              />
              <input
                className="field"
                type="number"
                min="0"
                step="1"
                value={formState.price_rub}
                onChange={(event) => setFormState((prev) => ({ ...prev, price_rub: event.target.value }))}
                placeholder="Цена в RUB для СБП"
              />
            <select
              className="field"
              value={formState.status}
              onChange={(event) => setFormState((prev) => ({ ...prev, status: event.target.value }))}
            >
              <option value="draft">Черновик</option>
              <option value="published">Опубликовать</option>
            </select>
            <select
              className="field"
              value={formState.visibility}
              onChange={(event) => setFormState((prev) => ({ ...prev, visibility: event.target.value }))}
            >
              <option value="public">Публичный</option>
              <option value="unlisted">Только по ссылке</option>
              <option value="private">Private</option>
            </select>
            <select
              className="field"
              value={formState.sales_channel}
              onChange={(event) => setFormState((prev) => ({ ...prev, sales_channel: event.target.value }))}
            >
              <option value="site">Публичный сайт</option>
              <option value="both">Сайт + админка</option>
              <option value="admin_only">Только админка</option>
            </select>
          </div>
          <div className="payment-method-row">
            <div className="payment-method-row__options">
              {[
                ['ton', 'TON'],
                ['p2p', 'СБП']
              ].map(([method, label]) => (
                <label key={method} className="checkbox-pill">
                  <input
                    type="checkbox"
                    checked={formState.payment_methods.includes(method)}
                    onChange={(event) => {
                      setFormState((prev) => {
                        const next = event.target.checked
                          ? Array.from(new Set([...prev.payment_methods, method]))
                          : prev.payment_methods.filter((item) => item !== method);
                        return { ...prev, payment_methods: next.length ? next : ['ton'] };
                      });
                    }}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="form-grid">
            <label className="field-group">
              <span>Preview</span>
              <textarea
                className="field"
                rows="3"
                value={formState.preview_text}
                onChange={(event) => setFormState((prev) => ({ ...prev, preview_text: event.target.value }))}
                placeholder="Короткий текст, который видно на витрине"
              />
            </label>
            <label className="field-group">
              <span>Описание</span>
              <textarea
                className="field"
                rows="4"
                value={formState.description}
                onChange={(event) => setFormState((prev) => ({ ...prev, description: event.target.value }))}
                placeholder="Что получает покупатель и зачем ему это"
              />
            </label>
            <label className="field-group">
              <span>Сообщение после оплаты</span>
              <textarea
                className="field"
                rows="4"
                value={formState.post_purchase_message}
                onChange={(event) => setFormState((prev) => ({ ...prev, post_purchase_message: event.target.value }))}
                placeholder="Спасибо за покупку. Вот что дальше..."
              />
            </label>
          </div>

          <div className="list-item">
            <div className="list-item__title">Шаблоны</div>
            <div className="table-actions" style={{ marginTop: 12, flexWrap: 'wrap' }}>
              {TEXT_OFFER_TEMPLATES.map((template) => (
                <button
                  key={template.id}
                  className="ghost-button"
                  type="button"
                  onClick={() => applyTextOfferTemplate(template)}
                >
                  {template.title}
                </button>
              ))}
            </div>
          </div>

          <div className="toolbar-card__body">
            <button className="ghost-button ghost-button--primary" type="button" onClick={saveItem} disabled={state.saving}>
              {state.saving ? 'Сохраняем...' : 'Сохранить лот'}
            </button>
          </div>
        </div>
      </div>

      <div className="section">
        <div className="shop-admin-section-head">
          <div>
            <div className="section__title">Лоты в продаже</div>
            <div className="shop-admin-section-head__text">Все seller-side лоты в одном месте: что опубликовано, что в черновике и что уже висит в брони.</div>
          </div>
        </div>
        {profileRole !== 'admin' ? (
          <div className="toolbar-card" style={{ marginBottom: 16 }}>
            <div className="toolbar-card__title">Лимиты тарифа</div>
            <div className="table-subtext" style={{ marginBottom: 10 }}>
              Текущий тариф: <strong>{planRules.label}</strong>
            </div>
            <div className="list-stack">
              <div className="list-item">
                <div className="list-item__title">Свои прокси</div>
                <div className="list-item__meta">
                  {Number.isFinite(planRules.maxOwnedProxies) ? `${planRules.maxOwnedProxies} шт.` : 'Без лимита'}
                </div>
              </div>
              <div className="list-item">
                <div className="list-item__title">Свои юзерботы</div>
                <div className="list-item__meta">
                  {Number.isFinite(planRules.maxUserbots) ? `${planRules.maxUserbots} шт.` : 'Без лимита'}
                </div>
              </div>
              <div className="list-item">
                <div className="list-item__title">Тип seller-flow</div>
                <div className="list-item__meta">
                  {planRules.canUseShopAdmin ? 'P2P-офферы и полный seller-mode' : 'Только P2P-офферы с текстом после оплаты'}
                </div>
              </div>
            </div>
          </div>
        ) : null}
      <div className="grid shop-admin-stat-grid">
          <StatCard title="Всего" value={itemSummary.total} hint="Все seller-side лоты." />
          <StatCard title="На витрине" value={itemSummary.published} hint="Публичные и реально продающиеся." />
          <StatCard title="С бронью" value={itemSummary.reserved} hint="По ним уже висят живые pending-покупки." tone={itemSummary.reserved ? 'warning' : 'default'} />
          <StatCard title="Скрытые" value={itemSummary.unlisted} hint="Только по прямой ссылке." />
        </div>
        <div className="toolbar-card">
          <div className="toolbar-card__body">
            <input
              className="field"
              type="text"
              value={itemSearch}
              onChange={(event) => setItemSearch(event.target.value)}
              placeholder="Название, тип, видимость, состав актива"
            />
          </div>
          <div className="filter-strip">
            {ITEM_FILTERS.map((item) => (
              <button
                key={item.id}
                className={`filter-chip${itemFilter === item.id ? ' filter-chip--active' : ''}`}
                onClick={() => setItemFilter(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="table-card">
          <div className="table-card__title">Seller-side лоты</div>
          {filteredItems.length === 0 ? (
            <div className="empty-inline shop-admin-empty">Под текущий фильтр лоты не попали.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Лот</th>
                  <th>Состав</th>
                  <th>Статус</th>
                  <th>Продажи</th>
                  <th>Что делать</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.slice(0, 50).map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div>{item.title}</div>
                      <div className="table-subtext">
                        {offerCodeLabel(item.offer_code) || item.item_type} • {itemPriceSummary(item)}
                      </div>
                    </td>
                    <td>
                      <div>{assetText(item) || 'P2P-оффер без передаваемых активов'}</div>
                      <div className="table-subtext">
                        {visibilityLabel(item.visibility)} • {salesChannelLabel(item.sales_channel)} • {paymentMethodsLabel(item.payment_methods)}
                      </div>
                    </td>
                    <td>
                      <span className={itemBadgeClass(item)}>{item.status}</span>
                      <div className="table-subtext">
                        Бронь: {item.stats?.pending_purchases || 0} • Оплаты: {item.stats?.paid_purchases || 0}
                      </div>
                    </td>
                    <td>
                      <div>{item.stats?.paid_purchases || 0} / {item.stats?.total_purchases || 0}</div>
                      <div className="table-subtext">
                        Handoff ok: {item.stats?.completed_transfers || 0} • Fail: {item.stats?.failed_transfers || 0}
                      </div>
                    </td>
                    <td>
                      <div>{item.stats?.failed_transfers ? 'Сначала добей handoff.' : item.stats?.pending_purchases ? 'Проверь живые брони.' : 'Лот выглядит спокойно.'}</div>
                      <div className="table-actions">
                        {item.status === 'published' ? (
                          <button className="inline-action" onClick={() => unpublishItem(item.id)}>Снять с продажи</button>
                        ) : null}
                        <button className="inline-action" onClick={() => deleteItem(item.id)}>Удалить</button>
                        <a href={`/shop/?item=${encodeURIComponent(item.id)}`} target="_blank" rel="noreferrer">Лот</a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="section">
        <div className="shop-admin-section-head">
          <div>
            <div className="section__title">Продажи</div>
            <div className="shop-admin-section-head__text">Хвост оплат, ручная проверка чеков и всё, что влияет на закрытие сделки после создания лота.</div>
          </div>
        </div>
        <div className="grid shop-admin-stat-grid">
          <StatCard title="Всего" value={purchaseSummary.total} hint="Все последние сделки продавца." />
          <StatCard title="Ждут оплату" value={purchaseSummary.pending} hint="TON и свежие pending." tone={purchaseSummary.pending ? 'warning' : 'default'} />
          <StatCard title="Ждут чек" value={purchaseSummary.awaiting_receipt} hint="P2P ждут ручного решения." tone={purchaseSummary.awaiting_receipt ? 'warning' : 'default'} />
          <StatCard title="Оплаты есть" value={purchaseSummary.paid} hint="Деньги уже пришли." />
          <StatCard title="Передача сломалась" value={purchaseSummary.failed} hint="Главный seller-side риск." tone={purchaseSummary.failed ? 'danger' : 'default'} />
        </div>
        <div className="toolbar-card">
          <div className="toolbar-card__body">
            <input
              className="field"
              type="text"
              value={purchaseSearch}
              onChange={(event) => setPurchaseSearch(event.target.value)}
              placeholder="memo, buyer owner, лот, состав актива"
            />
          </div>
          <div className="filter-strip">
            {PURCHASE_FILTERS.map((item) => (
              <button
                key={item.id}
                className={`filter-chip${purchaseFilter === item.id ? ' filter-chip--active' : ''}`}
                onClick={() => setPurchaseFilter(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {receiptQueue.length ? (
          <div className="table-card" style={{ marginBottom: 16 }}>
            <div className="table-card__title">Чеки на проверку</div>
            <div className="list-stack">
              {receiptQueue.map((purchase) => (
                <div key={`receipt-${purchase.id}`} className="list-item">
                  <div className="list-item__head">
                    <div>
                      <div className="list-item__title">{purchase.item?.title || 'Лот'}</div>
                      <div className="list-item__meta">
                        owner {purchase.buyer_owner_id} • {purchase.payload?.sbp_bank || 'СБП'} • {purchaseAmountSummary(purchase)}{purchase.purchase_ids?.length > 1 ? ` • ${purchase.purchase_ids.length} счета` : ''}
                      </div>
                    </div>
                    <span className="pill pill--warning">{purchase.purchase_ids?.length > 1 ? 'Чеки отправлены' : 'Чек отправлен'}</span>
                  </div>
                  {purchase.payload?.receipt_note ? (
                    <div className="list-item__meta" style={{ marginTop: 8 }}>{purchase.payload.receipt_note}</div>
                  ) : null}
                  <div className="table-actions" style={{ marginTop: 10, flexWrap: 'wrap' }}>
                    {purchase.payload?.receipt_file_url ? (
                      <a href={purchase.payload.receipt_file_url} target="_blank" rel="noreferrer">Открыть чек</a>
                    ) : null}
                    <button className="inline-action" onClick={() => approvePurchase(purchase)}>Одобрить</button>
                    <button className="inline-action" onClick={() => rejectPurchase(purchase)}>Отклонить</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="table-card">
          <div className="table-card__title">Последние продажи</div>
          {filteredPurchases.length === 0 ? (
            <div className="empty-inline shop-admin-empty">Под текущий фильтр продаж ничего не попало.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Лот</th>
                  <th>Покупатель</th>
                  <th>Оплата</th>
                  <th>Статус</th>
                  <th>Дальше</th>
                </tr>
              </thead>
              <tbody>
                {filteredPurchases.slice(0, 50).map((purchase) => (
                  <tr key={purchase.id}>
                    <td>
                      <div>{purchase.item?.title || 'Лот удален'}</div>
                      <div className="table-subtext">{purchaseAssetText(purchase) || purchase.item?.item_type || '—'}{purchase.purchase_ids?.length > 1 ? ` • x${purchase.purchase_ids.length}` : ''}</div>
                    </td>
                    <td>
                      <div>owner {purchase.buyer_owner_id}</div>
                      <div className="table-subtext">{purchase.payload?.memo || 'memo нет'}</div>
                    </td>
                    <td>
                      <div>{purchaseAmountSummary(purchase)}</div>
                      <div className="table-subtext">
                        {purchase.status === 'pending' ? `До ${formatWhen(purchase.expires_at)}` : formatWhen(purchase.created_at)}
                      </div>
                      {purchase.payload?.payment_method === 'p2p' ? (
                        <>
                          <div className="table-subtext">
                            P2P • {purchase.payload?.sbp_bank || 'СБП'}{purchase.payload?.sbp_fio ? ` • ${purchase.payload.sbp_fio}` : ''}
                          </div>
                          {purchase.payload?.receipt_file_url ? (
                            <div className="table-subtext">
                              <a href={purchase.payload.receipt_file_url} target="_blank" rel="noreferrer">Чек</a>
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <div className="table-subtext">TON • {purchase.payload?.seller_wallet || 'кошелек не указан'}</div>
                      )}
                    </td>
                    <td>
                      <span className={purchaseStatusBadge(purchase)}>{purchaseStatusText(purchase)}</span>
                      <div className="table-subtext">{purchase.ownership_transfer_error || 'Без ошибок handoff'}</div>
                    </td>
                    <td>
                      <div className="table-actions">
                        <button className="inline-action" onClick={() => checkPurchase(purchase)}>Проверить оплату</button>
                        {purchase.status === 'awaiting_receipt' ? (
                          <>
                            <button className="inline-action" onClick={() => approvePurchase(purchase)}>Одобрить</button>
                            <button className="inline-action" onClick={() => rejectPurchase(purchase)}>Отклонить</button>
                          </>
                        ) : null}
                        {purchase.payload?.buyer_tg_user_id ? (
                          <a
                            href={`/app/dossier?tg=${encodeURIComponent(purchase.payload.buyer_tg_user_id)}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Досье
                          </a>
                        ) : null}
                        {purchaseHasAssetType(purchase, 'proxy') ? (
                          <a href="/app/proxies" target="_blank" rel="noreferrer">Прокси</a>
                        ) : null}
                        {purchaseHasAssetType(purchase, 'userbot') ? (
                          <a href="/app/userbots" target="_blank" rel="noreferrer">Боты</a>
                        ) : null}
                        {purchaseHasAssetType(purchase, 'customer_base_asset') ? (
                          <a href="/app/customers?tab=bases" target="_blank" rel="noreferrer">Базы</a>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </section>
  );
}
