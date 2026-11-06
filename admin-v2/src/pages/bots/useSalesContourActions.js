import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { apiRequest } from '../../api/client.js';
import { ensureContourAdminRights, fetchContourJoinAllStatus, startContourJoinAll } from '../../api/official-bot.js';
import { createEmptyRightsResult, normalizeRightsResult } from './useSalesContourOptions.js';

const JOIN_ALL_CONFIRM_TEXT = 'Юзербот вступит в площадки контура и получит в них права админа. Telegram может не дать вступить без приглашения — тогда площадка не подключится, и её нужно будет добавить вручную. Это занимает до минуты. Продолжить?';
const JOIN_ALL_POLL_INTERVAL_MS = 3000;
const JOIN_ALL_POLL_TIMEOUT_MS = 10 * 60 * 1000;
const JOIN_ALL_STALLED_TEXT = 'Вступление зависло, попробуй ещё раз';
const JOIN_ALL_ERROR_TEXT = 'Ошибка вступления в группы';
const ENSURE_ADMIN_ERROR_TEXT = 'Не удалось выдать права';

// Кластер сайд-эффектов контура продаж: тихая проверка прав, «Обновить информацию»,
// тумблер ротации юзерботов, фоновый join-all с поллингом и «Выдать максимум прав».
// Чистые вычисления и черновики живут в useSalesContourController.js.
export function useSalesContourActions({
  accessToken,
  selectedOfficialBot,
  selectedBotId,
  draft,
  dirtyBotIds,
  setBotRightsByKey,
  reloadAccounts,
  showUiMessage,
  contourEntry,
}) {
  const [userbotActiveMap, setUserbotActiveMap] = useState({});
  const [togglingUserbotId, setTogglingUserbotId] = useState('');
  const [joinAllPending, setJoinAllPending] = useState(false);
  const joinAllInFlightRef = useRef(false);
  const joinAllPollTimerRef = useRef(null);
  const joinAllPollCancelledRef = useRef(false);

  // «Выдать максимум прав»: держим pending-стейт для спиннера; результат — только тостом.
  const [ensureAdminPending, setEnsureAdminPending] = useState(false);
  const ensureAdminInFlightRef = useRef(false);

  const [contourInfoPending, setContourInfoPending] = useState(false);

  // При unmount во время фонового join-all гасим таймер поллинга; pending-стейт умрёт вместе с компонентом.
  useEffect(() => () => stopJoinAllPolling(), []);

  useEffect(() => {
    const rawBindings = contourEntry?.userbot_bindings || [];
    const map = {};
    for (const b of rawBindings) {
      map[String(b.userbot_id)] = b.is_active;
    }
    setUserbotActiveMap(map);
  }, [contourEntry]);

  // Тихая проверка прав одного слота (без тостов): { ok: true } или { ok: false, error }.
  async function verifyBotRightsSilent(normalizedTarget) {
    const targetFieldByKey = {
      public_channel: 'publicChannelId',
      public_chat: 'publicChatId',
      paid_channel: 'paidChannelId',
      paid_chat: 'paidChatId'
    };
    if (!draft[targetFieldByKey[normalizedTarget]]) {
      return { ok: true, skipped: true };
    }

    const key = `${selectedBotId}:${normalizedTarget}`;
    try {
      const result = await apiRequest('/api/official-bot/contours/check-rights', {
        accessToken,
        method: 'POST',
        body: {
          bot_id: selectedOfficialBot.id,
          target: normalizedTarget
        }
      });

      setBotRightsByKey((prev) => ({
        ...prev,
        [key]: normalizeRightsResult(result, normalizedTarget)
      }));
      return { ok: true };
    } catch (error) {
      setBotRightsByKey((prev) => ({
        ...prev,
        [key]: {
          ...createEmptyRightsResult(normalizedTarget),
          status: 'error',
          message: error.message
        }
      }));
      return { ok: false, error };
    }
  }

  async function toggleUserbotActive(userbotId, isActive) {
    if (!selectedOfficialBot?.id || togglingUserbotId) return;
    setTogglingUserbotId(String(userbotId));
    setUserbotActiveMap((prev) => ({ ...prev, [String(userbotId)]: isActive }));
    try {
      await apiRequest('/api/official-bot/contours/userbot-active', {
        accessToken,
        method: 'PATCH',
        body: {
          bot_id: selectedOfficialBot.id,
          userbot_id: userbotId,
          is_active: isActive
        }
      });
      if (isActive) {
        const joinStarted = triggerJoinAll();
        if (!joinStarted) {
          // Тумблер включён, но подтверждение отклонено или join-all уже занят —
          // без подсказки выглядит, будто вступление уже пошло.
          toast.info('Вступление в площадки не запущено — перещёлкни тумблер «Участвует в ротации» ещё раз и подтверди.');
        }
      }
      showUiMessage(isActive ? 'Юзербот включён в ротацию.' : 'Юзербот приостановлен.', 'success');
    } catch (err) {
      console.error('[toggleUserbotActive] PATCH failed:', err?.message);
      setUserbotActiveMap((prev) => ({ ...prev, [String(userbotId)]: !isActive }));
      showUiMessage(err?.message || 'Не удалось переключить юзербота.', 'error');
    } finally {
      setTogglingUserbotId('');
    }
  }

  function stopJoinAllPolling() {
    // Cancelled-ref глушит и висящий в await fetch tick: без него unmount во время
    // запроса планировал бы новый таймер уже после очистки, и поллинг жил до дедлайна.
    joinAllPollCancelledRef.current = true;
    if (joinAllPollTimerRef.current) {
      clearTimeout(joinAllPollTimerRef.current);
      joinAllPollTimerRef.current = null;
    }
  }

  function resetJoinAllState() {
    joinAllInFlightRef.current = false;
    setJoinAllPending(false);
  }

  // Поллинг статуса фонового join-all: рекурсивный setTimeout, предохранитель по дедлайну.
  // Одиночные сетевые сбои статуса не роняют процесс — ждём до дедлайна.
  function pollJoinAllStatus(botId, deadline) {
    joinAllPollCancelledRef.current = false;
    const tick = async () => {
      try {
        const data = await fetchContourJoinAllStatus(accessToken, botId);
        if (joinAllPollCancelledRef.current) return;
        const status = String(data?.status || '').trim();

        if (status === 'done') {
          stopJoinAllPolling();
          toast.success(data?.result?.summary || 'Готово');
          reloadAccounts();
          resetJoinAllState();
          return;
        }

        if (status === 'error') {
          stopJoinAllPolling();
          toast.error(data?.result?.message || JOIN_ALL_ERROR_TEXT);
          resetJoinAllState();
          return;
        }
      } catch (err) {
        console.error('join-all status poll failed:', err?.message);
        if (joinAllPollCancelledRef.current) return;
      }

      if (Date.now() >= deadline) {
        stopJoinAllPolling();
        toast.error(JOIN_ALL_STALLED_TEXT);
        resetJoinAllState();
        return;
      }

      joinAllPollTimerRef.current = setTimeout(tick, JOIN_ALL_POLL_INTERVAL_MS);
    };

    tick();
  }

  // Возвращает true, если join-all реально запущен (или уже идёт и мы следим),
  // false — если отклонили подтверждение или сработал in-flight guard.
  function triggerJoinAll() {
    const botId = selectedOfficialBot?.id;
    // In-flight guard: join-all исполняется в фоне, повторные клики и параллельный поллинг стакать нельзя.
    if (!botId || joinAllInFlightRef.current) return false;
    if (!window.confirm(JOIN_ALL_CONFIRM_TEXT)) return false;

    joinAllInFlightRef.current = true;
    setJoinAllPending(true);

    startContourJoinAll(accessToken, botId)
      .then(() => {
        pollJoinAllStatus(botId, Date.now() + JOIN_ALL_POLL_TIMEOUT_MS);
      })
      .catch((err) => {
        // 409 join_all_already_running — не ошибка: задача уже идёт (наш прошлый или чужой запуск), следим за ней.
        const alreadyRunning = err?.code === 'join_all_already_running';

        if (alreadyRunning) {
          toast.info('Вступление уже идёт, следим за статусом');
          pollJoinAllStatus(botId, Date.now() + JOIN_ALL_POLL_TIMEOUT_MS);
          return;
        }

        console.error('join-all failed:', err?.message);
        toast.error(err?.message || JOIN_ALL_ERROR_TEXT);
        resetJoinAllState();
      });
    return true;
  }

  // «Выдать права»: синхронно выдаём/подтверждаем права админа актёрам контура на бэке.
  // Запрос может висеть до минуты (серийные вызовы Telegram) — просто крутим спиннер, поллинг не нужен.
  async function ensureAdminRights() {
    const botId = selectedOfficialBot?.id;
    if (!botId || ensureAdminInFlightRef.current) return;
    if (dirtyBotIds[selectedBotId]) {
      toast.warning('Сначала сохрани изменения контура');
      return;
    }

    ensureAdminInFlightRef.current = true;
    setEnsureAdminPending(true);

    try {
      const data = await ensureContourAdminRights(accessToken, botId);
      const summary = String(data?.summary || '').trim();
      toast.success(summary || 'Права выданы');
    } catch (err) {
      console.error('ensure-admin failed:', err?.message);
      toast.error(err?.message || ENSURE_ADMIN_ERROR_TEXT);
    } finally {
      ensureAdminInFlightRef.current = false;
      setEnsureAdminPending(false);
    }
  }

  // «Обновить информацию»: по каждой площадке сохранённого контура — refresh из
  // Telegram (title/username/visibility + авто-перенос слота) и тихая проверка прав
  // бота. Итог — одним тостом, без спама по каждой площадке.
  async function refreshContourInfo() {
    const botId = selectedOfficialBot?.id;
    if (!botId || contourInfoPending) return;
    if (dirtyBotIds[selectedBotId]) {
      toast.warning('Сначала сохрани изменения контура');
      return;
    }

    const slotFields = {
      public_channel: 'publicChannelId',
      public_chat: 'publicChatId',
      paid_channel: 'paidChannelId',
      paid_chat: 'paidChatId'
    };
    const slotLabels = {
      public_channel: 'открытый канал',
      public_chat: 'открытый чат',
      paid_channel: 'закрытый канал',
      paid_chat: 'закрытый чат'
    };
    const slots = Object.entries(slotFields)
      .map(([target, field]) => ({ target, channelId: draft[field] || null }))
      .filter((slot) => slot.channelId);
    if (!slots.length) {
      toast.warning('В контуре нет привязанных площадок');
      return;
    }

    setContourInfoPending(true);
    const failed = [];
    const moved = [];
    try {
      for (const slot of slots) {
        try {
          const data = await apiRequest(`/api/official-bot/channels/${slot.channelId}/refresh`, {
            accessToken,
            method: 'POST'
          });
          const change = data?.contourChange;
          if (change?.from && change?.to) {
            moved.push(`${slotLabels[change.from] || change.from} → ${slotLabels[change.to] || change.to}`);
          }
        } catch (error) {
          failed.push(slotLabels[slot.target]);
          continue;
        }
        const { ok } = await verifyBotRightsSilent(slot.target);
        if (!ok) failed.push(`${slotLabels[slot.target]} (права)`);
      }
      await reloadAccounts();

      if (failed.length === 0) {
        toast.success(`Обновлено площадок: ${slots.length}${moved.length ? `. Переносы: ${moved.join('; ')}` : ''}`);
      } else {
        toast.error(`Не обновилось: ${failed.join(', ')}`);
      }
    } finally {
      setContourInfoPending(false);
    }
  }

  return {
    verifyBotRightsSilent,
    contourInfoPending,
    refreshContourInfo,
    userbotActiveMap,
    togglingUserbotId,
    toggleUserbotActive,
    joinAllPending,
    triggerJoinAll,
    ensureAdminPending,
    ensureAdminRights,
  };
}
