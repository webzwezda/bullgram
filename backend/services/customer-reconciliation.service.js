import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { decrypt } from '../utils/crypto.js';
import { UserbotService } from './userbot.service.js';
import { loadReservedUserbotIds } from '../utils/shop-reservations.js';

const TELEGRAM_API_ID = 4;
const TELEGRAM_API_HASH = '014b35b6184100b085b0d0572f9b5103';
const FRESH_IMPORT_RUNTIME_STATUS = 'pending_activation';
const FRESH_IMPORT_RUNTIME_REASON = 'Свежий импорт. Аккаунт в safe-mode: автоматика и живые Telegram-действия отключены до ручной активации.';
const RECONCILIATION_DISCOVERY_LIMIT = 80;
export const RECONCILIATION_LARGE_SOURCE_MEMBER_COUNT = 1000;

export const RECONCILIATION_SOURCE_ROLES = Object.freeze([
    'public_funnel_group',
    'public_chat',
    'private_paid_group',
    'ignored'
]);

export const RECONCILIATION_SCAN_STATUSES = Object.freeze([
    'never',
    'queued',
    'running',
    'success',
    'partial',
    'failed',
    'cooldown'
]);

class CustomerReconciliationError extends Error {
    constructor(message, statusCode = 400) {
        super(message);
        this.name = 'CustomerReconciliationError';
        this.statusCode = statusCode;
    }
}

function isFreshImportedUserbot(userbot) {
    return String(userbot?.runtime_status || '').trim().toLowerCase() === FRESH_IMPORT_RUNTIME_STATUS;
}

function isUserbotOnDeadProxy(userbot) {
    return !!(userbot?.proxy_id && userbot?.proxies?.is_working === false);
}

function getDeadProxyMessage() {
    return 'У этого юзербота сдох прокси. Пока не перепривяжешь его к живому, аккаунт считается неактивным.';
}

function getFailoverCooldownMessage(retryAfterMs = 0) {
    const minutes = Math.max(1, Math.ceil(retryAfterMs / 60000));
    return `Прокси сдох, но авто-переезд уже недавно срабатывал. Подожди еще примерно ${minutes} мин. или перепривяжи аккаунт вручную.`;
}

function normalizeChatId(value) {
    const raw = String(value ?? '').trim();
    if (!raw) {
        throw new CustomerReconciliationError('Не передан chat_id.');
    }
    if (!/^-?\d+$/.test(raw)) {
        throw new CustomerReconciliationError('chat_id должен быть Telegram ID чата.');
    }
    return raw;
}

function normalizeRole(value, { allowMissing = false } = {}) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) {
        if (allowMissing) return null;
        throw new CustomerReconciliationError('Не передана роль источника.');
    }
    if (!RECONCILIATION_SOURCE_ROLES.includes(raw)) {
        throw new CustomerReconciliationError('Передана неизвестная роль источника.');
    }
    return raw;
}

function normalizeBoolean(value, defaultValue) {
    if (typeof value === 'boolean') return value;
    if (value === undefined) return defaultValue;
    if (value === null) return defaultValue;

    const normalized = String(value).trim().toLowerCase();
    if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n'].includes(normalized)) return false;
    return defaultValue;
}

function normalizeOptionalUuid(value) {
    const raw = String(value || '').trim();
    return raw || null;
}

function normalizeOptionalText(value) {
    const raw = String(value || '').trim();
    return raw || null;
}

function normalizeChatType(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return 'unknown';
    if (['group', 'supergroup', 'channel'].includes(raw)) return raw;
    return 'unknown';
}

function normalizeMemberCount(value) {
    if (value === undefined || value === null || value === '') return null;
    const numeric = Number(value);
    if (!Number.isInteger(numeric) || numeric < 0) {
        throw new CustomerReconciliationError('member_count_snapshot должен быть целым числом >= 0.');
    }
    return numeric;
}

function normalizeStatusToken(value, allowed, fallback) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return fallback;
    return allowed.includes(raw) ? raw : fallback;
}

