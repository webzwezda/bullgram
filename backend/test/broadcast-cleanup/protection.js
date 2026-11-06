import {
    OWNER, PREP, UB1, UB2, NOW_ISO,
    assertEqual, assertTrue,
    makeEnv, makeMockSupabase, makeCampaign, makeJoin, makeAccount,
    recordPreparationJoin, toMarkedChatId
} from './shared.js';

// ---------------------------------------------------------------------------
// (a) протекция: свой канал + слот контура
// ---------------------------------------------------------------------------
console.log('\n[protection: own channel + contour slot]');
{
  const { supabase, factory, cleanup } = makeEnv({
    tables: {
      broadcast_campaigns: [makeCampaign()],
      broadcast_preparation_joins: [
        makeJoin({ id: 'j1', userbot_id: UB1, tg_chat_id: '-100999' }),
        makeJoin({ id: 'j2', userbot_id: UB2, tg_chat_id: '-100888' })
      ],
      channels: [
        { id: 'ch-1', owner_id: OWNER, tg_chat_id: '-100999' },
        { id: 'ch-2', owner_id: OWNER, tg_chat_id: '-100888' }
      ],
      sales_bot_contours: [{
        owner_id: OWNER, public_channel_id: 'ch-2', paid_channel_id: null,
        public_chat_id: null, paid_chat_id: null
      }],
      tg_accounts: [makeAccount({ id: UB1 }), makeAccount({ id: UB2 })]
    }
  });
  await cleanup.runCleanupTick();

  assertEqual(factory.calls.created.length, 0, 'клиент юзербота не создавался — ноль Telegram-вызовов');
  const rows = supabase._tables.broadcast_preparation_joins;
  assertTrue(rows.every((r) => r.remove_status === 'skipped_protected'), 'обе строки skipped_protected',
    rows.map((r) => r.remove_status));
  assertTrue(rows.every((r) => r.removed_at === NOW_ISO), 'removed_at выставлен');
  const campaign = supabase._tables.broadcast_campaigns[0];
  assertEqual(campaign.meta.cleanup, { total: 2, done: 2, failed: 0 }, 'meta.cleanup пересчитан');
}

// P0-регрессия: phaseJoin получил BARE id от Telegram, helper вывел MARKED →
// протекция по channels.tg_chat_id матчится, юзербота не выгоняет из своего канала
console.log('\n[protection: bare-vs-marked — join записан через helper, channels хранит marked]');
{
  const markedChatId = toMarkedChatId('channel', '3996170258'); // как phaseJoin из joined.chat_id
  const supabase = makeMockSupabase({});
  await recordPreparationJoin(supabase, {
    ownerId: OWNER, preparationId: PREP, userbotId: UB1, chatId: markedChatId, chatTitle: 'Свой канал'
  });
  assertEqual(supabase._tables.broadcast_preparation_joins[0].tg_chat_id, '-1003996170258', 'в join-строке MARKED id');

  supabase._tables.broadcast_campaigns = [makeCampaign()];
  supabase._tables.channels = [{ id: 'ch-own', owner_id: OWNER, tg_chat_id: '-1003996170258' }];
  supabase._tables.sales_bot_contours = [];
  supabase._tables.tg_accounts = [makeAccount()];

  const { factory, cleanup } = makeEnv({ supabase });
  await cleanup.runCleanupTick();

  const row = supabase._tables.broadcast_preparation_joins[0];
  assertEqual(row.remove_status, 'skipped_protected', 'bare-vs-marked: строка защищена');
  assertEqual(factory.calls.created.length, 0, 'ноль Telegram-вызовов — своего канала не касаемся');
}
