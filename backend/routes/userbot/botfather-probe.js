// Проба BotFather по стоку юзерботов (зона 2a-разрезки userbot.routes.js).
// POST /botfather-probe: admin, body { account_ids?: [...] } — без списка
// проверяется весь сток. Скан фоном (минуты: коннект+сон на аккаунт),
// вердикты падают в tg_accounts.health_summary по мере готовности.
import { authenticateUser } from '../../middlewares/auth.middleware.js';
import { launchBotFatherProbeScan } from '../../services/botfather-probe.service.js';
import { logger } from '../../utils/logger.js';

export function registerBotfatherProbe(router, ctx) {
    const { supabase, userbotService } = ctx;

    router.post('/botfather-probe', authenticateUser, async (req, res) => {
        try {
            if (req.profile?.role !== 'admin') {
                return res.status(403).json({ error: 'Проба BotFather доступна только платформенному админу.' });
            }

            let accountIds = null;
            if (Array.isArray(req.body?.account_ids)) {
                accountIds = req.body.account_ids.map(String).filter(Boolean).slice(0, 100);
            }

            const started = launchBotFatherProbeScan({
                supabase,
                userbotService,
                ownerId: req.user.id,
                accountIds
            });
            if (!started) {
                return res.status(409).json({ error: 'Проба уже идёт — дождись её завершения.' });
            }
            res.status(202).json({ started: true });
        } catch (error) {
            logger.error({ err: error }, '[botfather-probe] Ошибка запуска');
            res.status(500).json({ error: 'Не удалось запустить пробу BotFather.' });
        }
    });
}
