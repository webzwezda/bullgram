// Честные вердикты SpamBot (план docs/plans/2026-11-15-spambot-verdicts-appeals.md).
// Офлайн, детерминированные: Telegram не трогаем — client мокается, проба /start
// читает ответы из фикстуры. Покрывает:
//   (a) classifySpambotReply — clear/limited/blocked по реальным текстам EN+RU;
//   (b) пассивная проверка без знакомых фраз = not_checked, а не «чисто»
//       (инцидент 2026-11-15: зелёный бейдж при лимите);
//   (c) липкость limited: пассивная проверка не снимает сохранённый лимит;
//   (d) активная проба: limited/clear вердикты с source='spambot_probe';
//   (e) getHealthSnapshot — fallback к персистентному health_summary;
//   (f) account-sale-rules: limited unsellable и по статусу, и по spambot_state;
//   (g) buildHealthSummary — spambot_* поля;
//   (h) listed job: limited → unpublish + sentinel healthy_streak=-1 +
//       событие spambot_limited с is_restriction=false.
import assert from 'node:assert';
import { test } from 'node:test';

// Таймаут пробы короче — тесты не должны висеть 12 секунд.
process.env.USERBOT_SPAMBOT_PROBE_TIMEOUT_MS = '3000';

const { classifySpambotReply, buildHealthDetails } = await import('../services/userbot/telegram-errors.js');
const { HealthMixin } = await import('../services/userbot/health.mixin.js');
const { buildHealthSummary } = await import('../utils/telegram-profile.js');
const { accountSaleRuleState, isFreshHealthyAccount, ACCOUNT_LIMITED_MESSAGE } = await import('../utils/account-sale-rules.js');

// Реальные тексты SpamBot'а (проверка 2026-11-15) + русские экраны.
const CLEAN_EN = "Good news, no limits are currently applied to your account. You're free as a bird!";
const LIMITED_EN = "Hello Nester!\n\nI'm very sorry that you had to contact me. Unfortunately, some actions can trigger a harsh response from our anti-spam systems. If you think your account was limited by mistake, you can submit a complaint to our moderators.\n\nWhile the account is limited, you will not be able to send messages to people who do not have your number in their phone contacts or add them to groups and channels. Of course, when people contact you first, you can always reply to them.";
const BLOCKED_EN = 'Your account was blocked for violations of the Telegram Terms of Service. This block was confirmed by our moderators.';
const LIMITED_RU = 'Пока аккаунт ограничен, вы не сможете отправлять сообщения людям, у которых нет вашего номера в телефонных контактах.';
const CLEAN_RU = 'Хорошая новость: на ваш аккаунт сейчас не наложено никаких ограничений. Вы свободны как птица!';

// --- Микро-сервис на миксине + мок клиента ---

class HealthBase {
    constructor() {
        this.spamBlockCache = new Map();
        this.supabase = null;
    }
    async _lastTelegramEventFor() { return null; }
}
const HealthSvc = HealthMixin(HealthBase);

function makeClient({ getMessages } = {}) {
    let call = 0;
    return {
        sentMessages: [],
        async getMe() {
            return {
                id: 123n, deleted: false, restricted: false,
                restrictionReason: [], scam: false, fake: false
            };
        },
        async invoke() { return {}; }, // probeFrozenState: не frozen
        async getInputEntity() { return { className: 'InputPeerUser' }; },
        async getEntity() { return { id: 178220800n, accessHash: 4242n }; },
        async sendMessage(_peer, params) { this.sentMessages.push(params?.message || ''); },
        async getMessages() {
            call += 1;
            return getMessages ? getMessages(call) : [];
        }
    };
}

// (a) Классификатор — три исхода на реальных текстах.
test('classifySpambotReply: clear/limited/blocked на реальных текстах', () => {
    assert.equal(classifySpambotReply(CLEAN_EN).state, 'clear');
    assert.equal(classifySpambotReply(LIMITED_EN).state, 'limited');
    assert.equal(classifySpambotReply(BLOCKED_EN).state, 'blocked');
    assert.equal(classifySpambotReply(LIMITED_RU).state, 'limited');
    assert.equal(classifySpambotReply(CLEAN_RU).state, 'clear');
    assert.equal(classifySpambotReply('No problem. Send /start if you need me again.').state, 'unknown');
    assert.equal(classifySpambotReply('').state, 'unknown');
});

