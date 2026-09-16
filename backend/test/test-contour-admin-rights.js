/**
 * Offline tests for the contour ensure-admin mechanism (ContourAdminRightsService).
 * Запуск: node test/test-contour-admin-rights.js
 *
 * Strategy: no network, no Supabase, no Telegraf traffic.
 *   - pure functions tested directly (ensureFlagsSufficient, classifyTelegramError)
 *   - orchestration tested with fake supabase (chained from()), fake botApi,
 *     fake userbot client (getInputEntity + invoke с реальными GramJS-классами
 *     запросов), instant sleep
 *
 * Covered scenarios:
 *   - flags sufficiency matrix (creator all-sufficient, missing can_restrict_members, empty desired)
 *   - telegram error classification matrix
 *   - userbot not member + autoJoin=false → missing_membership, no join attempted
 *   - userbot member, not admin, promote ok → promote with CONTOUR_USERBOT_MAX_RIGHTS,
 *     re-read confirms admin → state ok, upsert row written with flags
 *   - admin read shape: resolved peer + channels.GetParticipant(InputPeerSelf) для
 *     каналов; InputPeerChat → messages.GetFullChat (self ищется по userId) для базисных групп
 *   - promote throws CHAT_ADMIN_REQUIRED + re-read administrator:
 *     flags sufficient → ok («права достаточны»), flags insufficient → owner_appointed
 *   - official_bot actor with missing can_restrict_members → promote_forbidden + warning,
 *     no promote attempt
 *   - membership check failure (бот не видит состав) + autoJoin=false → error,
 *     НЕ missing_membership
 *   - flood_wait stops remaining targets for that actor
 *   - peer-invite (3-й способ): бот-инвайт падает → юзербот-сосед из подтверждённых
 *     ячеек прав (ok/owner_appointed) экспортирует инвайт, вступающий импортирует,
 *     ссылка отзывается, клиент соседа отключается
 *   - экспорт у соседа падает → предупреждение в ячейку, structured failure, не throw
 *   - вступающий исключён из кандидатов (нет self-invite); state=error и
 *     pending_activation не становятся кандидатами
 */
import { Api } from 'telegram';
import {
    CONTOUR_OFFICIAL_BOT_MAX_RIGHTS,
    CONTOUR_USERBOT_MAX_RIGHTS,
    ensureFlagsSufficient,
    classifyTelegramError,
    ContourAdminRightsService
} from '../services/contour-admin-rights.service.js';

let failures = 0;
let passes = 0;
function ok(label) { passes++; console.log(`  ✓ ${label}`); }
function fail(label, expected, actual) {
  failures++;
  console.error(`  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`);
}
function assertEqual(actual, expected, label) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) ok(label);
  else fail(label, expected, actual);
}
function assertTrue(cond, label, extra = null) {
  if (cond) ok(label);
  else fail(label, true, extra);
}

// ---------------------------------------------------------------------------
// Mock Supabase: generic filter builder over in-memory rows + upsert capture.
// ---------------------------------------------------------------------------
function applyFilters(rows, filters) {
  return (rows || []).filter((row) => filters.every(([col, op, val]) => {
    const cell = row[col];
    if (op === 'eq') return String(cell) === String(val);
    if (op === 'neq') return String(cell) !== String(val);
    if (op === 'in') return (val || []).map(String).includes(String(cell));
    return true;
  }));
}

function makeMockSupabase({ bots = [], userbots = [], channels = [], contours = [], bindings = [], actorRights = [] } = {}) {
  const tables = {
    tg_accounts: [...bots, ...userbots],
    channels,
    sales_bot_contours: contours,
    official_bot_userbot_bindings: bindings,
    sales_contour_actor_rights: actorRights,
    shop_items: [],
    shop_item_assets: []
  };
  const upserts = [];
  const supabase = {
    from(table) {
      const rows = tables[table] || [];
      const filters = [];
      const builder = {
        select() { return builder; },
        eq(col, val) { filters.push([col, 'eq', val]); return builder; },
        neq(col, val) { filters.push([col, 'neq', val]); return builder; },
        in(col, vals) { filters.push([col, 'in', vals]); return builder; },
        order() { return builder; },
        limit() { return builder; },
        maybeSingle: async () => ({ data: applyFilters(rows, filters)[0] || null, error: null }),
        single: async () => {
          const found = applyFilters(rows, filters);
          return found.length
            ? { data: found[0], error: null }
            : { data: null, error: { message: 'row not found', code: 'PGRST116' } };
        },
        upsert(payload) {
          const list = Array.isArray(payload) ? payload : [payload];
          for (const row of list) upserts.push({ table, row });
          return {
            select() { return builder; },
            then(resolve) { resolve({ data: payload, error: null }); }
          };
        },
        then(resolve) { resolve({ data: applyFilters(rows, filters), error: null }); }
      };
      return builder;
    }
  };
  supabase._upserts = upserts;
  return supabase;
}

