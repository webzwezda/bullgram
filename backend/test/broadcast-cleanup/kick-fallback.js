import {
    OWNER, UB1, NOW_ISO,
    assertEqual, assertTrue,
    makeEnv, makeCampaign, makeJoin, makeAccount, peerChannel, isClass
} from './shared.js';

// ---------------------------------------------------------------------------
// (e) фолбэк: kick через промоутера удался
// ---------------------------------------------------------------------------
console.log('\n[kick fallback: promoter kicked]');
{
  const kickCalls = [];
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
        if (isClass(request, 'LeaveChannel')) throw new Error('CHANNEL_PRIVATE');
        return {};
      }
    },
    kickViaPromoter: async (args) => { kickCalls.push(args); return true; }
  });
  await cleanup.runCleanupTick();

  const row = supabase._tables.broadcast_preparation_joins[0];
  assertEqual(row.remove_status, 'kicked', 'kick удался → kicked');
  assertEqual(row.removed_at, NOW_ISO, 'removed_at выставлен');
  assertEqual(kickCalls[0]?.ownerId, OWNER, 'фолбэку передан ownerId');
  assertEqual(kickCalls[0]?.chatId, '-100555', 'фолбэку передан chatId');
  assertEqual(kickCalls[0]?.joinerTgUserId, '424242', 'фолбэку передан tg_id joiner-а');
  assertEqual(kickCalls[0]?.joinerUserbotId, UB1, 'фолбэку передан userbot_id joiner-а');
}

// ---------------------------------------------------------------------------
// (f) фолбэк: промоутера нет → failed
// ---------------------------------------------------------------------------
console.log('\n[kick fallback: no promoter → failed]');
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
        if (isClass(request, 'LeaveChannel')) throw new Error('CHANNEL_PRIVATE');
        return {};
      }
    },
    kickViaPromoter: async () => false
  });
  await cleanup.runCleanupTick();

  const row = supabase._tables.broadcast_preparation_joins[0];
  assertEqual(row.remove_status, 'failed', 'нет промоутера → failed');
  assertEqual(row.removed_at, null, 'removed_at остаётся null');
  assertTrue(String(row.remove_error || '').length > 0, 'remove_error заполнен');
  assertEqual(supabase._tables.broadcast_campaigns[0].meta.cleanup, { total: 1, done: 0, failed: 1 }, 'failed учтён в meta.cleanup');
}