function buildUserbotOption(userbot, reservedUserbotIds = new Set()) {
    const userbotId = String(userbot.id);
    let availabilityStatus = 'ready';
    let availabilityReason = null;

    if (isFreshImportedUserbot(userbot)) {
        availabilityStatus = 'pending_activation';
        availabilityReason = FRESH_IMPORT_RUNTIME_REASON;
    } else if (reservedUserbotIds.has(userbotId)) {
        availabilityStatus = 'reserved_in_shop';
        availabilityReason = 'Этот юзербот сейчас выставлен в shop и не должен участвовать в рабочем reconciliation contour.';
    } else if (isUserbotOnDeadProxy(userbot)) {
        availabilityStatus = 'proxy_dead';
        availabilityReason = getDeadProxyMessage();
    }

    return {
        id: userbotId,
        tg_username: userbot.tg_username || null,
        tg_account_id: userbot.tg_account_id ? String(userbot.tg_account_id) : null,
        proxy_id: userbot.proxy_id || null,
        proxy_name: userbot.proxies?.name || null,
        proxy_country: userbot.proxies?.last_check_country || null,
        proxy_is_working: userbot.proxies?.is_working ?? null,
        runtime_status: userbot.runtime_status || null,
        runtime_error: userbot.runtime_error || null,
        availability_status: availabilityStatus,
        availability_reason: availabilityReason,
        visible_in_reconciliation: availabilityStatus !== 'reserved_in_shop',
        eligible_for_discovery: availabilityStatus === 'ready'
    };
}

async function loadOwnedUserbots(supabase, ownerId) {
    const reservedUserbotIds = await loadReservedUserbotIds(supabase, ownerId);
    const { data, error } = await supabase
        .from('tg_accounts')
        .select('*, proxies(id, name, host, port, username, password, is_working, provision_source, inventory_group, last_check_country, last_check_country_code)')
        .eq('owner_id', ownerId)
        .eq('account_type', 'userbot')
        .order('created_at', { ascending: false });

    if (error) {
        throw error;
    }

    return {
        userbots: data || [],
        reservedUserbotIds
    };
}

async function loadReadyDiscoveryUserbot(supabase, ownerId, userbotId) {
    const requestedUserbotId = String(userbotId || '').trim();
    if (!requestedUserbotId) {
        throw new CustomerReconciliationError('Не передан userbot_id для discovery.', 400);
    }

    const { userbots, reservedUserbotIds } = await loadOwnedUserbots(supabase, ownerId);
    const optionRows = userbots.map((userbot) => buildUserbotOption(userbot, reservedUserbotIds));
    const userbot = userbots.find((item) => String(item.id) === requestedUserbotId);

    if (!userbot) {
        throw new CustomerReconciliationError('Выбранный юзербот не найден.', 404);
    }

    if (reservedUserbotIds.has(requestedUserbotId)) {
        throw new CustomerReconciliationError('Этот юзербот сейчас выставлен в shop и выведен из рабочей Telegram-операционки. Сними его с витрины или выбери другой аккаунт.', 409);
    }

    if (isFreshImportedUserbot(userbot)) {
        throw new CustomerReconciliationError(FRESH_IMPORT_RUNTIME_REASON, 409);
    }

    let operationalUserbot = userbot;

    if (isUserbotOnDeadProxy(operationalUserbot)) {
        const service = new UserbotService(supabase, TELEGRAM_API_ID, TELEGRAM_API_HASH);
        const failover = await service.tryAutoFailoverUserbot(operationalUserbot);

        if (failover?.switched && failover?.account) {
            operationalUserbot = {
                ...operationalUserbot,
                ...failover.account,
                proxies: failover.account.proxies || operationalUserbot.proxies
            };
        }

        if (isUserbotOnDeadProxy(operationalUserbot)) {
            if (failover?.reason === 'cooldown') {
                throw new CustomerReconciliationError(getFailoverCooldownMessage(failover.retry_after_ms), 409);
            }
            throw new CustomerReconciliationError(getDeadProxyMessage(), 409);
        }
    }

    return {
        userbot: operationalUserbot,
        userbots: optionRows
    };
}

function extractMemberCount(dialog) {
    const entity = dialog?.entity || {};
    const raw = entity.participantsCount ?? entity.participants_count ?? dialog?.participantsCount ?? null;
    const numeric = Number(raw);
    if (!Number.isInteger(numeric) || numeric < 0) {
        return null;
    }
    return numeric;
}

function resolveTelegramType(dialog) {
    const entity = dialog?.entity || {};

    if (dialog?.isGroup || entity.megagroup) {
        return 'supergroup';
    }

    if (dialog?.isChannel || entity.broadcast) {
        return 'channel';
    }

    return normalizeChatType(entity.className || 'unknown');
}

function resolveAdminRightsStatus(dialog) {
    const entity = dialog?.entity || {};

    if (entity.creator || entity.adminRights) {
        return 'admin';
    }

    if (dialog?.isChannel || dialog?.isGroup) {
        return 'member';
    }

    return 'unknown';
}

function buildSnapshot({ status, discoveredAt, source, extra = {} }) {
    return {
        status,
        checked_at: discoveredAt,
        source,
        ...extra
    };
}

