/**
 * Юнит-тесты userbot-ops (план 2026-09-17): Волна 1 (group_create / member_invite /
 * member_promote / group_invite_link / botfather_create_bot / bot_init + фикс leave-chat)
 * и Волна 2 (message_edit / message_delete / message_forward / message_pin /
 * chat_read / user_resolve + фикс addAdmins в chat-admin-rights.service).
 * Офлайн, детерминированные: сервисные методы гоняем на замоканном клиенте
 * (createAuthorizedClient подменён), bot_init — на моке supabase + стабе
 * validateAndCreateBot (стиль test-autopost-checklist-ops.js).
 *
 * Покрывает: флаг-гейты TOOL_DISABLED, валидации аргументов, happy-path каждого
 * метода, per-member результаты приглашения (включая already-participant),
 * FORBIDDEN без addAdmins, «taken» от BotFather, таймаут ответа BotFather,
 * incoming-фильтр и in-flight гард BotFather (RATE_LIMITED), redaction токена
 * из raw_reply, отзыв инвайт-ссылки (по link и текущей без link), ветку
 * basic-группы в leaveChat (DeleteChatUser + InputUserSelf), маппинг ошибок
 * bot_init (квота / неверный токен) и sanitizeBot (без bot_token/invite_secret),
 * confirm-гейт delete, peer-ветки markChatRead, обе ветки user_resolve,
 * «ровно один аргумент», валидацию формата username, username-скан участника
 * и фикс canPromoteMembers→addAdmins (не ALL-false adminRights).
 */
import { Api } from 'telegram';
import { UserbotService, parseBotFatherToken } from '../services/userbot.service.js';
import { ChatAdminRightsService } from '../services/chat-admin-rights.service.js';
import { botInitHandler } from '../mcp/tools/autopost/bot-init.js';
import { groupCreateHandler } from '../mcp/tools/dialogs/group-create.js';
import { memberInviteHandler } from '../mcp/tools/dialogs/member-invite.js';
import { memberPromoteHandler } from '../mcp/tools/dialogs/member-promote.js';
import { botfatherCreateBotHandler } from '../mcp/tools/account/botfather-create-bot.js';
import { editMessageHandler } from '../mcp/tools/messages/edit-message.js';
import { deleteMessageHandler } from '../mcp/tools/messages/delete-message.js';
import { forwardMessageHandler } from '../mcp/tools/messages/forward-message.js';
import { pinMessageHandler } from '../mcp/tools/messages/pin-message.js';
import { markReadHandler } from '../mcp/tools/messages/mark-read.js';
import { userResolveHandler } from '../mcp/tools/account/user-resolve.js';
import { MCPError, ERROR_CODES } from '../shared/errors.js';
import { AutopostService } from '../services/autopost.service.js';

let failures = 0;
function assert(condition, label) {
    if (condition) {
        console.log(`  ✓ ${label}`);
    } else {
        console.error(`  ✗ ${label}`);
        failures++;
    }
}
async function capture(promise) {
    try {
        await promise;
        return null;
    } catch (e) {
        return e;
    }
}

const OWNER_ID = '9fd78a21-33b6-4d68-b0f7-a8ddf2e0bce3';
const USERBOT_ID = '11111111-1111-4111-8111-111111111111';
const REQ = { user: { id: OWNER_ID } };

// --- Флаги-kill-switch: сохраняем и восстанавливаем окружение ---
const FLAG_KEYS = ['USERBOT_GROUP_ADMIN_ENABLED', 'USERBOT_BOTFATHER_ENABLED'];
const savedFlags = Object.fromEntries(FLAG_KEYS.map((k) => [k, process.env[k]]));
function setFlags({ group = false, botfather = false }) {
    for (const [key, enabled] of [['USERBOT_GROUP_ADMIN_ENABLED', group], ['USERBOT_BOTFATHER_ENABLED', botfather]]) {
        if (enabled) {
            process.env[key] = 'true';
        } else {
            delete process.env[key];
        }
    }
}

function makeUserbot(patch = {}) {
    return {
        id: USERBOT_ID,
        owner_id: OWNER_ID,
        account_type: 'userbot',
        runtime_status: 'active',
        ...patch
    };
}

/**
 * Мок GramJS-клиента: invoke маршрутизируется по className TL-запроса,
 * переопределяемые хуки передаются в overrides.
 */
