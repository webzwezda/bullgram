// «Журнал публикаций» — секция AutopostManagePage (behavior-preserving
// разрезка 2026-11-07). Владеет всем журнальным стейтом и загрузкой:
// reqId-ref уезжает вместе с loadJournal, не отрываясь от него.
// Realtime-страница пробрасывает события autopost_items через journalApiRef
// ({ scheduleRefetch, clearDebounce }) — supabase-канал остаётся один.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Loader2, RefreshCw, ScrollText, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../../components/ui/button.jsx';
import { clearFailedItems, fetchChecklists, fetchItems } from '../api.js';
import {
  computeJournalData,
  JOURNAL_CHECKLIST_BADGES,
  JOURNAL_MEDIA_EMOJI,
  JOURNAL_TABS,
  journalSnippet,
  journalTimeLabel
} from '../utils/journal.js';

export default function JournalPanel({ botId, accessToken, channelConfigs, createdBot, journalApiRef, askConfirm }) {
  // «Журнал публикаций» — только наблюдение за запланированным контентом.
  // Управление (создание/правка/отмена) сознательно не здесь: план ведёт агент.
  const [journalItems, setJournalItems] = useState([]);
  const [clearingFailed, setClearingFailed] = useState(false);
  const [journalChecklists, setJournalChecklists] = useState([]);
  const [journalLoading, setJournalLoading] = useState(false);
  const [journalError, setJournalError] = useState(null);
  const [journalTab, setJournalTab] = useState('media');
  const loadJournalReqIdRef = useRef(0);
  const journalDebounceRef = useRef(null);
  const journalLoadedAtRef = useRef(0);

  // Загрузка журнала при выборе бота и при смене токена — паритет с эффектом
  // выбора бота на странице (там deps [selectedBotId, accessToken]; здесь
  // botId = createdBot?.id). Сброс на «нового» дополнительно размонтирует
  // панель условием рендера — ветка reset оставлена как защита.
  useEffect(() => {
    if (!botId) {
      setJournalItems([]);
      setJournalChecklists([]);
      setJournalError(null);
      journalLoadedAtRef.current = 0;
      return;
    }
    loadJournal(botId);
  }, [botId, accessToken]);

  // Журнал публикаций: items (все, planned фильтруем на клиенте) + чек-листы
  // (одна страница) одним параллельным заходом. Read-only.
  async function loadJournal(botId) {
    if (!botId || !accessToken) return;
    const reqId = ++loadJournalReqIdRef.current;
    setJournalLoading(true);
    setJournalError(null);
    try {
      const [itemsData, listsData] = await Promise.all([
        fetchItems(botId, accessToken),
        fetchChecklists(botId, accessToken)
      ]);
      if (reqId !== loadJournalReqIdRef.current) return;
      setJournalItems(Array.isArray(itemsData?.items) ? itemsData.items : []);
      setJournalChecklists(Array.isArray(listsData?.items) ? listsData.items : []);
      journalLoadedAtRef.current = Date.now();
    } catch (e) {
      if (reqId !== loadJournalReqIdRef.current) return;
      setJournalError(e.message || 'Не удалось загрузить журнал публикаций');
    } finally {
      if (reqId === loadJournalReqIdRef.current) setJournalLoading(false);
    }
  }

  // Realtime-серия событий не должна бить по API каждым item — debounce 800 мс.
  function scheduleJournalRefetch(botId) {
    if (journalDebounceRef.current) clearTimeout(journalDebounceRef.current);
    journalDebounceRef.current = setTimeout(() => {
      journalDebounceRef.current = null;
      loadJournal(botId);
    }, 800);
  }

  // Раскрыли секцию, а данные старше минуты (или ещё не приходили) — тихо освежаем.
  function handleJournalToggle(e) {
    if (!e.target.open) return;
    const botId = createdBot?.id;
    if (!botId) return;
    const last = journalLoadedAtRef.current;
    if (!last || Date.now() - last > 60000) {
      loadJournal(botId);
    }
  }

  // Сброс отложенного refetch: cleanup realtime-эффекта страницы при смене
  // бота/токена и размонтирование панели (дословно из того cleanup).
  function clearJournalDebounce() {
    if (journalDebounceRef.current) {
      clearTimeout(journalDebounceRef.current);
      journalDebounceRef.current = null;
    }
  }

  // Мост к realtime-эффекту страницы: держим ref свежим на каждый рендер
  // (замыкания должны видеть актуальные accessToken/refs).
  useEffect(() => {
    journalApiRef.current = { scheduleRefetch: scheduleJournalRefetch, clearDebounce: clearJournalDebounce };
  });
  useEffect(() => {
    return () => {
      clearJournalDebounce();
      journalApiRef.current = null;
    };
  }, []);

  // Журнал: индекс tg_chat_id → конфиг канала. Пересобирается только при смене
  // конфигов, а не на каждый рендер (каждый символ в поле токена, realtime-refetch).
  const journalChannelByChatId = useMemo(() => {
    const byChatId = new Map();
    for (const cfg of Object.values(channelConfigs)) {
      const key = String(cfg.tgChatId);
      if (!byChatId.has(key)) byChatId.set(key, cfg);
    }
    return byChatId;
  }, [channelConfigs]);

  // Отсечка 30-дневного окна провалов, квантованная до часа: в deps memo она
  // меняется максимум раз в час, поэтому окно живое (дрейф ≤ 1 ч на 30 дней),
  // а memo не пересчитывается на каждом рендере.
  const failedJournalCutoffMs = Math.floor(Date.now() / (60 * 60 * 1000)) * (60 * 60 * 1000) - 30 * 24 * 60 * 60 * 1000;

  // Журнал: вся производка (планы, провалы, строки по табам, счётчики, сводки)
  // пересчитывается только при изменении входов. Хуки стоят ДО раннего return
  // по loading — порядок хуков не должен зависеть от состояния загрузки.
  const {
    plannedJournalItems,
    failedJournalCount,
    latestFailedJournal,
    mediaJournalRows,
    checklistJournalRows,
    textJournalRows,
    journalTabCounts,
    activeJournalRows,
    mediaJournalSummary,
    journalChecklistById
  } = useMemo(() => computeJournalData({
    journalItems,
    journalChecklists,
    journalChannelByChatId,
    journalTab,
    failedJournalCutoffMs
  }), [journalItems, journalChecklists, journalChannelByChatId, journalTab, failedJournalCutoffMs]);

  // Очистить журнал от провалившихся публикаций (записи Bullgram, посты в Telegram не трогаем)
  async function doClearFailedItems() {
    if (!createdBot?.id) return;
    setClearingFailed(true);
    try {
      const res = await clearFailedItems(createdBot.id, accessToken);
      setJournalItems(prev => prev.filter(it => it.status !== 'failed'));
      toast.success(res?.deleted ? `Журнал очищен: удалено записей — ${res.deleted}` : 'Провалившихся публикаций нет');
    } catch (e) {
      toast.error(e.message || 'Не удалось очистить журнал');
    } finally {
      setClearingFailed(false);
    }
  }

  function askClearFailedItems() {
    if (!failedJournalCount) return;
    askConfirm({
      title: 'Очистить провалы в журнале?',
      description: `Будет удалено записей: ${failedJournalCount}. Это только журнал Bullgram — опубликованные посты и очередь в Telegram не затрагиваются.`,
      actionLabel: 'Очистить',
      onConfirm: () => doClearFailedItems()
    });
  }

  return (
    <>
          {/* Журнал публикаций — только наблюдение: что агент уже поставил
              в очередь и на расписание. Кнопок управления здесь нет сознательно:
              планом ведёт агент, ручные правки расписания ему только мешают. */}
          <details
            className="group shadow-sm ring-1 ring-border-default bg-white overflow-hidden rounded-2xl"
            onToggle={handleJournalToggle}
          >
            <summary className="p-5 sm:p-6 cursor-pointer select-none flex items-center gap-3 list-none [&::-webkit-details-marker]:hidden">
              <div className="w-9 h-9 rounded-xl bg-surface-subtle-strong flex items-center justify-center text-ink-muted shrink-0">
                <ScrollText className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-bold text-ink-strong">Журнал публикаций</h3>
                <p className="text-xs text-ink-muted mt-0.5 max-w-[70ch]">
                  Что запланировано и когда выйдет. План ведёт агент — здесь только посмотреть.
                </p>
              </div>
              {plannedJournalItems.length > 0 && (
                <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-surface-subtle-strong text-ink-body border border-border-default shrink-0">
                  Запланировано: {plannedJournalItems.length}
                </span>
              )}
              <ChevronDown className="w-4 h-4 text-ink-faint shrink-0 transition-transform group-open:rotate-180" />
            </summary>
            <div className="px-5 sm:px-6 pb-5 sm:pb-6 pt-4 space-y-4 border-t border-border-default">
              {journalError ? (
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl bg-feedback-error-bg p-4 text-sm font-semibold text-feedback-error-text">
                  <span className="flex-1">Не удалось загрузить журнал: {journalError}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => loadJournal(createdBot.id)}
                    className="h-8 rounded-lg text-xs font-semibold shrink-0"
                  >
                    <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Повторить
                  </Button>
                </div>
              ) : journalLoading && journalItems.length === 0 ? (
                <p className="text-sm text-ink-muted font-semibold">Загрузка…</p>
              ) : (
                <>
                  <div role="tablist" aria-label="Журнал публикаций" className="flex flex-wrap gap-2">
                    {JOURNAL_TABS.map((tab) => (
                      <button
                        key={tab.key}
                        type="button"
                        role="tab"
                        aria-selected={journalTab === tab.key}
                        onClick={() => setJournalTab(tab.key)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                          journalTab === tab.key
                            ? 'bg-action-primary text-action-primary-text border-action-primary'
                            : 'bg-surface-card text-ink-body border-border-default hover:border-border-strong'
                        }`}
                      >
                        {tab.label} · {journalTabCounts[tab.key]}
                      </button>
                    ))}
                  </div>

                  {failedJournalCount > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xs text-feedback-warning-text font-semibold flex-1 min-w-0">
                        ⚠️ Не удалось опубликовать: {failedJournalCount}
                        {latestFailedJournal?.created_at ? ` · последняя ${new Date(latestFailedJournal.created_at).toLocaleDateString('ru-RU')}` : ''}
                        {latestFailedJournal?.error_message
                          ? `: ${String(latestFailedJournal.error_message).replace(/bot\d+:[^/\s]+/g, 'bot***').slice(0, 90)}`
                          : ''} — детали у агента (posts_list) или в Telegram-боте.
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={askClearFailedItems}
                        disabled={clearingFailed}
                        className="h-7 rounded-lg text-xs font-semibold shrink-0"
                      >
                        {clearingFailed ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5 mr-1.5" />}
                        Очистить ({failedJournalCount})
                      </Button>
                    </div>
                  )}

                  {journalTab === 'media' && mediaJournalSummary.length > 0 && (
                    <div className="space-y-1">
                      {mediaJournalSummary.map((line, idx) => (
                        <p key={idx} className="text-xs text-ink-muted font-semibold">{line}</p>
                      ))}
                    </div>
                  )}

                  {activeJournalRows.length === 0 ? (
                    <p className="text-sm text-ink-muted font-semibold">Ничего не запланировано</p>
                  ) : (
                    <div className="space-y-2">
                      {activeJournalRows.map(({ item, channel }) => {
                        if (journalTab === 'checklists') {
                          const cl = journalChecklistById.get(String(item.checklist_id));
                          const badge = JOURNAL_CHECKLIST_BADGES[cl?.status] || null;
                          const title = journalSnippet(cl?.title) || journalSnippet(item.caption) || 'Чек-лист';
                          return (
                            <div key={item.id} className="flex items-start gap-3 p-3.5 rounded-xl border border-border-default bg-surface-subtle/60">
                              <span className="text-base leading-none mt-0.5 shrink-0" aria-hidden="true">☑️</span>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 min-w-0">
                                  <p className="text-sm font-bold text-ink-body truncate">{title}</p>
                                  {badge && (
                                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold shrink-0 ${badge.className}`}>
                                      {badge.label}
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-ink-muted font-semibold mt-0.5 flex flex-wrap items-center gap-x-1.5">
                                  <span>{journalTimeLabel(item.scheduled_at)}</span>
                                  <span aria-hidden="true">·</span>
                                  <span>{channel?.title || `канал ${item.target_channel_id}`}</span>
                                </p>
                              </div>
                            </div>
                          );
                        }
                        const emoji = journalTab === 'media' ? (JOURNAL_MEDIA_EMOJI[item.media_type] || '🖼') : '📝';
                        const primary = journalSnippet(item.caption) || (journalTab === 'media' ? 'Без подписи' : 'Без текста');
                        return (
                          <div key={item.id} className="flex items-start gap-3 p-3.5 rounded-xl border border-border-default bg-surface-subtle/60">
                            <span className="text-base leading-none mt-0.5 shrink-0" aria-hidden="true">{emoji}</span>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-bold text-ink-body truncate">{primary}</p>
                              <p className="text-xs text-ink-muted font-semibold mt-0.5 flex flex-wrap items-center gap-x-1.5">
                                <span>{journalTimeLabel(item.scheduled_at)}</span>
                                <span aria-hidden="true">·</span>
                                <span>{channel?.title || `канал ${item.target_channel_id}`}</span>
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          </details>
    </>
  );
}
