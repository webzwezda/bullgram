import {
    HOUR_MS, OWNER,
    assertEqual,
    makeMockSupabase, makeRouter, makeAccount, sentRows
} from './shared.js';

// ---------------------------------------------------------------------------
// 7. Rotation: touchpoint первым, далее по минимуму отправок
// ---------------------------------------------------------------------------
console.log('\n[rotation order]');
{
  const makeEnv = () => makeMockSupabase({
    accounts: [makeAccount('ub-1'), makeAccount('ub-2'), makeAccount('ub-3')],
    sendLog: [...sentRows('ub-1', 5, HOUR_MS), ...sentRows('ub-2', 1, HOUR_MS)]
  });

  const supabaseA = makeEnv();
  const a = makeRouter({ supabase: supabaseA, send: async () => { throw new Error('что-то странное'); } });
  const resultA = await a.router.deliver({
    ownerId: OWNER, tgUserId: '700', text: 'привет',
    pool: supabaseA._tables.tg_accounts, baseDelayMs: 1000
  });
  assertEqual(resultA.errorKind, 'pool_exhausted', 'все упали → pool_exhausted');
  assertEqual(a.calls.map((c) => c.id), ['ub-3', 'ub-2', 'ub-1'], 'без touchpoint: наименее отправлявший первым');

  const supabaseB = makeEnv();
  const b = makeRouter({ supabase: supabaseB, send: async () => { throw new Error('что-то странное'); } });
  await b.router.deliver({
    ownerId: OWNER, tgUserId: '700', text: 'привет',
    pool: supabaseB._tables.tg_accounts, baseDelayMs: 1000, touchpointActorId: 'ub-2'
  });
  assertEqual(b.calls.map((c) => c.id), ['ub-2', 'ub-3', 'ub-1'], 'touchpoint-актёр идёт первым');

  assertEqual(a.delays.length, 2, 'между тремя попытками ровно 2 sleep');
}

// ---------------------------------------------------------------------------
// 8. Jitter bounds: ±jitterPercent от baseDelayMs, нет sleep перед первой попыткой
// ---------------------------------------------------------------------------
console.log('\n[jitter bounds]');
{
  const baseEnv = () => makeMockSupabase({
    accounts: [makeAccount('ub-1'), makeAccount('ub-2')]
  });
  const failFirst = async (account) => {
    if (account.id === 'ub-1') throw new Error('что-то странное');
    return { success: true };
  };

  const supabaseLow = baseEnv();
  const low = makeRouter({ supabase: supabaseLow, send: failFirst, randomQueue: [0] });
  await low.router.deliver({ ownerId: OWNER, tgUserId: '700', text: 'привет', pool: supabaseLow._tables.tg_accounts, baseDelayMs: 1000 });
  assertEqual(low.delays, [800], 'random=0 → base −20% = 800');

  const supabaseMid = baseEnv();
  const mid = makeRouter({ supabase: supabaseMid, send: failFirst, randomQueue: [0.5] });
  await mid.router.deliver({ ownerId: OWNER, tgUserId: '700', text: 'привет', pool: supabaseMid._tables.tg_accounts, baseDelayMs: 1000 });
  assertEqual(mid.delays, [1000], 'random=0.5 → ровно base = 1000');

  const supabaseHigh = baseEnv();
  const high = makeRouter({ supabase: supabaseHigh, send: failFirst, randomQueue: [1] });
  await high.router.deliver({ ownerId: OWNER, tgUserId: '700', text: 'привет', pool: supabaseHigh._tables.tg_accounts, baseDelayMs: 1000 });
  assertEqual(high.delays, [1200], 'random=1 → base +20% = 1200');

  const supabaseHappy = baseEnv();
  const happy = makeRouter({ supabase: supabaseHappy });
  await happy.router.deliver({ ownerId: OWNER, tgUserId: '700', text: 'привет', pool: supabaseHappy._tables.tg_accounts, baseDelayMs: 1000 });
  assertEqual(happy.delays, [], 'успех с первой попытки → sleep нет');
}
