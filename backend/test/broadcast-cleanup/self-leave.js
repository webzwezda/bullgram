import { Api } from 'telegram';
import {
    OWNER, NOW_ISO,
    assertEqual, assertTrue,
    makeEnv, makeCampaign, makeJoin, makeAccount, peerChannel, isClass
} from './shared.js';

// ---------------------------------------------------------------------------
// (c) самовыход: LeaveChannel + DeleteChatUser
// ---------------------------------------------------------------------------
console.log('\n[self-leave: LeaveChannel success]');
{
  const { supabase, factory, cleanup } = makeEnv({
    tables: {
      broadcast_campaigns: [makeCampaign()],
      broadcast_preparation_joins: [makeJoin({ id: 'j1' })],
      channels: [],
      sales_bot_contours: [],
      tg_accounts: [makeAccount()]
    },
    clientImpl: { getInputEntity: () => peerChannel() }
  });
  await cleanup.runCleanupTick();

  const row = supabase._tables.broadcast_preparation_joins[0];
  assertEqual(row.remove_status, 'left', 'успешный выход → left');
  assertEqual(row.removed_at, NOW_ISO, 'removed_at выставлен');
  assertEqual(row.remove_error, null, 'без ошибки');
  const leave = factory.calls.invocations.find((c) => isClass(c, 'LeaveChannel'));
  assertTrue(leave, 'ушёл channels.LeaveChannel');
  assertTrue(factory.calls.disconnects >= 1, 'клиент отключён в finally');
  assertEqual(supabase._tables.broadcast_campaigns[0].meta.cleanup, { total: 1, done: 1, failed: 0 }, 'meta.cleanup');
}

console.log('[self-leave: basic group via DeleteChatUser]');
{
  const { factory, cleanup } = makeEnv({
    tables: {
      broadcast_campaigns: [makeCampaign()],
      broadcast_preparation_joins: [makeJoin({ id: 'j1' })],
      channels: [],
      sales_bot_contours: [],
      tg_accounts: [makeAccount()]
    },
    clientImpl: { getInputEntity: () => new Api.InputPeerChat({ chatId: BigInt(777) }) }
  });
  await cleanup.runCleanupTick();

  const del = factory.calls.invocations.find((c) => isClass(c, 'DeleteChatUser'));
  assertTrue(del, 'basic-группа → messages.DeleteChatUser');
  assertEqual(String(del?.request.chatId), '777', 'chatId из InputPeerChat');
  assertTrue(del?.request.userId instanceof Api.InputUserSelf, 'userId = InputUserSelf (InputPeerSelf сервер отклоняет)');
}

// ---------------------------------------------------------------------------
// (d) USER_NOT_PARTICIPANT = уже вышел
// ---------------------------------------------------------------------------
console.log('\n[self-leave: USER_NOT_PARTICIPANT]');
{
  const { supabase, cleanup } = makeEnv({
    tables: {
      broadcast_campaigns: [makeCampaign()],
      broadcast_preparation_joins: [makeJoin({ id: 'j1' })],
      channels: [],
      sales_bot_contours: [],
      tg_accounts: [makeAccount()]
    },
    clientImpl: {
      getInputEntity: () => peerChannel(),
      invoke: (request) => {
        if (isClass(request, 'LeaveChannel')) throw new Error('Telegram error: USER_NOT_PARTICIPANT');
        return {};
      }
    }
  });
  await cleanup.runCleanupTick();

  const row = supabase._tables.broadcast_preparation_joins[0];
  assertEqual(row.remove_status, 'left', 'уже не участник → left');
  assertEqual(row.remove_error, 'уже не участник', 'remove_error с коротким текстом');
  assertEqual(row.removed_at, NOW_ISO, 'removed_at выставлен');
}
