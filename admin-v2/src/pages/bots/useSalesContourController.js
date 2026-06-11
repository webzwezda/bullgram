import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { apiRequest } from '../../api/client.js';

function normalizeBotKind(value) {
  return value === 'template' ? 'template' : 'sales';
}

function normalizeUserbotMode(value) {
  return value === 'single' || value === 'pool' ? value : 'none';
}

function normalizeContourTarget(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw || raw === 'paid' || raw === 'closed_channel' || raw === 'access_channel') return 'paid_channel';
  if (raw === 'public' || raw === 'open_chat') return 'public_chat';
  if (raw === 'open_channel') return 'public_channel';
  if (raw === 'closed_chat' || raw === 'access_chat') return 'paid_chat';
  if (['public_channel', 'public_chat', 'paid_channel', 'paid_chat'].includes(raw)) return raw;
  return 'paid_channel';
}

function toId(value) {
  return String(value || '').trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function readFirstValue(source, keys) {
  for (const key of keys) {
    if (source?.[key] !== undefined && source[key] !== null) {
      return source[key];
    }
  }
  return undefined;
}

function readFirstObject(source, keys) {
  for (const key of keys) {
    const value = source?.[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value;
    }
  }
  return null;
}

function normalizeNullableBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1') return true;
  if (value === 0 || value === '0') return false;

  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (['true', 'yes', 'ok', 'allowed', 'admin', 'administrator'].includes(normalized)) return true;
  if (['false', 'no', 'blocked', 'denied'].includes(normalized)) return false;
  return null;
}

function normalizeStatusKey(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
}

