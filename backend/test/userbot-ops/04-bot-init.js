/**
 * Сценарий: bot_init — валидация bot_token, квота Trial → QUOTA_EXCEEDED,
 * happy path с Pro-профилем и стабом validateAndCreateBot (sanitizeBot:
 * без bot_token/invite_secret, token_masked, has_invite_secret), неверный
 * токен → INVALID_PARAMS, сервисная квота → QUOTA_EXCEEDED. Финальная секция
 * исходного test-userbot-ops.js. Экспортирует run() — хост вызывает сценарии
 * строго по порядку.
 */
import { botInitHandler } from '../../mcp/tools/autopost/bot-init.js';
import { MCPError, ERROR_CODES } from '../../shared/errors.js';
import { AutopostService } from '../../services/autopost.service.js';
import { capture, assert, makeDb, REQ, OWNER_ID } from './shared.js';

export async function run() {

console.log('--- bot_init: валидация, квота, неверный токен, sanitize ---');
{
    // bot_token отсутствует
    const noToken = await capture(botInitHandler({ supabase: makeDb(), req: REQ, args: {} }));
    assert(noToken?.code === ERROR_CODES.INVALID_PARAMS, 'missing bot_token → INVALID_PARAMS');

    const origValidate = AutopostService.prototype.validateAndCreateBot;
    try {
        // Квота Trial: профиль из БД отсутствует → дефолт trial, уже 1 бот → QUOTA_EXCEEDED
        const quotaDb = makeDb({ bots: [{ id: 'bot-1', owner_id: OWNER_ID }] });
        const quotaErr = await capture(botInitHandler({ supabase: quotaDb, req: REQ, args: { bot_token: '123:abc' } }));
        assert(quotaErr instanceof MCPError && quotaErr?.code === ERROR_CODES.QUOTA_EXCEEDED, `trial quota → QUOTA_EXCEEDED (got ${quotaErr?.code})`);
        assert(String(quotaErr?.message).startsWith('На тарифе'), 'quota message from enforceAutopostBotQuota surfaced');

        // Happy path: Pro-профиль из БД, стаб validateAndCreateBot → sanitizeBot в ответе
        AutopostService.prototype.validateAndCreateBot = async function ({ ownerId, botToken, adminTgId }) {
            assert(ownerId === OWNER_ID, 'ownerId from req.user.id');
            assert(botToken === '7314967042:AAHxxx', 'botToken passed trimmed');
            assert(adminTgId === '42', 'single admin_tg_id passed through');
            return {
                id: 'bot-row-1',
                owner_id: ownerId,
                username: 'my_shop_bot',
                bot_token: botToken,
                invite_secret: 'topsecret',
                posts_per_day: 1,
                bot_username: 'my_shop_bot'
            };
        };
        const okDb = makeDb({ profiles: [{ id: OWNER_ID, role: null, product_tier: 'pro' }] });
        const res = await botInitHandler({
            supabase: okDb,
            req: REQ,
            args: { bot_token: '7314967042:AAHxxx', admin_tg_id: '42' }
        });
        assert(res.bot?.id === 'bot-row-1', 'bot registered');
        assert(res.bot?.bot_token === undefined && res.bot?.invite_secret === undefined, 'bot_token/invite_secret never leave the server');
        assert(res.bot?.token_masked === '7314967042:…xxx', 'token_masked hint present');
        assert(res.bot?.has_invite_secret === true, 'has_invite_secret boolean instead of secret');

        // Неверный токен (401) → INVALID_PARAMS «Неверный токен бота»
        AutopostService.prototype.validateAndCreateBot = async function () {
            throw new Error('401 Unauthorized');
        };
        const badToken = await capture(botInitHandler({ supabase: makeDb({ profiles: [{ id: OWNER_ID, role: null, product_tier: 'pro' }] }), req: REQ, args: { bot_token: 'bad' } }));
        assert(badToken?.code === ERROR_CODES.INVALID_PARAMS && badToken?.message === 'Неверный токен бота', '401 → INVALID_PARAMS «Неверный токен бота»');

        // Квота из сервиса (гонка после прекерека) → QUOTA_EXCEEDED
        AutopostService.prototype.validateAndCreateBot = async function () {
            throw new Error('На тарифе Trial можно держать только одного автопостера.');
        };
        const svcQuota = await capture(botInitHandler({ supabase: makeDb({ profiles: [{ id: OWNER_ID, role: null, product_tier: 'trial' }] }), req: REQ, args: { bot_token: 'x' } }));
        assert(svcQuota?.code === ERROR_CODES.QUOTA_EXCEEDED, 'service-level quota → QUOTA_EXCEEDED');
    } finally {
        AutopostService.prototype.validateAndCreateBot = origValidate;
    }
}

}
