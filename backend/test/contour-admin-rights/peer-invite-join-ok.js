// Сценарий из test/test-contour-admin-rights.js (разрезка под лимит pre-commit; хост — test/test-contour-admin-rights.js).
import { Api } from 'teleproto';
import { assertEqual, assertTrue, makePeerInviteEnv, makeActorRightRow, PEER_USERBOT_ID, OWNER_ID, BOT_ID } from './shared.js';

export async function runPeerInviteJoinOk() {
// ---------------------------------------------------------------------------
// 12. peer-invite: бот-инвайт падает → юзербот-сосед приглашает, revoke + disconnect
// ---------------------------------------------------------------------------
console.log('\n[ensureAll] peer userbot invite: joiner joins via peer admin invite');
{
  const { botApi, joiner, exporter, factoryCalls, service } = makePeerInviteEnv({
    actorRights: [makeActorRightRow(PEER_USERBOT_ID, 'ok')]
  });
  const res = await service.ensureAll(OWNER_ID, { botId: BOT_ID, autoJoin: true });

  const cell = res.results.find((r) => r.actor_type === 'userbot' && r.target === 'public_channel');
  assertEqual(cell?.state, 'ok', 'join via peer invite confirmed → cell ok');
  assertEqual(botApi.calls.exportInvite, ['-100111'], 'bot export attempted (and failed) before peer invite');
  assertEqual(botApi.calls.createInvite, ['-100111'], 'bot createInvite attempted (and failed) before peer invite');
  assertTrue(joiner.calls.invoke.some((r) => r instanceof Api.channels.JoinChannel), 'JoinChannel tried before peer invite');
  assertEqual(joiner.calls.imports, ['peerinvite777'], 'joiner imported hash from peer-exported link');
  assertEqual(exporter.calls.exportInvites.length, 1, 'peer exported invite exactly once');
  assertEqual(exporter.calls.revokeExports, ['https://t.me/+peerinvite777'], 'revoke attempted with the exported link');
  assertEqual(exporter.calls.disconnect, 1, 'exporter client disconnected once');
  assertEqual(factoryCalls.filter((id) => id === PEER_USERBOT_ID).length, 1, 'exporter client opened exactly once');
  assertTrue(
    (cell.warnings || []).some((w) => w.includes('только что вступил')),
    'cell notes fresh join',
    cell?.warnings
  );
}
}
