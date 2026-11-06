import {
    CAMPAIGN,
    assertEqual, assertTrue,
    makeMockSupabase, makeRouter, makeSender, deliverOne, makeAccount, sentRows,
    createBroadcastDeliverySender
} from './shared.js';

// ---------------------------------------------------------------------------
// 7. REAL router: дневная квота исчерпана → quotaWait без попыток
// ---------------------------------------------------------------------------
console.log('\n[real router: daily quota → quotaWait]');
{
  const supabase = makeMockSupabase({
    accounts: [makeAccount('ub-1')],
    sendLog: sentRows('ub-1', 50, 60 * 1000)
  });
  const { router, calls } = makeRouter(supabase);
  const sender = makeSender(supabase, router);
  const result = await deliverOne(sender, { userbots: supabase._tables.tg_accounts });
  assertEqual(result.quotaWait, true, 'квота исчерпана → quotaWait');
  assertEqual(result.deliveryStatus, 'pending', 'строка pending');
  assertEqual(calls.length, 0, 'попыток отправки нет');
}

// ---------------------------------------------------------------------------
// 8. REAL router: happy path через фабрику
// ---------------------------------------------------------------------------
console.log('\n[real router: happy path]');
{
  const supabase = makeMockSupabase({ accounts: [makeAccount('ub-1')] });
  const { router, calls } = makeRouter(supabase);
  const sender = makeSender(supabase, router);
  const result = await deliverOne(sender, { userbots: supabase._tables.tg_accounts });
  assertEqual(result.deliveryStatus, 'sent', 'доставлено');
  assertEqual(result.actualSenderUserbot?.id, 'ub-1', 'sender stats из роутера');
  assertEqual(calls[0]?.options.campaign_id, CAMPAIGN, 'campaign_id ушёл в sender-опции');
  assertEqual(calls[0]?.options.event_source, 'broadcast', 'event_source = broadcast');
  const sentRow = supabase._tables.userbot_send_log[0];
  assertEqual(sentRow?.status, 'sent', 'успех записан в леджер');
}

// ---------------------------------------------------------------------------
// 9. Фабрика без роутера — программная ошибка
// ---------------------------------------------------------------------------
console.log('\n[factory guards]');
{
  let threw = false;
  try {
    createBroadcastDeliverySender({ supabase: makeMockSupabase(), getBotById: () => null });
  } catch (error) {
    threw = true;
  }
  assertTrue(threw, 'без router фабрика бросает');
}
