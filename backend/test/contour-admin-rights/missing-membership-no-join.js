// Сценарий из test/test-contour-admin-rights.js (разрезка под лимит pre-commit; хост — test/test-contour-admin-rights.js).
import { assertEqual, assertTrue, makeEnv, OWNER_ID, BOT_ID } from './shared.js';

export async function runMissingMembership() {
// ---------------------------------------------------------------------------
// 3. userbot not member + autoJoin=false → missing_membership, no join attempted
// ---------------------------------------------------------------------------
console.log('\n[ensureAll] userbot not member, autoJoin=false');
{
  const { botApi, client, service } = makeEnv({ userbotMember: null });
  const res = await service.ensureAll(OWNER_ID, { botId: BOT_ID, autoJoin: false });

  const userbotCells = res.results.filter((r) => r.actor_type === 'userbot');
  assertEqual(userbotCells.map((r) => r.state), ['missing_membership', 'missing_membership'], 'userbot cells → missing_membership');
  assertEqual(client.calls.invoke.length, 0, 'no join attempted');
  assertEqual(client.calls.getInputEntity.length, 0, 'no admin read attempted');
  assertEqual(botApi.calls.promote.length, 0, 'no promote attempted');
  assertEqual(res.results.filter((r) => r.actor_type === 'official_bot').length, 2, 'official bot cells present');
  assertTrue(res.summary.includes('2 из 4'), 'summary format', res.summary);
}
}
