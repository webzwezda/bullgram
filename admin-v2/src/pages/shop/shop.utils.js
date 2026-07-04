import { Badge } from '@/components/ui/badge';

// --- Filters ---

export const ITEM_FILTERS = [
  { id: 'all', label: 'Все' },
  { id: 'published', label: 'На витрине' },
  { id: 'draft', label: 'Черновики' },
  { id: 'reserved', label: 'С бронью' },
  { id: 'sold', label: 'Продано' },
  { id: 'unlisted', label: 'По ссылке' }
];

export const PURCHASE_FILTERS = [
  { id: 'all', label: 'Все' },
  { id: 'pending', label: 'Ожидает оплату' },
  { id: 'awaiting_receipt', label: 'Ждёт подтверждения' },
  { id: 'paid', label: 'Оплачен' },
  { id: 'rejected', label: 'Отклонён' },
  { id: 'expired', label: 'Срок истёк' }
];

export const TEXT_OFFER_TEMPLATES = [
  {
    id: 'trial',
    offerCode: 'trial',
    title: 'Trial вход',
    priceTon: '5',
    preview: 'Быстрый вход в Bullgram Trial: первый заказ и стартовый Telegram-контур.',
    description: 'Покупатель получает входной оффер: базовый TON/P2P заказ, скрытое сообщение после оплаты и понятный следующий шаг.',
    postPurchaseMessage: 'Спасибо за покупку Trial. Открой /app, забери бесплатный прокси, подключи первый юзербот и начни работу.'
  },
  {
    id: 'p2p',
    offerCode: 'p2p',
    title: 'Оффер с текстом',
    priceTon: '10',
    preview: 'После оплаты покупатель получает скрытое сообщение, ссылку или инструкцию.',
    description: 'Простой оффер: подходит для текстов, гайдов, ссылок, сигналов и разовых услуг.',
    postPurchaseMessage: 'Оплата получена. Вот ваш результат: вставьте сюда ссылку, инструкцию или текст для покупателя.'
  },
  {
    id: 'normal',
    offerCode: 'normal',
    title: 'Normal апгрейд',
    priceTon: '29',
    preview: 'Апгрейд с Trial: больше юзерботов, больше прокси, CRM и дожим без лимитов.',
    description: 'Покупатель получает следующий продуктовый слой: рабочий контур для денег, доступа, CRM и рассылок.',
    postPurchaseMessage: 'Normal открыт. Переходите в /app, подключайте контур и запускайте CRM и рассылки без trial-лимитов.'
  }
];

// --- Formatters ---

export function formatWhen(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value));
}

export function formatTon(value) {
  return Number(value || 0).toFixed(4);
}

export function formatRub(value) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Number(value || 0));
}

// --- Status Mappers (return { label, tone }) ---

export function itemStatusMeta(item) {
  if (item.status === 'sold') return { label: 'Продан', tone: 'success' };
  if (item.status === 'published') return { label: 'На витрине', tone: 'warning' };
  return { label: 'Черновик', tone: 'default' };
}

export function purchaseStatusMeta(row) {
  if (row.ownership_transfer_status === 'failed') return { label: 'Ошибка передачи', tone: 'error' };
  if (row.status === 'paid' && row.ownership_transfer_status === 'completed') return { label: 'Завершён', tone: 'success' };
  if (row.status === 'awaiting_receipt') return { label: 'Ждёт подтверждения', tone: 'warning' };
  if (row.status === 'rejected') return { label: 'Отклонён', tone: 'error' };
  if (row.status === 'paid') return { label: 'Передаётся', tone: 'warning' };
  if (row.status === 'pending') return { label: 'Ожидает оплату', tone: 'warning' };
  if (row.status === 'expired') return { label: 'Срок истёк', tone: 'default' };
  return { label: row.status || '—', tone: 'default' };
}

// --- Labels ---

export function visibilityLabel(value) {
  if (value === 'unlisted') return 'По ссылке';
  if (value === 'private') return 'Private';
  return 'Публичный';
}

export function offerCodeLabel(value) {
  if (value === 'trial') return 'Trial';
  if (value === 'normal') return 'Normal';
  if (value === 'seller') return 'Seller';
  if (value === 'p2p') return 'Оффер с текстом';
  return '';
}

export function salesChannelLabel(value) {
  if (value === 'admin_only') return 'Только админка';
  if (value === 'both') return 'Сайт + админка';
  return 'Публичный сайт';
}

export function paymentMethodLabel(method) {
  if (method === 'p2p') return 'СБП';
  return 'TON';
}

export function paymentMethodsLabel(value) {
  const methods = Array.isArray(value) ? value : [];
  if (!methods.length) return 'TON + СБП';
  return methods.map(paymentMethodLabel).join(' + ');
}