// ---------------------------------------------------------------------------
// Fake Bot API (telegraf.telegram shape) + fake GramJS userbot client.
// adminByChat: { chatId → channels.GetParticipant result }; promote success
// (или onPromoteAttempt) обновляет его, следующая перечитка это видит.
// Fake client реализует РЕАЛЬНУЮ поверхность telegram@2.26.22: getInputEntity +
// invoke (никакого client.getParticipant — его не существует).
// ---------------------------------------------------------------------------
const PLAIN_PARTICIPANT = { className: 'ChannelParticipant' };
const ADMIN_PARTICIPANT = { className: 'ChannelParticipantAdmin', adminRights: { inviteUsers: true, banUsers: true } };
const ADMIN_PARTICIPANT_PARTIAL = { className: 'ChannelParticipantAdmin', adminRights: { inviteUsers: true } };

function makeBotApi({
  members = new Map(),
  adminByChat = {},
  promoteError = null,
  onPromoteAttempt = null,
  getMemberErrorFor = null,
  exportInviteError = null,
  createInviteError = null
} = {}) {
  const calls = { getChatMember: [], promote: [], exportInvite: [], createInvite: [], revoke: [] };
  const api = {
    async getChatMember(chatId, userId) {
      calls.getChatMember.push({ chatId: String(chatId), userId: String(userId) });
      const injected = getMemberErrorFor?.(String(chatId), String(userId));
      if (injected) throw injected;
      const member = members.get(`${chatId}:${userId}`);
      if (!member) {
        throw new Error('Bad Request: user not found');
      }
      return member;
    },
    async promoteChatMember(chatId, userId, rights) {
      calls.promote.push({ chatId: String(chatId), userId: String(userId), rights });
      if (onPromoteAttempt) onPromoteAttempt(String(chatId));
      if (promoteError) throw promoteError;
      members.set(`${chatId}:${userId}`, { status: 'administrator', ...rights });
      adminByChat[String(chatId)] = ADMIN_PARTICIPANT;
      return true;
    },
    async exportChatInviteLink(chatId) {
      calls.exportInvite.push(String(chatId));
      if (exportInviteError) throw exportInviteError;
      return 'https://t.me/+testhash123';
    },
    async createChatInviteLink(chatId, _opts) {
      calls.createInvite.push(String(chatId));
      if (createInviteError) throw createInviteError;
      return { invite_link: 'https://t.me/+testhash456' };
    },
    async revokeChatInviteLink(chatId, link) {
      calls.revoke.push(String(link));
      return true;
    }
  };
  return { api, calls };
}

// Fake GramJS client с реальной поверхностью telegram@2.26.22. Помимо чтения
// админ-состояния умеет join/export/import/revoke — этого требует сценарий
// инвайта от юзербота-соседа (кандидат-экспортёр получает СВОЙ клиент).
function makeUserbotClient({
  peers = {},
  fullChats = {},
  participantResults = {},
  joinError = null,
  joinChannelError = null,
  importError = null,
  exportInviteError = null,
  exportInviteResult = { className: 'ChatInviteExported', link: 'https://t.me/+peerinvite777' }
} = {}) {
  const calls = { getInputEntity: [], invoke: [], getEntity: [], imports: [], exportInvites: [], revokeExports: [], disconnect: 0 };
  const chatByPeer = new Map(Object.entries(peers).map(([chatId, peer]) => [peer, String(chatId)]));
  const client = {
    async getInputEntity(chatId) {
      calls.getInputEntity.push(String(chatId));
      const peer = peers[String(chatId)];
      if (!peer) throw new Error('PEER_ID_INVALID');
      return peer;
    },
    async invoke(request) {
      calls.invoke.push(request);
      if (request instanceof Api.messages.GetFullChat) {
        const result = fullChats[String(request.chatId)];
        if (!result) throw new Error('CHAT_ID_INVALID');
        return result;
      }
      if (request instanceof Api.channels.GetParticipant) {
        const result = participantResults[chatByPeer.get(request.channel)];
        if (result instanceof Error) throw result;
        if (!result) throw new Error('USER_NOT_PARTICIPANT');
        return result;
      }
      if (request instanceof Api.channels.JoinChannel) {
        if (joinChannelError) throw joinChannelError;
        return {};
      }
      if (request instanceof Api.messages.ImportChatInvite) {
        calls.imports.push(request.hash);
        if (importError) throw importError;
        return {};
      }
      if (request instanceof Api.messages.ExportChatInvite) {
        calls.exportInvites.push(chatByPeer.get(request.peer) || '');
        if (exportInviteError) throw exportInviteError;
        return exportInviteResult;
      }
      if (request instanceof Api.messages.EditExportedChatInvite) {
        calls.revokeExports.push(request.link);
        return {};
      }
      if (joinError) throw joinError;
      return {};
    },
    async getEntity(username) {
      calls.getEntity.push(username);
      return { username };
    },
    async disconnect() { calls.disconnect++; return true; }
  };
  return { client, calls, peers };
}

// ---------------------------------------------------------------------------
// Fixture: owner + sales bot (tg 7001) + userbot (tg 8001) + 2 targets
// (public_channel '-100111', public_chat '-100222', оба — каналы/супергруппы).
// ---------------------------------------------------------------------------
const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const BOT_ID = '22222222-2222-4222-8222-222222222222';
const USERBOT_ID = '33333333-3333-4333-8333-333333333333';
const CH1_ID = '44444444-4444-4444-8444-444444444444';
const CH2_ID = '55555555-5555-4555-8555-555555555555';

const FULL_BOT_RIGHTS = {
  status: 'administrator',
  is_admin: true,
  can_manage_chat: true,
  can_invite_users: true,
  can_restrict_members: true,
  can_promote_members: true
};

