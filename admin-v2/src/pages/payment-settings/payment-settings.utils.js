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

export function requisitesStatusBadgeClass(isReady) {
  return isReady
    ? 'border border-emerald-200/80 bg-emerald-50 text-emerald-700'
    : 'border border-amber-200/80 bg-amber-50 text-amber-700';
}