function mapSourceRow(row, { channelByChatId, userbotById, botById, baseLinksByChannelId }) {
    const chatId = String(row.chat_id);
    const linkedChannel = channelByChatId.get(chatId) || null;
    const linkedBases = linkedChannel?.id ? (baseLinksByChannelId.get(String(linkedChannel.id)) || []) : [];
    const userbot = userbotById.get(String(row.userbot_id)) || null;
    const bot = row.bot_id ? (botById.get(String(row.bot_id)) || null) : null;
    const visibilitySnapshot = row.visibility_snapshot && typeof row.visibility_snapshot === 'object'
        ? row.visibility_snapshot
        : {};
    const adminRightsSnapshot = row.admin_rights_snapshot && typeof row.admin_rights_snapshot === 'object'
        ? row.admin_rights_snapshot
        : {};

    return {
        id: row.id,
        owner_id: row.owner_id,
        userbot_id: row.userbot_id,
        userbot_username: userbot?.tg_username || null,
        userbot_tg_account_id: userbot?.tg_account_id ? String(userbot.tg_account_id) : null,
        bot_id: row.bot_id || null,
        bot_username: bot?.tg_username || null,
        chat_id: chatId,
        chat_type: row.chat_type || 'unknown',
        title_snapshot: row.title_snapshot || '',
        username_snapshot: row.username_snapshot || null,
        role: row.role,
        is_active: !!row.is_active,
        scan_enabled: !!row.scan_enabled,
        admin_verified: !!row.admin_verified,
        admin_verified_at: row.admin_verified_at || null,
        last_scan_at: row.last_scan_at || null,
        last_scan_status: row.last_scan_status || 'never',
        last_scan_error: row.last_scan_error || null,
        next_scan_after: row.next_scan_after || null,
        cooldown_until: row.cooldown_until || null,
        member_count_snapshot: row.member_count_snapshot ?? null,
        visibility_status: visibilitySnapshot.status || 'unknown',
        visibility_snapshot: visibilitySnapshot,
        admin_rights_status: adminRightsSnapshot.status || 'unknown',
        admin_rights_snapshot: adminRightsSnapshot,
        scan_cursor: row.scan_cursor && typeof row.scan_cursor === 'object' ? row.scan_cursor : {},
        last_scanned_member: row.last_scanned_member || null,
        already_bound_channel_id: linkedChannel?.id || null,
        already_bound_channel_title: linkedChannel?.title || null,
        already_bound_bot_id: linkedChannel?.bot_id || null,
        linked_base_count: linkedBases.length,
        linked_bases: linkedBases,
        created_at: row.created_at,
        updated_at: row.updated_at
    };
}

async function loadContourContext(supabase, ownerId) {
    const [
        { data: sourceRows, error: sourceError },
        { userbots, reservedUserbotIds },
        { data: channels, error: channelsError },
        { data: bots, error: botsError },
        { data: baseLinks, error: baseLinksError },
        { data: bases, error: basesError }
    ] = await Promise.all([
        supabase
            .from('customer_reconciliation_sources')
            .select('*')
            .eq('owner_id', ownerId)
            .order('is_active', { ascending: false })
            .order('updated_at', { ascending: false }),
        loadOwnedUserbots(supabase, ownerId),
        supabase
            .from('channels')
            .select('id, tg_chat_id, title, bot_id')
            .eq('owner_id', ownerId),
        supabase
            .from('tg_accounts')
            .select('id, tg_username, tg_account_id')
            .eq('owner_id', ownerId)
            .eq('account_type', 'bot')
        ,
        supabase
            .from('customer_base_channels')
            .select('base_id, channel_id'),
        supabase
            .from('customer_bases')
            .select('id, name')
            .eq('owner_id', ownerId)
    ]);

    if (sourceError) throw sourceError;
    if (channelsError) throw channelsError;
    if (botsError) throw botsError;
    if (baseLinksError && !(baseLinksError.message || '').includes('customer_base_channels')) throw baseLinksError;
    if (basesError && !(basesError.message || '').includes('customer_bases')) throw basesError;

    const channelByChatId = new Map(
        (channels || []).map((channel) => [String(channel.tg_chat_id), channel])
    );
    const userbotById = new Map(
        (userbots || []).map((userbot) => [String(userbot.id), userbot])
    );
    const botById = new Map(
        (bots || []).map((bot) => [String(bot.id), bot])
    );
    const baseById = new Map(
        (bases || []).map((base) => [String(base.id), base])
    );
    const baseLinksByChannelId = new Map();
    for (const link of baseLinks || []) {
        const channelId = String(link.channel_id || '');
        const base = baseById.get(String(link.base_id || ''));
        if (!channelId || !base) continue;
        if (!baseLinksByChannelId.has(channelId)) baseLinksByChannelId.set(channelId, []);
        baseLinksByChannelId.get(channelId).push({
            id: base.id,
            name: base.name || `База ${String(base.id).slice(0, 8)}`
        });
    }

    return {
        sources: (sourceRows || []).map((row) => mapSourceRow(row, {
            channelByChatId,
            userbotById,
            botById,
            baseLinksByChannelId
        })),
        userbots: (userbots || []).map((userbot) => buildUserbotOption(userbot, reservedUserbotIds)),
        channels: channels || []
    };
}

