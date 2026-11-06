import {
    NOW, OWNER,
    assertEqual, assertTrue,
    makeMockSupabase, makeRouter, makeAccount
} from './shared.js';

// ---------------------------------------------------------------------------
// 12. Паузы: pauseActor / getActorPause / clearPause roundtrip (owner-scoped)
// ---------------------------------------------------------------------------
console.log('\n[actor pause roundtrip]');
{
  const supabase = makeMockSupabase({ accounts: [makeAccount('ub-1')] });
  const { router } = makeRouter({ supabase });
  assertEqual(await router.getActorPause('ub-1'), null, 'без паузы → null');
  await router.pauseActor('ub-1', new Date(NOW + 60 * 1000).toISOString(), 'flood_wait', OWNER);
  assertEqual(
    await router.getActorPause('ub-1'),
    { until: new Date(NOW + 60 * 1000).toISOString(), reason: 'flood_wait' },
    'pauseActor → getActorPause'
  );
  await router.clearPause('ub-1', OWNER);
  assertEqual(await router.getActorPause('ub-1'), null, 'clearPause → null');

  await router.pauseActor('ub-1', new Date(NOW + 60 * 1000).toISOString(), 'flood_wait', 'чужой-owner');
  assertEqual(await router.getActorPause('ub-1'), null, 'чужой owner не трогает чужую строку (owner-фильтр в update)');
}

// ---------------------------------------------------------------------------
// 13. P1-1: flood-пауза зеркалится на in-memory пул, повторный deliver без попыток
// ---------------------------------------------------------------------------
console.log('\n[flood pause mirrored onto in-memory pool]');
{
  const supabase = makeMockSupabase({ accounts: [makeAccount('ub-1')] });
  const floodError = Object.assign(new Error('FLOOD_WAIT_42'), { retry_after: 42 });
  // Копии строк: мок-БД мутирует свои объекты, значит поля на копиях пула может
  // поставить только зеркало роутера — тест не полагается на мутацию мок-БД.
  const poolCopies = supabase._tables.tg_accounts.map((a) => ({ ...a }));
  const { router, calls } = makeRouter({
    supabase,
    send: async () => { throw floodError; }
  });
  const first = await router.deliver({
    ownerId: OWNER, tgUserId: '700', text: 'привет',
    pool: poolCopies, baseDelayMs: 1000
  });
  assertEqual(first.errorKind, 'pool_exhausted', 'единственный актор во flood → pool_exhausted');
  assertTrue(poolCopies[0].dm_paused_until != null, 'in-memory пул несёт dm_paused_until после flood');
  assertEqual(poolCopies[0].dm_pause_reason, 'flood_wait', 'in-memory пул несёт dm_pause_reason после flood');

  const second = await router.deliver({
    ownerId: OWNER, tgUserId: '700', text: 'привет',
    pool: poolCopies, baseDelayMs: 1000
  });
  assertEqual(
    second,
    { status: 'failed', actorType: null, actorId: null, errorKind: 'pool_exhausted', errorText: 'Юзерботы пула недоступны: пауза, квота или ошибка Telegram.' },
    'повторный deliver видит паузу в памяти → pool_exhausted (quotaWait-семантика)'
  );
  assertEqual(calls.length, 1, 'повторный deliver не дёргает sender (нет новой атаки по flood-сессии)');
}

// ---------------------------------------------------------------------------
// 14. P2-5: ключ идемпотентности держит только первая попытка deliver
// ---------------------------------------------------------------------------
console.log('\n[idempotency key on first attempt only]');
{
  const supabase = makeMockSupabase({ accounts: [makeAccount('ub-1'), makeAccount('ub-2')] });
  const { router } = makeRouter({
    supabase,
    send: async (account) => {
      if (account.id === 'ub-1') throw new Error('что-то странное');
      return { success: true };
    }
  });
  const result = await router.deliver({
    ownerId: OWNER, tgUserId: '700', text: 'привет',
    pool: supabase._tables.tg_accounts, baseDelayMs: 1000, idempotencyKey: 'k-retry'
  });
  assertEqual(result.status, 'sent', 'ретрай после не-паузы доставил');
  const rows = supabase._tables.userbot_send_log;
  assertEqual(rows.length, 2, 'обе попытки в леджере');
  assertEqual(
    { status: rows[0]?.status, key: rows[0]?.idempotency_key, actor: rows[0]?.actor_id },
    { status: 'failed', key: 'k-retry', actor: 'ub-1' },
    'первая попытка держит ключ'
  );
  assertEqual(
    { status: rows[1]?.status, key: rows[1]?.idempotency_key, actor: rows[1]?.actor_id },
    { status: 'sent', key: null, actor: 'ub-2' },
    'вторая попытка записана без ключа'
  );
}
