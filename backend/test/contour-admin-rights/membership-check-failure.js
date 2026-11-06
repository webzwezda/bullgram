// Сценарий из test/test-contour-admin-rights.js (разрезка под лимит pre-commit; хост — test/test-contour-admin-rights.js).
import { assertEqual, assertTrue, makeEnv, OWNER_ID, BOT_ID } from './shared.js';

export async function runMembershipCheckFailure() {
// ---------------------------------------------------------------------------
// 9. membership check failure + autoJoin=false → error, НЕ missing_membership
// ---------------------------------------------------------------------------
console.log('\n[ensureAll] membership check failure (bot cannot see members), autoJoin=false');
{
  const { botApi, client, service } = makeEnv({
    userbotMember: { status: 'member' },
    getMemberErrorFor: (_chatId, userId) => userId === '8001'
      ? new Error('Forbidden: bot is not a member of the channel chat')
      : null
  });
  const res = await service.ensureAll(OWNER_ID, { botId: BOT_ID, autoJoin: false });

  const userbotCells = res.results.filter((r) => r.actor_type === 'userbot');
  assertEqual(userbotCells.map((r) => r.state), ['error', 'error'], 'check failure → error state, not missing_membership');
  assertTrue(
    userbotCells.every((r) => r.message.includes('не удалось проверить членство')),
    'message explains the membership check failure',
    userbotCells[0]?.message
  );
  assertEqual(botApi.calls.promote.length, 0, 'no promote attempted');
  assertEqual(client.calls.invoke.length, 0, 'no join / admin read attempted');
}
}
