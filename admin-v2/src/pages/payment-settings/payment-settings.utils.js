export function normalizeTonWallet(value) {
  return String(value || '').replace(/\s+/g, '').trim();
}

export function isValidTonWallet(value) {
  const wallet = normalizeTonWallet(value);
  if (!wallet) return true;
  return /^[A-Za-z0-9_-]{48,}$/.test(wallet);
}

export function formatWhen(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value));
}

export function paymentEventBadge(event) {
  if (event.event_type === 'invoice_completed') return { text: 'Оплата закрылась', className: 'pill pill--ok' };
  if (event.event_type === 'webhook_received' || event.event_type === 'webhook_test') return { text: 'Webhook дошел', className: 'pill pill--warning' };
  if (event.event_type === 'rejected_secret' || event.status === 'rejected') return { text: 'Косяк / отказ', className: 'pill pill--danger' };
  return { text: event.event_type || 'Событие', className: 'pill' };
}

export function downloadCsv(filename, header, rows) {
  const escapeCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const csv = [header, ...rows].map((line) => line.map(escapeCell).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function requisitesStatusBadgeClass(isReady) {
  return isReady
    ? 'border border-emerald-200/80 bg-emerald-50 text-emerald-700'
    : 'border border-amber-200/80 bg-amber-50 text-amber-700';
}
