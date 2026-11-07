// Общие фикстуры сценариев test/contour-admin-rights/* (вынесено из test/test-contour-admin-rights.js вербатимно).
import { Api } from 'teleproto';
import { ContourAdminRightsService } from '../../services/contour-admin-rights.service.js';

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

export function getPasses() {
  return passes;
}

export function getFailures() {
  return failures;
}

export {
  assertEqual,
  assertTrue,
  makeMockSupabase,
  PLAIN_PARTICIPANT,
  ADMIN_PARTICIPANT,
  ADMIN_PARTICIPANT_PARTIAL,
  makeBotApi,
  makeUserbotClient,
  OWNER_ID,
  BOT_ID,
  USERBOT_ID,
  CH1_ID,
  CH2_ID,
  FULL_BOT_RIGHTS,
  FIXTURE_BOT,
  FIXTURE_USERBOT,
  FIXTURE_CHANNELS,
  PEER_USERBOT_ID,
  PENDING_USERBOT_ID,
  PEER_USERBOT,
  PENDING_USERBOT,
  makePeerInviteEnv,
  makeActorRightRow,
  makeService,
  makeEnv
};
