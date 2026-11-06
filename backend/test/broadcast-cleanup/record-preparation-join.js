import {
    OWNER, PREP, UB1, UB2,
    ok, assertEqual, assertTrue, captureWarns,
    makeMockSupabase, recordPreparationJoin, toMarkedChatId, resolveMarkedChatId
} from './shared.js';

// ---------------------------------------------------------------------------
// (g) recordPreparationJoin
// ---------------------------------------------------------------------------
console.log('\n[recordPreparationJoin: fresh insert]');
{
  const supabase = makeMockSupabase({ broadcast_preparation_joins: [] });
  await recordPreparationJoin(supabase, {
    ownerId: OWNER, preparationId: PREP, userbotId: UB1, chatId: -100555, chatTitle: 'Чужая группа'
  });
  const rows = supabase._tables.broadcast_preparation_joins;
  assertEqual(rows.length, 1, 'одна строка вставлена');
  assertEqual(
    { owner_id: rows[0].owner_id, preparation_id: rows[0].preparation_id, userbot_id: rows[0].userbot_id },
    { owner_id: OWNER, preparation_id: PREP, userbot_id: UB1 },
    'скоуп строки: owner + preparation + userbot'
  );
  assertEqual(rows[0].tg_chat_id, '-100555', 'tg_chat_id приведён к строке');
  assertEqual(rows[0].granted_admin, false, 'granted_admin=false по умолчанию');
  assertEqual(rows[0].chat_title, 'Чужая группа', 'chat_title записан');
}

console.log('[recordPreparationJoin: retry upsert + granted_admin]');
{
  const supabase = makeMockSupabase({ broadcast_preparation_joins: [] });
  await recordPreparationJoin(supabase, { ownerId: OWNER, preparationId: PREP, userbotId: UB1, chatId: '-100555' });
  await recordPreparationJoin(supabase, { ownerId: OWNER, preparationId: PREP, userbotId: UB1, chatId: '-100555' });
  assertEqual(supabase._tables.broadcast_preparation_joins.length, 1, 'повторный join не дублирует строку');

  await recordPreparationJoin(supabase, {
    ownerId: OWNER, preparationId: PREP, userbotId: UB1, chatId: '-100555', grantedAdmin: true
  });
  const row = supabase._tables.broadcast_preparation_joins[0];
  assertEqual(supabase._tables.broadcast_preparation_joins.length, 1, 'после апдейта строка одна');
  assertEqual(row.granted_admin, true, 'granted_admin поднялся до true на той же строке');

  await recordPreparationJoin(supabase, { ownerId: OWNER, preparationId: PREP, userbotId: UB2, chatId: '-100555' });
  assertEqual(supabase._tables.broadcast_preparation_joins.length, 2, 'другой юзербот — отдельная строка');
}

console.log('[recordPreparationJoin: silence on db failure]');
{
  const broken = { from: () => { throw new Error('db down'); } };
  await recordPreparationJoin(broken, { ownerId: OWNER, preparationId: PREP, userbotId: UB1, chatId: '-100555' });
  ok('ошибка БД не роняет join-флоу');
}

console.log('[recordPreparationJoin: insert error замечен и не роняет флоу]');
{
  const failing = {
    from: () => {
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        limit() { return builder; },
        maybeSingle: async () => ({ data: null, error: null }),
        insert: async () => ({ data: null, error: { message: 'duplicate key value' } })
      };
      return builder;
    }
  };
  const warns = await captureWarns(() => recordPreparationJoin(failing, {
    ownerId: OWNER, preparationId: PREP, userbotId: UB1, chatId: '-100555'
  }));
  assertTrue(warns.some((w) => w.includes('duplicate key value')), 'ошибка insert попала в warn', warns);
  ok('ошибка insert не роняет join-флоу');
}

// ---------------------------------------------------------------------------
// toMarkedChatId / resolveMarkedChatId: bare TL id → MARKED channels.tg_chat_id
// ---------------------------------------------------------------------------
console.log('\n[toMarkedChatId: bare → marked]');
{
  assertEqual(toMarkedChatId('channel', '3996170258'), '-1003996170258', 'channel → -100{bare}');
  assertEqual(toMarkedChatId('group', '3996170258'), '-3996170258', 'group → -{bare}');
  assertEqual(toMarkedChatId('channel', '-1003996170258'), '-1003996170258', 'уже marked channel — без изменений');
  assertEqual(toMarkedChatId('group', '-3996170258'), '-3996170258', 'уже marked basic-группа — без изменений');
  assertEqual(toMarkedChatId('channel', null), null, 'null → null');
  assertEqual(toMarkedChatId('channel', 'null'), null, '"null" → null');
  assertEqual(toMarkedChatId('channel', ''), null, 'пустая строка → null');
  assertEqual(resolveMarkedChatId('-100555', 'group', '777'), '-100555', 'target.chat_id marked приоритетнее kind');
  assertEqual(resolveMarkedChatId(null, 'channel', '555'), '-100555', 'без target.chat_id — derived из kind');
  assertEqual(resolveMarkedChatId(null, 'group', '555'), '-555', 'без target.chat_id — basic-группа');
}
