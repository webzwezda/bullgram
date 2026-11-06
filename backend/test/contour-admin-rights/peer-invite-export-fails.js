// Сценарий из test/test-contour-admin-rights.js (разрезка под лимит pre-commit; хост — test/test-contour-admin-rights.js).
import { assertEqual, assertTrue, makePeerInviteEnv, makeActorRightRow, PEER_USERBOT_ID, OWNER_ID, BOT_ID } from './shared.js';

export async function runPeerInviteExportFails() {
// ---------------------------------------------------------------------------
// 13. экспорт у соседа падает → предупреждение, structured failure, не throw
// ---------------------------------------------------------------------------
console.log('\n[ensureAll] peer invite: export throws → warning, structured failure');
{
  const { joiner, exporter, service } = makePeerInviteEnv({
    actorRights: [makeActorRightRow(PEER_USERBOT_ID, 'ok')],
    exportInviteError: new Error('CHAT_ADMIN_REQUIRED')
  });
  const res = await service.ensureAll(OWNER_ID, { botId: BOT_ID, autoJoin: true });

  const cell = res.results.find((r) => r.actor_type === 'userbot' && r.target === 'public_channel');
  assertEqual(cell?.state, 'missing_membership', 'export failure → structured missing_membership cell');
  assertTrue(
    (cell?.warnings || []).some((w) => w.includes('не смог сделать инвайт') && w.includes('ub2admin')),
    'warning names the failed peer exporter',
    cell?.warnings
  );
  assertTrue(
    String(cell?.message || '').includes('ни одним из способов'),
    'cell message lists all join methods failed',
    cell?.message
  );
  assertEqual(joiner.calls.imports, [], 'no import attempted without a link');
  assertEqual(exporter.calls.disconnect, 1, 'exporter still disconnected after export failure');
  assertEqual(exporter.calls.revokeExports, [], 'no revoke attempted without exported link');
}
}
