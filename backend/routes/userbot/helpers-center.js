// Хелперы «Центра юзерботов»: редактируемый профиль Telegram, сборка карточек
// аккаунтов/сигналов/сводки, source кика пачкой, fingerprint-пейлоады,
// чтение и полная замена кэша групп/диалогов центра.
// Вынесено дословно из userbot.routes.js на стадии 1 разрезки (2026-11-06).
import { newestTimestamp } from './helpers-core.js';

function normalizeEditableTelegramProfile(raw = {}) {
    const firstName = String(raw.first_name ?? raw.firstName ?? '').trim();
    const lastName = String(raw.last_name ?? raw.lastName ?? '').trim();
    const about = String(raw.about ?? '').trim();

    if (!firstName) {
        throw new Error('Имя Telegram-аккаунта не может быть пустым.');
    }
    if (firstName.length > 64) {
        throw new Error('Имя слишком длинное. Telegram обычно принимает до 64 символов.');
    }
    if (lastName.length > 64) {
        throw new Error('Фамилия слишком длинная. Telegram обычно принимает до 64 символов.');
    }
    if (about.length > 70) {
        throw new Error('Описание слишком длинное. Telegram bio обычно принимает до 70 символов.');
    }

    return {
        firstName,
        lastName,
        about
    };
}

function buildUserbotCenterAccount(item, runtimeState = null) {
    return {
        id: item.id,
        tg_username: item.tg_username || null,
        tg_account_id: item.tg_account_id || null,
        tg_first_name: item.tg_first_name || null,
        tg_last_name: item.tg_last_name || null,
        tg_phone: item.tg_phone || null,
        tg_about: item.tg_about || null,
        tg_photo_url: item.tg_photo_url || null,
        tg_photo_synced_at: item.tg_photo_synced_at || null,
        tg_photo_data_url: item.tg_photo_data_url || null,
        tg_profile_synced_at: item.tg_profile_synced_at || null,
        tg_profile_sync_attempted_at: item.tg_profile_sync_attempted_at || null,
        tg_profile_sync_error: item.tg_profile_sync_error || null,
        proxy_id: item.proxy_id || null,
        proxy_name: item.proxies?.name || null,
        proxy_country: item.proxies?.last_check_country || null,
        proxy_is_working: item.proxies?.is_working ?? null,
        runtime_status: runtimeState?.status || item.runtime_status || null,
        runtime_reason: runtimeState?.reason || item.runtime_error || null
    };
}

function buildUserbotCenterSignalConfig(paymentSettings, officialBots = []) {
    const opsBot = (officialBots || []).find(item => (item.bot_role || 'sales') === 'ops') || null;
    return {
        admin_tg_id: paymentSettings?.admin_tg_id ? String(paymentSettings.admin_tg_id) : '',
        has_admin_tg_id: !!paymentSettings?.admin_tg_id,
        ops_bot_count: (officialBots || []).filter(item => (item.bot_role || 'sales') === 'ops').length,
        sales_bot_count: (officialBots || []).filter(item => (item.bot_role || 'sales') !== 'ops').length,
        ops_bot: opsBot
            ? {
                id: opsBot.id,
                tg_username: opsBot.tg_username || null,
                tg_account_id: opsBot.tg_account_id || null
            }
            : null,
        ready: !!paymentSettings?.admin_tg_id && !!opsBot
    };
}

function buildUserbotCenterSummary(groups = [], conversations = []) {
    return {
        groups_total: groups.length,
        groups_admin: groups.filter(group => group.userbot_admin).length,
        linked_groups: groups.filter(group => group.linked_channel_id).length,
        open_dialogs: conversations.length,
        unread_dialogs: conversations.filter(item => item.unread_count > 0).length,
        sales_signals: conversations.filter(item => item.sales_signal).length,
        signaled_dialogs: conversations.filter(item => item.signal_notified_at).length
    };
}

