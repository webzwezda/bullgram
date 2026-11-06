import {
    assertEqual, assertTrue,
    makeEnv, makeCampaign, makeJoin, makeAccount, peerChannel, isClass
} from './shared.js';

// ---------------------------------------------------------------------------
// Фолбэк-промоутер №1: официальный бот-админ с can_restrict_members (Bot API ban+unban)
// ---------------------------------------------------------------------------
console.log('\n[default promoter: official bot via Bot API]');
{
  const realFetch = global.fetch;
  const botApiCalls = [];
  global.fetch = async (url, opts) => {
    const method = String(url).split('/').pop();
    botApiCalls.push({ method, body: JSON.parse(opts?.body || '{}') });
    const result = method === 'getChatMember'
      ? { status: 'administrator', can_restrict_members: true }
      : {};
    return { ok: true, json: async () => ({ ok: true, result }) };
  };
  try {
    const { supabase, cleanup } = makeEnv({
      tables: {
        broadcast_campaigns: [makeCampaign()],
        broadcast_preparation_joins: [makeJoin({ id: 'j1' })],
        channels: [],
        sales_bot_contours: [],
        tg_accounts: [makeAccount(), makeAccount({
          id: 'bot-1', account_type: 'bot', tg_account_id: '999', session_data: '123:TOKEN'
        })]
      },
      clientImpl: {
        getInputEntity: () => peerChannel(),
        invoke: (request) => {
          if (isClass(request, 'LeaveChannel')) throw new Error('CHANNEL_PRIVATE');
          return {};
        }
      }
    });
    await cleanup.runCleanupTick();

    const row = supabase._tables.broadcast_preparation_joins[0];
    assertEqual(row.remove_status, 'kicked', 'бот-админ с правом бана → kicked');
    const methods = botApiCalls.map((c) => c.method);
    assertTrue(methods.includes('getChatMember'), 'бот проверен через getChatMember');
    assertTrue(methods.includes('banChatMember'), 'kick = banChatMember');
    assertTrue(methods.includes('unbanChatMember'), '...и unbanChatMember');
    const ban = botApiCalls.find((c) => c.method === 'banChatMember');
    assertEqual(ban.body.user_id, 424242, 'банится именно joiner');
  } finally {
    global.fetch = realFetch;
  }
}

// kick завершён только после ПРОВЕРЕННОГО unban: первый unban сорвался → ретрай
console.log('\n[default promoter: unban проверяется — ретрай после сбоя]');
{
  const realFetch = global.fetch;
  let unbanAttempts = 0;
  global.fetch = async (url, opts) => {
    const method = String(url).split('/').pop();
    if (method === 'unbanChatMember') unbanAttempts += 1;
    let result = {};
    if (method === 'getChatMember') result = { status: 'administrator', can_restrict_members: true };
    const fail = method === 'unbanChatMember' && unbanAttempts === 1;
    return { ok: true, json: async () => (fail ? { ok: false, description: 'Try again later' } : { ok: true, result }) };
  };
  try {
    const { supabase, cleanup } = makeEnv({
      tables: {
        broadcast_campaigns: [makeCampaign()],
        broadcast_preparation_joins: [makeJoin({ id: 'j1' })],
        channels: [],
        sales_bot_contours: [],
        tg_accounts: [makeAccount(), makeAccount({
          id: 'bot-1', account_type: 'bot', tg_account_id: '999', session_data: '123:TOKEN'
        })]
      },
      clientImpl: {
        getInputEntity: () => peerChannel(),
        invoke: (request) => {
          if (isClass(request, 'LeaveChannel')) throw new Error('CHANNEL_PRIVATE');
          return {};
        }
      }
    });
    await cleanup.runCleanupTick();

    const row = supabase._tables.broadcast_preparation_joins[0];
    assertEqual(row.remove_status, 'kicked', 'unban прошёл на ретрае → kicked');
    assertEqual(unbanAttempts, 2, 'unban был ровно один ретрай');
  } finally {
    global.fetch = realFetch;
  }
}

// unban не прошёл ни разу → kick НЕ засчитан, юзербот мог остаться забаненным
console.log('\n[default promoter: unban сорвался дважды → failed с пометкой про ручной разбан]');
{
  const realFetch = global.fetch;
  let unbanAttempts = 0;
  global.fetch = async (url, opts) => {
    const method = String(url).split('/').pop();
    if (method === 'unbanChatMember') unbanAttempts += 1;
    let result = {};
    if (method === 'getChatMember') result = { status: 'administrator', can_restrict_members: true };
    const fail = method === 'unbanChatMember';
    return { ok: true, json: async () => (fail ? { ok: false, description: 'Try again later' } : { ok: true, result }) };
  };
  try {
    const { supabase, cleanup } = makeEnv({
      tables: {
        broadcast_campaigns: [makeCampaign()],
        broadcast_preparation_joins: [makeJoin({ id: 'j1' })],
        channels: [],
        sales_bot_contours: [],
        tg_accounts: [makeAccount(), makeAccount({
          id: 'bot-1', account_type: 'bot', tg_account_id: '999', session_data: '123:TOKEN'
        })]
      },
      clientImpl: {
        getInputEntity: () => peerChannel(),
        invoke: (request) => {
          if (isClass(request, 'LeaveChannel')) throw new Error('CHANNEL_PRIVATE');
          return {};
        }
      }
    });
    await cleanup.runCleanupTick();

    const row = supabase._tables.broadcast_preparation_joins[0];
    assertEqual(row.remove_status, 'failed', 'unban не прошёл → не kicked');
    assertTrue(String(row.remove_error || '').includes('разбанить вручную'), 'remove_error предупреждает про бан', row.remove_error);
    assertEqual(row.removed_at, null, 'removed_at остаётся null');
    assertEqual(unbanAttempts, 2, 'unban ретраился один раз, без бесконечных попыток');
  } finally {
    global.fetch = realFetch;
  }
}
