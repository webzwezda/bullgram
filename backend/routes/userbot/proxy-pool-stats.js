// Статистика платформенного пула managed-прокси (BACKLOG §32).
// Пул = все строки proxies с username mp_* (источник правды reconcile'а).
// «Используется» = слот привязан к юзерботу (tg_accounts.proxy_id);
// «свободно» = owner_id IS NULL (доступно автоматической выдаче);
// «резерв» = занят владельцем, но ещё не привязан (осиротевшие).
// Только платформенный админ: числа видны изнутри платформы.
import { authenticateUser } from '../../middlewares/auth.middleware.js';

export function registerProxyPoolStats(router, ctx) {
    const { supabase } = ctx;

    router.get('/proxy-pool/stats', authenticateUser, async (req, res) => {
        if (req.profile?.role !== 'admin') {
            return res.status(403).json({ error: 'Статистика пула доступна только платформенному админу.' });
        }

        const { data: poolRows, error: poolError } = await supabase
            .from('proxies')
            .select('id, owner_id')
            .like('username', 'mp_%');
        if (poolError) throw poolError;

        const { data: boundRows, error: boundError } = await supabase
            .from('tg_accounts')
            .select('proxy_id')
            .not('proxy_id', 'is', null);
        if (boundError) throw boundError;

        const poolIds = new Set((poolRows || []).map((row) => String(row.id)));
        const usedIds = new Set((boundRows || [])
            .map((row) => String(row.proxy_id))
            .filter((id) => poolIds.has(id)));

        const total = (poolRows || []).length;
        const used = usedIds.size;
        const free = (poolRows || []).filter((row) => row.owner_id == null).length;
        return res.json({ total, used, free, reserved: Math.max(total - used - free, 0) });
    });
}