function resolveBatchKickCallSource(...rawValues) {
    const normalized = rawValues
        .map((value) => String(value || '').trim().toLowerCase())
        .find(Boolean) || '';

    if (['customers', 'customer', 'customers_workbench', 'customer_workbench'].includes(normalized)) {
        return {
            requestSource: 'customers',
            payloadSource: 'customers',
            eventSource: 'customers_manual_admin_removed',
            accessNote: 'Удален админом вручную из Customers',
            removalKind: 'manual_admin_removed',
            shouldExpireSubscription: true
        };
    }

    return {
        requestSource: normalized || 'legacy',
        payloadSource: normalized || 'access_screen',
        eventSource: 'manual_batch',
        accessNote: 'Кикнули пачкой из админки',
        removalKind: null,
        shouldExpireSubscription: false
    };
}

function normalizeFingerprintPayload(raw = {}) {
    const input = raw && typeof raw === 'object' ? raw : {};
    return {
        label: String(input.label || '').trim(),
        note: String(input.note || '').trim(),
        api_id: Number(input.api_id || 0),
        api_hash: String(input.api_hash || '').trim(),
        device_model: String(input.device_model || input.deviceModel || '').trim(),
        system_version: String(input.system_version || input.systemVersion || '').trim(),
        app_version: String(input.app_version || input.appVersion || '').trim(),
        system_lang_code: String(input.system_lang_code || input.systemLangCode || '').trim(),
        lang_code: String(input.lang_code || input.langCode || '').trim()
    };
}

function validateCustomFingerprintPayload(fingerprint = {}) {
    if (!fingerprint.label) {
        throw new Error('Назови свой fingerprint-пресет, чтобы потом не гадать, что это за профиль.');
    }
    if (!Number.isInteger(fingerprint.api_id) || fingerprint.api_id <= 0) {
        throw new Error('Для своего fingerprint укажи нормальный api_id.');
    }
    if (!fingerprint.api_hash) {
        throw new Error('Для своего fingerprint укажи api_hash.');
    }
    if (!fingerprint.device_model) {
        throw new Error('Для своего fingerprint укажи модель устройства.');
    }
    if (!fingerprint.system_version) {
        throw new Error('Для своего fingerprint укажи версию системы.');
    }
    if (!fingerprint.app_version) {
        throw new Error('Для своего fingerprint укажи версию Telegram app.');
    }
    if (!fingerprint.system_lang_code) {
        throw new Error('Для своего fingerprint укажи system_lang_code.');
    }
    if (!fingerprint.lang_code) {
        throw new Error('Для своего fingerprint укажи lang_code.');
    }
}

async function loadUserbotCenterCache(supabase, ownerId, userbotId) {
    const [{ data: groupRows, error: groupError }, { data: conversationRows, error: conversationError }] = await Promise.all([
        supabase
            .from('userbot_center_group_cache')
            .select('*')
            .eq('owner_id', ownerId)
            .eq('userbot_id', userbotId)
            .order('userbot_admin', { ascending: false })
            .order('unread_count', { ascending: false })
            .order('last_message_at', { ascending: false, nullsFirst: false }),
        supabase
            .from('userbot_center_conversation_cache')
            .select('*')
            .eq('owner_id', ownerId)
            .eq('userbot_id', userbotId)
            .order('sales_signal', { ascending: false })
            .order('unread_count', { ascending: false })
            .order('last_message_at', { ascending: false, nullsFirst: false })
    ]);

    if (groupError) throw groupError;
    if (conversationError) throw conversationError;

    const groups = (groupRows || []).map(row => ({
        chat_id: String(row.chat_id),
        title: row.title || null,
        type: row.chat_type || 'group',
        unread_count: Number(row.unread_count || 0),
        last_message_preview: row.last_message_preview || null,
        last_message_at: row.last_message_at || null,
        userbot_admin: !!row.userbot_admin,
        admin_check_skipped: !!row.admin_check_skipped,
        linked_channel_id: row.linked_channel_id || null,
        linked_channel_title: row.linked_channel_title || null,
        admin_error: row.admin_error || null,
        scanned_at: row.scanned_at || null
    }));

    const conversations = (conversationRows || []).map(row => ({
        tg_user_id: String(row.tg_user_id),
        username: row.username || null,
        display_name: row.display_name || row.username || `ID ${row.tg_user_id}`,
        unread_count: Number(row.unread_count || 0),
        last_message_preview: row.last_message_preview || null,
        last_message_at: row.last_message_at || null,
        last_outgoing: !!row.last_outgoing,
        sales_signal: !!row.sales_signal,
        signal_notified_at: row.signal_notified_at || null,
        signal_last_message_id: row.signal_last_message_id || null,
        scanned_at: row.scanned_at || null
    }));

    return {
        groups,
        conversations,
        scanned_at: newestTimestamp(
            ...groups.map(item => item.scanned_at),
            ...conversations.map(item => item.scanned_at)
        )
    };
}

