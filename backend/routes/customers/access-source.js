// Чистые хелперы customers (вынесены из customers.routes.js дословно).

export function latestBy(list = [], keyFn, dateField = 'created_at') {
    const map = new Map();

    for (const item of list) {
        const key = keyFn(item);
        if (!key) continue;

        const prev = map.get(key);
        const itemDate = new Date(item?.[dateField] || item?.issued_at || 0).getTime();
        const prevDate = new Date(prev?.[dateField] || prev?.issued_at || 0).getTime();

        if (!prev || itemDate >= prevDate) {
            map.set(key, item);
        }
    }

    return map;
}

export function emptyListResult() {
    return Promise.resolve({ data: [], error: null });
}

// «Таблицы нет» — единственная ошибка выборки, которую можно проглотить (код 42P01,
// фолбэк для старых PostgREST-ответов — текст 'does not exist'). Остальное падает.
export function isUndefinedTableError(error) {
    if (!error) return false;
    if (error.code === '42P01') return true;
    return String(error.message || '').includes('does not exist');
}

// Аддитивные капы для фронта: честно сообщает, где сработал лимит выборки.
// count берется из count:'exact' на том же запросе; если count не пришел —
// truncated:false, total:null.
export function buildLimitCap(resp, limit) {
    const total = typeof resp?.count === 'number' ? resp.count : null;
    const rows = Array.isArray(resp?.data) ? resp.data.length : 0;

    return {
        limit,
        total,
        truncated: total === null ? false : total > rows
    };
}

export function buildPersonDisplayName(profile = {}) {
    const fullName = [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim();
    if (fullName) return fullName;
    if (profile.display_name) return String(profile.display_name).trim();
    return null;
}

export function buildFunnelPersonProfile(event = {}) {
    const payload = event?.payload && typeof event.payload === 'object' ? event.payload : {};
    const first_name = payload.first_name || null;
    const last_name = payload.last_name || null;
    const display_name = payload.display_name || null;
    const username = payload.username || null;

    return {
        first_name,
        last_name,
        display_name: buildPersonDisplayName({ first_name, last_name, display_name }),
        username
    };
}

export function normalizeUuidLike(value) {
    const raw = String(value || '').trim();
    return raw || null;
}

export function detectAccessSource(eventSource = null, payload = {}, accessNote = '') {
    const source = String(eventSource || '').trim().toLowerCase();
    const note = String(accessNote || '').toLowerCase();
    const eventPayload = payload && typeof payload === 'object' ? payload : {};
    const payloadSource = String(eventPayload.source || '').trim().toLowerCase();

    if (
        source === 'customers_manual_admin_removed'
        || source === 'customers_manual_action'
        || eventPayload.removal_kind === 'manual_admin_removed'
        || (source === 'manual_batch' && payloadSource === 'customers')
        || note.includes('удален админом вручную из customers')
    ) {
        return { key: 'manual_admin_removed', label: 'Удален админом вручную' };
    }

    if (
        source === 'customers_direct_access'
        || eventPayload.issued_via === 'customers_direct_access'
        || note.includes('доступ выдан вручную из customers')
    ) {
        return { key: 'customers_direct_access', label: 'Выдан вручную из Customers' };
    }

    if (source === 'gift_code' || source === 'admin_gift' || eventPayload.gift_code_id || eventPayload.gift_code || note.includes('подарочному коду')) {
        return { key: 'gift_code', label: 'Подарочный код' };
    }

    if (source === 'official_bot' || source === 'manual_ton' || source === 'manual_rub' || note.includes('join request')) {
        return { key: 'payment', label: 'Оплата' };
    }

    return { key: 'unknown', label: null };
}

export function isManualAdminRemoval(eventSource = null, payload = {}, accessNote = '') {
    return detectAccessSource(eventSource, payload, accessNote).key === 'manual_admin_removed';
}
