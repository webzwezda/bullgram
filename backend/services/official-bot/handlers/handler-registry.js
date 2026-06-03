import { registerStartHandlers } from './start.handler.js';
import { registerNavigationHandlers } from './navigation.handler.js';
import { registerReferralHandlers } from './referral.handler.js';
import { registerTariffExactHandlers, registerTariffRegexHandlers } from './tariff.handler.js';
import { registerPaymentExactHandlers, registerPaymentRegexHandlers } from './payment.handler.js';
import { registerAdminHandlers } from './admin.handler.js';
import { registerMessageHandlers } from './message.handler.js';
import { registerChatEventHandlers } from './chat-events.handler.js';

export function registerAllHandlers(bot, regCtx) {
    // 1. start + exact-match actions (registered FIRST)
    registerStartHandlers(bot, regCtx);
    registerNavigationHandlers(bot, regCtx);
    registerReferralHandlers(bot, regCtx);
    registerTariffExactHandlers(bot, regCtx);
    registerPaymentExactHandlers(bot, regCtx);
    registerAdminHandlers(bot, regCtx);

    // 2. regex actions (registered AFTER exact — prevents shadowing)
    registerTariffRegexHandlers(bot, regCtx);
    registerPaymentRegexHandlers(bot, regCtx);

    // 3. catch-all event handlers (message + chat events)
    registerMessageHandlers(bot, regCtx);
    registerChatEventHandlers(bot, regCtx);

    // Dev validation: check no exact trigger is shadowed by regex
    validateNoExactShadowedByRegex(bot);
}

function validateNoExactShadowedByRegex(bot) {
    const triggers = bot.handlers?.filter(h => h.type === 'action') || [];
    const exacts = triggers.filter(h => typeof h.trigger === 'string');
    const regexes = triggers.filter(h => h.trigger instanceof RegExp);

    for (const exact of exacts) {
        for (const regex of regexes) {
            if (regex.trigger.test(exact.trigger)) {
                console.warn(
                    `[handler-registry] CONFLICT: exact "${exact.trigger}" is matched by regex ${regex.trigger}. ` +
                    `The exact handler may be shadowed. Registration order matters.`
                );
            }
        }
    }
}
