// Сценарий из test/test-contour-admin-rights.js (разрезка под лимит pre-commit; хост — test/test-contour-admin-rights.js).
import { assertEqual, assertTrue, makeEnv, OWNER_ID, BOT_ID } from './shared.js';

export async function runPromoteOkUpsert() {
// ---------------------------------------------------------------------------
// 4. member, not admin, promote ok → ok + upsert row with flags
// ---------------------------------------------------------------------------
console.log('\n[ensureAll] member, not admin, promote ok');
{
  const { botApi, client, supabase, service } = makeEnv({ userbotMember: { status: 'member' } });
  const res = await service.ensureAll(OWNER_ID, { botId: BOT_ID, autoJoin: true });

  const cell = res.results.find((r) => r.actor_type === 'userbot' && r.target === 'public_channel');
  assertEqual(cell?.state, 'ok', 'userbot cell → ok');
  assertEqual(botApi.calls.promote[0]?.rights, { can_invite_users: true, can_restrict_members: true }, 'promote called with CONTOUR_USERBOT_MAX_RIGHTS');
  assertEqual(cell?.actor_username, 'ub1', 'userbot cell carries actor_username');
  assertEqual(res.results.find((r) => r.actor_type === 'official_bot')?.actor_username, 'salesbot', 'official bot cell carries actor_username');
  assertEqual(client.calls.disconnect, 1, 'userbot client disconnected once');

  const row = supabase._upserts.find((u) => u.table === 'sales_contour_actor_rights'
    && u.row.actor_type === 'userbot' && u.row.target === 'public_channel');
  assertTrue(!!row, 'upsert row written', supabase._upserts.map((u) => u.table));
  assertEqual(row?.row?.state, 'ok', 'upsert row state ok');
  assertEqual(row?.row?.is_admin, true, 'upsert row is_admin true');
  assertEqual(row?.row?.flags?.can_restrict_members, true, 'upsert row flags include can_restrict_members');
  assertEqual(row?.row?.bot_id, BOT_ID, 'upsert row bot_id');
  assertEqual(row?.row?.owner_id, OWNER_ID, 'upsert row owner_id');
}
}