const FIXTURE_BOT = {
  id: BOT_ID, owner_id: OWNER_ID, account_type: 'bot', tg_username: 'salesbot',
  tg_account_id: '7001', bot_role: 'sales', bot_kind: 'sales',
  runtime_status: 'ok', runtime_error: null, session_data: 'enc:token'
};
const FIXTURE_USERBOT = {
  id: USERBOT_ID, owner_id: OWNER_ID, account_type: 'userbot', tg_account_id: '8001',
  tg_username: 'ub1', session_data: 'enc:session', proxy_id: null,
  runtime_status: 'ok', proxies: null
};
const FIXTURE_CHANNELS = [
  { id: CH1_ID, owner_id: OWNER_ID, bot_id: BOT_ID, tg_chat_id: '-100111', title: 'Chan1', chat_type: 'channel', username: 'chan1', visibility: 'public', created_at: '2026-01-01T00:00:00Z' },
  { id: CH2_ID, owner_id: OWNER_ID, bot_id: BOT_ID, tg_chat_id: '-100222', title: 'Chat1', chat_type: 'supergroup', username: null, visibility: 'unknown', created_at: '2026-01-02T00:00:00Z' }
];

// Юзербот-сосед (уже админ в площадке — приглашает вступающего) и юзербот
// с pending_activation (для проверки отбраковки кандидатов).
const PEER_USERBOT_ID = '66666666-6666-4666-8666-666666666666';
const PENDING_USERBOT_ID = '77777777-7777-4777-8777-777777777777';
const PEER_USERBOT = {
  id: PEER_USERBOT_ID, owner_id: OWNER_ID, account_type: 'userbot', tg_account_id: '9001',
  tg_username: 'ub2admin', session_data: 'enc:session', proxy_id: null,
  runtime_status: 'ok', proxies: null
};
const PENDING_USERBOT = {
  id: PENDING_USERBOT_ID, owner_id: OWNER_ID, account_type: 'userbot', tg_account_id: '9101',
  tg_username: 'ub-pending', session_data: 'enc:session', proxy_id: null,
  runtime_status: 'pending_activation', proxies: null
};

// Среда сценариев инвайта от соседа: одна площадка (public_channel '-100111'),
// бот-инвайт всегда падает (бота в площадке нет), username-вступление падает
// (CHAT_INVITE_REQUIRED). Первая проверка членства вступающего прячет его запись
// в членах (иначе до join дело не дойдёт), повторная — видит (после импорта инвайта).
function makePeerInviteEnv({
  actorRights = [],
  userbots = [FIXTURE_USERBOT, PEER_USERBOT],
  membersForJoiner = true,
  joinChannelError = new Error('CHAT_INVITE_REQUIRED'),
  exportInviteError = null,
  exportInviteResult = { className: 'ChatInviteExported', link: 'https://t.me/+peerinvite777' },
  botInviteError = new Error('Forbidden: bot is not a member of the supergroup chat')
} = {}) {
  const members = new Map();
  members.set('-100111:7001', FULL_BOT_RIGHTS);
  let joinerChecks = 0;
  if (membersForJoiner) members.set('-100111:8001', { status: 'member' });

  const adminByChat = { '-100111': PLAIN_PARTICIPANT };
  const botApi = makeBotApi({
    members,
    adminByChat,
    exportInviteError: botInviteError,
    createInviteError: botInviteError,
    getMemberErrorFor: membersForJoiner
      ? (_chatId, userId) => (userId === '8001' && joinerChecks++ === 0)
        ? new Error('Bad Request: user not found')
        : null
      : null
  });

  const peers = {
    '-100111': new Api.InputPeerChannel({ channelId: BigInt('1011'), accessHash: BigInt('1') })
  };
  const joiner = makeUserbotClient({
    peers,
    participantResults: adminByChat,
    joinChannelError
  });
  const exporter = makeUserbotClient({ peers, exportInviteError, exportInviteResult });

  const factoryCalls = [];
  const clientFactory = async (account) => {
    factoryCalls.push(String(account.id));
    return String(account.id) === PEER_USERBOT_ID ? exporter.client : joiner.client;
  };

  const supabase = makeMockSupabase({
    bots: [FIXTURE_BOT],
    userbots,
    channels: [FIXTURE_CHANNELS[0]],
    contours: [{
      bot_id: BOT_ID, owner_id: OWNER_ID,
      public_channel_id: CH1_ID, paid_channel_id: null,
      public_chat_id: null, paid_chat_id: null,
      userbot_mode: 'single', selected_userbot_id: USERBOT_ID, selected_userbot_ids: []
    }],
    bindings: [{ bot_id: BOT_ID, userbot_id: USERBOT_ID, is_active: true }],
    actorRights
  });

  const service = makeService(supabase, botApi, joiner.client, clientFactory);
  return { supabase, botApi, joiner, exporter, factoryCalls, service, adminByChat, peers };
}

function makeActorRightRow(actorId, state, target = 'public_channel') {
  return {
    owner_id: OWNER_ID, bot_id: BOT_ID, actor_type: 'userbot', actor_id: actorId,
    target, channel_id: CH1_ID, state, is_admin: true, flags: {},
    warnings: [], message: '', checked_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z'
  };
}

