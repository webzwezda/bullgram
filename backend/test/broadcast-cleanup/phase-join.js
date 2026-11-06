import {
    OWNER, PREP, UB1,
    assertEqual, assertTrue, captureWarns,
    makeMockSupabase, BroadcastPreparationService
} from './shared.js';

// --- phaseJoin harness: реальный сервис с заглушками вместо сети/БД ----------------------
function makePoolUserbot(overrides = {}) {
  return { id: UB1, tg_username: 'ub1', ...overrides };
}

function makePrepRow(overrides = {}) {
  return {
    id: PREP, owner_id: OWNER, status: 'joining', audience_type: 'manual_list',
    userbot_ids: [UB1], external_targets: [], phase_detail: {},
    ...overrides
  };
}

// Стабим всё, до чего phaseJoin дотягивается кроме join-петли: сеть не трогаем,
// sleep остаётся реальным (~5s через USERBOT_JOIN_SLEEP_MS) — как в проде.
function makeJoinService(supabase, prepRow, { pool = [makePoolUserbot()], target, joinImpl = null } = {}) {
  const service = new BroadcastPreparationService(supabase);
  const joinCalls = [];
  service.setStatus = async () => {};
  service.updatePhaseDetail = async () => {};
  service.getPreparationRow = async () => prepRow;
  service.loadPoolUserbots = async () => pool;
  service.buildJoinTargets = async () => [target];
  service.countRecentJoins = async () => 0;
  service.scanChatParticipants = async () => new Set();
  service.applyConfirmedTouchpoints = async () => {};
  service.userbotService.joinChatByInvite = async (userbot, args) => {
    joinCalls.push({ userbotId: String(userbot.id), invite: args?.inviteLink });
    if (joinImpl) return joinImpl(userbot, args);
    return { chat_id: '555', access_hash: '77', title: 'Целевая', kind: 'channel' };
  };
  return { service, joinCalls };
}

// ---------------------------------------------------------------------------
// (i) phaseJoin: persisted-скан переживёт рестарт; вслепую не вступаем
// ---------------------------------------------------------------------------
const JOIN_TARGET = { raw: 'https://t.me/target', scope: 'owner', chat_id: '-100555', title: 'Целевая' };

// (a) рестарт посреди подготовки: in-memory кэш пуст, но phase_detail.scanned_chats живёт
console.log('\n[phaseJoin: restart — persisted-скан с чатом → skip, без записи]');
{
  const supabase = makeMockSupabase({});
  const prepRow = makePrepRow({ phase_detail: { scanned_chats: { [UB1]: ['-100555'] } } });
  const { service, joinCalls } = makeJoinService(supabase, prepRow, { target: JOIN_TARGET });
  await service.phaseJoin(prepRow);

  assertEqual(joinCalls.length, 0, 'чат в persisted-скане — Telegram join не вызывался');
  assertEqual((supabase._tables.broadcast_preparation_joins || []).length, 0, 'join-строка не записана (юзербот был там раньше)');
}

// (b) скана нет ни в кэше, ни в persisted → вслепую не вступаем
console.log('\n[phaseJoin: скана нет вовсе → warn, без join и без записи]');
{
  const supabase = makeMockSupabase({});
  const prepRow = makePrepRow({ phase_detail: {} });
  const { service, joinCalls } = makeJoinService(supabase, prepRow, { target: JOIN_TARGET });
  const warns = await captureWarns(() => service.phaseJoin(prepRow));

  assertEqual(joinCalls.length, 0, 'вслепую не вступаем');
  assertEqual((supabase._tables.broadcast_preparation_joins || []).length, 0, 'join-строка не записана');
  assertTrue(warns.some((w) => w.includes('не вступаем вслепую')), 'warn про join вслепую', warns);
}

// (c) скан есть, но целевого чата в нём нет → join проходит и записывает MARKED tg_chat_id
console.log('\n[phaseJoin: чат вне скана → join проходит, запись с MARKED id]');
{
  const supabase = makeMockSupabase({});
  const prepRow = makePrepRow({ phase_detail: { scanned_chats: { [UB1]: ['-100999'] } } });
  const { service, joinCalls } = makeJoinService(supabase, prepRow, { target: JOIN_TARGET });
  await service.phaseJoin(prepRow);

  assertEqual(joinCalls.length, 1, 'чат вне скана — join выполнен');
  const rows = supabase._tables.broadcast_preparation_joins;
  assertEqual(rows.length, 1, 'join записан');
  assertEqual(rows[0].tg_chat_id, '-100555', 'записан MARKED id (target.chat_id приоритетнее bare из joined)');
  assertEqual(joinCalls[0]?.userbotId, UB1, 'join делал юзербот из пула');
}
