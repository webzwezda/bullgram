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
//
// Два пути выдачи одним и тем же claim-механизмом:
//  - allocateManagedProxyForAccount — пост-фактум для аккаунта, который уже
//    встал без прокси (апгрейд старых подключений);
//  - claimFreeManagedSlot — превентивный claim ДО подключения к Telegram
//    (qr-start / import-session-file без proxy_id): без него свежий пользователь
//    застревал на 400 «выбери прокси». Если подключение после claim провалилось,
//    releaseFreeManagedSlot возвращает слот в пул (только если слот всё ещё наш).

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

// Столбцы слота, которых хватает роутам собрать proxyData той же формы, что и
// для переданного пользователем прокси (зеркало loadOwnedProxy-ветки).
const FREE_SLOT_COLUMNS = 'id, host, port, username, password, provision_source, inventory_group, is_working, last_check_ip, last_check_country, last_check_city';

// Превентивный claim свободного managed-слота ДО подключения к Telegram
// (qr-start / import-session-file без proxy_id). Причины отказа:
//  - 'flag_off'   — USERBOT_AUTO_ALLOCATE_PROXY_ENABLED не 'true' (роут в этой
//    ветке обязан вести себя ровно как до появления JIT-выдачи — 400);
//  - 'disabled'   — вызов без supabase/ownerId (ошибка программирования);
//  - 'pool_empty' — свободных mp_* слотов нет; если передан alert, зовём его
//    (non-fatal), роут покажет пользователю сообщение про пустой пул;
//  - 'race_lost'  — условный claim-апдейт не забрал ни строки (слот забрали
//    параллельным подключением/админом между select и update).
export async function claimFreeManagedSlot(supabase, ownerId, { alert } = {}) {
    if (String(process.env.USERBOT_AUTO_ALLOCATE_PROXY_ENABLED || '').toLowerCase() !== 'true') {
        return { claimed: false, reason: 'flag_off' };
    }
    if (!supabase || !ownerId) {
        return { claimed: false, reason: 'disabled' };
    }

    // Консервация пула: выдача «один слот на руки». Если у владельца уже есть
    // наш платформенный mp_* слот, не привязанный ни к одному его аккаунту
    // (осиротевший после прошлых подключений), переиспользуем ЕГО — новый из
    // пула не берём. Иначе реконнекты без своего прокси накапливали слоты.
    const { data: ownSlots, error: ownError } = await supabase
        .from('proxies')
        .select(FREE_SLOT_COLUMNS)
        .eq('owner_id', ownerId)
        .like('username', 'mp_%')
        .order('username', { ascending: true });
    if (ownError) throw ownError;
    if (ownSlots?.length) {
        const { data: boundRows, error: boundError } = await supabase
            .from('tg_accounts')
            .select('proxy_id')
            .eq('owner_id', ownerId)
            .not('proxy_id', 'is', null);
        if (boundError) throw boundError;
        const boundIds = new Set((boundRows || []).map(row => String(row.proxy_id)));
        const orphan = ownSlots.find(slot => !boundIds.has(String(slot.id)));
        if (orphan) {
            return { claimed: true, slot: orphan, reused: true };
        }
    }

    // Кандидат: младший свободный mp_* слот (детерминированный выбор), читаем
    // только его; сам claim — условный update ниже, как в allocateManagedProxyForAccount.
    const { data: candidates, error: selectError } = await supabase
        .from('proxies')
        .select(FREE_SLOT_COLUMNS)
        .is('owner_id', null)
        .like('username', 'mp_%')
        .order('username', { ascending: true })
        .limit(1);
    if (selectError) throw selectError;

    const slot = (candidates || [])[0] || null;
    if (!slot) {
        if (typeof alert === 'function') {
            try {
                alert(PROXY_POOL_EXHAUSTED_ALERT_KEY);
            } catch {
                // Алерт не должен маскировать сам результат claim (pool_empty важнее).
            }
        }
        return { claimed: false, reason: 'pool_empty' };
    }

    const { count: claimed, error: claimError } = await supabase
        .from('proxies')
        .update({ owner_id: ownerId }, { count: 'exact' })
        .eq('id', slot.id)
        .is('owner_id', null);
    if (claimError) throw claimError;
    if (!claimed) return { claimed: false, reason: 'race_lost' };

    return { claimed: true, slot };
}

// Возврат заклеймленного слота в пул при провале подключения после claim
// (подключение не удалось / аккаунт не создался). owner_id в where гарантирует,
// что мы отпускаем только СВОЙ слот: если его успел перезабрать кто-то другой
// или он уже привязан другому владельцу — released: false, чужое не трогаем.
export async function releaseFreeManagedSlot(supabase, ownerId, slotId) {
    if (!supabase || !ownerId || !slotId) {
        return { released: false, reason: 'invalid_args' };
    }
    const { count, error } = await supabase
        .from('proxies')
        .update({ owner_id: null }, { count: 'exact' })
        .eq('id', slotId)
        .eq('owner_id', ownerId);
    if (error) {
        return { released: false, reason: 'release_failed', error: error.message || null };
    }
    return { released: count > 0 };
}

// proxyData из заклеймленного слота — поле в поле как в ветке loadOwnedProxy
// роутов (qr.js/sessions.js), включая формулу force_ipv6: для свежего слота
// is_working=true и last_check_ip=null → force_ipv6=true (managed-слоты IPv6-only).
export function buildProxyDataFromManagedSlot(slot) {
    if (!slot || typeof slot !== 'object') return null;
    return {
        proxy_host: slot.host,
        proxy_port: slot.port,
        proxy_username: slot.username,
        proxy_password: slot.password,
        proxy_id: slot.id,
        is_working: slot.is_working,
        last_check_ip: slot.last_check_ip,
        last_check_country: slot.last_check_country,
        last_check_city: slot.last_check_city,
        force_ipv6: slot.is_working === true && (!slot.last_check_ip || slot.last_check_ip.includes(':')),
        provision_source: slot.provision_source,
        inventory_group: slot.inventory_group
    };
}
