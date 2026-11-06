import {
    NOW, HOUR_MS, OWNER,
    assertEqual,
    makeMockSupabase, makeRouter, makeAccount, sentRows
} from './shared.js';

// ---------------------------------------------------------------------------
// 4. Quotas: hourly и daily skip
// ---------------------------------------------------------------------------
console.log('\n[isUnderQuota]');
{
  const supabase = makeMockSupabase({
    sendLog: [...sentRows('ub-1', 20, 60 * 1000)]
  });
  const { router } = makeRouter({ supabase });
  assertEqual(
    await router.isUnderQuota('ub-1', { now: NOW }),
    { ok: false, reason: 'hourly_cap' },
    '20 отправок в час → hourly_cap'
  );
  assertEqual(await router.isUnderQuota('ub-2', { now: NOW }), { ok: true, reason: null }, 'чистый актёр → ok');
}

console.log('\n[quota skip: hourly]');
{
  const supabase = makeMockSupabase({
    accounts: [makeAccount('ub-1'), makeAccount('ub-2')],
    sendLog: sentRows('ub-1', 20, 60 * 1000)
  });
  const { router, calls, delays } = makeRouter({ supabase });
  const result = await router.deliver({
    ownerId: OWNER, tgUserId: '700', text: 'привет',
    pool: supabase._tables.tg_accounts, baseDelayMs: 1000
  });
  assertEqual(result.actorId, 'ub-2', 'исчерпавший часовой кап пропущен, доставил ub-2');
  assertEqual(calls.map((c) => c.id), ['ub-2'], 'одна попытка — только ub-2');
  assertEqual(delays, [], 'skip по квоте не даёт sleep');
}

console.log('\n[quota skip: daily]');
{
  const supabase = makeMockSupabase({
    accounts: [makeAccount('ub-1'), makeAccount('ub-2')],
    sendLog: [...sentRows('ub-1', 5, 60 * 1000), ...sentRows('ub-1', 45, 2 * HOUR_MS)]
  });
  const { router, calls } = makeRouter({ supabase });
  assertEqual(
    await router.isUnderQuota('ub-1', { now: NOW }),
    { ok: false, reason: 'daily_cap' },
    '5 в час, 50 в сутки → daily_cap'
  );
  const result = await router.deliver({
    ownerId: OWNER, tgUserId: '700', text: 'привет',
    pool: supabase._tables.tg_accounts, baseDelayMs: 1000
  });
  assertEqual(result.actorId, 'ub-2', 'исчерпавший дневной кап пропущен');
  assertEqual(calls.map((c) => c.id), ['ub-2'], 'попытка только по ub-2');
}
