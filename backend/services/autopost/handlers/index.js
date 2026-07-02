/**
 * Единая точка регистрации всех Telegraf-хендлеров автопостера.
 * Порядок важен: my_chat_member и /start первыми, callbacks после, media последним.
 */
import { registerChatMemberHandler } from './chat-member.js';
import { registerOnboardingHandler } from './onboarding.js';
import { registerAdminCommandsHandler } from './admin-commands.js';
import { registerQueueCallbacksHandler } from './queue-callbacks.js';
import { registerSuggestionCallbacksHandler } from './suggestion-callbacks.js';
import { registerAlbumCallbacksHandler } from './album-callbacks.js';
import { registerBestOfCallbacksHandler } from './best-of-callbacks.js';
import { registerReactionsHandler } from './reactions.js';
import { registerMediaHandler } from './media.js';

export function registerAllHandlers(bot, service, botId) {
    registerChatMemberHandler(bot, service, botId);
    registerOnboardingHandler(bot, service, botId);
    registerAdminCommandsHandler(bot, service, botId);
    registerQueueCallbacksHandler(bot, service, botId);
    registerSuggestionCallbacksHandler(bot, service, botId);
    registerAlbumCallbacksHandler(bot, service, botId);
    registerBestOfCallbacksHandler(bot, service, botId);
    registerReactionsHandler(bot, service, botId);
    registerMediaHandler(bot, service, botId);
}