function ensureSingleActiveContourUserbot(existingSources, nextUserbotId, ignoredSourceId = null) {
    const activeUserbotIds = new Set(
        (existingSources || [])
            .filter((source) => source.id !== ignoredSourceId)
            .filter((source) => source.is_active && source.role !== 'ignored')
            .map((source) => String(source.userbot_id))
    );

    if (!nextUserbotId || activeUserbotIds.size === 0) {
        return;
    }

    if (activeUserbotIds.size === 1 && activeUserbotIds.has(String(nextUserbotId))) {
        return;
    }

    throw new CustomerReconciliationError('В Milestone A contour должен жить на одном выбранном юзерботе. Сначала переведи текущие активные источники на тот же userbot или отключи их.', 409);
}

function buildPersistedSourcePayload(rawInput, existingSource = null) {
    const now = new Date().toISOString();
    const role = normalizeRole(rawInput.role, { allowMissing: !!existingSource }) || existingSource?.role || 'ignored';
    const title = normalizeOptionalText(rawInput.title_snapshot ?? rawInput.title) || existingSource?.title_snapshot || null;

    if (!title) {
        throw new CustomerReconciliationError('Для источника нужен title/title_snapshot.');
    }

    const userbotId = normalizeOptionalUuid(rawInput.userbot_id) || existingSource?.userbot_id || null;
    if (!userbotId) {
        throw new CustomerReconciliationError('Для источника нужен userbot_id.');
    }

    const chatId = rawInput.chat_id !== undefined
        ? normalizeChatId(rawInput.chat_id)
        : (existingSource ? String(existingSource.chat_id) : null);
    if (!chatId) {
        throw new CustomerReconciliationError('Для источника нужен chat_id.');
    }

    const chatType = normalizeChatType(rawInput.chat_type ?? rawInput.telegram_type ?? existingSource?.chat_type);
    const memberCountSnapshot = rawInput.member_count_snapshot !== undefined || rawInput.member_count !== undefined
        ? normalizeMemberCount(rawInput.member_count_snapshot ?? rawInput.member_count)
        : (existingSource?.member_count_snapshot ?? null);

    const visibilityStatus = normalizeStatusToken(
        rawInput.visibility_status ?? rawInput.visibility_snapshot?.status ?? existingSource?.visibility_snapshot?.status,
        ['visible_now', 'not_visible', 'unknown'],
        existingSource?.visibility_snapshot?.status || 'unknown'
    );
    const adminRightsStatus = normalizeStatusToken(
        rawInput.admin_rights_status ?? rawInput.admin_rights_snapshot?.status ?? existingSource?.admin_rights_snapshot?.status,
        ['admin', 'member', 'unknown'],
        existingSource?.admin_rights_snapshot?.status || 'unknown'
    );

    const adminVerified = normalizeBoolean(rawInput.admin_verified, existingSource?.admin_verified ?? false);
    const adminVerifiedAt = adminVerified
        ? (rawInput.admin_verified_at || existingSource?.admin_verified_at || now)
        : null;

    const persisted = {
        id: existingSource?.id || rawInput.id || undefined,
        owner_id: existingSource?.owner_id || rawInput.owner_id,
        userbot_id: userbotId,
        bot_id: normalizeOptionalUuid(rawInput.bot_id) ?? existingSource?.bot_id ?? null,
        chat_id: chatId,
        chat_type: chatType,
        title_snapshot: title,
        username_snapshot: normalizeOptionalText(rawInput.username_snapshot ?? rawInput.username) ?? existingSource?.username_snapshot ?? null,
        role,
        is_active: normalizeBoolean(rawInput.is_active, existingSource?.is_active ?? (role !== 'ignored')),
        scan_enabled: normalizeBoolean(rawInput.scan_enabled, existingSource?.scan_enabled ?? false),
        admin_verified: adminVerified,
        admin_verified_at: adminVerifiedAt,
        last_scan_at: existingSource?.last_scan_at || null,
        last_scan_status: existingSource?.last_scan_status || 'never',
        last_scan_error: existingSource?.last_scan_error || null,
        next_scan_after: existingSource?.next_scan_after || null,
        cooldown_until: existingSource?.cooldown_until || null,
        member_count_snapshot: memberCountSnapshot,
        admin_rights_snapshot: rawInput.admin_rights_snapshot && typeof rawInput.admin_rights_snapshot === 'object'
            ? rawInput.admin_rights_snapshot
            : buildSnapshot({
                status: adminRightsStatus,
                discoveredAt: now,
                source: rawInput.snapshot_source || 'manual_config',
                extra: memberCountSnapshot !== null ? { member_count: memberCountSnapshot } : {}
            }),
        visibility_snapshot: rawInput.visibility_snapshot && typeof rawInput.visibility_snapshot === 'object'
            ? rawInput.visibility_snapshot
            : buildSnapshot({
                status: visibilityStatus,
                discoveredAt: now,
                source: rawInput.snapshot_source || 'manual_config'
            }),
        scan_cursor: existingSource?.scan_cursor || {},
        last_scanned_member: existingSource?.last_scanned_member || null,
        updated_at: now
    };

    if (!existingSource) {
        persisted.created_at = now;
    }

    return persisted;
}

