/**
 * Guest sessions для предложки. Хранятся в БД, переживают рестарт бэкенда.
 * TTL 1 час — на чтение лень: если created_at старее, возвращаем null.
 */

const SESSION_TTL_MS = 60 * 60 * 1000; // 1 час

function isExpired(row) {
    if (!row?.created_at) return true;
    return Date.now() - new Date(row.created_at).getTime() > SESSION_TTL_MS;
}

export async function setGuestSession(supabase, { botId, tgUserId, targetChannelId = null, targetChannelType = null }) {
    const { error } = await supabase
        .from('autopost_guest_sessions')
        .upsert({
            tg_user_id: tgUserId,
            bot_id: botId,
            target_channel_id: targetChannelId,
            target_channel_type: targetChannelType,
            created_at: new Date().toISOString()
        }, { onConflict: 'bot_id,tg_user_id' });

    if (error) throw error;
}

export async function getGuestSession(supabase, botId, tgUserId) {
    const { data, error } = await supabase
        .from('autopost_guest_sessions')
        .select('*')
        .eq('bot_id', botId)
        .eq('tg_user_id', tgUserId)
        .maybeSingle();

    if (error) {
        console.error('[Autopost] Ошибка чтения guest session:', error.message);
        return null;
    }

    if (!data) return null;
    if (isExpired(data)) {
        // Lazy cleanup
        await supabase
            .from('autopost_guest_sessions')
            .delete()
            .eq('bot_id', botId)
            .eq('tg_user_id', tgUserId);
        return null;
    }
    // Возвращаем в camelCase для совместимости с handlers
    return {
        botId: data.bot_id,
        tgUserId: data.tg_user_id,
        targetChannelId: data.target_channel_id,
        targetChannelType: data.target_channel_type,
        createdAt: data.created_at
    };
}

export async function deleteGuestSession(supabase, botId, tgUserId) {
    await supabase
        .from('autopost_guest_sessions')
        .delete()
        .eq('bot_id', botId)
        .eq('tg_user_id', tgUserId);
}

/**
 * Периодическая чистка устаревших сессий (вызывать из фоновой задачи).
 */
export async function pruneExpiredGuestSessions(supabase) {
    const cutoff = new Date(Date.now() - SESSION_TTL_MS).toISOString();
    const { error } = await supabase
        .from('autopost_guest_sessions')
        .delete()
        .lt('created_at', cutoff);

    if (error) console.error('[Autopost] Ошибка чистки guest sessions:', error.message);
}