// --- Price / Amount ---

export function itemPriceSummary(item) {
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

export function purchaseAmountSummary(purchase) {
  if (purchase?.payload?.payment_method === 'p2p') {
    const rub = Number(purchase?.amount_rub || purchase?.payload?.amount_rub || purchase?.item?.price_rub || 0);
    return rub > 0 ? `${formatRub(rub)} RUB` : paymentMethodLabel(purchase?.payload?.payment_method);
  }
  return `${formatTon(purchase?.amount_ton || purchase?.item?.price_ton || 0)} TON`;
}

// --- Asset helpers ---

export function assetText(row) {
  return (row.assets || []).map((asset) => asset.label || asset.asset_type).join(' • ');
}

export function purchaseAssetText(row) {
  return (row.item?.assets || []).map((asset) => asset.label || asset.asset_type).join(' • ');
}

export function purchaseHasAssetType(row, type) {
  return (row.item?.assets || []).some((asset) => asset.asset_type === type);
}

// --- Purchase grouping ---

export function normalizeSellerPurchaseGroup(rows = []) {
  if (!rows.length) return null;
  const first = rows[0];
  const status = rows.some((p) => p.ownership_transfer_status === 'failed')
    ? 'paid'
    : rows.some((p) => p.status === 'awaiting_receipt')
      ? 'awaiting_receipt'
      : rows.some((p) => p.status === 'pending')
        ? 'pending'
        : rows.some((p) => p.status === 'rejected')
          ? 'rejected'
          : rows.some((p) => p.status === 'expired')
            ? 'expired'
            : 'paid';
  const amountTon = rows.reduce((sum, p) => sum + Number(p.amount_ton || 0), 0);
  const amountRub = rows.reduce((sum, p) => sum + Number(p.amount_rub || p.payload?.amount_rub || p.item?.price_rub || 0), 0);
  const createdAt = rows
    .map((p) => p.created_at ? new Date(p.created_at).getTime() : null)
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => b - a)[0];
  const expiresAt = rows
    .map((p) => p.expires_at ? new Date(p.expires_at).getTime() : null)
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b)[0];
  const assets = rows.flatMap((p) => p.item?.assets || []);
  const uniqueAssets = Array.from(new Map(
    assets.map((a) => [`${a.asset_type}:${a.asset_id || a.label || ''}`, a])
  ).values());
  const uniqueBuyers = Array.from(new Set(rows.map((p) => String(p.buyer_owner_id || '')).filter(Boolean)));

  return {
    ...first,
    id: first.payload?.batch_token || first.id,
    purchase_ids: rows.map((p) => p.id),
    buyer_owner_id: uniqueBuyers.length === 1 ? uniqueBuyers[0] : uniqueBuyers.join(', '),
    status,
    amount_ton: amountTon,
    amount_rub: amountRub,
    created_at: createdAt ? new Date(createdAt).toISOString() : first.created_at,
    expires_at: expiresAt ? new Date(expiresAt).toISOString() : first.expires_at,
    ownership_transfer_status: rows.some((p) => p.ownership_transfer_status === 'failed')
      ? 'failed'
      : rows.every((p) => p.ownership_transfer_status === 'completed')
        ? 'completed'
        : rows.some((p) => p.status === 'paid')
          ? 'pending'
          : 'pending',
    ownership_transfer_error: rows.find((p) => p.ownership_transfer_error)?.ownership_transfer_error || null,
    payload: {
      ...(first.payload || {}),
      amount_rub: amountRub,
      receipt_file_url: rows.find((p) => p.payload?.receipt_file_url)?.payload?.receipt_file_url || first.payload?.receipt_file_url || null,
      receipt_note: rows.find((p) => p.payload?.receipt_note)?.payload?.receipt_note || first.payload?.receipt_note || null
    },
    item: {
      ...(first.item || {}),
      title: rows.length > 1 ? `${first.item?.title || 'Лот'} x${rows.length}` : (first.item?.title || 'Лот'),
      assets: uniqueAssets
    },
    batch: rows.length > 1 || !!first.payload?.batch_token
  };
}

// --- Initial form states ---

export const INITIAL_FORM_STATE = {
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
};

export const TONE_COLORS = {
  success: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  ok: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  warning: 'bg-amber-100 text-amber-800 border-amber-200',
  error: 'bg-rose-100 text-rose-800 border-rose-200',
  danger: 'bg-rose-100 text-rose-800 border-rose-200',
  default: 'bg-slate-100 text-slate-700 border-slate-200'
};

export const INITIAL_PROXY_COMPOSER = {
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
};

