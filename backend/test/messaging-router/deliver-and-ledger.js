import {
    OWNER,
    assertEqual, assertTrue,
    makeMockSupabase, makeRouter, makeAccount, sentRows
} from './shared.js';

// ---------------------------------------------------------------------------
// 9. recordSend: идемпотентность
// ---------------------------------------------------------------------------
console.log('\n[recordSend idempotency]');
{
  const supabase = makeMockSupabase({ accounts: [makeAccount('ub-1')] });
  const { router } = makeRouter({ supabase });
  assertEqual(
    await router.recordSend({ ownerId: OWNER, actorId: 'ub-1', tgUserId: '700', status: 'sent', idempotencyKey: 'k1' }),
    { recorded: true },
    'первая запись с ключом → recorded'
  );
  assertEqual(
    await router.recordSend({ ownerId: OWNER, actorId: 'ub-1', tgUserId: '700', status: 'sent', idempotencyKey: 'k1' }),
    { recorded: false },
    'повтор того же ключа → recorded:false, без throw'
  );
  assertEqual(
    await router.recordSend({ ownerId: OWNER, actorId: 'ub-1', tgUserId: '700', status: 'sent', idempotencyKey: 'k2' }),
    { recorded: true },
    'другой ключ → recorded'
  );
  assertEqual(supabase._tables.userbot_send_log.length, 2, 'в леджере 2 строки, дубль не записан');
}

// ---------------------------------------------------------------------------
// 10. deliver happy path
// ---------------------------------------------------------------------------
console.log('\n[deliver happy path]');
{
  const supabase = makeMockSupabase({ accounts: [makeAccount('ub-1')] });
  const { router, calls, delays } = makeRouter({ supabase });
  const result = await router.deliver({
    ownerId: OWNER, tgUserId: '700', text: 'привет', pool: supabase._tables.tg_accounts, baseDelayMs: 1000
  });
  assertEqual(
    result,
    { status: 'sent', actorType: 'userbot', actorId: 'ub-1', errorKind: null, errorText: null },
    'форма успешного результата'
  );
  assertEqual(
    calls[0],
    { id: 'ub-1', tgUserId: '700', text: 'привет', options: { event_source: 'messaging_router', event_type: 'messaging_router' } },
    'sender получил опции роутера (без common_chat_id)'
  );
  const row = supabase._tables.userbot_send_log[0];
  assertTrue(!!row, 'send-строка записана');
  assertEqual(
    { owner_id: row.owner_id, actor_id: row.actor_id, actor_type: row.actor_type, tg_user_id: row.tg_user_id, status: row.status, campaign_id: row.campaign_id },
    { owner_id: OWNER, actor_id: 'ub-1', actor_type: 'userbot', tg_user_id: '700', status: 'sent', campaign_id: null },
    'поля леджер-строки'
  );
  assertEqual(delays, [], 'одна попытка — без sleep');

  const withCommonChat = makeRouter({ supabase: makeMockSupabase({ accounts: [makeAccount('ub-1')] }) });
  await withCommonChat.router.deliver({
    ownerId: OWNER, tgUserId: '700', text: 'привет', pool: withCommonChat.router.supabase._tables.tg_accounts,
    commonChatId: '-100222', campaignId: 'camp-1'
  });
  assertEqual(
    withCommonChat.calls[0].options,
    { event_source: 'messaging_router', event_type: 'messaging_router', campaign_id: 'camp-1', common_chat_id: '-100222' },
    'common_chat_id и campaign_id пробрасываются в sender'
  );
}

// ---------------------------------------------------------------------------
// 11. deliver pool exhausted
// ---------------------------------------------------------------------------
console.log('\n[deliver pool exhausted]');
{
  const empty = makeRouter({ supabase: makeMockSupabase() });
  const emptyResult = await empty.router.deliver({ ownerId: OWNER, tgUserId: '700', text: 'привет', pool: [] });
  assertEqual(
    emptyResult,
    { status: 'failed', actorType: null, actorId: null, errorKind: 'pool_exhausted', errorText: 'Юзерботы пула недоступны: пауза, квота или ошибка Telegram.' },
    'пустой пул → pool_exhausted'
  );
  assertEqual(empty.calls.length, 0, 'пустой пул — отправок нет');

  const capped = makeRouter({
    supabase: makeMockSupabase({
      accounts: [makeAccount('ub-1')],
      sendLog: sentRows('ub-1', 50, 60 * 1000)
    })
  });
  const cappedResult = await capped.router.deliver({
    ownerId: OWNER, tgUserId: '700', text: 'привет',
    pool: capped.router.supabase._tables.tg_accounts, baseDelayMs: 1000
  });
  assertEqual(cappedResult.errorKind, 'pool_exhausted', 'кандидат сверх квоты → pool_exhausted');
  assertEqual(capped.calls.length, 0, 'ни одной попытки отправки');
}
