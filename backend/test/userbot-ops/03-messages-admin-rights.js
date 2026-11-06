/**
 * Сценарий: Волна 2 (messages) — editSentMessage (happy path, валидации,
 * чужое сообщение), deleteSentMessages (revoke + confirm-гейт),
 * forwardSentMessages (randomId), pinChatMessage (pin/unpin), markChatRead
 * (канал/базик-чат), resolveTelegramUser (username/id/ровно один + tool-валидации
 * пяти тулов) и фикс canPromoteMembers→addAdmins в chat-admin-rights.service.
 * Секции исходного test-userbot-ops.js в исходном порядке. Экспортирует run() —
 * хост вызывает сценарии строго по порядку.
 */
import { Api } from 'telegram';
import { ChatAdminRightsService } from '../../services/chat-admin-rights.service.js';
import { editMessageHandler } from '../../mcp/tools/messages/edit-message.js';
import { deleteMessageHandler } from '../../mcp/tools/messages/delete-message.js';
import { forwardMessageHandler } from '../../mcp/tools/messages/forward-message.js';
import { pinMessageHandler } from '../../mcp/tools/messages/pin-message.js';
import { markReadHandler } from '../../mcp/tools/messages/mark-read.js';
import { userResolveHandler } from '../../mcp/tools/account/user-resolve.js';
import { ERROR_CODES } from '../../shared/errors.js';
import {
    capture, assert, makeDb, makeMockClient, makeUserbot, makeService,
    invokeOfClass, countInvokesOfClass, firstDeleteCall, REQ, USERBOT_ID
} from './shared.js';

