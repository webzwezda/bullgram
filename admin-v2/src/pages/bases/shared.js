export const MEMBER_FILTERS = [
  { id: 'humans', label: 'Люди' },
  { id: 'all', label: 'Все' },
  { id: 'active_paid', label: 'Активно платят' },
  { id: 'expired_paid', label: 'Сгорели' },
  { id: 'unpaid_leads', label: 'Не оплатили' },
  { id: 'free_riders', label: 'Без подписки' },
  { id: 'all_channels', label: 'Есть везде' },
  { id: 'partial_channels', label: 'Есть не везде' },
  { id: 'manual_only', label: 'Вбиты руками' },
  { id: 'synced_only', label: 'Из групп' }
];

export function formatRelativeTime(iso) {
  if (!iso) return '—';
  const ts = new Date(iso).getTime();
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60_000) return 'только что';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} мин назад`;
  const d = new Date(iso);
  if (diff < 24 * 3600_000) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function coverageLabel(member) {
  if (member.coverage_status === 'all_channels') return 'Во всех местах';
  if (member.coverage_status === 'partial_channels') return 'Не во всех местах';
  if (member.coverage_status === 'missing_everywhere') return 'Не найден';
  return '—';
}

export function paymentBadge(payment_status) {
  switch (payment_status) {
    case 'active_paid':
      return { text: 'Активно платит', cls: 'bg-emerald-50 text-emerald-700' };
    case 'expired_paid':
      return { text: 'Платил, сгорел', cls: 'bg-amber-50 text-amber-700' };
    case 'expired_paid_inside':
      return { text: 'Сгорел, сидит внутри', cls: 'bg-rose-50 text-rose-700' };
    case 'free_rider':
      return { text: 'Без подписки', cls: 'bg-rose-50 text-rose-700' };
    case 'unpaid_lead':
      return { text: 'Жал, не оплатил', cls: 'bg-slate-100 text-slate-600' };
    default:
      return { text: 'Нет истории', cls: 'bg-slate-100 text-slate-500' };
  }
}

export function filterAudienceMembers(members, filter, search) {
  const needle = String(search || '').trim().toLowerCase();
  return (members || []).filter((member) => {
    if (filter === 'humans' && member.is_bot) return false;
    if (filter === 'active_paid' && member.payment_status !== 'active_paid') return false;
    if (filter === 'expired_paid' && !['expired_paid', 'expired_paid_inside'].includes(member.payment_status)) return false;
    if (filter === 'unpaid_leads' && member.payment_status !== 'unpaid_lead') return false;
    if (filter === 'free_riders' && !['free_rider', 'expired_paid_inside'].includes(member.payment_status)) return false;
    if (filter === 'all_channels' && member.coverage_status !== 'all_channels') return false;
    if (filter === 'partial_channels' && member.coverage_status !== 'partial_channels') return false;
    if (filter === 'manual_only' && member.source !== 'manual') return false;
    if (filter === 'synced_only' && member.source === 'manual') return false;

    if (!needle) return true;

    return [
      member.display_name || '',
      member.username ? `@${member.username}` : '',
      String(member.tg_user_id || ''),
      member.payment_status || '',
      coverageLabel(member)
    ].join(' ').toLowerCase().includes(needle);
  });
}

export function parseCsvInput(rawText) {
  return String(rawText || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [tg_user_id = '', username = '', display_name = ''] = line.split(',').map((part) => part.trim());
      return { tg_user_id, username, display_name };
    })
    .filter((entry) => entry.tg_user_id);
}

export function generateTempId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `temp_${crypto.randomUUID()}`;
  }
  return `temp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function memberDisplayName(member) {
  return member?.display_name || member?.username || `TG ${member?.tg_user_id}`;
}