export async function listCustomerReconciliationContour(supabase, ownerId, selectedBotId = null) {
    const context = await loadContourContext(supabase, ownerId);
    const visibleUserbots = (context.userbots || []).filter((userbot) => userbot.visible_in_reconciliation !== false);

    const filteredSources = selectedBotId
        ? context.sources.filter((source) => String(source.bot_id) === String(selectedBotId))
        : context.sources;

    const activeUserbotIds = Array.from(new Set(
        filteredSources
            .filter((source) => source.is_active && source.role !== 'ignored')
            .map((source) => String(source.userbot_id))
    ));
    const visibleUserbotIds = new Set(visibleUserbots.map((userbot) => String(userbot.id)));

    let selectedUserbotId = null;
    if (selectedBotId) {
        const { data: contour } = await supabase
            .from('sales_bot_contours')
            .select('userbot_mode, selected_userbot_id, selected_userbot_ids')
            .eq('bot_id', selectedBotId)
            .eq('owner_id', ownerId)
            .maybeSingle();

        if (contour) {
            selectedUserbotId = contour.userbot_mode === 'single'
                ? contour.selected_userbot_id
                : (contour.selected_userbot_ids || [])[0] || null;
        }
    }

    if (!selectedUserbotId) {
        selectedUserbotId = activeUserbotIds.find((id) => visibleUserbotIds.has(String(id)))
            || visibleUserbots[0]?.id
            || null;
    }

    return {
        roles: RECONCILIATION_SOURCE_ROLES,
        scan_statuses: RECONCILIATION_SCAN_STATUSES,
        userbots: visibleUserbots,
        contour: {
            selected_userbot_id: selectedUserbotId,
            integrity: {
                active_userbot_ids: activeUserbotIds,
                single_active_userbot: activeUserbotIds.length <= 1
            },
            summary: {
                total_sources: filteredSources.length,
                active_sources: filteredSources.filter((source) => source.is_active).length,
                active_scannable_sources: filteredSources.filter((source) => source.is_active && source.scan_enabled && source.role !== 'ignored').length,
                verified_sources: filteredSources.filter((source) => source.admin_verified).length
            },
            sources: filteredSources
        }
    };
}