function makeMockClient(overrides = {}) {
    const invokes = [];
    const invokeHandlers = overrides.invoke || {};
    const client = {
        invokes,
        async invoke(request) {
            invokes.push(request);
            // request.className у namespaced-запросов полный: «channels.CreateChannel» —
            // хуки в тестах ключуем по короткому имени после точки.
            const shortName = String(request?.className || '').split('.').pop();
            const handler = invokeHandlers[shortName];
            if (handler) return handler(request);
            return {};
        },
        async getInputEntity(target) {
            if (overrides.getInputEntity) return overrides.getInputEntity(target);
            return new Api.InputPeerChannel({ channelId: BigInt(500), accessHash: BigInt(900) });
        },
        async getEntity(target) {
            if (overrides.getEntity) return overrides.getEntity(target);
            return { id: 777, accessHash: 888, username: String(target).replace(/^@/, '') };
        },
        async getDialogs() {
            return overrides.getDialogs ? overrides.getDialogs() : [];
        },
        async getParticipants() {
            return overrides.getParticipants ? overrides.getParticipants() : [];
        },
        async getMessages() {
            return overrides.getMessages ? overrides.getMessages() : [];
        },
        async sendMessage() {
            return overrides.sendMessage ? overrides.sendMessage() : { id: 1 };
        },
        deleteCalls: [],
        async deleteMessages(entity, ids, opts) {
            client.deleteCalls.push({ entity, ids, opts });
            if (overrides.deleteMessages) return overrides.deleteMessages(entity, ids, opts);
            return {};
        },
        async disconnect() {}
    };
    return client;
}


function invokeOfClass(client, shortName) {
    return client.invokes.find((r) => String(r?.className || '').split('.').pop() === shortName);
}
function countInvokesOfClass(client, shortName) {
    return client.invokes.filter((r) => String(r?.className || '').split('.').pop() === shortName).length;
}
function firstDeleteCall(client) {
    return (client.deleteCalls || [])[0] || null;
}

function makeService(mockClient) {
    const service = new UserbotService({ from: () => { throw new Error('supabase не нужен в этих тестах'); } });
    service.createAuthorizedClient = async () => mockClient;
    return service;
}

// --- Минимальный supabase-мок для bot_init: profiles (maybeSingle) + autopost_bots (thenable) ---
function makeDb({ profiles = [], bots = [] } = {}) {
    const db = { profiles: [...profiles], autopost_bots: [...bots] };
    function chain(table) {
        const state = { filters: {} };
        const b = {
            select() { return b; },
            eq(k, v) { state.filters[k] = v; return b; },
            maybeSingle() { return Promise.resolve(runSingle()); },
            then(resolve, reject) { return Promise.resolve(runMany()).then(resolve, reject); }
        };
        function runMany() {
            const rows = (db[table] || []).filter((row) =>
                Object.entries(state.filters).every(([k, v]) => String(row[k]) === String(v)));
            return { data: rows, error: null };
        }
        function runSingle() {
            const { data } = runMany();
            return { data: data[0] ?? null, error: null };
        }
        return b;
    }
    return { from: chain, db };
}

console.log('--- parseBotFatherToken ---');
{
    const good = 'Done! Congratulations on your new bot. Use this token to access the HTTP API:\n7314967042:AAHxxxXxxx_yyy-1234567890abcdefgh';
    assert(parseBotFatherToken(good) === '7314967042:AAHxxxXxxx_yyy-1234567890abcdefgh', 'token extracted from BotFather reply');
    assert(parseBotFatherToken('Sorry, this username is already taken.') === null, 'no token in plain reply');
    assert(parseBotFatherToken('') === null, 'empty reply → null');
    assert(parseBotFatherToken('token: 550234117:Z') === null, 'short secret does not match');
}

console.log('--- флаг-гейты: без USERBOT_GROUP_ADMIN_ENABLED / USERBOT_BOTFATHER_ENABLED → TOOL_DISABLED ---');
{
    setFlags({});
    const service = makeService(makeMockClient());
    const userbot = makeUserbot();

    const e1 = await capture(service.createGroupChat(userbot, { title: 'T' }));
    assert(e1 instanceof MCPError && e1?.code === ERROR_CODES.TOOL_DISABLED, `createGroupChat → TOOL_DISABLED (got ${e1?.code})`);
    assert(String(e1?.message).includes('USERBOT_GROUP_ADMIN_ENABLED'), 'createGroupChat hint names the env flag');

    const e2 = await capture(service.inviteGroupMembers(userbot, { chatId: '-100', members: ['@a'] }));
    assert(e2?.code === ERROR_CODES.TOOL_DISABLED, 'inviteGroupMembers → TOOL_DISABLED');

    const e3 = await capture(service.promoteGroupMember(userbot, { chatId: '-100', member: '@a' }));
    assert(e3?.code === ERROR_CODES.TOOL_DISABLED, 'promoteGroupMember → TOOL_DISABLED');

    const e4 = await capture(service.exportGroupInviteLink(userbot, { chatId: '-100' }));
    assert(e4?.code === ERROR_CODES.TOOL_DISABLED, 'exportGroupInviteLink → TOOL_DISABLED');

    const e5 = await capture(service.botFatherCreateBot(userbot, { botName: 'N', botUsername: 'my_bot' }));
    assert(e5?.code === ERROR_CODES.TOOL_DISABLED && String(e5?.message).includes('USERBOT_BOTFATHER_ENABLED'), 'botFatherCreateBot → TOOL_DISABLED with own flag');
}

