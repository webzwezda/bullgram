// Чистые хелперы контроллера контура продаж: нормализация payload'ов бэка,
// резолв опций площадок/юзерботов и сборка черновика контура. Без React и стейта —
// стейт/логика живёт в useSalesContourController.js, сайд-эффекты в useSalesContourActions.js.

export function normalizeUserbotMode(value) {
  return value === 'single' || value === 'pool' ? value : 'none';
}

export function normalizeContourTarget(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw || raw === 'paid' || raw === 'closed_channel' || raw === 'access_channel') return 'paid_channel';
  if (raw === 'public' || raw === 'open_chat') return 'public_chat';
  if (raw === 'open_channel') return 'public_channel';
  if (raw === 'closed_chat' || raw === 'access_chat') return 'paid_chat';
  if (['public_channel', 'public_chat', 'paid_channel', 'paid_chat'].includes(raw)) return raw;
  return 'paid_channel';
}

export function toId(value) {
  return String(value || '').trim();
}

export function asArray(value) {
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

export function getContourPayloadEntry(payload, botId) {
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

export function getContourConfig(entry) {
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

export function resolveChannelOptions({ entry, fallbackChannels, targetKind = 'channel' }) {
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

export function resolveUserbotOptions({ entry, fallbackUserbots, payload }) {
  const contour = getContourConfig(entry);
  const rawOptions = [
    ...extractFirstArray(entry, ['userbots', 'eligible_userbots', 'userbot_options']),
    ...extractFirstArray(contour, ['userbots', 'eligible_userbots', 'userbot_options']),
    ...extractFirstArray(payload, ['userbots', 'eligible_userbots', 'userbot_options']),
    ...fallbackUserbots
  ];

  return dedupeOptions(rawOptions.map(normalizeUserbotOption).filter(Boolean));
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

export function createEmptyRightsResult(target) {
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

export function normalizeRightsResult(payload, fallbackTarget) {
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

export function resolveRightsByTarget(entry) {
  const source = readFirstObject(entry, ['rights_by_target', 'rightsByTarget', 'cached_rights_by_target', 'cachedRightsByTarget']) || {};
  return Object.entries(source).reduce((acc, [target, value]) => {
    const normalizedTarget = normalizeContourTarget(target);
    acc[normalizedTarget] = normalizeRightsResult(value, normalizedTarget);
    return acc;
  }, {});
}

function pickSingleOption(currentValue, options, excludeId) {
  if (currentValue) return currentValue;
  const available = (Array.isArray(options) ? options : []).filter((option) => {
    const optionId = toId(option?.id);
    if (!optionId) return false;
    if (excludeId && optionId === toId(excludeId)) return false;
    return true;
  });
  return available.length === 1 ? toId(available[0].id) : '';
}

export function buildDraft({ entry, publicChannelOptions, paidChannelOptions, publicChatOptions, paidChatOptions, userbotOptions }) {
  const contour = getContourConfig(entry);
  const eligibleUserbotOptions = userbotOptions.filter((option) => option.eligible !== false);
  const contourPublicChannelId = toId(contour?.public_channel_id || contour?.publicChannelId || entry?.public_channel_id);
  const contourPaidChannelId = toId(contour?.paid_channel_id || contour?.paidChannelId || entry?.paid_channel_id);
  const contourPublicChatId = toId(contour?.public_chat_id || contour?.publicChatId || entry?.public_chat_id);
  const contourPaidChatId = toId(contour?.paid_chat_id || contour?.paidChatId || entry?.paid_chat_id);
  const userbotMode = normalizeUserbotMode(contour?.userbot_mode || contour?.userbotMode || entry?.userbot_mode);
  const selectedUserbotId = toId(contour?.selected_userbot_id || contour?.selectedUserbotId || entry?.selected_userbot_id);
  const selectedUserbotIds = asArray(
    contour?.selected_userbot_ids
      || contour?.selectedUserbotIds
      || entry?.selected_userbot_ids
  ).map(toId).filter(Boolean);

  // Авто-выбор: если слот пустой и остался ровно один доступный вариант — берем его.
  // Пары (каналы/чаты) обрабатываем последовательно, чтобы public и paid не получили один и тот же ID.
  let publicChannelId = contourPublicChannelId;
  let paidChannelId = contourPaidChannelId;
  let publicChatId = contourPublicChatId;
  let paidChatId = contourPaidChatId;

  publicChannelId = pickSingleOption(publicChannelId, publicChannelOptions, paidChannelId);
  paidChannelId = pickSingleOption(paidChannelId, paidChannelOptions, publicChannelId);
  publicChannelId = pickSingleOption(publicChannelId, publicChannelOptions, paidChannelId);

  publicChatId = pickSingleOption(publicChatId, publicChatOptions, paidChatId);
  paidChatId = pickSingleOption(paidChatId, paidChatOptions, publicChatId);
  publicChatId = pickSingleOption(publicChatId, publicChatOptions, paidChatId);

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