// (b) Пассивная проверка: хвост без знакомых фраз — not_checked, не «чисто».
test('пассивная проверка без фраз: honest not_checked, статус online', async () => {
    const svc = new HealthSvc();
    const client = makeClient({ getMessages: () => [
        { id: 10, out: false, message: 'No problem. Send /start if you need me again.' }
    ] });
    const health = await svc.inspectAccountHealth(client, { userbotId: 'u1' });
    assert.equal(health.status, 'online');
    assert.equal(health.details.spambot.state, 'not_checked');
});

// (c) Липкость: пассивная проверка не снимает сохранённый limited.
test('липкость limited при пассивной проверке', async () => {
    const svc = new HealthSvc();
    const client = makeClient({ getMessages: () => [] });
    const health = await svc.inspectAccountHealth(client, {
        userbotId: 'u1',
        persistedHealthSummary: { spambot_state: 'limited', spambot_reason: 'Аккаунт лимитирован Telegram.' }
    });
    assert.equal(health.status, 'limited');
    assert.equal(health.details.spambot.source, 'persisted');
    assert.equal(health.details.spambot.state, 'limited');
});

// (d) Активная проба: вердикты limited и clear с source='spambot_probe'.
test('активная проба: limited вердикт', async () => {
    const svc = new HealthSvc();
    let polled = 0;
    const client = makeClient({ getMessages: () => {
        polled += 1;
        if (polled <= 1) return []; // история до /start пуста
        return [{ id: 45, out: false, message: LIMITED_EN }];
    } });
    const health = await svc.inspectAccountHealth(client, { userbotId: 'u1', activeSpamProbe: true });
    assert.equal(health.status, 'limited');
    assert.equal(health.details.spambot.state, 'limited');
    assert.equal(health.details.spambot.source, 'spambot_probe');
    assert.deepEqual(client.sentMessages, ['/start']);
});

test('активная проба: clear вердикт становится online', async () => {
    const svc = new HealthSvc();
    let polled = 0;
    const client = makeClient({ getMessages: () => {
        polled += 1;
        if (polled <= 1) return [];
        return [{ id: 46, out: false, message: CLEAN_EN }];
    } });
    const health = await svc.inspectAccountHealth(client, { userbotId: 'u1', activeSpamProbe: true });
    assert.equal(health.status, 'online');
    assert.equal(health.details.spambot.state, 'clear');
    assert.equal(health.details.spambot.source, 'spambot_probe');
});

// (e) getHealthSnapshot: персистентный fallback вместо вечного null.
test('getHealthSnapshot читает health_summary, когда кэш процесса пуст', async () => {
    const svc = new HealthSvc();
    const snapshot = await svc.getHealthSnapshot({
        id: 'u1',
        tg_username: 'testbot',
        runtime_status: 'limited',
        health_summary: {
            spambot_state: 'limited',
            spambot_reason: 'Аккаунт лимитирован Telegram.',
            spambot_checked_at: '2026-11-15T00:42:21.000Z'
        }
    });
    assert.equal(snapshot.spambot_signal.state, 'limited');
    assert.equal(snapshot.spambot_signal.source, 'persisted');
    assert.equal(snapshot.spambot_checked_at, '2026-11-15T00:42:21.000Z');
});

// (f) Правила продажи: limited unsellable и по статусу, и по spambot_state.
test('account-sale-rules: limited закрыт для продажи', () => {
    const fresh = { runtime_status: 'online', last_checked_at: new Date().toISOString() };

    const byStatus = accountSaleRuleState({ ...fresh, runtime_status: 'limited' });
    assert.equal(byStatus.sellable, false);
    assert.equal(byStatus.reasons[0], ACCOUNT_LIMITED_MESSAGE);

    const bySummary = accountSaleRuleState({
        ...fresh,
        health_summary: { spambot_state: 'limited', spambot_checked_at: new Date().toISOString() }
    });
    assert.equal(bySummary.sellable, false);
    assert.equal(bySummary.reasons[0], ACCOUNT_LIMITED_MESSAGE);

    // isFreshHealthyAccount (гейт брони/выдачи) тоже видит лимит.
    assert.equal(isFreshHealthyAccount({
        ...fresh,
        health_summary: { spambot_state: 'limited' }
    }), false);
    assert.equal(isFreshHealthyAccount(fresh), true);
});

