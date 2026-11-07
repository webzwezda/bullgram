// Сценарий из test/test-contour-admin-rights.js (разрезка под лимит pre-commit; хост — test/test-contour-admin-rights.js).
import { Api } from 'teleproto';
import { assertEqual, assertTrue, PLAIN_PARTICIPANT, ADMIN_PARTICIPANT_PARTIAL, makeBotApi, makeUserbotClient, makeMockSupabase, makeService, FULL_BOT_RIGHTS, FIXTURE_BOT, FIXTURE_USERBOT, FIXTURE_CHANNELS, OWNER_ID, BOT_ID, USERBOT_ID, CH1_ID, CH2_ID } from './shared.js';

export async function runOwnerAppointedPartialFlags() {
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
}
