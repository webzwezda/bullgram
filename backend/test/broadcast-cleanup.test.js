/**
 * Offline tests for broadcast membership cleanup (выход юзерботов из групп по окончании рассылки).
 * Запуск: node test/test-broadcast-cleanup.js
 *
 * Strategy: no network, no Supabase, no Telegram traffic.
 *   - recordPreparationJoin tested directly against a fake supabase (insert/upsert/silence)
 *   - job tick tested via createBroadcastMembershipCleanup with fake supabase,
 *     fake userbot client factory, injected kickViaPromoter / sleep / random
 *
 * Covered scenarios:
 *   (g) recordPreparationJoin: свежий join → insert; повтор → upsert granted_admin;
 *       ошибка БД / ошибка insert не роняют вызов; toMarkedChatId/resolveMarkedChatId
 *       (bare TL id → MARKED channels.tg_chat_id, приоритет target.chat_id)
 *   (a) свой канал + слот контура → skipped_protected, ноль Telegram-вызовов;
 *       join, записанный через helper с bare id, матчится с marked channels-строкой
 *   (b) restricted/missing актёр → skipped_restricted, ноль Telegram-вызовов
 *   (c) LeaveChannel успех → left + removed_at; basic-группа → DeleteChatUser с InputUserSelf
 *   (d) USER_NOT_PARTICIPANT → left c «уже не участник»
 *   (e) самовыход упал + kick через промоутера удался → kicked (аргументы фолбэка)
 *   (f) самовыход упал + промоутера нет → failed, removed_at остаётся null
 *       фолбэк-промоутер через Bot API: ban+unban бот-админом с can_restrict_members;
 *       unban проверяется (ретрай), сорвался — failed с пометкой «разбанить вручную»
 *       фолбэк-промоутер через юзербота-админа: GetParticipant + EditBanned ban+unban (+ретрай unban)
 *       meta.cleanup = {total, done, failed} пересчитывается из строк
 *       полностью обработанная кампания (meta.cleanup done+failed >= total) скипается;
 *       пустая подготовка — cleanup-мета не пишется вовсе
 *   (h) пейсинг: skip'и без sleep; между операциями sleep ~4s ±20%; батч ≤20 за тик
 *   (i) phaseJoin: persisted-скан переживает рестарт (пустой кэш → skip без записи);
 *       скана нет вовсе → не вступаем вслепую (warn, без записи); скан есть, чата в нём нет
 *       → join проходит и записывает MARKED tg_chat_id
 *   (j) кампании-кандидаты привязаны к pending join-строкам: старая кампания с работой
 *       не вытесняется 50+ новыми (starvation)
 *
 * Сценарии живут в test/broadcast-cleanup/<scenario>.js; общие фикстуры —
 * test/broadcast-cleanup/shared.js. Хост импортирует их в исходном порядке,
 * проверки выполняются на импорте модуля.
 */
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'test-encryption-key-0123456789ab';
// phaseJoin-тесты: реальный sleep между join-операциями сжимаем до ~5s (env читается на вызове)
process.env.USERBOT_JOIN_SLEEP_MS = '5000';

// crypto.js (через userbot.service) требует ENCRYPTION_KEY на импорте — поэтому shared.js
// со всеми импортами джобы/сервиса везём динамически, уже после заглушки. Сами модули сеть не трогают.
const { state } = await import('./broadcast-cleanup/shared.js');

// Сценарии в исходном порядке.
await import('./broadcast-cleanup/record-preparation-join.js');
await import('./broadcast-cleanup/protection.js');
await import('./broadcast-cleanup/actor-state.js');
await import('./broadcast-cleanup/self-leave.js');
await import('./broadcast-cleanup/kick-fallback.js');
await import('./broadcast-cleanup/default-promoter-bot-api.js');
await import('./broadcast-cleanup/default-promoter-userbot.js');
await import('./broadcast-cleanup/campaign-meta.js');
await import('./broadcast-cleanup/pacing.js');
await import('./broadcast-cleanup/phase-join.js');

console.log(`\n=== broadcast-cleanup: ${state.passes} passed, ${state.failures} failed ===`);
if (state.failures > 0) process.exit(1);
