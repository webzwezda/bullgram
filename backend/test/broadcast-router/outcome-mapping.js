import {
    OWNER, CAMPAIGN,
    assertEqual,
    makeMockSupabase, makeFakeRouter, makeSender, makeRow, deliverOne, makeAccount,
    createBroadcastDeliverySender
} from './shared.js';

// ---------------------------------------------------------------------------
// 4. Outcome mapping: fake router
// ---------------------------------------------------------------------------
console.log('\n[outcome mapping: sent]');
{
  const sender = makeSender(makeMockSupabase(), makeFakeRouter(
    () => ({ status: 'sent', actorType: 'userbot', actorId: 'ub-2', errorKind: null, errorText: null })
  ));
  const result = await deliverOne(sender, {
    senderType: 'userbot_pool_round_robin',
    userbots: [makeAccount('ub-1'), makeAccount('ub-2')]
  });
  assertEqual(result.deliveryStatus, 'sent', 'router sent → delivered');
  assertEqual(result.sentViaUserbot, true, 'sentViaUserbot');
  assertEqual(result.actualSenderUserbot?.id, 'ub-2', 'sender stats из actorId роутера');
  assertEqual(result.blockedByUser, false, 'без blockedByUser');
  assertEqual(result.quotaWait, false, 'без quotaWait');
}

console.log('\n[outcome mapping: blocked by user]');
{
  const sender = makeSender(makeMockSupabase(), makeFakeRouter(
    () => ({ status: 'failed', actorType: 'userbot', actorId: 'ub-1', errorKind: 'user_blocked', errorText: 'получатель заблокировал юзербота' })
  ));
  const result = await deliverOne(sender, { userbots: [makeAccount('ub-1')] });
  assertEqual(result.deliveryStatus, 'failed', 'failed');
  assertEqual(result.blockedByUser, true, 'user_blocked → blockedByUser (dm_blocked writeback)');
}

console.log('\n[outcome mapping: other failures]');
{
  const sender = makeSender(makeMockSupabase(), makeFakeRouter(
    () => ({ status: 'failed', actorType: 'userbot', actorId: 'ub-1', errorKind: 'flood_wait', errorText: 'flood' })
  ));
  const result = await deliverOne(sender, { userbots: [makeAccount('ub-1')] });
  assertEqual(result.deliveryStatus, 'failed', 'failed');
  assertEqual(result.blockedByUser, false, 'flood_wait — не blockedByUser');
}

console.log('\n[outcome mapping: pool_exhausted, весь пул на квоте → quotaWait]');
{
  const sender = makeSender(makeMockSupabase(), makeFakeRouter(
    () => ({ status: 'failed', actorType: null, actorId: null, errorKind: 'pool_exhausted', errorText: 'пул недоступен' }),
    { ok: false, reason: 'daily_cap' }
  ));
  const result = await deliverOne(sender, { userbots: [makeAccount('ub-1'), makeAccount('ub-2')] });
  assertEqual(result.quotaWait, true, 'все на квоте → quotaWait');
  assertEqual(result.deliveryStatus, 'pending', 'строка остаётся pending');
  assertEqual(result.blockedByUser, false, 'без blockedByUser');
}

console.log('\n[outcome mapping: pool_exhausted, попытки были, леджер чистый → failed]');
{
  const sender = makeSender(makeMockSupabase(), makeFakeRouter(
    () => ({ status: 'failed', actorType: null, actorId: null, errorKind: 'pool_exhausted', errorText: 'пул недоступен' }),
    { ok: true, reason: null }
  ));
  const result = await deliverOne(sender, { userbots: [makeAccount('ub-1')] });
  assertEqual(result.quotaWait, false, 'квота есть — значит пытались');
  assertEqual(result.deliveryStatus, 'failed', 'попытки провалились → failed');
  assertEqual(result.blockedByUser, false, 'в леджере нет privacy → не blockedByUser');
}

console.log('\n[outcome mapping: touchpoint passthrough]');
{
  const fakeRouter = makeFakeRouter(
    () => ({ status: 'sent', actorType: 'userbot', actorId: 'ub-2', errorKind: null, errorText: null })
  );
  const sender = makeSender(makeMockSupabase(), fakeRouter);
  const matrix = new Map([
    ['700', [{ userbot_id: 'ub-2', confirmed: 1, via: 'shared_chat', chat_id: '-100555' }]]
  ]);
  const result = await deliverOne(sender, {
    senderType: 'userbot_pool_round_robin',
    userbots: [makeAccount('ub-1'), makeAccount('ub-2')],
    matrix
  });
  assertEqual(result.deliveryStatus, 'sent', 'доставлено');
  const call = fakeRouter.deliverCalls[0];
  assertEqual(call.ownerId, OWNER, 'ownerId проброшен в роутер');
  assertEqual(call.campaignId, CAMPAIGN, 'campaignId проброшен в роутер');
  assertEqual(call.touchpointActorId, 'ub-2', 'touchpointActorId из матрицы');
  assertEqual(call.commonChatId, '-100555', 'commonChatId для shared_chat');
  assertEqual(call.pool.map((u) => u.id), ['ub-1', 'ub-2'], 'весь пул передан; порядок решает роутер по touchpointActorId');
  assertEqual(call.baseDelayMs, 1000, 'baseDelayMs проброшен');
  assertEqual(call.eventSource, 'broadcast', 'eventSource = broadcast');
}

console.log('\n[outcome mapping: official bot leg preserved]');
{
  const officialOnlySender = createBroadcastDeliverySender({
    supabase: makeMockSupabase(),
    getBotById: () => ({ telegram: { sendMessage: async () => { throw new Error('Telegram API: 403 USER_IS_BLOCKED bot was blocked by the user'); } } }),
    router: makeFakeRouter(() => ({ status: 'sent', actorType: 'userbot', actorId: 'x', errorKind: null, errorText: null }))
  });
  const result = await officialOnlySender.deliverToRecipient({
    ownerId: OWNER,
    campaignId: CAMPAIGN,
    messageText: 'привет',
    senderType: 'official_only',
    selectedUserbots: [],
    preparationMatrix: null,
    row: makeRow('700', 'bot-1'),
    baseDelayMs: 1000
  });
  assertEqual(result.deliveryStatus, 'failed', 'бот не смог → failed');
  assertEqual(result.blockedByUser, true, 'USER_IS_BLOCKED → blockedByUser как раньше');
  assertEqual(result.sentViaUserbot, false, 'юзербот-нога не тронута');
}
