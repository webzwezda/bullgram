import { toast } from 'sonner';

export const ADMIN_PROXY_GROUPS = ['self_use', 'shop_sale'];
export const PROXY_TABLE_PAGE_SIZE = 20;

export const LANE_OPTIONS = [
  { id: 'self-use', label: 'Свои' },
  { id: 'on-sale', label: 'На продаже' },
  { id: 'sold', label: 'Продано' }
];

export function showUiMessage(text, tone = 'default') {
  if (tone === 'success') return toast.success(text);
  if (tone === 'error') return toast.error(text);
  return toast(text);
}

export function proxyBatchTitleFor(count) {
  return `Прокси x${count}`;
}

export function formatWhen(value) {
  if (!value) return 'Ещё не проверялся';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Дата неизвестна';
  return date.toLocaleString('ru-RU');
}

export function countryFlag(countryCode) {
  if (!countryCode || typeof countryCode !== 'string') return '';
  return countryCode
    .trim()
    .toUpperCase()
    .split('')
    .map((char) => String.fromCodePoint(127397 + char.charCodeAt(0)))
    .join('');
}

// Цвет статус-точки по тону бейджа (hex — точки рисуются inline style'ем)
export const STATUS_DOT_HEX = {
  ok: '#34d399',
  warning: '#fbbf24',
  danger: '#f87171',
  default: '#cbd5e1'
};

export function proxyHealthMode(proxy) {
  if (proxy?.status === 'checking') return 'checking';
  // Приоритет — аддитивный флаг бэкенда; подстрока в last_check_error оставлена
  // как фолбэк для старых ответов без is_pending.
  if (proxy?.is_pending === true) return 'warming_up';
  if (proxy?.is_working == null && (proxy?.last_check_error || '').includes('фоновую проверку Telegram')) return 'warming_up';
  if (proxy?.is_working !== true) return proxy?.is_working === false ? 'broken' : 'unchecked';
  if (!proxy?.last_check_ip && !proxy?.last_check_country && !proxy?.last_check_city) {
    return 'telegram_only';
  }
  return 'full';
}

export function proxyBadge(proxy) {
  const mode = proxyHealthMode(proxy);
  if (mode === 'checking') return { text: 'Проверяется', tone: 'warning' };
  if (mode === 'warming_up') return { text: 'Поднимается', tone: 'warning' };
  if (mode === 'telegram_only') return { text: 'Рабочий для Telegram', tone: 'ok' };
  if (mode === 'full') return { text: 'Работает', tone: 'ok' };
  if (mode === 'broken') return { text: 'Ошибка', tone: 'danger' };
  return { text: 'Не проверен', tone: 'neutral' };
}

export function proxyHasLiveUserbot(proxy) {
  return Number(proxy?.userbot_count || 0) > 0;
}

export function buildServerProxyName(existingNames = []) {
  const normalized = new Set(existingNames.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean));
  let index = 1;
  while (normalized.has(`прокси #${index}`)) {
    index += 1;
  }
  return `Прокси #${index}`;
}

export function formatTon(value) {
  return Number(value || 0).toFixed(2);
}

export function inventoryGroupActionLabel(value) {
  if (value === 'self_use') return 'Использую сам';
  return 'На продажу';
}

export function proxyEgressSummary(proxy) {
  if (proxy?.ipv6) return `IPv6 ${proxy.ipv6}`;
  if (proxy?.last_check_ip) return proxy.last_check_ip;
  return 'IP не зафиксирован';
}