function dedupeStrings(items) {
  const seen = new Set();
  return items.filter((item) => {
    const normalized = String(item || '').trim();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function isChatTarget(target) {
  const chatType = String(target?.chat_type || target?.type || target?.chatType || '').toLowerCase();
  return chatType === 'group' || chatType === 'supergroup';
}

function isChannelTarget(target) {
  const chatType = String(target?.chat_type || target?.type || target?.chatType || '').toLowerCase();
  return chatType === 'channel';
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
  const username = String(item?.username || item?.tg_username || '').trim().replace(/^@/, '');
  const visibility = String(item?.visibility || (username ? 'public' : 'unknown')).trim().toLowerCase();

  return {
    id,
    title: String(item?.title || item?.label || item?.name || item?.tg_chat_id || id).trim(),
    chatType: String(item?.chat_type || item?.type || '').toLowerCase(),
    tgChatId: String(item?.tg_chat_id || item?.chat_id || '').trim(),
    username,
    visibility: ['public', 'private', 'unknown'].includes(visibility) ? visibility : 'unknown',
    lastVisibilityCheckAt: item?.last_visibility_check_at || item?.lastVisibilityCheckAt || null
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
    label: !eligible && reason ? `${title} — ${reason}` : title,
    runtimeStatus: item?.runtime_status || ''
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

function resolveChannelOptions({ entry, fallbackChannels, targetKind = 'channel' }) {
  const contour = getContourConfig(entry);
  const chatOnly = targetKind === 'chat';
  const optionKeys = chatOnly
    ? ['paid_chat_options', 'public_chat_options', 'public_chats', 'eligible_public_chats', 'chat_options', 'eligible_chats']
    : ['public_channel_options', 'paid_channel_options', 'paid_channels', 'eligible_paid_channels', 'channel_options', 'eligible_channels', 'channels'];
  const rawOptions = [
    ...extractFirstArray(entry, optionKeys),
    ...extractFirstArray(contour, optionKeys),
    ...fallbackChannels
  ];

  const options = dedupeOptions(rawOptions.map(normalizeChannelOption).filter(Boolean));
  if (!chatOnly) return options.filter((option) => isChannelTarget(option));
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

function extractResponseRoot(payload) {
  return readFirstObject(payload, ['result', 'data', 'payload']) || payload || {};
}

function collectApiWarnings(source) {
  const warningArrays = [
    ...asArray(source?.warnings),
    ...asArray(source?.issues),
    ...asArray(source?.notices)
  ];

  return warningArrays
    .map((item) => (typeof item === 'string' ? item : item?.message || item?.text || item?.warning || ''))
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function createEmptyRightsResult(target) {
  return {
    target: normalizeContourTarget(target),
    status: '',
    adminStatus: '',
    isAdmin: null,
    channelId: '',
    checkedAt: '',
    canInviteUsers: null,
    canRestrictMembers: null,
    canPromoteMembers: null,
    canManageChat: null,
    warnings: [],
    message: ''
  };
}

function normalizeRightsResult(payload, fallbackTarget) {
  const root = extractResponseRoot(payload);
  const rights = readFirstObject(root, ['rights', 'permissions', 'admin_rights', 'adminRights']) || root;

  return {
    target: normalizeContourTarget(readFirstValue(root, ['target', 'chat_target']) || fallbackTarget),
    status: normalizeStatusKey(readFirstValue(root, ['status', 'check_status'])) || 'checked',
    adminStatus: String(readFirstValue(root, ['admin_status', 'adminStatus']) || '').trim(),
    isAdmin: normalizeNullableBoolean(readFirstValue(root, ['is_admin', 'isAdmin']) ?? readFirstValue(rights, ['is_admin', 'isAdmin'])),
    channelId: toId(readFirstValue(root, ['channel_id', 'channelId']) || root?.channel?.id || root?.cached_rights?.channel_id || root?.cachedRights?.channelId),
    checkedAt: String(readFirstValue(root, ['checked_at', 'checkedAt']) || root?.cached_rights?.checked_at || root?.cachedRights?.checkedAt || '').trim(),
    canInviteUsers: normalizeNullableBoolean(readFirstValue(rights, ['can_invite_users', 'canInviteUsers'])),
    canRestrictMembers: normalizeNullableBoolean(readFirstValue(rights, ['can_restrict_members', 'canRestrictMembers'])),
    canPromoteMembers: normalizeNullableBoolean(readFirstValue(rights, ['can_promote_members', 'canPromoteMembers'])),
    canManageChat: normalizeNullableBoolean(readFirstValue(rights, ['can_manage_chat', 'canManageChat'])),
    warnings: dedupeStrings([
      ...collectApiWarnings(root),
      ...collectApiWarnings(rights)
    ]),
    message: String(readFirstValue(root, ['message', 'text', 'detail']) || '').trim()
  };
}

function resolveRightsByTarget(entry) {
  const source = readFirstObject(entry, ['rights_by_target', 'rightsByTarget', 'cached_rights_by_target', 'cachedRightsByTarget']) || {};
  return Object.entries(source).reduce((acc, [target, value]) => {
    const normalizedTarget = normalizeContourTarget(target);
    acc[normalizedTarget] = normalizeRightsResult(value, normalizedTarget);
    return acc;
  }, {});
}

function normalizePrepareResult(payload, fallbackTarget, fallbackUserbotId) {
  const root = extractResponseRoot(payload);

  return {
    target: normalizeContourTarget(readFirstValue(root, ['target', 'chat_target']) || fallbackTarget),
    status: normalizeStatusKey(readFirstValue(root, ['status', 'prepare_status', 'result_status'])),
    inviteLink: String(readFirstValue(root, ['invite_link', 'inviteLink', 'join_link', 'joinLink']) || '').trim(),
    warnings: dedupeStrings(collectApiWarnings(root)),
    message: String(readFirstValue(root, ['message', 'text', 'detail']) || '').trim(),
    userbotId: toId(readFirstValue(root, ['selected_userbot_id', 'selectedUserbotId', 'userbot_id', 'userbotId']) || fallbackUserbotId)
  };
}

function responseIncludesRights(payload) {
  const root = extractResponseRoot(payload);
  return Boolean(
    root?.rights
      || root?.permissions
      || root?.admin_rights
      || root?.adminRights
      || readFirstValue(root, ['can_invite_users', 'canInviteUsers']) !== undefined
      || readFirstValue(root, ['can_promote_members', 'canPromoteMembers']) !== undefined
      || readFirstValue(root, ['can_manage_chat', 'canManageChat']) !== undefined
      || readFirstValue(root, ['admin_status', 'adminStatus']) !== undefined
  );
}

function isPreparationSuccessStatus(status) {
  return ['prepared', 'promoted', 'ready', 'already_admin', 'already_prepared'].includes(normalizeStatusKey(status));
}

function buildDraft({ entry, paidChannelOptions, publicChatOptions, userbotOptions }) {
  const contour = getContourConfig(entry);
  const eligibleUserbotOptions = userbotOptions.filter((option) => option.eligible !== false);
  const publicChannelId = toId(contour?.public_channel_id || contour?.publicChannelId || entry?.public_channel_id);
  const paidChannelId = toId(contour?.paid_channel_id || contour?.paidChannelId || entry?.paid_channel_id);
  const publicChatId = toId(contour?.public_chat_id || contour?.publicChatId || entry?.public_chat_id);
  const paidChatId = toId(contour?.paid_chat_id || contour?.paidChatId || entry?.paid_chat_id);
  const userbotMode = normalizeUserbotMode(contour?.userbot_mode || contour?.userbotMode || entry?.userbot_mode);
  const selectedUserbotId = toId(contour?.selected_userbot_id || contour?.selectedUserbotId || entry?.selected_userbot_id);
  const selectedUserbotIds = asArray(
    contour?.selected_userbot_ids
      || contour?.selectedUserbotIds
      || entry?.selected_userbot_ids
  ).map(toId).filter(Boolean);

  return {
    publicChannelId: publicChannelId || '',
    paidChannelId: paidChannelId || '',
    publicChatId: publicChatId || '',
    paidChatId: paidChatId || '',
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
  showUiMessage,
  state,
  setState,
}) {
  const [draftsByBotId, setDraftsByBotId] = useState({});
  const [dirtyBotIds, setDirtyBotIds] = useState({});
  const [botRightsTarget, setBotRightsTarget] = useState('paid_channel');
  const [botRightsByKey, setBotRightsByKey] = useState({});
  const [checkingRightsKey, setCheckingRightsKey] = useState('');
  const [prepareResultByKey, setPrepareResultByKey] = useState({});
  const [preparingUserbotKey, setPreparingUserbotKey] = useState('');

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

  const contourWarnings = useMemo(() => resolveWarnings(contourEntry), [contourEntry]);
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
    return rawChannelOptions.filter((option) => toId(option.id) !== toId(draft.paidChannelId));
  }, [draft.paidChannelId, rawChannelOptions]);

  const paidChannelOptions = useMemo(() => {
    return rawChannelOptions.filter((option) => toId(option.id) !== toId(draft.publicChannelId));
  }, [draft.publicChannelId, rawChannelOptions]);

  const publicChatOptions = useMemo(() => {
    return rawChatOptions.filter((option) => toId(option.id) !== toId(draft.paidChatId));
  }, [draft.paidChatId, rawChatOptions]);

  const paidChatOptions = useMemo(() => {
    return rawChatOptions.filter((option) => toId(option.id) !== toId(draft.publicChatId));
  }, [draft.publicChatId, rawChatOptions]);

  const normalizedRightsTarget = normalizeContourTarget(botRightsTarget);
  const rightsKey = `${selectedBotId}:${normalizedRightsTarget}`;
  const prepareKey = `${selectedBotId}:paid_channel`;
  const botRightsResult = botRightsByKey[rightsKey] || null;
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
  const userbotPrepareResult = (() => {
    const result = prepareResultByKey[prepareKey] || null;
    if (result?.userbotId && toId(result.userbotId) !== toId(draft.selectedUserbotId)) {
      return null;
    }
    return result;
  })();

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

  function setUserbotMode(mode) {
    const nextMode = normalizeUserbotMode(mode);
    updateDraft({
      userbotMode: nextMode,
      selectedUserbotId: nextMode === 'single' ? draft.selectedUserbotId : '',
      selectedUserbotIds: nextMode === 'pool' ? draft.selectedUserbotIds : []
    });
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
      return;
    }
    const targetFieldByKey = {
      public_channel: 'publicChannelId',
      public_chat: 'publicChatId',
      paid_channel: 'paidChannelId',
      paid_chat: 'paidChatId'
    };
    if (!draft[targetFieldByKey[normalizedTarget]]) {
      return;
    }

    const key = `${selectedBotId}:${normalizedTarget}`;
    setBotRightsTarget(normalizedTarget);
    setCheckingRightsKey(key);

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
      showUiMessage('Права бота проверены.', 'success');
    } catch (error) {
      setBotRightsByKey((prev) => ({
        ...prev,
        [key]: {
          ...createEmptyRightsResult(normalizedTarget),
          status: 'error',
          message: error.message
        }
      }));
      showUiMessage(error.message, 'error');
    } finally {
      setCheckingRightsKey('');
    }
  }

  async function prepareUserbotAdmin() {
    if (!selectedOfficialBot?.id) return;
    const normalizedTarget = 'paid_channel';

    if (dirtyBotIds[selectedBotId]) {
      return;
    }
    if (draft.userbotMode !== 'single' || !draft.selectedUserbotId) {
      return;
    }
    if (!draft.paidChannelId) {
      return;
    }

    setPreparingUserbotKey(prepareKey);

    try {
      const result = await apiRequest('/api/official-bot/contours/prepare-userbot', {
        accessToken,
        method: 'POST',
        body: {
          bot_id: selectedOfficialBot.id,
          target: normalizedTarget
        }
      });

      const normalizedResult = normalizePrepareResult(result, normalizedTarget, draft.selectedUserbotId);

      setPrepareResultByKey((prev) => ({
        ...prev,
        [prepareKey]: normalizedResult
      }));

      if (responseIncludesRights(result)) {
        setBotRightsByKey((prev) => ({
          ...prev,
          [`${selectedBotId}:${normalizedResult.target}`]: normalizeRightsResult(result, normalizedTarget)
        }));
      }

      if (normalizedResult.status === 'needs_join') {

      } else if (isPreparationSuccessStatus(normalizedResult.status)) {
        reloadAccounts().catch(() => null);

      } else {

      }
    } catch (error) {
      setPrepareResultByKey((prev) => ({
        ...prev,
        [prepareKey]: {
          target: normalizedTarget,
          status: 'error',
          inviteLink: '',
          warnings: [],
          message: error.message,
          userbotId: toId(draft.selectedUserbotId)
        }
      }));
    } finally {
      setPreparingUserbotKey('');
    }
  }

  const [userbotActiveMap, setUserbotActiveMap] = useState({});
  const [togglingUserbotId, setTogglingUserbotId] = useState('');

  useEffect(() => {
    const rawBindings = contourEntry?.userbot_bindings || [];
    const map = {};
    for (const b of rawBindings) {
      map[String(b.userbot_id)] = b.is_active;
    }
    setUserbotActiveMap(map);
  }, [contourEntry]);

  async function toggleUserbotActive(userbotId, isActive) {
    console.log('[toggleUserbotActive]', { userbotId, isActive, selectedBotId: selectedOfficialBot?.id, togglingUserbotId });
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
        triggerJoinAll();
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

  function triggerJoinAll() {
    const botId = selectedOfficialBot?.id;
    if (!botId) return;
    apiRequest('/api/official-bot/contours/join-all', {
      accessToken,
      method: 'POST',
      body: { bot_id: botId }
    }).then((data) => {
      const summary = data?.summary || 'Готово';
      toast.success(summary);
      reloadAccounts();
    }).catch((err) => {
      console.error('join-all failed:', err?.message);
      toast.error(err?.message || 'Ошибка вступления в группы');
    });
  }

  return {
    botRightsResult,
    botRightsByTarget,
    botRightsTarget: normalizedRightsTarget,
    checkBotRights,
    checkingBotRights: checkingRightsKey === rightsKey,
    checkingBotRightsTarget,
    contourError: officialBotContoursError,
    contourWarnings,
    draft,
    isVisible: !!selectedBotId,
    paidChannelOptions,
    prepareUserbotAdmin,
    preparingUserbot: preparingUserbotKey === prepareKey,
    publicChatOptions,
    paidChatOptions,
    publicChannelOptions,
    saveContour,
    savingContour: String(state?.savingContourBotId || '') === selectedBotId,
    selectedBotKind,
    setBotRightsTarget,
    setFieldValue(fieldOrPatch, value, options = {}) {
      const patch = typeof fieldOrPatch === 'object' && fieldOrPatch !== null
        ? { ...fieldOrPatch }
        : { [fieldOrPatch]: value };
      if (options.oppositeField && value && String(draft[options.oppositeField] || '') === String(value)) {
        patch[options.oppositeField] = '';
      }
      const nextDraft = updateDraft(patch);
      clearRightsForFields(Object.keys(patch));
      if (options.autoSave && nextDraft) {
        saveContour(nextDraft, { auto: true });
      }
    },
    setUserbotMode,
    userbotPrepareResult,
    userbotOptions,
    userbotActiveMap,
    toggleUserbotActive,
    togglingUserbotId,
    triggerJoinAll
  };
}
