// bullgram_userbot_botfather_create_bot — создать нового бота через DM-диалог с @BotFather.
// Волна 1 userbot-ops (план 2026-09-17). ОДИН клиент на операцию, никаких
// персистентных клиентов. Токен возвращается только здесь — сразу регистрируй
// бота автопостером через bullgram_autopost_bot_init.

import { registerOperation } from '../../../shared/operations.js';
import { MCPError, ERROR_CODES } from '../../../shared/errors.js';
import { isValidUuid } from '../../../shared/utils.js';
import { loadOwnedUserbot } from './health.js';

const BOT_USERNAME_RE = /^[a-z][a-z0-9_]{4,31}bot$/;

export async function botfatherCreateBotHandler({ supabase, req, args, userbotService }) {
  if (!req?.user?.id) {
    throw new MCPError(ERROR_CODES.INTERNAL, 'botfather_create_bot requires authenticated user', {});
  }
  if (!isValidUuid(args?.userbot_id)) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "userbot_id" must be a UUID.', {});
  }
  const botName = String(args?.bot_name ?? '').trim();
  if (!botName || botName.length > 64) {
    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "bot_name" is required (1-64 chars).', {});
  }
  // Telegram-юзернеймы регистронезависимы — нормализуем в нижний регистр и
  // снимаем ведущий @, если агент его передал.
  const botUsername = String(args?.bot_username ?? '').trim().toLowerCase().replace(/^@/, '');
  if (!BOT_USERNAME_RE.test(botUsername)) {
    throw new MCPError(
      ERROR_CODES.INVALID_PARAMS,
      'Argument "bot_username" must match ^[a-z][a-z0-9_]{4,31}bot$ — Telegram требует юзернейм бота на "bot".',
      {}
    );
  }

  const userbot = await loadOwnedUserbot(supabase, req.user.id, args.userbot_id);
  return userbotService.botFatherCreateBot(userbot, { botName, botUsername });
}

registerOperation('bullgram_userbot_botfather_create_bot', {
  handler: botfatherCreateBotHandler,
  requiredScopes: ['mcp:userbot:write', 'api:userbot:write'],
  requiresIntegrationToken: true,
  rateLimitClass: 'write',
  title: 'Create bot via BotFather',
  description:
    'Создаёт нового Telegram-бота: юзербот ведёт DM-диалог с @BotFather (/newbot → имя → юзернейм) и забирает токен из ответа. ' +
    'Возвращает bot_username и bot_token — это свежие credentials владельца. ' +
    'Мини-инструкция: связка с bullgram_autopost_bot_init — создал бота → сразу регистрируй его автопостером, передав полученный bot_token; никому токен не пересылай и в логи не пиши. ' +
    'Если юзернейм занят — BotFather ответит «taken», получишь INVALID_PARAMS: придумай другой юзернейм (обязательно на "bot") и повтори. ' +
    'Операция выключена без флага USERBOT_BOTFATHER_ENABLED в backend/.env.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['userbot_id', 'bot_name', 'bot_username'],
    properties: {
      userbot_id: { type: 'string', format: 'uuid' },
      bot_name: { type: 'string', minLength: 1, maxLength: 64, description: 'Отображаемое имя будущего бота (1-64 символа).' },
      bot_username: {
        type: 'string',
        pattern: '^[a-z][a-z0-9_]{4,31}bot$',
        description: 'Юзернейм будущего бота, строго на "bot" (например, my_shop_bot). Регистр приводится к нижнему.'
      }
    }
  },
  transports: {
    mcp: true,
    rest: { method: 'POST', path: '/userbots/{userbot_id}/botfather/create-bot', tags: ['userbots'], summary: 'Create a bot via BotFather dialog' }
  }
});