console.log('--- createGroupChat: happy path (группа + канал) и валидация title ---');
{
    setFlags({ group: true });
    const client = makeMockClient({
        invoke: {
            CreateChannel: () => ({ chats: [{ id: 555, accessHash: 999n, title: 'Тестовая' }] }),
            ExportChatInvite: () => ({ link: 'https://t.me/+abc123' })
        }
    });
    const service = makeService(client);

    const res = await service.createGroupChat(makeUserbot(), { title: 'Тестовая', kind: 'group', about: 'описание' });
    // Контракт после e2e-фикса: chat_id в Bot-API-формате (-100…), голый MTProto-id — в mtproto_id
    assert(res.chat_id === '-100555' && res.mtproto_id === '555' && res.access_hash === '999', 'chat_id (-100) + mtproto_id + access_hash from CreateChannel result');
    assert(res.title === 'Тестовая', 'title echoed');
    assert(res.invite_link === 'https://t.me/+abc123', 'invite_link from ExportChatInvite');
    const create = invokeOfClass(client, 'CreateChannel');
    assert(create instanceof Api.channels.CreateChannel, 'invoke CreateChannel');
    assert(create.megagroup === true && create.broadcast === false, 'group flags: megagroup=true, broadcast=false');
    const exportReq = invokeOfClass(client, 'ExportChatInvite');
    assert(exportReq?.peer instanceof Api.InputPeerChannel && String(exportReq.peer.channelId) === '555', 'ExportChatInvite on InputPeerChannel of new chat');

    const client2 = makeMockClient({ invoke: { CreateChannel: () => ({ chats: [{ id: 556, accessHash: 1000n, title: 'Канал' }] }) } });
    const service2 = makeService(client2);
    await service2.createGroupChat(makeUserbot(), { title: 'Канал', kind: 'channel' });
    const create2 = invokeOfClass(client2, 'CreateChannel');
    assert(create2.broadcast === true && create2.megagroup === false, 'channel flags: broadcast=true, megagroup=false');

    const badTitle = await capture(makeService(makeMockClient()).createGroupChat(makeUserbot(), { title: '' }));
    assert(badTitle?.code === ERROR_CODES.INVALID_PARAMS, 'empty title → INVALID_PARAMS');
    const badKind = await capture(groupCreateHandler({
        supabase: makeDb(),
        req: REQ,
        args: { userbot_id: USERBOT_ID, title: 'T', kind: 'supergruppe' }
    }));
    assert(badKind?.code === ERROR_CODES.INVALID_PARAMS, 'tool: unknown kind → INVALID_PARAMS');
}

console.log('--- inviteGroupMembers: per-member результаты (ок / already / отказ) ---');
{
    setFlags({ group: true });
    const client = makeMockClient({
        getInputEntity: async () => new Api.InputPeerChannel({ channelId: BigInt(600), accessHash: BigInt(700) }),
        getEntity: async (target) => {
            if (String(target) === '@bad_guy') throw new Error('USER_PRIVACY_RESTRICTED');
            return { id: 777, accessHash: 888, username: String(target).replace(/^@/, '') };
        },
        invoke: {
            InviteToChannel: (request) => {
                if (String(request?.users?.[0]?.username) === 'dup_guy') {
                    throw new Error('Telegram says: USER_ALREADY_PARTICIPANT');
                }
                return {};
            }
        }
    });
    const service = makeService(client);
    const res = await service.inviteGroupMembers(makeUserbot(), { chatId: '-100600', members: ['good_guy', '@bad_guy', '@dup_guy'] });
    assert(Array.isArray(res.results) && res.results.length === 3, 'three per-member results');
    assert(res.results[0].member === '@good_guy' && res.results[0].status === 'ok', 'first member ok (normalized @)');
    assert(res.results[1].member === '@bad_guy' && res.results[1].status === 'failed', 'second member failed');
    assert(String(res.results[1].error).includes('USER_PRIVACY_RESTRICTED'), 'failure carries telegram error');
    assert(res.results[2].member === '@dup_guy' && res.results[2].status === 'already' && res.results[2].error === null, 'USER_ALREADY_PARTICIPANT → status already, not failed');
    const invitesCount = countInvokesOfClass(client, 'InviteToChannel');
    assert(invitesCount === 2, 'InviteToChannel for resolvable members; resolver failure isolated per-member');
    const noMembers = await capture(service.inviteGroupMembers(makeUserbot(), { chatId: '-100600', members: [] }));
    assert(noMembers?.code === ERROR_CODES.INVALID_PARAMS, 'empty members → INVALID_PARAMS');
}

