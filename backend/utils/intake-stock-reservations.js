// Приёмочный сток владельца (отлёжка/магазин-сток): юзерботы, у которых
// restore-сорс пришёл из пачки приёмки (intake_batch_id). Зеркало выбора целей
// jobs/intake-resting.job.js — только читаемая часть, для MCP-фильтров
// (bullgram_userbot_list / bullgram_infra_summary), чтобы сток не выглядел
// «боевыми» ботами агента.
export async function loadIntakeStockUserbotIds(supabase, ownerId) {
    try {
        const { data, error } = await supabase
            .from('userbot_restore_sources')
            .select('account_id')
            .eq('owner_id', ownerId)
            .not('intake_batch_id', 'is', null);

        if (error) {
            const message = error.message || '';
            if (message.includes('userbot_restore_sources')) {
                return new Set();
            }
            throw error;
        }

        return new Set((data || []).map((row) => String(row.account_id)));
    } catch (error) {
        throw error;
    }
}