function makeService(supabase, botApi, client, clientFactory = null) {
  return new ContourAdminRightsService(supabase, {
    botApiFactory: async () => botApi.api,
    userbotClientFactory: clientFactory || (async () => client.client),
    sleep: async () => {},
    now: () => 1758000000000
  });
}

function makeEnv({
  botMember = FULL_BOT_RIGHTS,
  userbotMember = null,
  withUserbot = true,
  promoteError = null,
  getMemberErrorFor = null
} = {}) {
  const members = new Map();
  if (botMember) {
    members.set('-100111:7001', botMember);
    members.set('-100222:7001', botMember);
  }
  if (userbotMember) {
    members.set('-100111:8001', userbotMember);
    members.set('-100222:8001', userbotMember);
  }
  const adminByChat = {
    '-100111': PLAIN_PARTICIPANT,
    '-100222': PLAIN_PARTICIPANT
  };

  const botApi = makeBotApi({ members, adminByChat, promoteError, getMemberErrorFor });
  const peers = {
    '-100111': new Api.InputPeerChannel({ channelId: BigInt('1011'), accessHash: BigInt('1') }),
    '-100222': new Api.InputPeerChannel({ channelId: BigInt('1022'), accessHash: BigInt('1') })
  };
  const client = makeUserbotClient({ peers, participantResults: adminByChat });

  const supabase = makeMockSupabase({
    bots: [FIXTURE_BOT],
    userbots: withUserbot ? [FIXTURE_USERBOT] : [],
    channels: FIXTURE_CHANNELS,
    contours: [{
      bot_id: BOT_ID, owner_id: OWNER_ID,
      public_channel_id: CH1_ID, paid_channel_id: null,
      public_chat_id: CH2_ID, paid_chat_id: null,
      userbot_mode: withUserbot ? 'single' : 'none',
      selected_userbot_id: withUserbot ? USERBOT_ID : null,
      selected_userbot_ids: []
    }],
    bindings: withUserbot ? [{ bot_id: BOT_ID, userbot_id: USERBOT_ID, is_active: true }] : []
  });

  const service = makeService(supabase, botApi, client);
  return { supabase, botApi, client, service, adminByChat, peers };
}

// ---------------------------------------------------------------------------
// 1. Pure: ensureFlagsSufficient
// ---------------------------------------------------------------------------
console.log('\n[ensureFlagsSufficient]');
{
  assertEqual(
    ensureFlagsSufficient({ status: 'creator' }, CONTOUR_USERBOT_MAX_RIGHTS),
    { sufficient: true, missing: [] },
    'creator with no flags object counts as all-sufficient'
  );
  assertEqual(
    ensureFlagsSufficient({
      status: 'administrator', is_admin: true,
      can_invite_users: true, can_restrict_members: false
    }, CONTOUR_USERBOT_MAX_RIGHTS),
    { sufficient: false, missing: ['can_restrict_members'] },
    'missing can_restrict_members detected'
  );
  assertEqual(
    ensureFlagsSufficient({ is_admin: false }, {}),
    { sufficient: true, missing: [] },
    'empty desired → sufficient'
  );
  assertEqual(
    ensureFlagsSufficient({
      status: 'administrator', is_admin: true,
      can_manage_chat: true, can_invite_users: true,
      can_restrict_members: true, can_promote_members: true
    }, CONTOUR_OFFICIAL_BOT_MAX_RIGHTS),
    { sufficient: true, missing: [] },
    'admin with all official-bot flags → sufficient'
  );
}

// ---------------------------------------------------------------------------
// 2. Pure: classifyTelegramError
// ---------------------------------------------------------------------------
console.log('\n[classifyTelegramError]');
{
  assertEqual(
    classifyTelegramError(new Error('Bad Request: CHAT_ADMIN_REQUIRED'), 'administrator'),
    'owner_appointed',
    'CHAT_ADMIN_REQUIRED + administrator → owner_appointed'
  );
  assertEqual(
    classifyTelegramError({ errorMessage: 'CHAT_ADMIN_REQUIRED' }, 'member'),
    'promote_forbidden',
    'CHAT_ADMIN_REQUIRED + member → promote_forbidden'
  );
  assertEqual(
    classifyTelegramError(new Error('Bad Request: not enough rights to restrict/unrestrict chat member'), 'member'),
    'promote_forbidden',
    '"not enough rights" + member → promote_forbidden'
  );
  const floodErr = new Error('FLOOD_WAIT_42');
  assertEqual(classifyTelegramError(floodErr, 'member'), 'flood_wait', 'FLOOD_WAIT → flood_wait');
  assertEqual(floodErr.retry_after, 42, 'FLOOD_WAIT extracts retry_after');
  assertEqual(
    classifyTelegramError({ errorMessage: 'USER_ALREADY_PARTICIPANT' }, 'member'),
    'already_member',
    'USER_ALREADY_PARTICIPANT → already_member'
  );
  assertEqual(
    classifyTelegramError(new Error('Something else happened'), 'administrator'),
    'unknown',
    'unrelated error → unknown'
  );
}

