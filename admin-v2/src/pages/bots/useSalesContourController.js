import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../../api/client.js';

function normalizeBotKind(value) {
  return value === 'template' ? 'template' : 'sales';
}

function normalizeUserbotMode(value) {
  return value === 'single' || value === 'pool' ? value : 'none';
}

function toId(value) {
  return String(value || '').trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isChatTarget(target) {
  const chatType = String(target?.chat_type || target?.type || '').toLowerCase();
  return chatType === 'group' || chatType === 'supergroup';
}

function extractFirstArray(source, keys) {
  for (const key of keys) {
    if (Array.isArray(source?.[key])) {
      return source[key];
    }
  }
  return [];
}

function getContourPayloadEntry(payload, botId) {
  const normalizedBotId = toId(botId);
  if (!normalizedBotId || !payload) return null;

  if (payload.byBotId && typeof payload.byBotId === 'object') {
    const direct = payload.byBotId[normalizedBotId];
    if (direct) return direct;
  }

  const candidates = [
    payload?.bots,
    payload?.items,
    payload?.contours,
    payload?.rows,
    payload?.data,
    Array.isArray(payload) ? payload : null
  ];

  const entries = candidates.find(Array.isArray) || [];
  return entries.find((entry) => {
    const entryBotId = toId(
      entry?.bot_id
        || entry?.official_bot_id
        || entry?.account_id
        || entry?.bot?.id
        || entry?.account?.id
        || entry?.id
    );

    return entryBotId === normalizedBotId;
  }) || null;
}

function getContourConfig(entry) {
  if (!entry || typeof entry !== 'object') return null;
  return entry.contour || entry.sales_contour || entry.config || entry.settings || null;
}

function normalizeChannelOption(item) {
  const id = toId(item?.id || item?.channel_id || item?.value || item?.tg_chat_id);
  if (!id) return null;

  return {
    id,
    title: String(item?.title || item?.label || item?.name || item?.tg_chat_id || id).trim(),
    chatType: String(item?.chat_type || item?.type || '').toLowerCase()
  };
}

function normalizeUserbotOption(item) {
  const id = toId(item?.id || item?.account_id || item?.value || item?.tg_account_id);
  if (!id) return null;

  const username = String(item?.tg_username || item?.username || '').trim().replace(/^@/, '');
  const title = username
    ? `@${username}`
    : `userbot-${String(item?.tg_account_id || id)}`;
  const eligible = item?.eligible_for_contour !== false;
  const reason = String(item?.availability_reason || item?.reason || '').trim();

  return {
    id,
    title,
    eligible,
    reason,
    label: !eligible && reason ? `${title} — ${reason}` : title
  };
}

function dedupeOptions(items) {
  const seen = new Set();
  return items.filter((item) => {
    const id = toId(item?.id);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function resolveChannelOptions({ entry, fallbackChannels, chatOnly = false }) {
  const contour = getContourConfig(entry);
  const optionKeys = chatOnly
    ? ['public_chat_options', 'public_chats', 'eligible_public_chats', 'chat_options', 'eligible_chats']
    : ['paid_channel_options', 'paid_channels', 'eligible_paid_channels', 'channel_options', 'eligible_channels', 'channels'];
  const rawOptions = [
    ...extractFirstArray(entry, optionKeys),
    ...extractFirstArray(contour, optionKeys),
    ...fallbackChannels
  ];

  const options = dedupeOptions(rawOptions.map(normalizeChannelOption).filter(Boolean));
  if (!chatOnly) return options;
  return options.filter((option) => isChatTarget(option));
}

function resolveUserbotOptions({ entry, fallbackUserbots, payload }) {
  const contour = getContourConfig(entry);
  const rawOptions = [
    ...extractFirstArray(entry, ['userbots', 'eligible_userbots', 'userbot_options']),
    ...extractFirstArray(contour, ['userbots', 'eligible_userbots', 'userbot_options']),
    ...extractFirstArray(payload, ['userbots', 'eligible_userbots', 'userbot_options']),
    ...fallbackUserbots
  ];

  return dedupeOptions(rawOptions.map(normalizeUserbotOption).filter(Boolean));
}

function resolveWarnings(entry) {
  const contour = getContourConfig(entry);
  const warnings = [
    ...asArray(entry?.warnings),
    ...asArray(entry?.readiness?.warnings),
    ...asArray(contour?.warnings),
    ...asArray(contour?.readiness?.warnings)
  ];

  return warnings
    .map((item) => (typeof item === 'string' ? item : item?.message || item?.text || ''))
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function buildDraft({ entry, paidChannelOptions, publicChatOptions, userbotOptions }) {
  const contour = getContourConfig(entry);
  const eligibleUserbotOptions = userbotOptions.filter((option) => option.eligible !== false);
  const paidChannelId = toId(contour?.paid_channel_id || contour?.paidChannelId || entry?.paid_channel_id);
  const publicChatId = toId(contour?.public_chat_id || contour?.publicChatId || entry?.public_chat_id);
  const userbotMode = normalizeUserbotMode(contour?.userbot_mode || contour?.userbotMode || entry?.userbot_mode);
  const selectedUserbotId = toId(contour?.selected_userbot_id || contour?.selectedUserbotId || entry?.selected_userbot_id);
  const selectedUserbotIds = asArray(
    contour?.selected_userbot_ids
      || contour?.selectedUserbotIds
      || entry?.selected_userbot_ids
  ).map(toId).filter(Boolean);

  return {
    paidChannelId: paidChannelId || (paidChannelOptions.length === 1 ? paidChannelOptions[0].id : ''),
    publicChatId: publicChatId || '',
    userbotMode,
    selectedUserbotId: selectedUserbotId || (userbotMode === 'single' && eligibleUserbotOptions.length === 1 ? eligibleUserbotOptions[0].id : ''),
    selectedUserbotIds
  };
}

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
  state,
  setState,
  showUiMessage
}) {
  const [draftsByBotId, setDraftsByBotId] = useState({});
  const [dirtyBotIds, setDirtyBotIds] = useState({});

  const selectedBotId = toId(selectedOfficialBot?.id);
  const selectedBotKind = normalizeBotKind(selectedOfficialBot?.bot_kind);

  const fallbackChannels = useMemo(() => {
    if (!selectedBotId) return [];
    return asArray(channelsByBotId?.[selectedBotId]);
  }, [channelsByBotId, selectedBotId]);

  const fallbackUserbots = useMemo(() => {
    const reservedIds = new Set((reservedUserbotIds || []).map(toId));
    return (accounts || []).filter((account) => {
      if (account.account_type !== 'userbot') return false;
      if (reservedIds.has(toId(account.id))) return false;
      if (account.proxy_id) {
        const proxy = (proxies || []).find((item) => toId(item.id) === toId(account.proxy_id));
        if (proxy?.is_working === false) return false;
      }
      return true;
    });
  }, [accounts, proxies, reservedUserbotIds]);

  const contourEntry = useMemo(() => {
    return getContourPayloadEntry(officialBotContoursPayload, selectedBotId);
  }, [officialBotContoursPayload, selectedBotId]);

  const paidChannelOptions = useMemo(() => {
    return resolveChannelOptions({
      entry: contourEntry,
      fallbackChannels,
      chatOnly: false
    });
  }, [contourEntry, fallbackChannels]);

  const rawPublicChatOptions = useMemo(() => {
    return resolveChannelOptions({
      entry: contourEntry,
      fallbackChannels,
      chatOnly: true
    });
  }, [contourEntry, fallbackChannels]);

  const userbotOptions = useMemo(() => {
    return resolveUserbotOptions({
      entry: contourEntry,
      fallbackUserbots,
      payload: officialBotContoursPayload
    });
  }, [contourEntry, fallbackUserbots, officialBotContoursPayload]);

  const contourWarnings = useMemo(() => resolveWarnings(contourEntry), [contourEntry]);

  const draft = draftsByBotId[selectedBotId] || {
    paidChannelId: paidChannelOptions.length === 1 ? paidChannelOptions[0].id : '',
    publicChatId: '',
    userbotMode: 'none',
    selectedUserbotId: '',
    selectedUserbotIds: []
  };

  const publicChatOptions = useMemo(() => {
    return rawPublicChatOptions.filter((option) => toId(option.id) !== toId(draft.paidChannelId));
  }, [draft.paidChannelId, rawPublicChatOptions]);

  useEffect(() => {
    if (!selectedBotId || dirtyBotIds[selectedBotId]) return;

    const nextDraft = buildDraft({
      entry: contourEntry,
      paidChannelOptions,
      publicChatOptions,
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
  }, [contourEntry, dirtyBotIds, paidChannelOptions, publicChatOptions, selectedBotId, userbotOptions]);

  function updateDraft(patch) {
    if (!selectedBotId) return;

    setDraftsByBotId((prev) => ({
      ...prev,
      [selectedBotId]: {
        ...(prev[selectedBotId] || draft),
        ...patch
      }
    }));

    setDirtyBotIds((prev) => ({
      ...prev,
      [selectedBotId]: true
    }));
  }

  function setUserbotMode(mode) {
    const nextMode = normalizeUserbotMode(mode);
    updateDraft({
      userbotMode: nextMode,
      selectedUserbotId: nextMode === 'single' ? draft.selectedUserbotId : '',
      selectedUserbotIds: nextMode === 'pool' ? draft.selectedUserbotIds : []
    });
  }

  async function saveContour() {
    if (!selectedOfficialBot?.id) return;

    if (!draft.paidChannelId) {
      showUiMessage('Сначала выбери платный канал или группу.', 'error');
      return;
    }

    if (draft.userbotMode === 'single' && !draft.selectedUserbotId) {
      showUiMessage('Для режима с одним юзерботом сначала выбери аккаунт.', 'error');
      return;
    }

    if (draft.publicChatId && draft.publicChatId === draft.paidChannelId) {
      showUiMessage('Публичный чат и платный канал должны быть разными Telegram-местами.', 'error');
      return;
    }

    if (draft.userbotMode === 'pool') {
      showUiMessage('Пул юзерботов оставили в MVP только как режим-наметку. Пока сохраняем без юзербота или один аккаунт.', 'error');
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
          paid_channel_id: draft.paidChannelId,
          public_chat_id: draft.publicChatId || null,
          userbot_mode: draft.userbotMode,
          selected_userbot_id: draft.userbotMode === 'single' ? draft.selectedUserbotId : null,
          selected_userbot_ids: []
        }
      });

      setDirtyBotIds((prev) => ({
        ...prev,
        [selectedBotId]: false
      }));
      await reloadAccounts();
      showUiMessage('Контур продаж сохранен.', 'success');
    } catch (error) {
      showUiMessage(error.message, 'error');
    } finally {
      setState((prev) => ({
        ...prev,
        savingContourBotId: ''
      }));
    }
  }

  return {
    contourError: officialBotContoursError,
    contourWarnings,
    draft,
    isVisible: !!selectedBotId && selectedBotKind === 'sales',
    paidChannelOptions,
    publicChatOptions,
    saveContour,
    savingContour: String(state?.savingContourBotId || '') === selectedBotId,
    selectedBotKind,
    setFieldValue(field, value) {
      updateDraft({ [field]: value });
    },
    setUserbotMode,
    userbotOptions
  };
}