export async function discoverCustomerReconciliationSources(supabase, ownerId, userbotId) {
    const context = await loadContourContext(supabase, ownerId);
    const { userbot, userbots } = await loadReadyDiscoveryUserbot(supabase, ownerId, userbotId);
    const visibleUserbots = (userbots || []).filter((item) => item.visible_in_reconciliation !== false);
    const channelByChatId = new Map(
        (context.channels || []).map((channel) => [String(channel.tg_chat_id), channel])
    );
    const configuredSourceByChatId = new Map(
        context.sources
            .filter((source) => String(source.userbot_id) === String(userbot.id))
            .map((source) => [String(source.chat_id), source])
    );

    const proxyData = userbot.proxies
        ? {
            proxy_host: userbot.proxies.host,
            proxy_port: userbot.proxies.port,
            proxy_username: userbot.proxies.username,
            proxy_password: userbot.proxies.password
        }
        : undefined;

    const userbotService = new UserbotService(supabase, TELEGRAM_API_ID, TELEGRAM_API_HASH);
    const { token, fingerprint } = userbotService.parseSessionData(decrypt(userbot.session_data));
    const clientConfig = userbotService._getClientConfig(userbotService._buildProxy(proxyData), 1, fingerprint, proxyData);
    const client = new TelegramClient(new StringSession(token), fingerprint.api_id, fingerprint.api_hash, clientConfig);
    userbotService.prepareServiceClient(client);
    userbotService._forceManagedIpv6Dc(client, proxyData);
    await userbotService.connectWithProxyFallback(client, proxyData);

    try {
        const dialogs = await client.getDialogs({ limit: RECONCILIATION_DISCOVERY_LIMIT });
        const discovered = [];

        for (const dialog of dialogs) {
            if (!dialog?.isChannel && !dialog?.isGroup) {
                continue;
            }

            const chatId = String(dialog.id);
            const linkedChannel = channelByChatId.get(chatId) || null;
            const configuredSource = configuredSourceByChatId.get(chatId) || null;
            const entity = dialog?.entity || {};

            discovered.push({
                chat_id: chatId,
                title: String(dialog.title || entity.title || chatId).trim(),
                username: entity.username || null,
                telegram_type: resolveTelegramType(dialog),
                member_count: extractMemberCount(dialog),
                visibility_status: 'visible_now',
                admin_rights_status: resolveAdminRightsStatus(dialog),
                already_bound_channel_id: linkedChannel?.id || null,
                already_bound_bot_id: linkedChannel?.bot_id || null,
                already_bound_channel_title: linkedChannel?.title || null,
                is_configured: !!configuredSource,
                configured_source_id: configuredSource?.id || null,
                configured_role: configuredSource?.role || null,
                configured_is_active: configuredSource?.is_active ?? null
            });
        }

        discovered.sort((left, right) => {
            if (Number(right.is_configured) !== Number(left.is_configured)) {
                return Number(right.is_configured) - Number(left.is_configured);
            }
            if (Number(!!right.already_bound_channel_id) !== Number(!!left.already_bound_channel_id)) {
                return Number(!!right.already_bound_channel_id) - Number(!!left.already_bound_channel_id);
            }
            return String(left.title || '').localeCompare(String(right.title || ''), 'ru');
        });

        return {
            roles: RECONCILIATION_SOURCE_ROLES,
            selected_userbot_id: String(userbot.id),
            selected_userbot_username: userbot.tg_username || userbot.tg_account_id || null,
            userbots: visibleUserbots,
            discovered_sources: discovered
        };
    } finally {
        await client.disconnect().catch(() => {});
    }
}

export async function upsertCustomerReconciliationSources(supabase, ownerId, payload = {}) {
    const inputs = Array.isArray(payload.sources) ? payload.sources : [payload];
    const sanitizedInputs = inputs.filter((item) => item && typeof item === 'object');
    const applyUserbotId = normalizeOptionalUuid(payload.userbot_id);

    if (sanitizedInputs.length === 0 && !applyUserbotId) {
        throw new CustomerReconciliationError('Для сохранения contour нужен userbot_id, даже если ты временно очищаешь все источники.', 400);
    }

    const context = await loadContourContext(supabase, ownerId);
    const existingByKey = new Map(
        context.sources.map((source) => [`${source.userbot_id}:${String(source.chat_id)}`, source])
    );

    const readyUserbots = new Set(
        context.userbots
            .filter((userbot) => userbot.eligible_for_discovery)
            .map((userbot) => String(userbot.id))
    );

    const persistedPayloads = sanitizedInputs.map((item) => {
        const candidateUserbotId = normalizeOptionalUuid(item.userbot_id ?? applyUserbotId);
        if (!candidateUserbotId) {
            throw new CustomerReconciliationError('Для сохранения источников нужен userbot_id.', 400);
        }

        if (!readyUserbots.has(candidateUserbotId)) {
            throw new CustomerReconciliationError('Для contour можно сохранять только рабочий юзербот без shop-reserve, safe-mode и мертвого прокси.', 409);
        }

        const candidateChatId = normalizeChatId(item.chat_id);
        const existingSource = existingByKey.get(`${candidateUserbotId}:${candidateChatId}`) || null;
        const merged = buildPersistedSourcePayload({
            ...item,
            userbot_id: candidateUserbotId,
            bot_id: item.bot_id ?? normalizeOptionalUuid(payload.bot_id) ?? null
        }, existingSource);
        merged.owner_id = ownerId;
        return merged;
    });

    const incomingKeys = new Set(
        persistedPayloads.map((row) => `${row.userbot_id}:${String(row.chat_id)}`)
    );

    const simulatedSourceMap = new Map(
        context.sources.map((source) => [String(source.id), { ...source }])
    );

    for (const source of context.sources) {
        const sourceKey = `${source.userbot_id}:${String(source.chat_id)}`;
        if (incomingKeys.has(sourceKey)) continue;
        if (!source.is_active && source.role === 'ignored') continue;

        simulatedSourceMap.set(String(source.id), {
            ...source,
            role: 'ignored',
            is_active: false,
            scan_enabled: false,
            updated_at: new Date().toISOString()
        });
    }

    for (const payloadRow of persistedPayloads) {
        const key = String(payloadRow.id || `pending:${payloadRow.userbot_id}:${payloadRow.chat_id}`);
        simulatedSourceMap.set(key, {
            ...(simulatedSourceMap.get(key) || {}),
            ...payloadRow,
            id: payloadRow.id || key
        });
    }

    const finalActiveUserbotIds = Array.from(new Set(
        Array.from(simulatedSourceMap.values())
            .filter((source) => source.is_active && source.role !== 'ignored')
            .map((source) => String(source.userbot_id))
    ));

    if (finalActiveUserbotIds.length > 1) {
        throw new CustomerReconciliationError('В Milestone A contour должен жить на одном выбранном юзерботе. Сначала переведи все активные источники на один userbot или отключи лишние.', 409);
    }

    if (persistedPayloads.length > 0) {
        const { error } = await supabase
            .from('customer_reconciliation_sources')
            .upsert(persistedPayloads, { onConflict: 'owner_id,userbot_id,chat_id' });

        if (error) {
            if (error.code === '23505') {
                throw new CustomerReconciliationError('Такой источник уже есть в contour для этого userbot.', 409);
            }
            throw error;
        }
    }

    const omittedSourceIds = context.sources
        .filter((source) => {
            const sourceKey = `${source.userbot_id}:${String(source.chat_id)}`;
            return !incomingKeys.has(sourceKey) && (source.is_active || source.role !== 'ignored');
        })
        .map((source) => String(source.id));

    if (omittedSourceIds.length > 0) {
        const { error } = await supabase
            .from('customer_reconciliation_sources')
            .update({
                role: 'ignored',
                is_active: false,
                scan_enabled: false,
                updated_at: new Date().toISOString()
            })
            .in('id', omittedSourceIds)
            .eq('owner_id', ownerId);

        if (error) throw error;
    }

    return listCustomerReconciliationContour(supabase, ownerId, normalizeOptionalUuid(payload.bot_id));
}