// ---------------------------------------------------------------------------
// 3. userbot not member + autoJoin=false → missing_membership, no join attempted
// ---------------------------------------------------------------------------
console.log('\n[ensureAll] userbot not member, autoJoin=false');
{
  const { botApi, client, service } = makeEnv({ userbotMember: null });
  const res = await service.ensureAll(OWNER_ID, { botId: BOT_ID, autoJoin: false });

  const userbotCells = res.results.filter((r) => r.actor_type === 'userbot');
  assertEqual(userbotCells.map((r) => r.state), ['missing_membership', 'missing_membership'], 'userbot cells → missing_membership');
  assertEqual(client.calls.invoke.length, 0, 'no join attempted');
  assertEqual(client.calls.getInputEntity.length, 0, 'no admin read attempted');
  assertEqual(botApi.calls.promote.length, 0, 'no promote attempted');
  assertEqual(res.results.filter((r) => r.actor_type === 'official_bot').length, 2, 'official bot cells present');
  assertTrue(res.summary.includes('2 из 4'), 'summary format', res.summary);
}

// ---------------------------------------------------------------------------
// 4. member, not admin, promote ok → ok + upsert row with flags
// ---------------------------------------------------------------------------
console.log('\n[ensureAll] member, not admin, promote ok');
{
  const { botApi, client, supabase, service } = makeEnv({ userbotMember: { status: 'member' } });
  const res = await service.ensureAll(OWNER_ID, { botId: BOT_ID, autoJoin: true });

  const cell = res.results.find((r) => r.actor_type === 'userbot' && r.target === 'public_channel');
  assertEqual(cell?.state, 'ok', 'userbot cell → ok');
  assertEqual(botApi.calls.promote[0]?.rights, { can_invite_users: true, can_restrict_members: true }, 'promote called with CONTOUR_USERBOT_MAX_RIGHTS');
  assertEqual(cell?.actor_username, 'ub1', 'userbot cell carries actor_username');
  assertEqual(res.results.find((r) => r.actor_type === 'official_bot')?.actor_username, 'salesbot', 'official bot cell carries actor_username');
  assertEqual(client.calls.disconnect, 1, 'userbot client disconnected once');

  const row = supabase._upserts.find((u) => u.table === 'sales_contour_actor_rights'
    && u.row.actor_type === 'userbot' && u.row.target === 'public_channel');
  assertTrue(!!row, 'upsert row written', supabase._upserts.map((u) => u.table));
  assertEqual(row?.row?.state, 'ok', 'upsert row state ok');
  assertEqual(row?.row?.is_admin, true, 'upsert row is_admin true');
  assertEqual(row?.row?.flags?.can_restrict_members, true, 'upsert row flags include can_restrict_members');
  assertEqual(row?.row?.bot_id, BOT_ID, 'upsert row bot_id');
  assertEqual(row?.row?.owner_id, OWNER_ID, 'upsert row owner_id');
}

// ---------------------------------------------------------------------------
// 5. Форма чтения админ-состояния: resolved peer + channels.GetParticipant(InputPeerSelf)
// ---------------------------------------------------------------------------
console.log('\n[ensureAll] admin read shape: GetParticipant(InputPeerSelf) with resolved peer');
{
  const { client, peers, service } = makeEnv({ userbotMember: { status: 'member' } });
  await service.ensureAll(OWNER_ID, { botId: BOT_ID, autoJoin: true });

  const getParticipantRequests = client.calls.invoke.filter((r) => r instanceof Api.channels.GetParticipant);
  assertTrue(getParticipantRequests.length > 0, 'channels.GetParticipant used for channel/supergroup targets');
  assertTrue(
    getParticipantRequests.every((r) => r.participant instanceof Api.InputPeerSelf),
    'participant is InputPeerSelf (InputUserSelf не кастится в InputPeer)',
    getParticipantRequests[0]?.participant
  );
  assertTrue(
    getParticipantRequests.every((r) => r.channel === peers['-100111'] || r.channel === peers['-100222']),
    'channel is the resolved peer returned by getInputEntity'
  );
  assertTrue(
    client.calls.getInputEntity.every((c) => c === '-100111' || c === '-100222'),
    'getInputEntity called with chat ids'
  );
}

