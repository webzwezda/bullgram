// Роуты messaging router: /api/messaging.
// Оценка ёмкости пула для UI и точечная ЛС с идемпотентностью.
// Бизнес-логика — в messaging-router.service.js; здесь только валидация и owner-скоуп.
import express from 'express';
import { authenticateUser } from '../middlewares/auth.middleware.js';
import { loadReservedUserbotIds } from '../utils/shop-reservations.js';
import {
    MessagingRouter,
    estimateCapacity,
    isActorEligible,
    resolveMessagingCaps
} from '../services/messaging-router.service.js';

function isUserbotDmEnabled() {
    return String(process.env.USERBOT_DM_ENABLED || '').trim().toLowerCase() === 'true';
}

export default function messagingRoutes(supabase) {
    const router = express.Router();
    const messagingRouter = new MessagingRouter({ supabase });

    // Оценка «хватит ли пула юзерботов» для базы N контактов (шаг «Юзерботы» в рассылке).
    router.get('/capacity', authenticateUser, async (req, res) => {
        try {
            const ownerId = req.user.id;
            const audienceSize = Math.max(0, Math.trunc(Number(req.query.audience_size) || 0));
            const caps = resolveMessagingCaps();

            const [reservedIds, accountsResponse] = await Promise.all([
                loadReservedUserbotIds(supabase, ownerId),
                supabase
                    .from('tg_accounts')
                    .select('id, runtime_status, proxy_id, dm_paused_until, proxies(is_working)')
                    .eq('owner_id', ownerId)
                    .eq('account_type', 'userbot')
            ]);
            if (accountsResponse.error) throw accountsResponse.error;

            const pool = (accountsResponse.data || []).filter((account) =>
                !reservedIds.has(String(account.id)) && isActorEligible(account)
            );

            res.json({
                ...estimateCapacity({ audienceSize, poolSize: pool.length, dailyCap: caps.dailyCap }),
                hourlyCap: caps.hourlyCap
            });
        } catch (error) {
            console.error('[messaging] Ошибка оценки ёмкости:', error?.message || error);
            res.status(500).json({ error: 'Внутренняя ошибка сервера' });
        }
    });

    // Точечная ЛС через юзербота: тот же ручной гейт, что у /api/userbot/send-message,
    // плюс идемпотентность по idempotency_key (повтор запроса возвращает сохранённый исход).
    router.post('/send', authenticateUser, async (req, res) => {
        if (!isUserbotDmEnabled()) {
            return res.status(403).json({
                error: 'Ручная отправка в ЛС через юзербота сейчас отключена в конфиге.'
            });
        }

        const { tg_user_id, text, userbot_id, common_chat_id, idempotency_key } = req.body || {};
        if (!/^\d+$/.test(String(tg_user_id || '').trim())) {
            return res.status(400).json({ error: 'TG ID должен быть числовым.' });
        }
        const messageText = String(text ?? '').trim();
        if (!messageText) return res.status(400).json({ error: 'Не указан текст сообщения.' });
        if (messageText.length > 4096) {
            return res.status(400).json({ error: 'Сообщение слишком длинное. Оставь до 4096 символов.' });
        }
        if (!String(userbot_id || '').trim()) {
            return res.status(400).json({ error: 'Не указан юзербот.' });
        }

        try {
            const ownerId = req.user.id;

            const idempotencyKey = String(idempotency_key || '').trim() || null;
            if (idempotencyKey) {
                const { data: existing, error: existingError } = await supabase
                    .from('userbot_send_log')
                    .select('actor_id, status, error_kind')
                    .eq('owner_id', ownerId)
                    .eq('idempotency_key', idempotencyKey)
                    .maybeSingle();
                if (existingError) throw existingError;
                if (existing) {
                    return res.json({
                        idempotent: true,
                        status: existing.status,
                        actor_id: existing.actor_id,
                        error_kind: existing.error_kind || null,
                        error: null
                    });
                }
            }

            const [reservedIds, userbotResponse] = await Promise.all([
                loadReservedUserbotIds(supabase, ownerId),
                supabase
                    .from('tg_accounts')
                    .select('id, owner_id, account_type, runtime_status, proxy_id, dm_paused_until, proxies(is_working)')
                    .eq('id', String(userbot_id).trim())
                    .eq('owner_id', ownerId)
                    .eq('account_type', 'userbot')
                    .maybeSingle()
            ]);
            if (userbotResponse.error) throw userbotResponse.error;
            if (!userbotResponse.data) {
                return res.status(404).json({ error: 'Юзербот не найден.' });
            }
            const userbot = userbotResponse.data;
            // Зарезервированные под лот и недоступные акторы в отправки не идут.
            if (reservedIds.has(String(userbot.id))) {
                return res.status(409).json({ error: 'Юзербот зарезервирован под лот в Shop и исключён из отправок.' });
            }
            if (!isActorEligible(userbot)) {
                return res.status(409).json({ error: 'Юзербот недоступен: safe-mode, ограничение, мёртвый прокси или пауза ЛС.' });
            }

            const result = await messagingRouter.deliver({
                ownerId,
                tgUserId: String(tg_user_id).trim(),
                text: messageText,
                pool: [userbot],
                commonChatId: common_chat_id ? String(common_chat_id).trim() : null,
                eventSource: 'manual_send',
                idempotencyKey
            });

            res.json({
                status: result.status,
                actor_id: result.actorId,
                error_kind: result.errorKind,
                error: result.errorText
            });
        } catch (error) {
            console.error('[messaging] Ошибка ручной отправки:', error?.message || error);
            res.status(500).json({ error: 'Внутренняя ошибка сервера' });
        }
    });

    return router;
}
