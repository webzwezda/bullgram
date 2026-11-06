import {
    NOW, HOUR_MS,
    assertTrue, assertEqual,
    makeAccount,
    hasDeliverableActor, isActorPermanentlyUnavailable, isDeliverableCampaignStatus,
    isPureUserbotSenderType, planCampaignFinalization
} from './shared.js';

// ---------------------------------------------------------------------------
// 1. Pure: sender-type helpers
// ---------------------------------------------------------------------------
console.log('\n[sender-type helpers]');
{
  assertTrue(isPureUserbotSenderType('userbot_only'), 'userbot_only — чисто юзерботный');
  assertTrue(isPureUserbotSenderType('userbot_pool_round_robin'), 'pool round robin — чисто юзерботный');
  assertTrue(!isPureUserbotSenderType('official_then_userbot'), 'official_then_userbot — с фолбэком');
  assertTrue(!isPureUserbotSenderType('official_only'), 'official_only — не юзерботный');
}

// ---------------------------------------------------------------------------
// 2. Pure: dead-pool helpers (очередь queue_error у чисто-юзерботных кампаний)
// ---------------------------------------------------------------------------
console.log('\n[hasDeliverableActor / isActorPermanentlyUnavailable]');
{
  assertTrue(!hasDeliverableActor([]), 'пустой пул → живых нет');
  assertTrue(!hasDeliverableActor([makeAccount('a', { runtime_status: 'restricted' })]), 'все restricted → живых нет');
  assertTrue(
    !hasDeliverableActor([makeAccount('a', { dm_paused_until: new Date(NOW + 24 * HOUR_MS).toISOString(), dm_pause_reason: 'account_flagged' })], { now: NOW }),
    'длинная пауза (flagged) → живых нет'
  );
  assertTrue(
    hasDeliverableActor([makeAccount('a', { dm_paused_until: new Date(NOW + 60 * 1000).toISOString(), dm_pause_reason: 'flood_wait' })], { now: NOW }),
    'flood-пауза — временная, актёр жив'
  );
  assertTrue(
    hasDeliverableActor([makeAccount('a', { runtime_status: 'restricted' }), makeAccount('b')]),
    'один живой среди мёртвых → пул годен'
  );
  assertTrue(isActorPermanentlyUnavailable(null), 'null-актёр — мёртв');
}

// ---------------------------------------------------------------------------
// 3. Pure: финализация и cancel-wins
// ---------------------------------------------------------------------------
console.log('\n[planCampaignFinalization]');
{
  const nowIso = new Date(NOW).toISOString();
  const allSent = planCampaignFinalization(
    [{ delivery_status: 'sent' }, { delivery_status: 'sent' }],
    { total: 2 },
    nowIso
  );
  assertEqual(allSent.action, 'finalize', 'все sent → финализируем');
  assertEqual(allSent.status, 'sent', 'без ошибок → sent');
  assertEqual(allSent.counts, { sent: 2, failed: 0, pending: 0, total: 2 }, 'счётчики');

  const withErrors = planCampaignFinalization(
    [{ delivery_status: 'sent' }, { delivery_status: 'failed' }],
    { total: 2 },
    nowIso
  );
  assertEqual(withErrors.status, 'completed_with_errors', 'есть failed → completed_with_errors');

  const withPending = planCampaignFinalization(
    [{ delivery_status: 'sent' }, { delivery_status: 'pending' }],
    { total: 2 },
    nowIso
  );
  assertEqual(withPending.action, 'wait', 'pending-строки → ждём, не финализируем');
  assertEqual(withPending.refreshHeartbeat, true, 'ждём со свежим heartbeat');
  assertEqual(withPending.meta.delivery_heartbeat_at, nowIso, 'heartbeat обновлён');
  assertEqual(withPending.status, null, 'статус не трогаем');

  const awaitingInsert = planCampaignFinalization([], { total: 5 }, nowIso);
  assertEqual(awaitingInsert.action, 'wait', 'строк нет, total обещан → ждём вставки');
  assertEqual(awaitingInsert.refreshHeartbeat, false, 'heartbeat не трогаем');

  const empty = planCampaignFinalization([], { total: 0 }, nowIso);
  assertEqual(empty.action, 'finalize', 'пустая кампания без обещаний → финализируем');
  assertEqual(empty.status, 'sent', 'пустая кампания → sent');
}

console.log('\n[isDeliverableCampaignStatus: cancel wins]');
{
  assertTrue(isDeliverableCampaignStatus('sending'), 'sending — доставляем и финализируем');
  assertTrue(!isDeliverableCampaignStatus('cancelled'), 'cancelled — стоп, финализация не перезапишет');
  assertTrue(!isDeliverableCampaignStatus('queued'), 'queued — не наша фаза');
  assertTrue(!isDeliverableCampaignStatus(null), 'null → false');
}