export async function run() {

console.log('--- Волна 2 / editSentMessage: happy path, валидации, чужое сообщение ---');
{
    const client = makeMockClient();
    const service = makeService(client);
    const res = await service.editSentMessage(makeUserbot(), { chatId: '-100500', messageId: 10, text: 'новый текст' });
    assert(res.chat_id === '-100500' && res.message_id === 10 && res.edited === true, 'edit result shape');
    const edit = invokeOfClass(client, 'EditMessage');
    assert(edit instanceof Api.messages.EditMessage, 'invoke messages.EditMessage');
    assert(edit?.id === 10 && edit?.message === 'новый текст', 'EditMessage carries id + new text');

    const emptyText = await capture(service.editSentMessage(makeUserbot(), { chatId: '-100500', messageId: 10, text: '   ' }));
    assert(emptyText?.code === ERROR_CODES.INVALID_PARAMS, 'whitespace-only text → INVALID_PARAMS');
    const longText = await capture(service.editSentMessage(makeUserbot(), { chatId: '-100500', messageId: 10, text: 'x'.repeat(4097) }));
    assert(longText?.code === ERROR_CODES.INVALID_PARAMS, 'text > 4096 → INVALID_PARAMS');
    const badChat = await capture(service.editSentMessage(makeUserbot(), { chatId: 'abc', messageId: 10, text: 't' }));
    assert(badChat?.code === ERROR_CODES.INVALID_PARAMS, 'non-numeric chat_id → INVALID_PARAMS');
    const badMsgId = await capture(service.editSentMessage(makeUserbot(), { chatId: '-100500', messageId: 0, text: 't' }));
    assert(badMsgId?.code === ERROR_CODES.INVALID_PARAMS, 'message_id 0 → INVALID_PARAMS');

    // Чужое сообщение: Telegram отклоняет MESSAGE_EDIT_FORBIDDEN → TELEGRAM_ERROR (wrapTelegramError)
    const clientForeign = makeMockClient({
        invoke: { EditMessage: () => { const e = new Error('MESSAGE_EDIT_FORBIDDEN'); e.errorMessage = 'MESSAGE_EDIT_FORBIDDEN'; throw e; } }
    });
    const foreign = await capture(makeService(clientForeign).editSentMessage(makeUserbot(), { chatId: '-100500', messageId: 11, text: 't' }));
    assert(foreign?.code === ERROR_CODES.TELEGRAM_ERROR && String(foreign?.message).includes('MESSAGE_EDIT_FORBIDDEN'), 'foreign message → TELEGRAM_ERROR mapped');
}

console.log('--- Волна 2 / deleteSentMessages: revoke через GramJS-хелпер, confirm-гейт ---');
{
    const client = makeMockClient();
    const service = makeService(client);
    const res = await service.deleteSentMessages(makeUserbot(), { chatId: '-100500', messageIds: [5, '6'] });
    assert(res.chat_id === '-100500' && res.deleted === 2, 'delete result shape with count');
    const call = firstDeleteCall(client);
    assert(call?.entity instanceof Api.InputPeerChannel, 'resolved peer passed to deleteMessages helper');
    assert(JSON.stringify(call?.ids) === '[5,6]', 'message ids normalized to numbers');
    assert(call?.opts?.revoke === true, 'revoke: true (удаление у всех)');

    const empty = await capture(service.deleteSentMessages(makeUserbot(), { chatId: '-100500', messageIds: [] }));
    assert(empty?.code === ERROR_CODES.INVALID_PARAMS, 'empty message_ids → INVALID_PARAMS');
    const badId = await capture(service.deleteSentMessages(makeUserbot(), { chatId: '-100500', messageIds: [5, 'x'] }));
    assert(badId?.code === ERROR_CODES.INVALID_PARAMS, 'non-numeric id in array → INVALID_PARAMS');

    // tool-level: без confirm → INVALID_PARAMS с русским подсказом, до похода в Telegram
    const noConfirm = await capture(deleteMessageHandler({
        supabase: makeDb(),
        req: REQ,
        args: { userbot_id: USERBOT_ID, chat_id: '-100', message_ids: [1], confirm: false }
    }));
    assert(noConfirm?.code === ERROR_CODES.INVALID_PARAMS && noConfirm?.message === 'Удаление необратимо — передай confirm: true', 'no confirm → INVALID_PARAMS russian hint');
    const tooMany = await capture(deleteMessageHandler({
        supabase: makeDb(),
        req: REQ,
        args: { userbot_id: USERBOT_ID, chat_id: '-100', message_ids: Array.from({ length: 101 }, (_, i) => i + 1), confirm: true }
    }));
    assert(tooMany?.code === ERROR_CODES.INVALID_PARAMS, 'more than 100 message_ids → INVALID_PARAMS');
}

console.log('--- Волна 2 / forwardSentMessages: ForwardMessages со своими randomId ---');
{
    const client = makeMockClient({
        getInputEntity: async (target) => new Api.InputPeerChannel({
            channelId: BigInt(String(target).replace(/^-100/, '')),
            accessHash: BigInt(900)
        })
    });
    const service = makeService(client);
    const res = await service.forwardSentMessages(makeUserbot(), { fromChatId: '-100500', messageIds: [5, 6], toChatId: '-100900' });
    assert(res.to_chat_id === '-100900' && res.forwarded === 2, 'forward result shape');
    const fwd = invokeOfClass(client, 'ForwardMessages');
    assert(fwd instanceof Api.messages.ForwardMessages, 'invoke messages.ForwardMessages');
    assert(String(fwd?.fromPeer?.channelId) === '500' && String(fwd?.toPeer?.channelId) === '900', 'fromPeer/toPeer resolved separately');
    assert(JSON.stringify(fwd?.id?.map(Number)) === '[5,6]', 'message ids forwarded');
    assert(Array.isArray(fwd?.randomId) && fwd.randomId.length === 2 && fwd.randomId.every((v) => typeof v === 'bigint' && v > 0n), 'randomId: positive bigints per message');

    const empty = await capture(service.forwardSentMessages(makeUserbot(), { fromChatId: '-100500', messageIds: [], toChatId: '-100900' }));
    assert(empty?.code === ERROR_CODES.INVALID_PARAMS, 'empty message_ids → INVALID_PARAMS');
    const badTo = await capture(service.forwardSentMessages(makeUserbot(), { fromChatId: '-100500', messageIds: [5], toChatId: 'chat' }));
    assert(badTo?.code === ERROR_CODES.INVALID_PARAMS, 'non-numeric to_chat_id → INVALID_PARAMS');
}

console.log('--- Волна 2 / pinChatMessage: pin и unpin ---');
{
    const client = makeMockClient();
    const service = makeService(client);
    const pinned = await service.pinChatMessage(makeUserbot(), { chatId: '-100500', messageId: 15 });
    assert(pinned.pinned === true && pinned.message_id === 15, 'pin result pinned:true');
    const pinReq = invokeOfClass(client, 'UpdatePinnedMessage');
    assert(pinReq instanceof Api.messages.UpdatePinnedMessage && pinReq?.unpin === false, 'invoke UpdatePinnedMessage without unpin');

    const client2 = makeMockClient();
    const unpinned = await makeService(client2).pinChatMessage(makeUserbot(), { chatId: '-100500', messageId: 15, unpin: true });
    assert(unpinned.pinned === false, 'unpin result pinned:false');
    assert(invokeOfClass(client2, 'UpdatePinnedMessage')?.unpin === true, 'unpin flag passed to Telegram');

    const badId = await capture(service.pinChatMessage(makeUserbot(), { chatId: '-100500', messageId: -3 }));
    assert(badId?.code === ERROR_CODES.INVALID_PARAMS, 'negative message_id → INVALID_PARAMS');
}

console.log('--- Волна 2 / markChatRead: канал через ReadMessageContents, базик-чат через ReadHistory ---');
{
    // Канал: peer InputPeerChannel → ReadMessageContents по id последнего сообщения
    const clientChannel = makeMockClient({ getMessages: () => [{ id: 42 }] });
    const resChannel = await makeService(clientChannel).markChatRead(makeUserbot(), { chatId: '-100500' });
    assert(resChannel.read === true && resChannel.chat_id === '-100500', 'channel read result shape');
    const contents = invokeOfClass(clientChannel, 'ReadMessageContents');
    assert(contents instanceof Api.channels.ReadMessageContents, 'channel → channels.ReadMessageContents');
    assert(JSON.stringify(contents?.id?.map(Number)) === '[42]', 'ReadMessageContents with latest message id');

    // Пустой канал: размечать нечем — без invoke, но read:true
    const clientEmpty = makeMockClient({ getMessages: () => [] });
    const resEmpty = await makeService(clientEmpty).markChatRead(makeUserbot(), { chatId: '-100500' });
    assert(resEmpty.read === true && countInvokesOfClass(clientEmpty, 'ReadMessageContents') === 0, 'empty channel → no invoke, read:true');

    // Базик-чат: peer InputPeerChat → messages.ReadHistory
    const clientBasic = makeMockClient({
        getInputEntity: async () => new Api.InputPeerChat({ chatId: BigInt(999) })
    });
    const resBasic = await makeService(clientBasic).markChatRead(makeUserbot(), { chatId: '-999' });
    assert(resBasic.read === true, 'basic chat read result shape');
    const history = invokeOfClass(clientBasic, 'ReadHistory');
    assert(history instanceof Api.messages.ReadHistory, 'basic chat → messages.ReadHistory');
    assert(history?.peer instanceof Api.InputPeerChat && Number(history?.maxId) === 2147483647, 'ReadHistory peer + MAX_INT maxId');

    const badChat = await capture(makeService(makeMockClient()).markChatRead(makeUserbot(), { chatId: null }));
    assert(badChat?.code === ERROR_CODES.INVALID_PARAMS, 'missing chat_id → INVALID_PARAMS');
}

console.log('--- Волна 2 / resolveTelegramUser: username, tg_user_id, ровно один ---');
{
    const client = makeMockClient({
        getEntity: async (target) => {
            if (String(target) === '@durov') {
                return { id: 777, accessHash: 888, username: 'durov', firstName: 'Павел', lastName: 'Дуров', verified: true };
            }
            if (String(target) === '777') {
                return { id: 777, accessHash: 888, username: 'durov', firstName: 'Павел' };
            }
            throw new Error('Cannot find any entity corresponding to');
        }
    });
    const service = makeService(client);
    const byUsername = await service.resolveTelegramUser(makeUserbot(), { username: '@durov' });
    assert(byUsername.id === '777' && byUsername.username === 'durov', 'username branch: id + username');
    assert(byUsername.first_name === 'Павел' && byUsername.last_name === 'Дуров', 'username branch: names mapped');
    assert(byUsername.verified === true && byUsername.access_hash === '888', 'username branch: verified + access_hash');

    const byId = await service.resolveTelegramUser(makeUserbot(), { tgUserId: '777' });
    assert(byId.id === '777', 'tg_user_id branch resolves');

    const both = await capture(service.resolveTelegramUser(makeUserbot(), { username: '@durov', tgUserId: '777' }));
    assert(both?.code === ERROR_CODES.INVALID_PARAMS, 'both username and tg_user_id → INVALID_PARAMS');
    const none = await capture(service.resolveTelegramUser(makeUserbot(), {}));
    assert(none?.code === ERROR_CODES.INVALID_PARAMS, 'neither argument → INVALID_PARAMS');

    // Мусорный username ловим до getEntity — Telegram отвечает на него невнятной peer-ошибкой
    const badUsername = await capture(service.resolveTelegramUser(makeUserbot(), { username: 'bad name!' }));
    assert(badUsername?.code === ERROR_CODES.INVALID_PARAMS && badUsername?.message === 'Некорректный username', 'malformed username → INVALID_PARAMS');
    const shortUsername = await capture(service.resolveTelegramUser(makeUserbot(), { username: 'abc' }));
    assert(shortUsername?.code === ERROR_CODES.INVALID_PARAMS, 'too-short username → INVALID_PARAMS');

    // tool-level: та же «ровно одна» валидация
    const toolBoth = await capture(userResolveHandler({
        supabase: makeDb(),
        req: REQ,
        args: { userbot_id: USERBOT_ID, username: 'durov', tg_user_id: '777' }
    }));
    assert(toolBoth?.code === ERROR_CODES.INVALID_PARAMS, 'tool: both args → INVALID_PARAMS');
    const editBadMsg = await capture(editMessageHandler({
        supabase: makeDb(),
        req: REQ,
        args: { userbot_id: USERBOT_ID, chat_id: '-100', message_id: 'x', text: 't' }
    }));
    assert(editBadMsg?.code === ERROR_CODES.INVALID_PARAMS, 'tool: non-integer message_id → INVALID_PARAMS');
    const fwdNoTo = await capture(forwardMessageHandler({
        supabase: makeDb(),
        req: REQ,
        args: { userbot_id: USERBOT_ID, chat_id: '-100', message_ids: [1] }
    }));
    assert(fwdNoTo?.code === ERROR_CODES.INVALID_PARAMS, 'tool: missing to_chat_id → INVALID_PARAMS');
    const pinBad = await capture(pinMessageHandler({
        supabase: makeDb(),
        req: REQ,
        args: { userbot_id: USERBOT_ID, chat_id: '-100', message_id: 0 }
    }));
    assert(pinBad?.code === ERROR_CODES.INVALID_PARAMS, 'tool: message_id 0 → INVALID_PARAMS');
    const readNoChat = await capture(markReadHandler({
        supabase: makeDb(),
        req: REQ,
        args: { userbot_id: USERBOT_ID }
    }));
    assert(readNoChat?.code === ERROR_CODES.INVALID_PARAMS, 'tool: missing chat_id → INVALID_PARAMS');
}

console.log('--- chat-admin-rights: фикс addAdmins (canPromoteMembers — Bot-API-имя, в MTProto его нет) ---');
{
    const rightsService = new ChatAdminRightsService({ from: () => { throw new Error('supabase не нужен'); } });

    // Настоящий MTProto-флаг addAdmins → кандидат берётся, EditAdmin вызывается
    const okClient = makeMockClient({
        invoke: {
            GetParticipant: () => ({ participant: { adminRights: { addAdmins: true } } }),
            EditAdmin: () => ({})
        },
        getDialogs: () => [{ id: '-100777', entity: { className: 'Channel', id: 777n } }],
        getParticipants: () => [{ id: 42, accessHash: 4242 }]
    });
    const found = await rightsService.findPromoterUserbot(
        { createAuthorizedClient: async () => okClient },
        [{ tg_account_id: '999' }],
        null,
        -100777,
        '42'
    );
    assert(found?.userbot && found.userbot.tg_account_id === '999', 'promoter found when adminRights.addAdmins === true');
    const editAdmin = invokeOfClass(okClient, 'EditAdmin');
    assert(editAdmin instanceof Api.channels.EditAdmin, 'EditAdmin invoked with target InputUser');
    assert(editAdmin?.adminRights instanceof Api.ChatAdminRights, 'adminRights is ChatAdminRights');
    // canManageChat (Bot-API имя) в TL-схеме нет: он бы сериализовался в ALL-false права — демоут.
    assert(Object.values(editAdmin?.adminRights || {}).some((v) => v === true), 'adminRights has at least one true flag');

    // Легаси Bot-API-имя canPromoteMembers (без addAdmins) — раньше флаг всегда «не находился»
    const legacyClient = makeMockClient({
        invoke: { GetParticipant: () => ({ participant: { adminRights: { canPromoteMembers: true } } }) },
        getDialogs: () => [{ id: '-100777', entity: { className: 'Channel', id: 777n } }],
        getParticipants: () => [{ id: 42, accessHash: 4242 }]
    });
    const notFound = await rightsService.findPromoterUserbot(
        { createAuthorizedClient: async () => legacyClient },
        [{ tg_account_id: '999' }],
        null,
        -100777,
        '42'
    );
    assert(notFound === null, 'candidate with only legacy canPromoteMembers is skipped');
    assert(countInvokesOfClass(legacyClient, 'EditAdmin') === 0, 'no EditAdmin without addAdmins');
}

}