export async function patchCustomerReconciliationSource(supabase, ownerId, sourceId, patch = {}) {
    const normalizedSourceId = String(sourceId || '').trim();
    if (!normalizedSourceId) {
        throw new CustomerReconciliationError('Не передан id источника.', 400);
    }

    const context = await loadContourContext(supabase, ownerId);
    const existingSource = context.sources.find((source) => String(source.id) === normalizedSourceId);

    if (!existingSource) {
        throw new CustomerReconciliationError('Источник contour не найден.', 404);
    }

    const nextUserbotId = normalizeOptionalUuid(patch.userbot_id) || existingSource.userbot_id;
    const targetUserbot = context.userbots.find((userbot) => String(userbot.id) === String(nextUserbotId));

    if (!targetUserbot) {
        throw new CustomerReconciliationError('Выбранный юзербот не найден.', 404);
    }

    if (!targetUserbot.eligible_for_discovery) {
        throw new CustomerReconciliationError('Нельзя перевесить contour на юзербот в safe-mode, с мертвым прокси или в shop-reserve.', 409);
    }

    const merged = buildPersistedSourcePayload({
        ...existingSource,
        ...patch,
        userbot_id: nextUserbotId
    }, existingSource);
    merged.owner_id = ownerId;

    if (merged.is_active && merged.role !== 'ignored') {
        ensureSingleActiveContourUserbot(context.sources, merged.userbot_id, existingSource.id);
    }

    const { error } = await supabase
        .from('customer_reconciliation_sources')
        .update(merged)
        .eq('id', normalizedSourceId)
        .eq('owner_id', ownerId);

    if (error) {
        if (error.code === '23505') {
            throw new CustomerReconciliationError('После обновления получился дубль источника на этом юзерботе.', 409);
        }
        throw error;
    }

    return listCustomerReconciliationContour(supabase, ownerId, existingSource.bot_id);
}