console.log('--- tool-level валидации member_invite ---');
{
    const badName = await capture(memberInviteHandler({
        supabase: makeDb(),
        req: REQ,
        args: { userbot_id: USERBOT_ID, chat_id: '-100', members: ['bad name!'] }
    }));
    assert(badName?.code === ERROR_CODES.INVALID_PARAMS, 'invalid member username → INVALID_PARAMS');

    const tooMany = await capture(memberInviteHandler({
        supabase: makeDb(),
        req: REQ,
        args: { userbot_id: USERBOT_ID, chat_id: '-100', members: Array.from({ length: 11 }, (_, i) => `@user_${i}`) }
    }));
    assert(tooMany?.code === ERROR_CODES.INVALID_PARAMS, 'more than 10 members → INVALID_PARAMS');
}

console.log('--- promoteGroupMember: валидация rights, FORBIDDEN без addAdmins, happy path ---');
{
    setFlags({ group: true });
    const service1 = makeService(makeMockClient());
    const badRights = await capture(service1.promoteGroupMember(makeUserbot(), { chatId: '-100', member: '@m', rights: 'superuser' }));
    assert(badRights?.code === ERROR_CODES.INVALID_PARAMS, 'unknown rights → INVALID_PARAMS');

    const clientNoRights = makeMockClient({
        invoke: { GetParticipant: () => ({ participant: { adminRights: { postMessages: true } } }) }
    });
    const forbidden = await capture(makeService(clientNoRights).promoteGroupMember(makeUserbot(), { chatId: '-100', member: '@m' }));
    assert(forbidden instanceof MCPError && forbidden?.code === ERROR_CODES.FORBIDDEN, `no addAdmins → FORBIDDEN (got ${forbidden?.code})`);
    assert(String(forbidden?.message).includes('назначать админов'), 'FORBIDDEN russian text');

    const client = makeMockClient({
        invoke: {
            GetParticipant: () => ({ participant: { adminRights: { addAdmins: true } } }),
            EditAdmin: () => ({})
        },
        getEntity: async () => ({ id: 777, accessHash: 888, username: 'member' })
    });
    const service = makeService(client);
    const res = await service.promoteGroupMember(makeUserbot(), { chatId: '-100500', member: '@member', rights: 'all' });
    assert(res.chat_id === '-100500' && res.member === '@member' && res.rights === 'all', 'promote result shape');
    const edit = invokeOfClass(client, 'EditAdmin');
    assert(edit instanceof Api.channels.EditAdmin, 'invoke EditAdmin');
    assert(edit.adminRights instanceof Api.ChatAdminRights, 'adminRights is ChatAdminRights (api.d.ts flags, не Bot-API имена)');
    assert(edit.userId instanceof Api.InputUser && String(edit.userId.accessHash) === '888', 'target InputUser with accessHash');

    const clientRevoke = makeMockClient({
        invoke: { GetParticipant: () => ({ participant: { adminRights: { addAdmins: true } } }) }
    });
    const serviceRevoke = makeService(clientRevoke);
    const revoked = await serviceRevoke.promoteGroupMember(makeUserbot(), { chatId: '-100500', member: '@member', rights: 'revoke' });
    assert(revoked.rights === 'revoke', 'revoke preset applied');

    // «призрак» без access_hash: getEntity падает, скан участников пуст → INVALID_PARAMS
    const clientMissing = makeMockClient({
        invoke: { GetParticipant: () => ({ participant: { adminRights: { addAdmins: true } } }) },
        getEntity: async () => { throw new Error('Cannot find any entity corresponding to'); },
        getParticipants: () => []
    });
    const missing = await capture(makeService(clientMissing).promoteGroupMember(makeUserbot(), { chatId: '-100500', member: '@ghost' }));
    assert(missing?.code === ERROR_CODES.INVALID_PARAMS, 'unresolvable member → INVALID_PARAMS');

    // username-скан: getEntity падает, участник находится в participants без учёта регистра
    const clientScan = makeMockClient({
        invoke: { GetParticipant: () => ({ participant: { adminRights: { addAdmins: true } } }) },
        getEntity: async () => { throw new Error('Cannot find any entity corresponding to'); },
        getParticipants: () => [{ id: 42, accessHash: 4242, username: 'Member' }]
    });
    await makeService(clientScan).promoteGroupMember(makeUserbot(), { chatId: '-100500', member: '@MEMBER' });
    const scanEdit = invokeOfClass(clientScan, 'EditAdmin');
    assert(String(scanEdit?.userId?.userId) === '42' && String(scanEdit?.userId?.accessHash) === '4242', 'username member found via participant scan (case-insensitive)');

    // числовой id с префиксом '-100' нормализуется до bare id участников
    const clientScanId = makeMockClient({
        invoke: { GetParticipant: () => ({ participant: { adminRights: { addAdmins: true } } }) },
        getParticipants: () => [{ id: 42, accessHash: 4242 }]
    });
    await makeService(clientScanId).promoteGroupMember(makeUserbot(), { chatId: '-100500', member: '-10042' });
    const scanIdEdit = invokeOfClass(clientScanId, 'EditAdmin');
    assert(String(scanIdEdit?.userId?.userId) === '42', 'numeric member id normalized (-100 prefix stripped)');
}

