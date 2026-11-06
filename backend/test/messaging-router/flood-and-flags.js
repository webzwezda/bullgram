import {
    NOW, DAY_MS, OWNER,
    assertEqual, assertTrue,
    makeMockSupabase, makeRouter, makeAccount
} from './shared.js';

// ---------------------------------------------------------------------------
// 5. flood_wait: пауза retry_after + 30s, clamp 3600, очеловеченный фолбэк
// ---------------------------------------------------------------------------
console.log('\n[flood_wait pause]');
{
  const supabase = makeMockSupabase({
    accounts: [makeAccount('ub-1'), makeAccount('ub-2')]
  });
  const floodError = Object.assign(new Error('FLOOD_WAIT_42'), { retry_after: 42 });
  const { router, calls } = makeRouter({
    supabase,
    send: async (account) => {
      if (account.id === 'ub-1') throw floodError;
      return { success: true };
    }
  });
  const result = await router.deliver({
    ownerId: OWNER, tgUserId: '700', text: 'привет',
    pool: supabase._tables.tg_accounts, baseDelayMs: 1000
  });
  assertEqual(result.actorId, 'ub-2', 'после flood у первого — доставил второй');
  assertEqual(calls.map((c) => c.id), ['ub-1', 'ub-2'], 'обе попытки совершены');
  const paused = supabase._tables.tg_accounts.find((a) => a.id === 'ub-1');
  assertEqual(
    { until: paused.dm_paused_until, reason: paused.dm_pause_reason },
    { until: new Date(NOW + 42 * 1000 + 30 * 1000).toISOString(), reason: 'flood_wait' },
    'пауза = retry_after + 30s'
  );
  const failedRow = supabase._tables.userbot_send_log.find((r) => r.status === 'failed');
  assertTrue(!!failedRow, 'failed-попытка записана в леджер');
  assertEqual(failedRow?.error_kind, 'flood_wait', 'error_kind = flood_wait');
}

console.log('\n[flood_wait clamp 3600s]');
{
  const supabase = makeMockSupabase({ accounts: [makeAccount('ub-1')] });
  const floodError = Object.assign(new Error('FLOOD_WAIT_9999'), { retry_after: 9999 });
  const { router } = makeRouter({
    supabase,
    send: async () => { throw floodError; }
  });
  await router.deliver({
    ownerId: OWNER, tgUserId: '700', text: 'привет',
    pool: supabase._tables.tg_accounts, baseDelayMs: 1000
  });
  const paused = supabase._tables.tg_accounts.find((a) => a.id === 'ub-1');
  assertEqual(
    paused.dm_paused_until,
    new Date(NOW + 3600 * 1000 + 30 * 1000).toISOString(),
    'retry_after зажат одним часом'
  );
}

console.log('\n[flood_wait humanized without seconds → 1h fallback]');
{
  const supabase = makeMockSupabase({ accounts: [makeAccount('ub-1')] });
  const { router } = makeRouter({
    supabase,
    // реальный путь sendMessage: getDirectMessageError теряет retry_after
    send: async () => { throw new Error('Telegram просит притормозить. По этому юзерботу сработал flood wait.'); }
  });
  await router.deliver({
    ownerId: OWNER, tgUserId: '700', text: 'привет',
    pool: supabase._tables.tg_accounts, baseDelayMs: 1000
  });
  const paused = supabase._tables.tg_accounts.find((a) => a.id === 'ub-1');
  assertEqual(paused.dm_pause_reason, 'flood_wait', 'очеловеченный текст распознан как flood_wait');
  assertEqual(
    paused.dm_paused_until,
    new Date(NOW + 3600 * 1000 + 30 * 1000).toISOString(),
    'без секунд — консервативный час + 30s'
  );
}

// ---------------------------------------------------------------------------
// 6. account_flagged / session_revoked → пауза 24h (сырые и очеловеченные тексты)
// ---------------------------------------------------------------------------
console.log('\n[account_flagged / session_revoked pause 24h]');
{
  const supabase = makeMockSupabase({
    accounts: [makeAccount('ub-1'), makeAccount('ub-2'), makeAccount('ub-3')]
  });
  const { router } = makeRouter({
    supabase,
    send: async (account) => {
      if (account.id === 'ub-1') throw new Error('Telegram через SpamBot подтвердил, что этот аккаунт заблокирован за нарушения. Этим юзерботом больше нельзя писать.');
      if (account.id === 'ub-2') throw new Error('AUTH_KEY_UNREGISTERED');
      return { success: true };
    }
  });
  const result = await router.deliver({
    ownerId: OWNER, tgUserId: '700', text: 'привет',
    pool: supabase._tables.tg_accounts, baseDelayMs: 1000
  });
  assertEqual(result.actorId, 'ub-3', 'третий кандидат доставил');
  const accountsById = new Map(supabase._tables.tg_accounts.map((a) => [a.id, a]));
  assertEqual(
    { reason: accountsById.get('ub-1').dm_pause_reason, until: accountsById.get('ub-1').dm_paused_until },
    { reason: 'account_flagged', until: new Date(NOW + DAY_MS).toISOString() },
    'очеловеченный SpamBot-текст → account_flagged на 24h'
  );
  assertEqual(
    { reason: accountsById.get('ub-2').dm_pause_reason, until: accountsById.get('ub-2').dm_paused_until },
    { reason: 'session_revoked', until: new Date(NOW + DAY_MS).toISOString() },
    'AUTH_KEY_UNREGISTERED → session_revoked на 24h'
  );
}
