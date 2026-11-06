// Сценарий из test/test-contour-admin-rights.js (разрезка под лимит pre-commit; хост — test/test-contour-admin-rights.js).
import { assertEqual, assertTrue, makeEnv, OWNER_ID, BOT_ID } from './shared.js';

export async function runOfficialBotMissingFlag() {
// ---------------------------------------------------------------------------
// 8. official_bot actor with missing can_restrict_members → promote_forbidden, no promote
// ---------------------------------------------------------------------------
console.log('\n[ensureAll] official bot missing can_restrict_members');
{
  const { botApi, service } = makeEnv({
    withUserbot: false,
    botMember: {
      status: 'administrator', is_admin: true,
      can_manage_chat: true, can_invite_users: true,
      can_restrict_members: false, can_promote_members: true
    }
  });
  const res = await service.ensureAll(OWNER_ID, { botId: BOT_ID });

  const botCells = res.results.filter((r) => r.actor_type === 'official_bot');
  assertEqual(botCells.map((r) => r.state), ['promote_forbidden', 'promote_forbidden'], 'bot cells → promote_forbidden');
  assertTrue(
    botCells.every((r) => (r.warnings || []).some((w) => w.includes('выдай боту права вручную'))),
    'warning tells to grant rights manually',
    botCells[0]?.warnings
  );
  assertTrue(
    botCells.every((r) => (r.warnings || []).some((w) => w.includes('can_restrict_members'))),
    'warning lists missing flag',
    botCells[0]?.warnings
  );
  assertEqual(botApi.calls.promote.length, 0, 'no promote attempt for official bot');
  assertEqual(res.results.length, 2, 'only official bot actor cells (no userbots configured)');
}
}
