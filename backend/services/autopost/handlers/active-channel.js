/**
 * Активный канал админа автопостера: active_modes[tgUserId] с fallback
 * на первый подключенный канал (channels[0]).
 */
export async function resolveActiveChannel(supabase, botId, botData, tgUserId) {
    const { data: channels } = await supabase
        .from('channels')
        .select('*')
        .eq('autopost_bot_id', botId);
    if (!channels || channels.length === 0) return null;
    const activeModes = botData?.active_modes || {};
    const activeId = activeModes[String(tgUserId)];
    const active = channels.find(c => String(c.tg_chat_id) === String(activeId));
    return active || channels[0];
}
