// Сценарий из test/test-contour-admin-rights.js (разрезка под лимит pre-commit; хост — test/test-contour-admin-rights.js).
import { assertEqual, makePeerInviteEnv, makeActorRightRow, USERBOT_ID, PENDING_USERBOT_ID, PEER_USERBOT_ID, FIXTURE_USERBOT, PEER_USERBOT, PENDING_USERBOT, OWNER_ID, BOT_ID } from './shared.js';

export async function runPeerInviteCandidates() {
// ---------------------------------------------------------------------------
// 14. вступающий исключён из кандидатов; state=error и pending_activation — не кандидаты
// ---------------------------------------------------------------------------
console.log('\n[ensureAll] peer invite: joining actor excluded, bad candidates filtered out');
{
  const { joiner, exporter, factoryCalls, service } = makePeerInviteEnv({
    actorRights: [
      makeActorRightRow(USERBOT_ID, 'ok'),
      makeActorRightRow(PENDING_USERBOT_ID, 'ok'),
      makeActorRightRow(PEER_USERBOT_ID, 'error')
    ],
    userbots: [FIXTURE_USERBOT, PEER_USERBOT, PENDING_USERBOT],
    membersForJoiner: false
  });
  const res = await service.ensureAll(OWNER_ID, { botId: BOT_ID, autoJoin: true });

  const cell = res.results.find((r) => r.actor_type === 'userbot' && r.target === 'public_channel');
  assertEqual(cell?.state, 'missing_membership', 'no eligible candidates → missing_membership');
  assertEqual(exporter.calls.exportInvites, [], 'no invite export attempted');
  assertEqual(factoryCalls.filter((id) => id === PEER_USERBOT_ID).length, 0, 'state=error row never opened as exporter');
  assertEqual(factoryCalls.filter((id) => id === PENDING_USERBOT_ID).length, 0, 'pending_activation row never opened as exporter');
  assertEqual(joiner.calls.imports, [], 'no self-invite import attempted');
}
}
