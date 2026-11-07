// Сценарий из test/test-contour-admin-rights.js (разрезка под лимит pre-commit; хост — test/test-contour-admin-rights.js).
import { Api } from 'teleproto';
import { assertEqual, assertTrue, makeEnv, OWNER_ID, BOT_ID } from './shared.js';

export async function runFloodWaitStopsTargets() {
// ---------------------------------------------------------------------------
// 10. flood_wait stops remaining targets for that actor
// ---------------------------------------------------------------------------
console.log('\n[ensureAll] flood_wait stops remaining targets for the actor');
{
  const { botApi, client, peers, service } = makeEnv({
    userbotMember: { status: 'member' },
    promoteError: new Error('FLOOD_WAIT_30')
  });
  const res = await service.ensureAll(OWNER_ID, { botId: BOT_ID, autoJoin: true });

  const userbotCells = res.results.filter((r) => r.actor_type === 'userbot');
  assertEqual(userbotCells.length, 1, 'flood stops remaining userbot targets');
  assertEqual(userbotCells[0]?.state, 'error', 'flood cell → error');
  assertTrue(userbotCells[0]?.message.includes('flood wait'), 'flood cell message mentions flood wait', userbotCells[0]?.message);
  assertEqual(botApi.calls.promote.length, 1, 'promote attempted once only');
  assertTrue(
    client.calls.getInputEntity.every((c) => c === '-100111'),
    'no userbot client reads for second target',
    client.calls.getInputEntity
  );
  assertTrue(
    client.calls.invoke
      .filter((r) => r instanceof Api.channels.GetParticipant)
      .every((r) => r.channel === peers['-100111']),
    'no GetParticipant for second target',
    client.calls.invoke
  );
  assertEqual(res.results.filter((r) => r.actor_type === 'official_bot').length, 2, 'official bot actor unaffected by userbot flood');
}
}
