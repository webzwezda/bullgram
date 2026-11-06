/**
 * Сценарий: botFatherCreateBot (happy path с redaction токена, «taken» от
 * BotFather, таймаут ответа, incoming-фильтр своих сообщений, in-flight гард
 * RATE_LIMITED + освобождение лока) и leaveChat (ветка basic-группы
 * DeleteChatUser + InputUserSelf, каналы). Секции исходного
 * test-userbot-ops.js в исходном порядке. Экспортирует run() — хост вызывает
 * сценарии строго по порядку.
 */
import { Api } from 'telegram';
import { botfatherCreateBotHandler } from '../../mcp/tools/account/botfather-create-bot.js';
import { MCPError, ERROR_CODES } from '../../shared/errors.js';
import {
    capture, assert, makeDb, makeMockClient, makeUserbot, makeService,
    invokeOfClass, countInvokesOfClass, setFlags, REQ, USERBOT_ID
} from './shared.js';

export async function run() {

console.log('--- botFatherCreateBot: happy path, redaction, taken, таймаут, incoming-фильтр, гард ---');
{
    setFlags({ botfather: true });

    const replies = [
        'Alright, a new bot. How are we going to call it? Please choose a name for your bot.',
        'Good. Now let\'s choose a username for your bot. It must end in `bot`.',
        'Done! Congratulations on your new bot. You will find it at t.me/my_shop_bot. Use this token to access the HTTP API:\n7314967042:AAHxxxXxxx_yyy-1234567890abcdefgh'
    ];
    let sendCount = 0;
    let nextSendId = 10;
    const client = makeMockClient({
        getInputEntity: async (target) => ({ id: 93372553, username: String(target) }),
        getMessages: () => {
            if (sendCount === 0) return [];
            return [{ id: nextSendId, out: false, message: replies[Math.min(sendCount - 1, replies.length - 1)] }];
        },
        sendMessage: () => {
            sendCount++;
            nextSendId = 10 + sendCount * 2;
            return { id: nextSendId - 1 };
        }
    });
    const service = makeService(client);
    const res = await service.botFatherCreateBot(makeUserbot(), { botName: 'My Shop', botUsername: 'My_Shop_Bot' });
    assert(res.bot_username === '@my_shop_bot', 'username normalized with @ and lowercase');
    assert(res.bot_token === '7314967042:AAHxxxXxxx_yyy-1234567890abcdefgh', 'token parsed from BotFather reply');
    assert(String(res.raw_reply).includes('Congratulations'), 'raw_reply carried');
    assert(!String(res.raw_reply).includes('7314967042:AAHxxxXxxx') && String(res.raw_reply).includes('<redacted>'), 'raw_reply does not leak the token');
    assert(sendCount === 3, 'three sends: /newbot, name, username');

    // tool-level: юзернейм не на «bot» → INVALID_PARAMS до похода в Telegram
    const badUsername = await capture(botfatherCreateBotHandler({
        supabase: makeDb(),
        req: REQ,
        args: { userbot_id: USERBOT_ID, bot_name: 'N', bot_username: 'not_a_bot_name' }
    }));
    assert(badUsername?.code === ERROR_CODES.INVALID_PARAMS, 'username not ending in bot → INVALID_PARAMS (tool level)');

    // tool-level: регистр и ведущий @ нормализуются до проверки
    const upperUsername = await capture(botfatherCreateBotHandler({
        supabase: makeDb(),
        req: REQ,
        args: { userbot_id: USERBOT_ID, bot_name: 'N', bot_username: '@My_Shop_Bot' }
    }));
    assert(upperUsername === undefined || upperUsername?.code !== ERROR_CODES.INVALID_PARAMS, '@My_Shop_Bot passes username validation');

    // «taken» от BotFather → INVALID_PARAMS с текстом BotFather
    let takenCount = 0;
    const clientTaken = makeMockClient({
        getInputEntity: async () => ({ id: 93372553 }),
        getMessages: () => {
            if (takenCount === 0) return [];
            return [{ id: 999, out: false, message: 'Sorry, this username is already taken. Try something different.' }];
        },
        sendMessage: () => {
            takenCount++;
            return { id: 990 + takenCount };
        }
    });
    const taken = await capture(makeService(clientTaken).botFatherCreateBot(makeUserbot(), { botName: 'N', botUsername: 'busy_bot' }));
    assert(taken instanceof MCPError && taken?.code === ERROR_CODES.INVALID_PARAMS, `taken → INVALID_PARAMS (got ${taken?.code})`);
    assert(String(taken?.message).includes('already taken'), 'BotFather text surfaced in error');

    // Таймаут ответа → TELEGRAM_ERROR «не ответил вовремя»
    const clientSilent = makeMockClient({
        getInputEntity: async () => ({ id: 93372553 }),
        getMessages: () => [],
        sendMessage: () => ({ id: 5 })
    });
    const silent = await capture(makeService(clientSilent).botFatherCreateBot(makeUserbot(), { botName: 'N', botUsername: 'quiet_bot', stepTimeoutMs: 120 }));
    assert(silent?.code === ERROR_CODES.TELEGRAM_ERROR && String(silent?.message).includes('не ответил вовремя'), 'silent BotFather → TELEGRAM_ERROR timeout');

    // Свои исходящие (out:true) не считаются ответом BotFather — только incoming (out:false)
    const clientEcho = makeMockClient({
        getInputEntity: async () => ({ id: 93372553 }),
        getMessages: () => [{ id: 995, out: true, message: replies[2] }],
        sendMessage: () => ({ id: 990 })
    });
    const echoed = await capture(makeService(clientEcho).botFatherCreateBot(makeUserbot(), { botName: 'N', botUsername: 'echo_bot', stepTimeoutMs: 120 }));
    assert(echoed?.code === ERROR_CODES.TELEGRAM_ERROR, 'own outgoing messages (out:true) are not accepted as BotFather reply');

    // Параллельный запуск на одном юзерботе: второй отклоняется RATE_LIMITED, лок снимается в finally
    let guardSendCount = 0;
    const clientGuard = makeMockClient({
        getInputEntity: async () => ({ id: 93372553 }),
        getMessages: () => {
            if (guardSendCount === 0) return [];
            return [{ id: 997, out: false, message: replies[2] }];
        },
        sendMessage: () => {
            guardSendCount++;
            return { id: 996 };
        }
    });
    const guardService = makeService(clientGuard);
    const settled = await Promise.allSettled([
        guardService.botFatherCreateBot(makeUserbot(), { botName: 'N', botUsername: 'guard_one_bot', stepTimeoutMs: 400 }),
        guardService.botFatherCreateBot(makeUserbot(), { botName: 'N', botUsername: 'guard_two_bot', stepTimeoutMs: 400 })
    ]);
    const okRun = settled.find((r) => r.status === 'fulfilled');
    const blockedRun = settled.find((r) => r.status === 'rejected');
    assert(okRun?.status === 'fulfilled' && okRun.value?.bot_token, 'first in-flight create succeeds');
    assert(blockedRun?.reason?.code === ERROR_CODES.RATE_LIMITED, `parallel create on same userbot → RATE_LIMITED (got ${blockedRun?.reason?.code})`);
    assert(String(blockedRun?.reason?.message).includes('уже идёт'), 'RATE_LIMITED message names the in-flight operation');

    // Лок освобождён — повторный запуск проходит
    guardSendCount = 0;
    const rerun = await guardService.botFatherCreateBot(makeUserbot(), { botName: 'N', botUsername: 'guard_retry_bot', stepTimeoutMs: 400 });
    assert(rerun?.bot_token === '7314967042:AAHxxxXxxx_yyy-1234567890abcdefgh', 'guard released in finally → rerun allowed');
}

console.log('--- leaveChat: ветка basic-группы (DeleteChatUser + InputUserSelf) и каналы ---');
{
    const clientBasic = makeMockClient({
        getInputEntity: async () => new Api.InputPeerChat({ chatId: BigInt(999) })
    });
    const service = makeService(clientBasic);
    const res = await service.leaveChat(makeUserbot(), { chatId: '-999' });
    assert(res.success === true && res.chat_id === '-999', 'basic-group leave returns success');
    const del = invokeOfClass(clientBasic, 'DeleteChatUser');
    assert(del instanceof Api.messages.DeleteChatUser, 'basic group → messages.DeleteChatUser');
    assert(del?.userId instanceof Api.InputUserSelf, 'DeleteChatUser userId is InputUserSelf (cleanup.job паттерн)');
    assert(String(del?.chatId) === '999', 'DeleteChatUser chatId from InputPeerChat');

    const clientChannel = makeMockClient({
        getInputEntity: async () => new Api.InputPeerChannel({ channelId: BigInt(500), accessHash: BigInt(900) })
    });
    const serviceChannel = makeService(clientChannel);
    const resChannel = await serviceChannel.leaveChat(makeUserbot(), { chatId: '-100500' });
    assert(resChannel.success === true, 'channel leave backward-compatible shape');
    assert(countInvokesOfClass(clientChannel, 'LeaveChannel') > 0, 'channel → LeaveChannel branch kept');
}

}
