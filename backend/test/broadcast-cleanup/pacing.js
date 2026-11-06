import {
    OWNER, UB2,
    assertEqual, assertTrue,
    makeEnv, makeCampaign, makeJoin, makeAccount, peerChannel
} from './shared.js';

// ---------------------------------------------------------------------------
// (h) пейсинг и батч
// ---------------------------------------------------------------------------
console.log('\n[pacing: skips without sleep]');
{
  const sleeps = [];
  const { factory, cleanup } = makeEnv({
    tables: {
      broadcast_campaigns: [makeCampaign()],
      broadcast_preparation_joins: [
        makeJoin({ id: 'j1', tg_chat_id: '-100999' }), // свой канал → skip
        makeJoin({ id: 'j2' })                          // реальная операция
      ],
      channels: [{ id: 'ch-1', owner_id: OWNER, tg_chat_id: '-100999' }],
      sales_bot_contours: [],
      tg_accounts: [makeAccount()]
    },
    clientImpl: { getInputEntity: () => peerChannel() },
    sleeps
  });
  await cleanup.runCleanupTick();

  assertEqual(sleeps.length, 0, 'skip + одна операция в конце — без sleep');
  assertEqual(factory.calls.invocations.length, 1, 'одна Telegram-операция');
}

console.log('[pacing: sleep между операциями ~4s ±20%]');
{
  const sleeps = [];
  const { cleanup } = makeEnv({
    tables: {
      broadcast_campaigns: [makeCampaign()],
      broadcast_preparation_joins: [makeJoin({ id: 'j1' }), makeJoin({ id: 'j2', userbot_id: UB2, tg_chat_id: '-100556' })],
      channels: [],
      sales_bot_contours: [],
      tg_accounts: [makeAccount(), makeAccount({ id: UB2, tg_account_id: '525252' })]
    },
    clientImpl: { getInputEntity: () => peerChannel() },
    sleeps,
    random: () => 0.5
  });
  await cleanup.runCleanupTick();

  assertEqual(sleeps.length, 1, 'один sleep между двумя операциями');
  assertTrue(sleeps[0] >= 3200 && sleeps[0] <= 4800, `sleep в диапазоне 4000±20% (получили ${sleeps[0]})`);
}

console.log('[batch: не больше 20 строк за тик]');
{
  const joins = Array.from({ length: 25 }, (_unused, i) => makeJoin({ id: `j${i}`, tg_chat_id: `-1005${String(i).padStart(2, '0')}` }));
  const accounts = joins.map((j) => makeAccount({ id: j.userbot_id, tg_account_id: '424242' }));
  const { factory, cleanup } = makeEnv({
    tables: {
      broadcast_campaigns: [makeCampaign()],
      broadcast_preparation_joins: joins,
      channels: [],
      sales_bot_contours: [],
      tg_accounts: accounts
    },
    clientImpl: { getInputEntity: () => peerChannel() },
    sleeps: []
  });
  await cleanup.runCleanupTick();

  assertEqual(factory.calls.created.length, 20, 'за тик обработано ровно 20 строк');
}
