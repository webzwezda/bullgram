import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { apiRequest } from '../../api/client.js';
import { useSalesContourActions } from './useSalesContourActions.js';
import {
  asArray,
  buildDraft,
  getContourConfig,
  getContourPayloadEntry,
  normalizeContourTarget,
  resolveChannelOptions,
  resolveRightsByTarget,
  resolveUserbotOptions,
  toId,
} from './useSalesContourOptions.js';

// Композитор контроллера контура продаж: стейт черновиков и прав, резолв опций,
// автосборка черновика и сохранение контура. Сайд-эффект-кластер (проверка прав,
// join-all, ротация юзерботов, «Выдать максимум прав») — в useSalesContourActions.js,
// чистые хелперы — в useSalesContourOptions.js. Возвращаемый API не меняется.
export function useSalesContourController({
  accessToken,
  accounts,
  proxies,
  reservedUserbotIds,
  channelsByBotId,
  officialBotContoursPayload,
  officialBotContoursError,
  reloadAccounts,
  selectedOfficialBot,
  showUiMessage,
  state,
  setState,
}) {
  const [draftsByBotId, setDraftsByBotId] = useState({});
  const [dirtyBotIds, setDirtyBotIds] = useState({});
  const [botRightsTarget, setBotRightsTarget] = useState('paid_channel');
  const [botRightsByKey, setBotRightsByKey] = useState({});
  const [checkingRightsKey, setCheckingRightsKey] = useState('');

  const selectedBotId = toId(selectedOfficialBot?.id);

  const fallbackChannels = useMemo(() => {
    if (!selectedBotId) return [];
    return asArray(channelsByBotId?.[selectedBotId]);
  }, [channelsByBotId, selectedBotId]);

  const fallbackUserbots = useMemo(() => {
    const reservedIds = new Set((reservedUserbotIds || []).map(toId));
    return (accounts || []).filter((account) => {
      if (account.account_type !== 'userbot') return false;
      if (reservedIds.has(toId(account.id))) return false;
      return true;
    });
  }, [accounts, reservedUserbotIds]);

  const contourEntry = useMemo(() => {
    return getContourPayloadEntry(officialBotContoursPayload, selectedBotId);
  }, [officialBotContoursPayload, selectedBotId]);

  const rawChannelOptions = useMemo(() => {
    return resolveChannelOptions({
      entry: contourEntry,
      fallbackChannels,
      targetKind: 'channel'
    });
  }, [contourEntry, fallbackChannels]);

  const rawChatOptions = useMemo(() => {
    return resolveChannelOptions({
      entry: contourEntry,
      fallbackChannels,
      targetKind: 'chat'
    });
  }, [contourEntry, fallbackChannels]);

  const userbotOptions = useMemo(() => {
    return resolveUserbotOptions({
      entry: contourEntry,
      fallbackUserbots,
      payload: officialBotContoursPayload
    });
  }, [contourEntry, fallbackUserbots, officialBotContoursPayload]);

  const cachedRightsByTarget = useMemo(() => resolveRightsByTarget(contourEntry), [contourEntry]);

  const draft = draftsByBotId[selectedBotId] || {
    publicChannelId: '',
    paidChannelId: '',
    publicChatId: '',
    paidChatId: '',
    userbotMode: 'none',
    selectedUserbotId: '',
    selectedUserbotIds: []
  };

  const publicChannelOptions = useMemo(() => {
    return rawChannelOptions.filter((option) =>
      toId(option.id) !== toId(draft.paidChannelId) &&
      option.visibility !== 'private'
    );
  }, [draft.paidChannelId, rawChannelOptions]);

  const paidChannelOptions = useMemo(() => {
    return rawChannelOptions.filter((option) =>
      toId(option.id) !== toId(draft.publicChannelId) &&
      option.visibility !== 'public'
    );
  }, [draft.publicChannelId, rawChannelOptions]);

  const publicChatOptions = useMemo(() => {
    return rawChatOptions.filter((option) =>
      toId(option.id) !== toId(draft.paidChatId) &&
      option.visibility !== 'private'
    );
  }, [draft.paidChatId, rawChatOptions]);

  const paidChatOptions = useMemo(() => {
    return rawChatOptions.filter((option) =>
      toId(option.id) !== toId(draft.publicChatId) &&
      option.visibility !== 'public'
    );
  }, [draft.publicChatId, rawChatOptions]);

  const normalizedRightsTarget = normalizeContourTarget(botRightsTarget);
  const targetFieldByKey = {
    public_channel: 'publicChannelId',
    public_chat: 'publicChatId',
    paid_channel: 'paidChannelId',
    paid_chat: 'paidChatId'
  };
  const botRightsByTarget = Object.keys(targetFieldByKey).reduce((acc, target) => {
    const selectedChannelId = toId(draft[targetFieldByKey[target]]);
    const localRights = botRightsByKey[`${selectedBotId}:${target}`] || null;
    const cachedRights = cachedRightsByTarget[target] || null;
    const candidate = localRights || cachedRights;
    acc[target] = candidate && selectedChannelId && toId(candidate.channelId) === selectedChannelId
      ? candidate
      : null;
    return acc;
  }, {});
  const checkingBotRightsTarget = checkingRightsKey.startsWith(`${selectedBotId}:`)
    ? checkingRightsKey.slice(`${selectedBotId}:`.length)
    : '';

  const {
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
  } = useSalesContourActions({
    accessToken,
    selectedOfficialBot,
    selectedBotId,
    draft,
    dirtyBotIds,
    setBotRightsByKey,
    reloadAccounts,
    showUiMessage,
    contourEntry,
  });

  useEffect(() => {
    if (!selectedBotId || dirtyBotIds[selectedBotId]) return;

    const nextDraft = buildDraft({
      entry: contourEntry,
      publicChannelOptions,
      paidChannelOptions,
      publicChatOptions,
      paidChatOptions,
      userbotOptions
    });

    setDraftsByBotId((prev) => {
      const current = prev[selectedBotId];
      if (JSON.stringify(current) === JSON.stringify(nextDraft)) {
        return prev;
      }

      return {
        ...prev,
        [selectedBotId]: nextDraft
      };
    });

    // Если buildDraft авто-выбрал значение, которого ещё нет в контуре на бэке — сохраняем.
    const contour = getContourConfig(contourEntry);
    const contourValuesByField = {
      publicChannelId: contour?.public_channel_id || contourEntry?.public_channel_id,
      paidChannelId: contour?.paid_channel_id || contourEntry?.paid_channel_id,
      publicChatId: contour?.public_chat_id || contourEntry?.public_chat_id,
      paidChatId: contour?.paid_chat_id || contourEntry?.paid_chat_id
    };
    const hasAutoPick = Object.entries(contourValuesByField).some(
      ([field, contourValue]) => nextDraft[field] && toId(nextDraft[field]) !== toId(contourValue)
    );

    if (hasAutoPick && !state?.savingContourBotId) {
      saveContour(nextDraft, { auto: true }).catch((error) => {
        console.error('[salesContour] auto-save failed:', error?.message || error);
      });
    }
  }, [contourEntry, dirtyBotIds, publicChannelOptions, paidChannelOptions, publicChatOptions, paidChatOptions, selectedBotId, userbotOptions, state?.savingContourBotId]);

  useEffect(() => {
    const targetFieldByKey = {
      public_channel: 'publicChannelId',
      public_chat: 'publicChatId',
      paid_channel: 'paidChannelId',
      paid_chat: 'paidChatId'
    };
    if (draft[targetFieldByKey[normalizedRightsTarget]]) return;
    setBotRightsTarget('paid_channel');
  }, [draft, normalizedRightsTarget]);

  function getNextDraft(patch) {
    return {
      ...(draftsByBotId[selectedBotId] || draft),
      ...patch
    };
  }

  function clearRightsForFields(fields = []) {
    const targetByField = {
      publicChannelId: 'public_channel',
      publicChatId: 'public_chat',
      paidChannelId: 'paid_channel',
      paidChatId: 'paid_chat'
    };
    const targets = fields.map((field) => targetByField[field]).filter(Boolean);
    if (!targets.length) return;

    setBotRightsByKey((prev) => {
      const next = { ...prev };
      targets.forEach((target) => {
        delete next[`${selectedBotId}:${target}`];
      });
      return next;
    });
  }

  function updateDraft(patch) {
    if (!selectedBotId) return;
    const nextDraft = getNextDraft(patch);

    setDraftsByBotId((prev) => ({
      ...prev,
      [selectedBotId]: nextDraft
    }));

    setDirtyBotIds((prev) => ({
      ...prev,
      [selectedBotId]: true
    }));

    return nextDraft;
  }

  async function saveContour(contourDraft = draft, options = {}) {
    if (!selectedOfficialBot?.id) return;

    if (contourDraft.userbotMode === 'single' && !contourDraft.selectedUserbotId) {
      return;
    }

    const selectedTargets = [
      contourDraft.publicChannelId,
      contourDraft.publicChatId,
      contourDraft.paidChannelId,
      contourDraft.paidChatId
    ].filter(Boolean);
    if (new Set(selectedTargets).size !== selectedTargets.length) {
      return;
    }

    if (contourDraft.userbotMode === 'pool' && !(contourDraft.selectedUserbotIds || []).length) {
      return;
    }

    setState((prev) => ({
      ...prev,
      savingContourBotId: selectedBotId
    }));

    try {
      await apiRequest('/api/official-bot/contours', {
        accessToken,
        method: 'POST',
        body: {
          bot_id: selectedOfficialBot.id,
          public_channel_id: contourDraft.publicChannelId || null,
          paid_channel_id: contourDraft.paidChannelId || null,
          public_chat_id: contourDraft.publicChatId || null,
          paid_chat_id: contourDraft.paidChatId || null,
          userbot_mode: contourDraft.userbotMode,
          selected_userbot_id: contourDraft.userbotMode === 'single' ? contourDraft.selectedUserbotId : null,
          selected_userbot_ids: contourDraft.userbotMode === 'pool' ? (contourDraft.selectedUserbotIds || []) : []
        }
      });

      setDirtyBotIds((prev) => ({
        ...prev,
        [selectedBotId]: false
      }));
      await reloadAccounts();
      showUiMessage('Контур продаж сохранён.', 'success');
    } catch (error) {
      showUiMessage(error.message, 'error');
      throw error;
    } finally {
      setState((prev) => ({
        ...prev,
        savingContourBotId: ''
      }));
    }
  }

  async function checkBotRights(target = botRightsTarget) {
    if (!selectedOfficialBot?.id) return;

    const normalizedTarget = normalizeContourTarget(target);
    if (dirtyBotIds[selectedBotId]) {
      toast.warning('Сначала сохрани изменения контура');
      return;
    }
    const key = `${selectedBotId}:${normalizedTarget}`;
    setCheckingRightsKey(normalizedTarget);

    const { ok, error, skipped } = await verifyBotRightsSilent(normalizedTarget);
    setCheckingRightsKey('');
    if (skipped) return;
    if (ok) {
      showUiMessage('Права бота проверены.', 'success');
    } else {
      showUiMessage(error?.message || 'Не удалось проверить права', 'error');
    }
  }

  return {
    botRightsByTarget,
    checkBotRights,
    checkingBotRightsTarget,
    contourError: officialBotContoursError,
    contourInfoPending,
    draft,
    ensureAdminPending,
    ensureAdminRights,
    isVisible: !!selectedBotId,
    joinAllPending,
    paidChannelOptions,
    publicChatOptions,
    paidChatOptions,
    publicChannelOptions,
    refreshContourInfo,
    savingContour: String(state?.savingContourBotId || '') === selectedBotId,
    async setFieldValue(fieldOrPatch, value, options = {}) {
      const patch = typeof fieldOrPatch === 'object' && fieldOrPatch !== null
        ? { ...fieldOrPatch }
        : { [fieldOrPatch]: value };
      if (options.oppositeField && value && String(draft[options.oppositeField] || '') === String(value)) {
        patch[options.oppositeField] = '';
      }
      const nextDraft = updateDraft(patch);
      clearRightsForFields(Object.keys(patch));
      if (options.autoSave && nextDraft) {
        return await saveContour(nextDraft, { auto: true });
      }
    },
    userbotOptions,
    userbotActiveMap,
    toggleUserbotActive,
    togglingUserbotId,
    triggerJoinAll
  };
}
