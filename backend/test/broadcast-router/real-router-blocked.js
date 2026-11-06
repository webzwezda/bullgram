import {
    NOW, CAMPAIGN,
    assertEqual, assertTrue,
    makeMockSupabase, makeRouter, makeSender, deliverOne, makeAccount
} from './shared.js';

// ---------------------------------------------------------------------------
// 5. REAL router: privacy error → леджер → blockedByUser
// ---------------------------------------------------------------------------
console.log('\n[real router: privacy error → blockedByUser via ledger]');
{
  const supabase = makeMockSupabase({ accounts: [makeAccount('ub-1')] });
  const { router } = makeRouter(supabase, async () => {
    throw new Error('Не смог написать: пользователь закрыл приватность от юзербота.');
  });
  const sender = makeSender(supabase, router);
  const result = await deliverOne(sender, { userbots: supabase._tables.tg_accounts });
  assertEqual(result.deliveryStatus, 'failed', 'доставка не удалась');
  assertEqual(result.blockedByUser, true, 'privacy_restricted в леджере → blockedByUser');
  assertEqual(result.quotaWait, false, 'актёры пытались, не ждём');
  const failedRow = supabase._tables.userbot_send_log.find((r) => r.status === 'failed');
  assertEqual(failedRow?.error_kind, 'privacy_restricted', 'леджер хранит privacy_restricted');
  assertEqual(failedRow?.campaign_id, CAMPAIGN, 'леджер-строка связана с кампанией');
}

// ---------------------------------------------------------------------------
// 6. REAL router: flood_wait → пауза → quotaWait pending
// ---------------------------------------------------------------------------
console.log('\n[real router: flood_wait → quotaWait]');
{
  const supabase = makeMockSupabase({ accounts: [makeAccount('ub-1')] });
  const { router } = makeRouter(supabase, async () => {
    throw Object.assign(new Error('FLOOD_WAIT_42'), { retry_after: 42 });
  });
  const sender = makeSender(supabase, router);
  const result = await deliverOne(sender, { userbots: supabase._tables.tg_accounts });
  assertEqual(result.quotaWait, true, 'актёр ушёл в flood-паузу → ждём');
  assertEqual(result.deliveryStatus, 'pending', 'строка pending');
  const paused = supabase._tables.tg_accounts.find((a) => a.id === 'ub-1');
  assertEqual(
    { until: paused.dm_paused_until, reason: paused.dm_pause_reason },
    { until: new Date(NOW + 42 * 1000 + 30 * 1000).toISOString(), reason: 'flood_wait' },
    'актёр запаузен роутером'
  );
}

// ---------------------------------------------------------------------------
// 6b. P1-1: flood-пауза зеркалится на in-memory пул → quotaWait вместо failed,
//     повторная доставка в том же тике без новых попыток к Telegram
// ---------------------------------------------------------------------------
console.log('\n[real router: весь пул во flood — stale-снимок пула видит паузу сразу]');
{
  const supabase = makeMockSupabase({ accounts: [makeAccount('ub-1'), makeAccount('ub-2')] });
  const { router, calls } = makeRouter(supabase, async () => {
    throw Object.assign(new Error('FLOOD_WAIT_60'), { retry_after: 60 });
  });
  const sender = makeSender(supabase, router);
  // Копии строк: мок-БД мутирует свои объекты, значит in-memory пул обновляет
  // только зеркало роутера — как реальный снимок пула в джобе (load-once-per-claim).
  const stalePool = supabase._tables.tg_accounts.map((a) => ({ ...a }));
  const first = await deliverOne(sender, { senderType: 'userbot_pool_round_robin', userbots: stalePool });
  assertEqual(first.quotaWait, true, 'оба актора во flood → quotaWait, а не permanent failed');
  assertEqual(first.deliveryStatus, 'pending', 'строка остаётся pending');
  assertEqual(calls.length, 2, 'по одной честной попытке на актора');
  assertTrue(
    stalePool.every((a) => a.dm_pause_reason === 'flood_wait' && a.dm_paused_until != null),
    'in-memory пул несёт flood-паузы после первой доставки'
  );

  const second = await deliverOne(sender, { senderType: 'userbot_pool_round_robin', userbots: stalePool });
  assertEqual(second.quotaWait, true, 'повторная доставка тому же получателю — снова quotaWait');
  assertEqual(calls.length, 2, 'новых попыток к Telegram нет — паузу видно из памяти');
}