// ---------------------------------------------------------------------------
// 6. promote throws CHAT_ADMIN_REQUIRED + re-read administrator без флагов → owner_appointed
// ---------------------------------------------------------------------------
console.log('\n[ensureAll] CHAT_ADMIN_REQUIRED + re-read administrator (flags missing) → owner_appointed');
{
  // promote падает с CHAT_ADMIN_REQUIRED, onPromoteAttempt помечает юзербота админом
  // БЕЗ can_restrict_members: re-read видит administrator с неполными флагами.
  const members = new Map();
  members.set('-100111:7001', FULL_BOT_RIGHTS);
  members.set('-100222:7001', FULL_BOT_RIGHTS);
  members.set('-100111:8001', { status: 'member' });
  members.set('-100222:8001', { status: 'member' });
  const adminByChat = { '-100111': PLAIN_PARTICIPANT, '-100222': PLAIN_PARTICIPANT };
  const botApi = makeBotApi({
    members,
    adminByChat,
    promoteError: new Error('Bad Request: CHAT_ADMIN_REQUIRED'),
    onPromoteAttempt: (chatId) => { adminByChat[chatId] = ADMIN_PARTICIPANT_PARTIAL; }
  });
  const peers = {
    '-100111': new Api.InputPeerChannel({ channelId: BigInt('1011'), accessHash: BigInt('1') }),
    '-100222': new Api.InputPeerChannel({ channelId: BigInt('1022'), accessHash: BigInt('1') })
  };
  const client = makeUserbotClient({ peers, participantResults: adminByChat });
  const supabase = makeMockSupabase({
    bots: [FIXTURE_BOT],
    userbots: [FIXTURE_USERBOT],
    channels: FIXTURE_CHANNELS,
    contours: [{
      bot_id: BOT_ID, owner_id: OWNER_ID,
      public_channel_id: CH1_ID, paid_channel_id: null,
      public_chat_id: CH2_ID, paid_chat_id: null,
      userbot_mode: 'single', selected_userbot_id: USERBOT_ID, selected_userbot_ids: []
    }],
    bindings: [{ bot_id: BOT_ID, userbot_id: USERBOT_ID, is_active: true }]
  });
  const service = makeService(supabase, botApi, client);

  const res = await service.ensureAll(OWNER_ID, { botId: BOT_ID, autoJoin: true });
  const userbotCells = res.results.filter((r) => r.actor_type === 'userbot');
  assertEqual(userbotCells.map((r) => r.state), ['owner_appointed', 'owner_appointed'], 'cells → owner_appointed (not error)');
  assertTrue(userbotCells.every((r) => r.is_admin === true), 'owner_appointed cells is_admin true');
  assertTrue(
    userbotCells.every((r) => (r.warnings || []).some((w) => w.includes('Не хватает прав') && w.includes('выдай вручную'))),
    'warning lists missing flags and manual grant',
    userbotCells[0]?.warnings
  );
  assertTrue(
    userbotCells.every((r) => r.message.includes('выдай вручную')),
    'message mentions manual grant',
    userbotCells[0]?.message
  );
}

// ---------------------------------------------------------------------------
// 7. promote throws CHAT_ADMIN_REQUIRED + re-read administrator с полными флагами → ok
// ---------------------------------------------------------------------------
console.log('\n[ensureAll] CHAT_ADMIN_REQUIRED + re-read administrator (flags sufficient) → ok');
{
  const members = new Map();
  members.set('-100111:7001', FULL_BOT_RIGHTS);
  members.set('-100222:7001', FULL_BOT_RIGHTS);
  members.set('-100111:8001', { status: 'member' });
  members.set('-100222:8001', { status: 'member' });
  const adminByChat = { '-100111': PLAIN_PARTICIPANT, '-100222': PLAIN_PARTICIPANT };
  const botApi = makeBotApi({
    members,
    adminByChat,
    promoteError: new Error('Bad Request: CHAT_ADMIN_REQUIRED'),
    onPromoteAttempt: (chatId) => { adminByChat[chatId] = ADMIN_PARTICIPANT; }
  });
  const peers = {
    '-100111': new Api.InputPeerChannel({ channelId: BigInt('1011'), accessHash: BigInt('1') }),
    '-100222': new Api.InputPeerChannel({ channelId: BigInt('1022'), accessHash: BigInt('1') })
  };
  const client = makeUserbotClient({ peers, participantResults: adminByChat });
  const supabase = makeMockSupabase({
    bots: [FIXTURE_BOT],
    userbots: [FIXTURE_USERBOT],
    channels: FIXTURE_CHANNELS,
    contours: [{
      bot_id: BOT_ID, owner_id: OWNER_ID,
      public_channel_id: CH1_ID, paid_channel_id: null,
      public_chat_id: CH2_ID, paid_chat_id: null,
      userbot_mode: 'single', selected_userbot_id: USERBOT_ID, selected_userbot_ids: []
    }],
    bindings: [{ bot_id: BOT_ID, userbot_id: USERBOT_ID, is_active: true }]
  });
  const service = makeService(supabase, botApi, client);

  const res = await service.ensureAll(OWNER_ID, { botId: BOT_ID, autoJoin: true });
  const userbotCells = res.results.filter((r) => r.actor_type === 'userbot');
  assertEqual(userbotCells.map((r) => r.state), ['ok', 'ok'], 'cells → ok (rights sufficient)');
  assertTrue(
    userbotCells.every((r) => (r.warnings || []).some((w) => w.includes('права достаточны'))),
    'warning mentions owner-appointed rights are sufficient',
    userbotCells[0]?.warnings
  );
}

// ---------------------------------------------------------------------------
// 8. official_bot actor with missing can_restrict_members → promote_forbidden, no promote
// ---------------------------------------------------------------------------
console.log('\n[ensureAll] official bot missing can_restrict_members');
{
  const { botApi, service } = makeEnv({
    withUserbot: false,
    botMember: {
      status: 'administrator', is_admin: true,
      can_manage_chat: true, can_invite_users: true,
      can_restrict_members: false, can_promote_members: true
    }
  });
  const res = await service.ensureAll(OWNER_ID, { botId: BOT_ID });

  const botCells = res.results.filter((r) => r.actor_type === 'official_bot');
  assertEqual(botCells.map((r) => r.state), ['promote_forbidden', 'promote_forbidden'], 'bot cells → promote_forbidden');
  assertTrue(
    botCells.every((r) => (r.warnings || []).some((w) => w.includes('выдай боту права вручную'))),
    'warning tells to grant rights manually',
    botCells[0]?.warnings
  );
  assertTrue(
    botCells.every((r) => (r.warnings || []).some((w) => w.includes('can_restrict_members'))),
    'warning lists missing flag',
    botCells[0]?.warnings
  );
  assertEqual(botApi.calls.promote.length, 0, 'no promote attempt for official bot');
  assertEqual(res.results.length, 2, 'only official bot actor cells (no userbots configured)');
}

