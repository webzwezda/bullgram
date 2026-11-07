/**
 * Offline tests for the messaging router (MessagingRouter + pure helpers).
 * Запуск: node test/test-messaging-router.js
 *
 * Strategy: no network, no Supabase, no Telegram traffic.
 *   - pure helpers tested directly (resolveMessagingCaps, estimateCapacity, isActorEligible)
 *   - orchestration tested with fake supabase (in-memory userbot_send_log + tg_accounts),
 *     fake sendUserbot, instant sleep, injected random
 *
 * Covered scenarios:
 *   - resolveMessagingCaps defaults + overrides + non-numeric/negative env
 *   - estimateCapacity math (pool 0 → days null, audience 0 → both 0)
 *   - isActorEligible (pending_activation, blocked statuses, dead proxy, future/past pause)
 *   - quota skip: hourly + daily (candidate пропускается, берётся следующий)
 *   - flood_wait: pause = retry_after + 30s, clamp 3600s, humanized fallback без секунд
 *   - account_flagged / session_revoked: пауза 24h (сырые и очеловеченные тексты)
 *   - rotation order: touchpoint first, затем по минимуму отправок
 *   - jitter bounds: ±jitterPercent от baseDelayMs, нет sleep перед первой попыткой
 *   - recordSend idempotency conflict → { recorded:false } без throw
 *   - deliver happy path + pool exhausted
 *   - flood-пауза зеркалится на in-memory пул (P1-1): повторный deliver без попыток
 *   - pauseActor/clearPause с owner-фильтром (P2-4)
 *   - ключ идемпотентности только на первой попытке (P2-5)
 *
 * Сценарии живут в test/messaging-router/<scenario>.js; общие фикстуры —
 * test/messaging-router/shared.js. Хост импортирует их в исходном порядке,
 * проверки выполняются на импорте модуля.
 */

// Пинним капы: тесты не должны зависеть от амбиентного .env
process.env.USERBOT_DM_HOURLY_CAP = '20';
process.env.USERBOT_DM_DAILY_CAP = '50';
process.env.USERBOT_DM_JITTER_PERCENT = '20';

const { state } = await import('./messaging-router/shared.js');

// Сценарии в исходном порядке.
await import('./messaging-router/pure-helpers.js');
await import('./messaging-router/quotas.js');
await import('./messaging-router/flood-and-flags.js');
await import('./messaging-router/rotation-and-jitter.js');
await import('./messaging-router/deliver-and-ledger.js');
await import('./messaging-router/pauses-mirroring.js');

console.log(`\n=== messaging-router: ${state.passes} passed, ${state.failures} failed ===`);
if (state.failures > 0) process.exit(1);
