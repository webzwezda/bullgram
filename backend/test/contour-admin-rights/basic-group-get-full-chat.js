// Сценарий из test/test-contour-admin-rights.js (разрезка под лимит pre-commit; хост — test/test-contour-admin-rights.js).
import { Api } from 'teleproto';
import { assertEqual, assertTrue, makeBotApi, makeUserbotClient, makeMockSupabase, makeService, FULL_BOT_RIGHTS, FIXTURE_BOT, FIXTURE_USERBOT, OWNER_ID, BOT_ID, USERBOT_ID, CH1_ID } from './shared.js';

export async function runBasicGroupGetFullChat() {
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
}
