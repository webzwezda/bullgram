// --- «Журнал публикаций» (read-only наблюдение за планом агента) ---
// Behavior-preserving разрезка AutopostManagePage (2026-11-07): помощники
// журнала переехали сюда дословно; JournalPanel импортирует то, что нужно
// его JSX, страница — ничего (весь журнальный стейт живёт в JournalPanel).
const JOURNAL_PLANNED_STATUSES = ['queued', 'scheduled'];
const JOURNAL_MEDIA_TYPES = ['photo', 'video', 'animation', 'document'];
export const JOURNAL_MEDIA_EMOJI = { photo: '🖼', video: '🎬', animation: '✨', document: '📄' };
export const JOURNAL_CHECKLIST_BADGES = {
  active: { label: 'активен', className: 'bg-feedback-success-bg text-feedback-success-text' },
  expired: { label: 'истёк', className: 'bg-feedback-warning-bg text-feedback-warning-text' },
  cancelled: { label: 'отменён', className: 'bg-feedback-error-bg text-feedback-error-text' }
};
export const JOURNAL_TABS = [
  { key: 'media', label: '🖼 Медиа' },
  { key: 'checklists', label: '☑️ Чекбоксы' },
  { key: 'text', label: '📝 Текст' }
];

function formatJournalTime(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const hhmm = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const ddmm = d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
  return `${hhmm}, ${ddmm}`;
}

// «⏰ 09:00, 21.09» либо «в очереди — ближайший слот» (scheduled_at не назначен).
export function journalTimeLabel(iso) {
  const t = formatJournalTime(iso);
  return t ? `⏰ ${t}` : 'в очереди — ближайший слот';
}

export function journalSnippet(text, max = 80) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// «в очереди» (без scheduled_at) идут первыми — это ближайшие к публикации,
// дальше по возрастанию назначенного времени.
function sortJournalRows(rows) {
  return [...rows].sort((a, b) => {
    const at = a.scheduled_at ? new Date(a.scheduled_at).getTime() : null;
    const bt = b.scheduled_at ? new Date(b.scheduled_at).getTime() : null;
    if (at === null && bt === null) return 0;
    if (at === null) return -1;
    if (bt === null) return 1;
    return at - bt;
  });
}

// target_channel_id — это tg_chat_id канала; конфиги каналов keyed по UUID,
// поэтому ищем по подготовленному индексу tg_chat_id → конфиг (O(1) вместо
// find по всем конфигам на каждую строку). Индекс хранит первый конфиг с таким
// chat id — тот же результат, что давал .find по Object.values(configs).
function findJournalChannel(channelByChatId, targetChannelId) {
  return channelByChatId.get(String(targetChannelId ?? '')) || null;
}

function journalRowsByType(plannedItems, types, channelByChatId) {
  return sortJournalRows(plannedItems.filter((it) => types.includes(it.media_type)))
    .map((item) => ({ item, channel: findJournalChannel(channelByChatId, item.target_channel_id) }));
}

// Одна строка на канал: «Запланировано N · при ~M/день хватит на K дн.»
function journalMediaSummaryLines(rows) {
  const byChannel = new Map();
  for (const row of rows) {
    const key = String(row.item.target_channel_id ?? '');
    const entry = byChannel.get(key) || { count: 0, channel: row.channel };
    entry.count += 1;
    byChannel.set(key, entry);
  }
  return [...byChannel.values()].map(({ count, channel }) => {
    const perDay = parseInt(channel?.postsPerDay, 10) || 0;
    if (perDay > 0) {
      return `Запланировано ${count} · при ~${perDay}/день хватит на ${Math.ceil(count / perDay)} дн.`;
    }
    return `Запланировано ${count}`;
  });
}

// Вся производка журнала — одним чистым проходом (планы, провалы, строки по
// табам, счётчики, сводки). Тело дословно перенесено из useMemo страницы;
// useMemo-обёртка с теми же deps живёт в JournalPanel.
export function computeJournalData({ journalItems, journalChecklists, journalChannelByChatId, journalTab, failedJournalCutoffMs }) {
    // planned = queued|scheduled (клиентский фильтр по полному списку),
    // failed — вне табов, только строка-предупреждение. Провалы старше 30 дней
    // не считаем: протухший контент всё равно не переиздаётся, а баннер висит годами.
    const planned = journalItems.filter((it) => JOURNAL_PLANNED_STATUSES.includes(it.status));
    const failed = journalItems.filter((it) => (
      it.status === 'failed' && new Date(it.created_at).getTime() > failedJournalCutoffMs
    ));
    const latestFailed = failed.reduce((acc, it) => (
      !acc || new Date(it.created_at) > new Date(acc.created_at) ? it : acc
    ), null);
    const mediaRows = journalRowsByType(planned, JOURNAL_MEDIA_TYPES, journalChannelByChatId);
    const checklistRows = journalRowsByType(planned, ['checklist'], journalChannelByChatId);
    const textRows = journalRowsByType(planned, ['text'], journalChannelByChatId);
    const tabRows = { media: mediaRows, checklists: checklistRows, text: textRows };
    return {
      plannedJournalItems: planned,
      failedJournalCount: failed.length,
      latestFailedJournal: latestFailed,
      mediaJournalRows: mediaRows,
      checklistJournalRows: checklistRows,
      textJournalRows: textRows,
      journalTabCounts: { media: mediaRows.length, checklists: checklistRows.length, text: textRows.length },
      activeJournalRows: tabRows[journalTab] || [],
      mediaJournalSummary: journalMediaSummaryLines(mediaRows),
      journalChecklistById: new Map(journalChecklists.map((cl) => [String(cl.id), cl]))
    };
}