async function replaceUserbotCenterCache(supabase, ownerId, userbotId, groups = [], conversations = [], scannedAt) {
    const normalizedScannedAt = scannedAt || new Date().toISOString();

    const { error: deleteGroupsError } = await supabase
        .from('userbot_center_group_cache')
        .delete()
        .eq('owner_id', ownerId)
        .eq('userbot_id', userbotId);
    if (deleteGroupsError) throw deleteGroupsError;

    const { error: deleteConversationsError } = await supabase
        .from('userbot_center_conversation_cache')
        .delete()
        .eq('owner_id', ownerId)
        .eq('userbot_id', userbotId);
    if (deleteConversationsError) throw deleteConversationsError;

    if (groups.length > 0) {
        const { error: insertGroupsError } = await supabase
            .from('userbot_center_group_cache')
            .insert(groups.map(group => ({
                owner_id: ownerId,
                userbot_id: userbotId,
                chat_id: String(group.chat_id),
                title: group.title || null,
                chat_type: group.type || 'group',
                unread_count: Number(group.unread_count || 0),
                last_message_preview: group.last_message_preview || null,
                last_message_at: group.last_message_at || null,
                userbot_admin: !!group.userbot_admin,
                admin_check_skipped: !!group.admin_check_skipped,
                linked_channel_id: group.linked_channel_id || null,
                linked_channel_title: group.linked_channel_title || null,
                admin_error: group.admin_error || null,
                scanned_at: normalizedScannedAt,
                updated_at: normalizedScannedAt
            })));
        if (insertGroupsError) throw insertGroupsError;
    }

    if (conversations.length > 0) {
        const { error: insertConversationsError } = await supabase
            .from('userbot_center_conversation_cache')
            .insert(conversations.map(conversation => ({
                owner_id: ownerId,
                userbot_id: userbotId,
                tg_user_id: String(conversation.tg_user_id),
                username: conversation.username || null,
                display_name: conversation.display_name || null,
                unread_count: Number(conversation.unread_count || 0),
                last_message_preview: conversation.last_message_preview || null,
                last_message_at: conversation.last_message_at || null,
                last_outgoing: !!conversation.last_outgoing,
                sales_signal: !!conversation.sales_signal,
                signal_notified_at: conversation.signal_notified_at || null,
                signal_last_message_id: conversation.signal_last_message_id || null,
                scanned_at: normalizedScannedAt,
                updated_at: normalizedScannedAt
            })));
        if (insertConversationsError) throw insertConversationsError;
    }
}

export {
    normalizeEditableTelegramProfile,
    buildUserbotCenterAccount,
    buildUserbotCenterSignalConfig,
    buildUserbotCenterSummary,
    resolveBatchKickCallSource,
    normalizeFingerprintPayload,
    validateCustomFingerprintPayload,
    loadUserbotCenterCache,
    replaceUserbotCenterCache
};