// (g) buildHealthSummary — spambot_* поля персистятся.
test('buildHealthSummary: spambot_reason/source/checked_at', () => {
    const limited = buildHealthSummary({
        status: 'limited',
        reason: 'Аккаунт лимитирован Telegram.',
        details: buildHealthDetails({
            session: 'alive',
            restriction: 'limited',
            restrictionReason: 'Аккаунт лимитирован Telegram.',
            spambotState: 'limited',
            spambotReason: LIMITED_EN.slice(0, 100),
            spambotSource: 'spambot_probe'
        })
    }, '2026-11-15T00:42:21.000Z');
    assert.equal(limited.spambot_state, 'limited');
    assert.equal(limited.spambot_source, 'spambot_probe');
    assert.equal(limited.spambot_checked_at, '2026-11-15T00:42:21.000Z');

    const unchecked = buildHealthSummary({
        status: 'online',
        details: buildHealthDetails({ session: 'alive', restriction: 'clear', spambotState: 'not_checked' })
    }, '2026-11-15T01:00:00.000Z');
    assert.equal(unchecked.spambot_state, 'not_checked');
    assert.equal(unchecked.spambot_checked_at, null);
});

// (h) Джоба витринных лотов: limited → unpublish + sentinel + событие без is_restriction.
test('listed job: limited карантинит лот и не ставит is_restriction', async () => {
    const { runListedHealthCheck } = await import('../jobs/listed-userbot-health.job.js');

    const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const UB_ID = '11111111-1111-4111-8111-111111111111';
    const ITEM_ID = '33333333-3333-4333-8333-333333333333';
    const STALE_ISO = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    const tablesInit = {
        shop_items: [{ id: ITEM_ID, owner_id: OWNER, status: 'published', visibility: 'public', updated_at: new Date().toISOString() }],
        shop_item_assets: [{ shop_item_id: ITEM_ID, asset_type: 'userbot', asset_id: UB_ID }],
        tg_accounts: [{
            id: UB_ID, owner_id: OWNER, account_type: 'userbot', tg_username: 'limitedbot',
            runtime_status: 'online', session_data: 'enc', proxy_id: null,
            healthy_streak: 0, last_checked_at: STALE_ISO,
            health_summary: { spambot_state: 'limited', spambot_reason: 'x' }
        }],
        telegram_error_events: []
    };

    // Мини-мок supabase: select-цепочки отдают все строки, update — thenable
    // билдер с eq/in (как в test/listed-health-auto-restore.test.js), insert
    // просто дописывает. Джоба патчит только затронутые строки — для сценария
    // «один лот/один аккаунт» фильтры эквивалентны «всем строкам таблицы».
    const tables = Object.fromEntries(Object.entries(tablesInit).map(([name, rows]) => [name, rows.map((r) => ({ ...r }))]));
    const db = {
        from(table) {
            const rows = tables[table] ?? (tables[table] = []);
            const builder = {
                select() { return builder; },
                eq() { return builder; },
                in() { return builder; },
                order() { return builder; },
                limit() { return builder; },
                insert(payload) {
                    const list = Array.isArray(payload) ? payload : [payload];
                    for (const p of list) rows.push({ ...p });
                    return Promise.resolve({ data: null, error: null });
                },
                update(patch) {
                    const updateBuilder = {
                        eq() { return updateBuilder; },
                        in() { return updateBuilder; },
                        select() { return updateBuilder; },
                        then(resolve) {
                            for (const row of rows) Object.assign(row, patch);
                            resolve({ data: null, error: null, count: rows.length });
                        }
                    };
                    return updateBuilder;
                },
                then(resolve) {
                    resolve({ data: rows.map((r) => ({ ...r })), error: null, count: rows.length });
                }
            };
            return builder;
        }
    };
    db._tables = tables;

    await runListedHealthCheck(db, {}, {
        checkFn: async () => ({ status: 'limited', reason: 'Аккаунт лимитирован Telegram: писать может только тем, у кого его номер в контактах.', details: null })
    });

    const item = tables.shop_items[0];
    assert.equal(item.status, 'draft', 'лот снят с витрины');
    assert.equal(item.visibility, 'private');

    const account = tables.tg_accounts[0];
    assert.equal(account.runtime_status, 'limited');
    assert.equal(account.healthy_streak, -1, 'sentinel: авто-возврат запрещён');

    const event = tables.telegram_error_events.find((row) => row.restriction_kind === 'spambot_limited');
    assert.ok(event, 'событие spambot_limited записано');
    assert.equal(event.is_restriction, false, 'пурга 72h limited не удаляет');
});
