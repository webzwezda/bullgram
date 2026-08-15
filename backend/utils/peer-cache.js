const PEER_CACHE_SOURCES = ['get_participants', 'dialogs'];

export function normalizePeerCacheEntry(entry = {}) {
    const accessHash = entry.access_hash != null ? String(entry.access_hash) : null;
    return {
        owner_id: entry.owner_id,
        userbot_id: entry.userbot_id,
        tg_user_id: String(entry.tg_user_id || '').trim(),
        access_hash: accessHash,
        username: entry.username ? String(entry.username) : null,
        source: PEER_CACHE_SOURCES.includes(entry.source) ? entry.source : 'get_participants'
    };
}

export async function upsertPeerCache(supabase, entry) {
    const normalized = normalizePeerCacheEntry(entry);
    if (!normalized.owner_id || !normalized.userbot_id || !normalized.tg_user_id) return;

    const { error } = await supabase
        .from('userbot_peer_cache')
        .upsert(normalized, {
            onConflict: 'userbot_id,tg_user_id'
        });

    if (error) {
        console.error('Ошибка upsert peer cache:', error.message);
    }
}

export async function upsertPeerCacheBatch(supabase, entries = []) {
    const rows = (entries || [])
        .map(normalizePeerCacheEntry)
        .filter(row => row.owner_id && row.userbot_id && row.tg_user_id);

    if (rows.length === 0) return;

    const { error } = await supabase
        .from('userbot_peer_cache')
        .upsert(rows, {
            onConflict: 'userbot_id,tg_user_id'
        });

    if (error) {
        console.error('Ошибка batch upsert peer cache:', error.message);
    }
}

export async function getPeerFromCache(supabase, userbotId, tgUserId) {
    const normalizedId = String(tgUserId || '').trim();
    if (!userbotId || !normalizedId) return null;

    const { data, error } = await supabase
        .from('userbot_peer_cache')
        .select('access_hash, username, seen_at')
        .eq('userbot_id', String(userbotId))
        .eq('tg_user_id', normalizedId)
        .maybeSingle();

    if (error) return null;
    return data || null;
}
