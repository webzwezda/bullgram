// Сценарий из test/test-contour-admin-rights.js (разрезка под лимит pre-commit; хост — test/test-contour-admin-rights.js).
import { Api } from 'telegram';
import { assertTrue, makeEnv, OWNER_ID, BOT_ID } from './shared.js';

export async function runAdminReadShape() {
// ---------------------------------------------------------------------------
// 5. Форма чтения админ-состояния: resolved peer + channels.GetParticipant(InputPeerSelf)
// ---------------------------------------------------------------------------
console.log('\n[ensureAll] admin read shape: GetParticipant(InputPeerSelf) with resolved peer');
{
  const { client, peers, service } = makeEnv({ userbotMember: { status: 'member' } });
  await service.ensureAll(OWNER_ID, { botId: BOT_ID, autoJoin: true });

  const getParticipantRequests = client.calls.invoke.filter((r) => r instanceof Api.channels.GetParticipant);
  assertTrue(getParticipantRequests.length > 0, 'channels.GetParticipant used for channel/supergroup targets');
  assertTrue(
    getParticipantRequests.every((r) => r.participant instanceof Api.InputPeerSelf),
    'participant is InputPeerSelf (InputUserSelf не кастится в InputPeer)',
    getParticipantRequests[0]?.participant
  );
  assertTrue(
    getParticipantRequests.every((r) => r.channel === peers['-100111'] || r.channel === peers['-100222']),
    'channel is the resolved peer returned by getInputEntity'
  );
  assertTrue(
    client.calls.getInputEntity.every((c) => c === '-100111' || c === '-100222'),
    'getInputEntity called with chat ids'
  );
}
}
