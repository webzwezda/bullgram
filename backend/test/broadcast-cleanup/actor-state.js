import {
    UB1, UB2,
    assertEqual, assertTrue,
    makeEnv, makeCampaign, makeJoin, makeAccount
} from './shared.js';

// ---------------------------------------------------------------------------
// (b) restricted / missing актёр
// ---------------------------------------------------------------------------
console.log('\n[actor state: restricted / missing]');
{
  const { supabase, factory, cleanup } = makeEnv({
    tables: {
      broadcast_campaigns: [makeCampaign()],
      broadcast_preparation_joins: [
        makeJoin({ id: 'j1', userbot_id: UB1, tg_chat_id: '-100555' }),
        makeJoin({ id: 'j2', userbot_id: UB2, tg_chat_id: '-100556' })
      ],
      channels: [],
      sales_bot_contours: [],
      tg_accounts: [makeAccount({ id: UB1, runtime_status: 'restricted' })]
    }
  });
  await cleanup.runCleanupTick();

  assertEqual(factory.calls.created.length, 0, 'restricted/missing — клиент не создавался');
  const rows = supabase._tables.broadcast_preparation_joins;
  assertTrue(rows.every((r) => r.remove_status === 'skipped_restricted'), 'обе строки skipped_restricted',
    rows.map((r) => r.remove_status));
}
