import {
    OWNER, PREP, NOW, NOW_ISO,
    assertEqual, assertTrue,
    makeEnv, makeCampaign, makeJoin, makeAccount, peerChannel
} from './shared.js';

// ---------------------------------------------------------------------------
// meta.cleanup: полностью обработанная кампания скипается
// ---------------------------------------------------------------------------
console.log('\n[campaign skip: cleanup already complete]');
{
  const { factory, cleanup } = makeEnv({
    tables: {
      broadcast_campaigns: [makeCampaign({
        meta: { leave_groups_on_complete: true, preparation_id: PREP, cleanup: { total: 1, done: 1, failed: 0 } }
      })],
      broadcast_preparation_joins: [makeJoin({ id: 'j1' })],
      channels: [],
      sales_bot_contours: [],
      tg_accounts: [makeAccount()]
    }
  });
  await cleanup.runCleanupTick();

  assertEqual(factory.calls.created.length, 0, 'обработанная кампания — ноль вызовов');
}

// zero-join кампания: pending-строк нет → не кандидат, cleanup-мету {total:0} не пишем вовсе
console.log('\n[zero-join campaign: без join-строк — ни запросов по строкам, ни cleanup-меты]');
{
  const { factory, cleanup, supabase } = makeEnv({
    tables: {
      broadcast_campaigns: [makeCampaign()],
      broadcast_preparation_joins: [],
      channels: [],
      sales_bot_contours: [],
      tg_accounts: []
    }
  });
  await cleanup.runCleanupTick();

  assertEqual(factory.calls.created.length, 0, 'ноль Telegram-вызовов');
  assertEqual(supabase._tables.broadcast_campaigns[0].meta.cleanup, undefined, 'пустой кампании cleanup-мета не пишется');
}

// старая кампания с живой работой не должна теряться за 50+ новыми (starvation)
console.log('\n[starvation: старая flagged-кампания с pending-строками обрабатывается]');
{
  const newerCampaigns = Array.from({ length: 55 }, (_unused, i) => ({
    id: `newer-${i}`, owner_id: OWNER, status: 'sent',
    meta: { leave_groups_on_complete: false },
    created_at: new Date(NOW + (i + 1) * 1000).toISOString()
  }));
  const { factory, cleanup, supabase } = makeEnv({
    tables: {
      broadcast_campaigns: [
        makeCampaign({ id: 'old-flagged', created_at: NOW_ISO }),
        ...newerCampaigns
      ],
      broadcast_preparation_joins: [makeJoin({ id: 'j1' })],
      channels: [],
      sales_bot_contours: [],
      tg_accounts: [makeAccount()]
    },
    clientImpl: { getInputEntity: () => peerChannel() }
  });
  await cleanup.runCleanupTick();

  const row = supabase._tables.broadcast_preparation_joins[0];
  assertEqual(row.remove_status, 'left', 'старейшая кампания обработана, несмотря на 55 новых');
  assertTrue(factory.calls.created.length >= 1, 'была реальная Telegram-операция');
}