console.log('--- exportGroupInviteLink: новая ссылка, отзыв по link, revoke текущей без link ---');
{
    setFlags({ group: true });
    const client = makeMockClient({
        invoke: { ExportChatInvite: () => ({ link: 'https://t.me/+fresh1' }) }
    });
    const service = makeService(client);
    const res = await service.exportGroupInviteLink(makeUserbot(), { chatId: '-100' });
    assert(res.invite_link === 'https://t.me/+fresh1' && res.revoked === false, 'fresh link exported');
    assert(countInvokesOfClass(client, 'ExportChatInvite') > 0, 'ExportChatInvite invoked');

    const revokeRes = await service.exportGroupInviteLink(makeUserbot(), { chatId: '-100', link: 'https://t.me/+old', revoke: true });
    assert(revokeRes.revoked === true && revokeRes.invite_link === null, 'revoke by link → revoked:true');
    const editReq = invokeOfClass(client, 'EditExportedChatInvite');
    assert(editReq?.revoked === true && editReq?.link === 'https://t.me/+old', 'EditExportedChatInvite revoked on the passed link');

    // revoke=true без link: текущая основная ссылка из GetFullChannel → fullChat.exportedInvite
    const clientCurrent = makeMockClient({
        invoke: {
            GetFullChannel: () => ({ fullChat: { exportedInvite: { link: 'https://t.me/+current1' } } }),
            EditExportedChatInvite: () => ({})
        }
    });
    const revokeCurrent = await makeService(clientCurrent).exportGroupInviteLink(makeUserbot(), { chatId: '-100', revoke: true });
    assert(revokeCurrent.revoked === true && revokeCurrent.invite_link === null, 'revoke without link → current primary link revoked');
    const editCurrent = invokeOfClass(clientCurrent, 'EditExportedChatInvite');
    assert(editCurrent?.link === 'https://t.me/+current1' && editCurrent?.revoked === true, 'EditExportedChatInvite on GetFullChannel exportedInvite.link');

    // активной ссылки нет → INVALID_PARAMS, а не фейковый успех
    const clientNoLink = makeMockClient({
        invoke: { GetFullChannel: () => ({ fullChat: {} }) }
    });
    const noLink = await capture(makeService(clientNoLink).exportGroupInviteLink(makeUserbot(), { chatId: '-100', revoke: true }));
    assert(noLink?.code === ERROR_CODES.INVALID_PARAMS && String(noLink?.message).includes('нет активной ссылки'), 'revoke without any active invite → INVALID_PARAMS');
}

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

// --- Восстановление окружения ---
setFlags({});
for (const [key, value] of Object.entries(savedFlags)) {
    if (value !== undefined) process.env[key] = value;
}

if (failures > 0) {
    console.error(`\n❌ ${failures} test(s) failed`);
    process.exit(1);
}
console.log('\n✅ All userbot ops tests passed');
