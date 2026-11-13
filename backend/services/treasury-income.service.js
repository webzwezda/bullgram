// Лента «Последние поступления» для казны проекта (вынесено из
// project-admin.routes.js — тот файл впритык к лимиту pre-commit 20КБ).
// Те же таблицы, что у агрегатов дохода, но построчно: чтобы было видно
// «деньги пришли» без сверки с блокчейном.

// «Таблицы нет» — единственная ошибка выборки, которую можно деградировать
// пустой лентой (42P01 / 'does not exist'). Остальное пробрасывается:
// экран денег fail-closed, лента не рисует «пока пусто» по частичным данным.
function isUndefinedTableError(error) {
    if (!error) return false;
    if (error.code === '42P01') return true;
    return String(error.message || '').includes('does not exist');
}

function nanoToTon(value) {
    return Number(value) / 1e9;
}

function roundTon(value) {
    return Math.round(Number(value) * 10000) / 10000;
}

// Доход тарифов: только mainnet-платежи. TIER_REVENUE_SINCE (ISO) отсекает
// тестнет-фантомы phase 1 — тот же cutoff, что у агрегата loadTierRevenue.
function tierRevenueCutoffMs() {
    const raw = String(process.env.TIER_REVENUE_SINCE || '').trim();
    if (!raw) return 0;
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : 0;
}

export async function loadRecentIncome(supabase, adminOwnerIds) {
    const [shopResult, tierResult] = await Promise.all([
        adminOwnerIds.length
            ? supabase
                .from('shop_purchases')
                .select('amount_ton, payload, delivered_at, created_at, shop_items(title, item_type)')
                .in('seller_owner_id', adminOwnerIds)
                .eq('status', 'paid')
                .order('created_at', { ascending: false })
                .limit(20)
            : Promise.resolve({ data: [], error: null }),
        supabase
            .from('billing_orders')
            .select('payload, paid_at')
            .eq('status', 'paid')
            .order('paid_at', { ascending: false })
            .limit(10)
    ]);

    if (shopResult.error && !isUndefinedTableError(shopResult.error)) throw shopResult.error;
    if (tierResult.error && !isUndefinedTableError(tierResult.error)) throw tierResult.error;

    const cutoffMs = tierRevenueCutoffMs();
    const shopRows = shopResult.data || [];
    const tierRows = (tierResult.data || []).filter((row) => {
        if (!cutoffMs || !row.paid_at) return true;
        return Date.parse(row.paid_at) >= cutoffMs;
    });

    return [
        ...shopRows.map((row) => ({
            source: 'shop',
            title: row.shop_items?.title || 'Покупка в магазине',
            amount_ton: roundTon(Number(row.amount_ton || 0)),
            memo: row.payload?.memo || null,
            when: row.delivered_at || row.created_at
        })),
        ...tierRows.map((row) => ({
            source: 'tier',
            title: 'Тариф Pro',
            amount_ton: roundTon(nanoToTon(Number(row.payload?.expected_nanoton || 0))),
            memo: row.payload?.memo || null,
            when: row.paid_at
        }))
    ]
        .filter((row) => row.amount_ton > 0 && row.when)
        .sort((a, b) => new Date(b.when) - new Date(a.when))
        .slice(0, 6);
}
