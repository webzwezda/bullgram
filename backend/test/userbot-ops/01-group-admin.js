/**
 * Сценарий: Волна 1 (group-admin) — parseBotFatherToken, флаг-гейты TOOL_DISABLED,
 * createGroupChat (группа/канал + валидации), inviteGroupMembers (per-member
 * результаты), tool-валидации member_invite, promoteGroupMember (rights,
 * FORBIDDEN без addAdmins, username-скан), exportGroupInviteLink (новая ссылка,
 * отзыв по link и текущей). Начальные секции исходного test-userbot-ops.js,
 * порядок сохранён. Экспортирует run() — хост вызывает сценарии строго по порядку.
 */
import { Api } from 'teleproto';
import { parseBotFatherToken } from '../../services/userbot.service.js';
import { groupCreateHandler } from '../../mcp/tools/dialogs/group-create.js';
import { memberInviteHandler } from '../../mcp/tools/dialogs/member-invite.js';
import { memberPromoteHandler } from '../../mcp/tools/dialogs/member-promote.js';
import { MCPError, ERROR_CODES } from '../../shared/errors.js';
import {
    capture, assert, makeDb, makeMockClient, makeUserbot, makeService,
    invokeOfClass, countInvokesOfClass, setFlags, REQ, USERBOT_ID
} from './shared.js';

export async function run() {

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

}