// ---------------------------------------------------------------------------
// 9. membership check failure + autoJoin=false → error, НЕ missing_membership
// ---------------------------------------------------------------------------
console.log('\n[ensureAll] membership check failure (bot cannot see members), autoJoin=false');
{
  const { botApi, client, service } = makeEnv({
    userbotMember: { status: 'member' },
    getMemberErrorFor: (_chatId, userId) => userId === '8001'
      ? new Error('Forbidden: bot is not a member of the channel chat')
      : null
  });
  const res = await service.ensureAll(OWNER_ID, { botId: BOT_ID, autoJoin: false });

  const userbotCells = res.results.filter((r) => r.actor_type === 'userbot');
  assertEqual(userbotCells.map((r) => r.state), ['error', 'error'], 'check failure → error state, not missing_membership');
  assertTrue(
    userbotCells.every((r) => r.message.includes('не удалось проверить членство')),
    'message explains the membership check failure',
    userbotCells[0]?.message
  );
  assertEqual(botApi.calls.promote.length, 0, 'no promote attempted');
  assertEqual(client.calls.invoke.length, 0, 'no join / admin read attempted');
}

// ---------------------------------------------------------------------------
// 10. flood_wait stops remaining targets for that actor
// ---------------------------------------------------------------------------
console.log('\n[ensureAll] flood_wait stops remaining targets for the actor');
{
  const { botApi, client, peers, service } = makeEnv({
    userbotMember: { status: 'member' },
    promoteError: new Error('FLOOD_WAIT_30')
  });
  const res = await service.ensureAll(OWNER_ID, { botId: BOT_ID, autoJoin: true });

  const userbotCells = res.results.filter((r) => r.actor_type === 'userbot');
  assertEqual(userbotCells.length, 1, 'flood stops remaining userbot targets');
  assertEqual(userbotCells[0]?.state, 'error', 'flood cell → error');
  assertTrue(userbotCells[0]?.message.includes('flood wait'), 'flood cell message mentions flood wait', userbotCells[0]?.message);
  assertEqual(botApi.calls.promote.length, 1, 'promote attempted once only');
  assertTrue(
    client.calls.getInputEntity.every((c) => c === '-100111'),
    'no userbot client reads for second target',
    client.calls.getInputEntity
  );
  assertTrue(
    client.calls.invoke
      .filter((r) => r instanceof Api.channels.GetParticipant)
      .every((r) => r.channel === peers['-100111']),
    'no GetParticipant for second target',
    client.calls.invoke
  );
  assertEqual(res.results.filter((r) => r.actor_type === 'official_bot').length, 2, 'official bot actor unaffected by userbot flood');
}

// ---------------------------------------------------------------------------
// 11. базисная группа: InputPeerChat → GetFullChat → self ищется по userId
// ---------------------------------------------------------------------------
console.log('\n[ensureAll] basic group: GetFullChat branch, self found by userId');
{
  const members = new Map();
  members.set('-100333:7001', FULL_BOT_RIGHTS);
  members.set('-100333:8001', { status: 'member' });
  const botApi = makeBotApi({ members, adminByChat: {} });
  const peer = new Api.InputPeerChat({ chatId: BigInt('333') });
  const client = makeUserbotClient({
    peers: { '-100333': peer },
    fullChats: {
      '333': {
        fullChat: {
          participants: {
            participants: [
              { className: 'ChatParticipant', userId: BigInt('999999') },
              { className: 'ChatParticipantAdmin', userId: BigInt('8001') }
            ]
          }
        }
      }
    }
  });
  const supabase = makeMockSupabase({
    bots: [FIXTURE_BOT],
    userbots: [FIXTURE_USERBOT],
    channels: [{
      id: CH1_ID, owner_id: OWNER_ID, bot_id: BOT_ID, tg_chat_id: '-100333',
      title: 'BasicGroup', chat_type: 'group', username: null,
      visibility: 'unknown', created_at: '2026-01-01T00:00:00Z'
    }],
    contours: [{
      bot_id: BOT_ID, owner_id: OWNER_ID,
      public_channel_id: CH1_ID, paid_channel_id: null,
      public_chat_id: null, paid_chat_id: null,
      userbot_mode: 'single', selected_userbot_id: USERBOT_ID, selected_userbot_ids: []
    }],
    bindings: [{ bot_id: BOT_ID, userbot_id: USERBOT_ID, is_active: true }]
  });
  const service = makeService(supabase, botApi, client);

  const res = await service.ensureAll(OWNER_ID, { botId: BOT_ID, autoJoin: true });
  const cell = res.results.find((r) => r.actor_type === 'userbot');
  assertEqual(cell?.state, 'ok', 'basic group: self found as ChatParticipantAdmin → all flags → ok');
  assertEqual(cell?.flags?.can_restrict_members, true, 'basic-group admin gets all flags');
  assertTrue(
    client.calls.invoke.some((r) => r instanceof Api.messages.GetFullChat),
    'messages.GetFullChat used for basic group'
  );
  assertEqual(
    client.calls.invoke.filter((r) => r instanceof Api.channels.GetParticipant).length,
    0,
    'no channels.GetParticipant for basic group'
  );
  assertEqual(botApi.calls.promote.length, 0, 'no promote needed for basic-group admin');
}