export async function scanCustomerReconciliationSource(supabase, ownerId, sourceId) {
    const normalizedSourceId = String(sourceId || '').trim();
    if (!normalizedSourceId) {
        throw new CustomerReconciliationError('Не передан id источника для scan.', 400);
    }

    const context = await loadContourContext(supabase, ownerId);
    const source = context.sources.find((item) => String(item.id) === normalizedSourceId);

    if (!source) {
        throw new CustomerReconciliationError('Источник contour не найден.', 404);
    }

    if (!source.is_active || source.role === 'ignored') {
        throw new CustomerReconciliationError('Этот источник выключен и сейчас не участвует в contour.', 409);
    }

    if (!source.scan_enabled) {
        throw new CustomerReconciliationError('Для этого источника scan отключен. Сначала включи scan в contour.', 409);
    }

    const now = Date.now();
    if (source.cooldown_until && new Date(source.cooldown_until).getTime() > now) {
        throw new CustomerReconciliationError('Источник сейчас в cooldown. Подожди и повтори scan позже.', 409);
    }

    await supabase
        .from('customer_reconciliation_sources')
        .update({
            last_scan_status: 'running',
            last_scan_error: null,
            updated_at: new Date().toISOString()
        })
        .eq('id', normalizedSourceId)
        .eq('owner_id', ownerId);

    const { userbot } = await loadReadyDiscoveryUserbot(supabase, ownerId, source.userbot_id);
    const proxyData = userbot.proxies
        ? {
            proxy_host: userbot.proxies.host,
            proxy_port: userbot.proxies.port,
            proxy_username: userbot.proxies.username,
            proxy_password: userbot.proxies.password
        }
        : undefined;

    const userbotService = new UserbotService(supabase, TELEGRAM_API_ID, TELEGRAM_API_HASH);
    const { token, fingerprint } = userbotService.parseSessionData(decrypt(userbot.session_data));
    const clientConfig = userbotService._getClientConfig(userbotService._buildProxy(proxyData), 1, fingerprint, proxyData);
    const client = new TelegramClient(new StringSession(token), fingerprint.api_id, fingerprint.api_hash, clientConfig);
    userbotService.prepareServiceClient(client);
    userbotService._forceManagedIpv6Dc(client, proxyData);
    await userbotService.connectWithProxyFallback(client, proxyData);

    try {
        const dialogs = await client.getDialogs({ limit: RECONCILIATION_DISCOVERY_LIMIT });
        const dialog = (dialogs || []).find((item) => String(item?.id) === String(source.chat_id));
        const scannedAt = new Date().toISOString();

        if (!dialog) {
            const cooldownUntil = new Date(Date.now() + 30 * 60 * 1000).toISOString();
            await supabase
                .from('customer_reconciliation_sources')
                .update({
                    last_scan_at: scannedAt,
                    last_scan_status: 'cooldown',
                    last_scan_error: 'Юзербот больше не видит этот источник в dialogs. Нужна перепроверка доступа или ручной resync.',
                    visibility_snapshot: buildSnapshot({
                        status: 'not_visible',
                        discoveredAt: scannedAt,
                        source: 'customers_manual_scan'
                    }),
                    next_scan_after: cooldownUntil,
                    cooldown_until: cooldownUntil,
                    updated_at: scannedAt
                })
                .eq('id', normalizedSourceId)
                .eq('owner_id', ownerId);

            return listCustomerReconciliationContour(supabase, ownerId, source.bot_id);
        }

        const entity = dialog?.entity || {};
        const memberCount = extractMemberCount(dialog);
        const adminRightsStatus = resolveAdminRightsStatus(dialog);
        const nextScanAfter = new Date(Date.now() + 60 * 60 * 1000).toISOString();

        await supabase
            .from('customer_reconciliation_sources')
            .update({
                title_snapshot: String(dialog.title || entity.title || source.title_snapshot || source.chat_id).trim(),
                username_snapshot: entity.username || source.username_snapshot || null,
                chat_type: resolveTelegramType(dialog),
                member_count_snapshot: memberCount,
                admin_verified: adminRightsStatus === 'admin',
                admin_verified_at: adminRightsStatus === 'admin' ? scannedAt : null,
                last_scan_at: scannedAt,
                last_scan_status: 'success',
                last_scan_error: null,
                visibility_snapshot: buildSnapshot({
                    status: 'visible_now',
                    discoveredAt: scannedAt,
                    source: 'customers_manual_scan'
                }),
                admin_rights_snapshot: buildSnapshot({
                    status: adminRightsStatus,
                    discoveredAt: scannedAt,
                    source: 'customers_manual_scan',
                    extra: memberCount !== null ? { member_count: memberCount } : {}
                }),
                next_scan_after: nextScanAfter,
                cooldown_until: null,
                updated_at: scannedAt
            })
            .eq('id', normalizedSourceId)
            .eq('owner_id', ownerId);

        return listCustomerReconciliationContour(supabase, ownerId, source.bot_id);
    } catch (error) {
        const scannedAt = new Date().toISOString();
        const cooldownUntil = new Date(Date.now() + 30 * 60 * 1000).toISOString();
        await supabase
            .from('customer_reconciliation_sources')
            .update({
                last_scan_at: scannedAt,
                last_scan_status: 'failed',
                last_scan_error: error.message || 'Scan failed',
                next_scan_after: cooldownUntil,
                cooldown_until: cooldownUntil,
                updated_at: scannedAt
            })
            .eq('id', normalizedSourceId)
            .eq('owner_id', ownerId);
        throw error;
    } finally {
        await client.disconnect().catch(() => {});
    }
}

export function isCustomerReconciliationError(error) {
    return error instanceof CustomerReconciliationError;
}
