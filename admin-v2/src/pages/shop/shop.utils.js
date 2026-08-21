// --- Filters ---

export const PURCHASE_FILTERS = [
  { id: 'all', label: 'Все' },
  { id: 'pending', label: 'Ожидает оплату' },
  { id: 'awaiting_receipt', label: 'Ждёт подтверждения' },
  { id: 'paid', label: 'Оплачен' },
  { id: 'rejected', label: 'Отклонён' },
  { id: 'expired', label: 'Срок истёк' }
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

// --- Status Mappers (return { label, tone }) ---

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

// --- Price / Amount ---

export function purchaseAmountSummary(purchase) {
  return `${formatTon(purchase?.amount_ton || purchase?.item?.price_ton || 0)} TON`;
}

// --- Asset helpers ---

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
  payment_methods: ['ton'],
  price_ton: '',
  status: 'published',
  visibility: 'public',
  saving: false,
  error: ''
};

