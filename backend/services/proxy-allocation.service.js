// JIT-выдача managed-прокси новому юзерботу (BACKLOG §32).
//
// Правило платформы «1 прокси = 1 юзербот»: свободный managed-слот — это
// строка proxies с username LIKE 'mp_%' и owner_id IS NULL (в inventory_group
// 'self_use' их резервируют под будущие аккаунты). Выдача — JIT при создании
// tg_accounts, НЕ при регистрации пользователя: GoTrue минует backend, точки
// создания аккаунтов — интерактивные пути владельца (routes/userbot/qr.js,
// routes/userbot/sessions.js).
//
// Атомарность: слот забирается условным update (owner_id IS NULL в where) —
// гонку с админом или параллельным подключением выигрывает ровно один вызов,
// проигравший получает race_lost и просто остаётся без прокси (non-fatal).
// Флаг USERBOT_AUTO_ALLOCATE_PROXY_ENABLED выключен по умолчанию — включать,
// когда в пуле есть свободные слоты; исчерпание (pool_empty) алертит админу
// через переданный alert (notifyPlatformAlert с дедупом 1ч).

export const PROXY_POOL_EXHAUSTED_ALERT_KEY = 'proxy_pool_exhausted';

export async function allocateManagedProxyForAccount(supabase, { ownerId, accountId, alert } = {}) {
    if (String(process.env.USERBOT_AUTO_ALLOCATE_PROXY_ENABLED || '').toLowerCase() !== 'true') {
        return { allocated: false, reason: 'disabled' };
    }
    if (!supabase || !ownerId || !accountId) {
        return { allocated: false, reason: 'invalid_args' };
    }

    // 1. Кандидат: самый младший свободный managed-слот (детерминированный выбор
    // — username mp_<seq> по возрастанию). Читаем только кандидата; сам claim — ниже.
    const { data: candidates, error: selectError } = await supabase
        .from('proxies')
        .select('id, username, host, port')
        .is('owner_id', null)
        .like('username', 'mp_%')
        .order('username', { ascending: true })
        .limit(1);
    if (selectError) throw selectError;

    const candidate = (candidates || [])[0] || null;
    if (!candidate) {
        if (typeof alert === 'function') {
            try {
                alert(PROXY_POOL_EXHAUSTED_ALERT_KEY);
            } catch {
                // Алерт не должен маскировать сам результат выдачи (pool_empty важнее).
            }
        }
        return { allocated: false, reason: 'pool_empty' };
    }

    // 2. Атомарный claim: условный update по-прежнему с owner_id IS NULL.
    // count=0 → слот забрали раньше нас (intake/админ/параллельный connect) —
    // не фатально, аккаунт просто живёт без managed-слота.
    const { count: claimed, error: claimError } = await supabase
        .from('proxies')
        .update({ owner_id: ownerId }, { count: 'exact' })
        .eq('id', candidate.id)
        .is('owner_id', null);
    if (claimError) throw claimError;
    if (!claimed) return { allocated: false, reason: 'race_lost' };

    // 3. Привязка слота к аккаунту (owner_id в where — изоляция арендаторов).
    const { count: linked, error: linkError } = await supabase
        .from('tg_accounts')
        .update({ proxy_id: candidate.id }, { count: 'exact' })
        .eq('id', accountId)
        .eq('owner_id', ownerId);
    if (linkError || !linked) {
        // Слот нельзя оставлять занятым «висяким» клеймом без аккаунта —
        // возвращаем его в пул (best effort, ошибки логирует route-хук).
        try {
            await supabase
                .from('proxies')
                .update({ owner_id: null })
                .eq('id', candidate.id)
                .eq('owner_id', ownerId);
        } catch {
            // no-op: best-effort release, наверх всё равно уйдёт link_failed.
        }
        return {
            allocated: false,
            reason: linkError ? 'link_failed' : 'account_not_found',
            error: linkError?.message || null
        };
    }

    return { allocated: true, proxy: { id: candidate.id, username: candidate.username, host: candidate.host, port: candidate.port } };
}
