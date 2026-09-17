// bullgram_autopost_bot_init — регистрация автопост-бота по токену от BotFather.
// Волна 1 userbot-ops (план 2026-09-17). Перенос POST /bots/init в реестр:
// квота тарифа (профиль читаем из БД — в MCP-запросе req.profile может не быть)
// → validateAndCreateBot (getMe + insert + startBot) → ответ как sanitizeBot:
// bot_token и invite_secret никогда не покидают сервер.
//
// Связка: bullgram_userbot_botfather_create_bot → сюда (создал → сразу регистрируй).

import { registerOperation } from '../../../shared/operations.js';
import { MCPError, ERROR_CODES } from '../../../shared/errors.js';
import { AutopostService } from '../../../services/autopost.service.js';
import { enforceAutopostBotQuota } from '../../../utils/product-tier.js';

// Зеркало maskBotToken/sanitizeBot из routes/autopost.routes.js: секреты не отдаём.
function maskBotToken(token) {
    const t = String(token || '');
    const idx = t.indexOf(':');
    if (idx === -1 || idx < 4 || t.length < idx + 7) return '••••';
    return `${t.slice(0, idx)}:…${t.slice(-3)}`;
}

function sanitizeBot(bot) {
    if (!bot) return bot;
    const { bot_token, invite_secret, ...rest } = bot;
    return { ...rest, token_masked: maskBotToken(bot_token), has_invite_secret: Boolean(invite_secret) };
}

// Минимальный профиль владельца: enforceAutopostBotQuota нужны только role и product_tier.
// В REST-транспорте req.profile уже есть; в MCP-пути полагаться на него нельзя —
// читаем из БД по owner_id (паттерн loadProfileForUser, урезанный до нужных полей).
async function loadOwnerProfile(supabase, ownerId, reqProfile) {
    if (reqProfile?.id === ownerId && reqProfile?.product_tier !== undefined) {
        return reqProfile;
    }
    const { data, error } = await supabase
        .from('profiles')
        .select('id, role, product_tier')
        .eq('id', ownerId)
        .maybeSingle();
    if (error) {
        throw new MCPError(ERROR_CODES.INTERNAL, 'DB error loading owner profile', { cause: error.message });
    }
    return data || { id: ownerId, role: null, product_tier: 'trial' };
}

export async function botInitHandler({ supabase, req, args }) {
  if (!req?.user?.id) {
    throw new MCPError(ERROR_CODES.INTERNAL, 'bot_init requires authenticated user', {});
  }
  const botToken = String(args?.bot_token ?? '').trim();
  if (!botToken) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "bot_token" is required — возьми токен у @BotFather (или через bullgram_userbot_botfather_create_bot).', {});
  }
  const adminTgIdRaw = args?.admin_tg_id;
  const adminTgId = adminTgIdRaw != null && String(adminTgIdRaw).trim() !== ''
    ? String(adminTgIdRaw).trim()
    : undefined;

  const profile = await loadOwnerProfile(supabase, req.user.id, req?.profile);

  try {
    await enforceAutopostBotQuota({ supabase, ownerId: req.user.id, profile });
  } catch (err) {
    if (String(err?.message || '').startsWith('На тарифе')) {
      throw new MCPError(ERROR_CODES.QUOTA_EXCEEDED, err.message, {});
    }
    throw err;
  }

  const service = new AutopostService(supabase);
  let bot;
  try {
    bot = await service.validateAndCreateBot({ ownerId: req.user.id, botToken, adminTgId });
  } catch (err) {
    const message = String(err?.message || err);
    if (message.includes('401') || message.toLowerCase().includes('unauthorized')) {
      throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Неверный токен бота', {});
    }
    if (message.startsWith('На тарифе')) {
      throw new MCPError(ERROR_CODES.QUOTA_EXCEEDED, message, {});
    }
    throw new MCPError(ERROR_CODES.INTERNAL, message || 'Failed to init bot', {});
  }

  return { bot: sanitizeBot(bot) };
}

registerOperation('bullgram_autopost_bot_init', {
  handler: botInitHandler,
  requiredScopes: ['mcp:autopost:write', 'api:autopost:write'],
  requiresIntegrationToken: true,
  rateLimitClass: 'write',
  title: 'Register autopost bot',
  description:
    'Регистрирует автопост-бот по токену от BotFather: проверяет токен (getMe), создаёт запись и запускает бота в работу. ' +
    'Связка с bullgram_userbot_botfather_create_bot: создал бота → сразу регистрируй, передав сюда полученный bot_token. ' +
    'Токен в ответе НЕ возвращается (только token_masked) — он уже сохранён на сервере. ' +
    'Ошибки: «Неверный токен бота» — перепроверь токен у BotFather; QUOTA_EXCEEDED — на тарифе лимит автопостеров, предложи владельцу апгрейд в /app/billing. ' +
    'admin_tg_id — необязательный Telegram ID администратора бота.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['bot_token'],
    properties: {
      bot_token: { type: 'string', description: 'Токен от @BotFather в формате 123456789:AA...' },
      admin_tg_id: { type: 'string', description: 'Необязательный Telegram ID администратора бота.' }
    }
  },
  transports: {
    mcp: true,
    rest: { method: 'POST', path: '/autopost/bots', tags: ['autopost'], summary: 'Register autopost bot by BotFather token' }
  }
});
