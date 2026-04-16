import { SBP_BANK_OPTIONS } from './payment-settings.constants.js';

export function parseSbpBanks(value) {
  const raw = Array.isArray(value)
    ? value
    : String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);

  const normalized = SBP_BANK_OPTIONS
    .map((option) => option.value)
    .filter((option) => raw.includes(option));

  return normalized.length > 0 ? normalized : ['Т-Банк'];
}

export function serializeSbpBanks(values) {
  return SBP_BANK_OPTIONS
    .map((option) => option.value)
    .filter((option) => values.includes(option))
    .join(', ');
}

export function normalizePhone(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');

  if (digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8'))) {
    return `+7 ${digits.slice(1, 4)} ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9, 11)}`;
  }

  if (digits.length === 10) {
    return `+7 ${digits.slice(0, 3)} ${digits.slice(3, 6)}-${digits.slice(6, 8)}-${digits.slice(8, 10)}`;
  }

  if (digits.length > 11 && raw.startsWith('+')) {
    return `+${digits}`;
  }

  return raw;
}

export function normalizePhoneLive(value) {
  const raw = String(value || '');
  if (!raw.trim()) return '';

  let digits = raw.replace(/\D/g, '');
  if (!digits) return '';

  if (digits.startsWith('8')) {
    digits = `7${digits.slice(1)}`;
  }

  const hasCountryPrefix = digits.startsWith('7');
  const body = hasCountryPrefix ? digits.slice(1, 11) : digits.slice(0, 10);

  const parts = [];
  if (body.length > 0) parts.push(body.slice(0, 3));
  if (body.length > 3) parts.push(body.slice(3, 6));

  let suffix = '';
  if (body.length > 6) {
    suffix = body.slice(6, 8);
  }
  if (body.length > 8) {
    suffix += `-${body.slice(8, 10)}`;
  }

  const left = hasCountryPrefix ? '+7' : '+7';
  const middle = parts.filter(Boolean).join(' ');
  return [left, middle, suffix].filter(Boolean).join(' ').trim();
}

export function normalizeTonWallet(value) {
  return String(value || '').replace(/\s+/g, '').trim();
}

export function isValidTonWallet(value) {
  const wallet = normalizeTonWallet(value);
  if (!wallet) return true;
  return /^[A-Za-z0-9_-]{48,}$/.test(wallet);
}

export function isValidSbpPhone(value) {
  if (!String(value || '').trim()) return true;
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8'))) return true;
  if (digits.length === 10) return true;
  return digits.length >= 11 && String(value || '').trim().startsWith('+');
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