// ---------------------------------------------------------------------------
// 12. peer-invite: бот-инвайт падает → юзербот-сосед приглашает, revoke + disconnect
// ---------------------------------------------------------------------------
console.log('\n[ensureAll] peer userbot invite: joiner joins via peer admin invite');
{
  const { botApi, joiner, exporter, factoryCalls, service } = makePeerInviteEnv({
    actorRights: [makeActorRightRow(PEER_USERBOT_ID, 'ok')]
  });
  const res = await service.ensureAll(OWNER_ID, { botId: BOT_ID, autoJoin: true });

  const cell = res.results.find((r) => r.actor_type === 'userbot' && r.target === 'public_channel');
  assertEqual(cell?.state, 'ok', 'join via peer invite confirmed → cell ok');
  assertEqual(botApi.calls.exportInvite, ['-100111'], 'bot export attempted (and failed) before peer invite');
  assertEqual(botApi.calls.createInvite, ['-100111'], 'bot createInvite attempted (and failed) before peer invite');
  assertTrue(joiner.calls.invoke.some((r) => r instanceof Api.channels.JoinChannel), 'JoinChannel tried before peer invite');
  assertEqual(joiner.calls.imports, ['peerinvite777'], 'joiner imported hash from peer-exported link');
  assertEqual(exporter.calls.exportInvites.length, 1, 'peer exported invite exactly once');
  assertEqual(exporter.calls.revokeExports, ['https://t.me/+peerinvite777'], 'revoke attempted with the exported link');
  assertEqual(exporter.calls.disconnect, 1, 'exporter client disconnected once');
  assertEqual(factoryCalls.filter((id) => id === PEER_USERBOT_ID).length, 1, 'exporter client opened exactly once');
  assertTrue(
    (cell.warnings || []).some((w) => w.includes('только что вступил')),
    'cell notes fresh join',
    cell?.warnings
  );
}

// ---------------------------------------------------------------------------
// 13. экспорт у соседа падает → предупреждение, structured failure, не throw
// ---------------------------------------------------------------------------
console.log('\n[ensureAll] peer invite: export throws → warning, structured failure');
{
  const { joiner, exporter, service } = makePeerInviteEnv({
    actorRights: [makeActorRightRow(PEER_USERBOT_ID, 'ok')],
    exportInviteError: new Error('CHAT_ADMIN_REQUIRED')
  });
  const res = await service.ensureAll(OWNER_ID, { botId: BOT_ID, autoJoin: true });

  const cell = res.results.find((r) => r.actor_type === 'userbot' && r.target === 'public_channel');
  assertEqual(cell?.state, 'missing_membership', 'export failure → structured missing_membership cell');
  assertTrue(
    (cell?.warnings || []).some((w) => w.includes('не смог сделать инвайт') && w.includes('ub2admin')),
    'warning names the failed peer exporter',
    cell?.warnings
  );
  assertTrue(
    String(cell?.message || '').includes('ни одним из способов'),
    'cell message lists all join methods failed',
    cell?.message
  );
  assertEqual(joiner.calls.imports, [], 'no import attempted without a link');
  assertEqual(exporter.calls.disconnect, 1, 'exporter still disconnected after export failure');
  assertEqual(exporter.calls.revokeExports, [], 'no revoke attempted without exported link');
}

// ---------------------------------------------------------------------------
// 14. вступающий исключён из кандидатов; state=error и pending_activation — не кандидаты
// ---------------------------------------------------------------------------
console.log('\n[ensureAll] peer invite: joining actor excluded, bad candidates filtered out');
{
  const { joiner, exporter, factoryCalls, service } = makePeerInviteEnv({
    actorRights: [
      makeActorRightRow(USERBOT_ID, 'ok'),
      makeActorRightRow(PENDING_USERBOT_ID, 'ok'),
      makeActorRightRow(PEER_USERBOT_ID, 'error')
    ],
    userbots: [FIXTURE_USERBOT, PEER_USERBOT, PENDING_USERBOT],
    membersForJoiner: false
  });
  const res = await service.ensureAll(OWNER_ID, { botId: BOT_ID, autoJoin: true });

  const cell = res.results.find((r) => r.actor_type === 'userbot' && r.target === 'public_channel');
  assertEqual(cell?.state, 'missing_membership', 'no eligible candidates → missing_membership');
  assertEqual(exporter.calls.exportInvites, [], 'no invite export attempted');
  assertEqual(factoryCalls.filter((id) => id === PEER_USERBOT_ID).length, 0, 'state=error row never opened as exporter');
  assertEqual(factoryCalls.filter((id) => id === PENDING_USERBOT_ID).length, 0, 'pending_activation row never opened as exporter');
  assertEqual(joiner.calls.imports, [], 'no self-invite import attempted');
}

console.log(`\n=== contour-admin-rights: ${passes} passed, ${failures} failed ===`);
if (failures > 0) process.exit(1);
