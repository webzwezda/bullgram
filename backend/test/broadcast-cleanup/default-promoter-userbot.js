import {
    UB1, UB2,
    assertEqual, assertTrue,
    makeEnv, makeCampaign, makeJoin, makeAccount, peerChannel, isClass
} from './shared.js';

// ---------------------------------------------------------------------------
// Фолбэк-промоутер №2: юзербот-админ с can_restrict_members (EditBanned ban+unban)
// ---------------------------------------------------------------------------
console.log('\n[default promoter: userbot admin via EditBanned]');
{
  const { supabase, factory, cleanup } = makeEnv({
    tables: {
      broadcast_campaigns: [makeCampaign()],
      broadcast_preparation_joins: [makeJoin({ id: 'j1', userbot_id: UB1 })],
      channels: [],
      sales_bot_contours: [],
      tg_accounts: [makeAccount({ id: UB1 }), makeAccount({ id: UB2, tg_account_id: '525252' })]
    },
    clientImpl: {
      getInputEntity: () => peerChannel(),
      invoke: (request, account) => {
        if (isClass(request, 'LeaveChannel')) throw new Error('CHANNEL_PRIVATE');
        if (isClass(request, 'GetParticipant')) {
          // промоутер UB2 — админ с правом бана; joiner UB1 промоутером не побывает (исключён из пула)
          if (String(account.id) === UB2) return { participant: { adminRights: { canRestrictMembers: true } } };
          return { participant: { adminRights: {} } };
        }
        return {};
      }
    }
  });
  await cleanup.runCleanupTick();

  const row = supabase._tables.broadcast_preparation_joins[0];
  assertEqual(row.remove_status, 'kicked', 'юзербот-админ kickнул → kicked');
  const edits = factory.calls.invocations.filter((c) => isClass(c, 'EditBanned'));
  assertEqual(edits.length, 2, 'EditBanned ban + unban');
  assertEqual(edits[0]?.account, UB2, 'кик делал промоутер, не joiner');
}

// userbot-промоутер: первый unban сорвался → компенсация-ретрай, kick засчитан
console.log('\n[default promoter: userbot unban ретраится — kick засчитан]');
{
  let editBanned = [];
  const { supabase, cleanup } = makeEnv({
    tables: {
      broadcast_campaigns: [makeCampaign()],
      broadcast_preparation_joins: [makeJoin({ id: 'j1', userbot_id: UB1 })],
      channels: [],
      sales_bot_contours: [],
      tg_accounts: [makeAccount({ id: UB1 }), makeAccount({ id: UB2, tg_account_id: '525252' })]
    },
    clientImpl: {
      getInputEntity: () => peerChannel(),
      invoke: (request, account) => {
        if (isClass(request, 'LeaveChannel')) throw new Error('CHANNEL_PRIVATE');
        if (isClass(request, 'GetParticipant')) {
          if (String(account.id) === UB2) return { participant: { adminRights: { canRestrictMembers: true } } };
          return { participant: { adminRights: {} } };
        }
        if (isClass(request, 'EditBanned') && String(account.id) === UB2) {
          editBanned.push(request);
          if (editBanned.length === 2) throw new Error('USER_ADMIN_INVALID'); // первый unban сорвался
        }
        return {};
      }
    }
  });
  await cleanup.runCleanupTick();

  const row = supabase._tables.broadcast_preparation_joins[0];
  assertEqual(row.remove_status, 'kicked', 'unban прошёл на ретрае → kicked');
  assertEqual(editBanned.length, 3, 'EditBanned ban + unban + ретрай unban');
}

// userbot-промоутер: unban сорвался дважды → kick НЕ засчитан, пометка про ручной разбан
console.log('\n[default promoter: userbot unban сорвался дважды → failed с пометкой]');
{
  let editBanned = [];
  const { supabase, cleanup } = makeEnv({
    tables: {
      broadcast_campaigns: [makeCampaign()],
      broadcast_preparation_joins: [makeJoin({ id: 'j1', userbot_id: UB1 })],
      channels: [],
      sales_bot_contours: [],
      tg_accounts: [makeAccount({ id: UB1 }), makeAccount({ id: UB2, tg_account_id: '525252' })]
    },
    clientImpl: {
      getInputEntity: () => peerChannel(),
      invoke: (request, account) => {
        if (isClass(request, 'LeaveChannel')) throw new Error('CHANNEL_PRIVATE');
        if (isClass(request, 'GetParticipant')) {
          if (String(account.id) === UB2) return { participant: { adminRights: { canRestrictMembers: true } } };
          return { participant: { adminRights: {} } };
        }
        if (isClass(request, 'EditBanned') && String(account.id) === UB2) {
          editBanned.push(request);
          if (editBanned.length >= 2) throw new Error('USER_ADMIN_INVALID'); // unban и его ретрай сорвались
        }
        return {};
      }
    }
  });
  await cleanup.runCleanupTick();

  const row = supabase._tables.broadcast_preparation_joins[0];
  assertEqual(row.remove_status, 'failed', 'unban не прошёл → не kicked');
  assertTrue(String(row.remove_error || '').includes('разбанить вручную'), 'remove_error предупреждает про бан', row.remove_error);
  assertEqual(row.removed_at, null, 'removed_at остаётся null');
  assertEqual(editBanned.length, 3, 'ban + unban + единственный ретрай, без бесконечных попыток');
}
