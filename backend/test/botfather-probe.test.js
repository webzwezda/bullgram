// Юнит-тесты пробы BotFather: офлайн, клиент фейковый (инъекция makeClient),
// Telegram не трогаем. Вердикты → health_summary.merge, гард параллельного
// скана, скип карантина. Стиль — как у account-intake (свой раннер).
import { probeBotFatherAbility, runBotFatherProbeScan } from '../services/botfather-probe.service.js';

let failures = 0;
function assert(condition, label) {
    if (condition) {
        console.log(`  ✓ ${label}`);
    } else {
        console.error(`  ✗ ${label}`);
        failures++;
    }
}

// Мок supabase в стиле test/account-intake/shared.js (thenable-билдер).
let idSeq = 0;
function makeMockSupabase(tablesInit = {}) {
    const tables = {};
    for (const [name, rows] of Object.entries(tablesInit)) tables[name] = rows.map((r) => ({ ...r }));
    const db = {
        from(table) {
            const rows = tables[table] ?? (tables[table] = []);
            const filters = [];
            const pred = (row) => filters.every(([col, op, val]) => {
                if (op === 'eq') return String(row[col]) === String(val);
                if (op === 'in') return (val || []).some((v) => String(row[col]) === String(v));
                return true;
            });
            const builder = {
                select() { return builder; },
                eq(col, val) { filters.push([col, 'eq', val]); return builder; },
                in(col, vals) { filters.push([col, 'in', vals]); return builder; },
                order() { return builder; },
                async maybeSingle() { return { data: rows.find(pred) || null, error: null }; },
                update(patch) {
                    const ub = {
                        eq(col, val) { filters.push([col, 'eq', val]); return ub; },
                        then(resolve) {
                            for (const row of rows) if (pred(row)) Object.assign(row, patch);
                            resolve({ data: null, error: null });
                        }
                    };
                    return ub;
                },
                then(resolve) { resolve({ data: rows.filter(pred).map((r) => ({ ...r })), error: null }); }
            };
            return builder;
        }
    };
    db._tables = tables;
    return db;
}

function fakeClient({ replies = [], sendError = null, resolveError = null } = {}) {
    let sent = 0;
    let incomingId = 100;
    const client = {
        connected: false,
        async connect() { client.connected = true; },
        async disconnect() { client.connected = false; },
        async getInputEntity(name) {
            if (resolveError) throw new Error(resolveError);
            return { className: 'InputPeerUser', username: name };
        },
        // До отправки — пусто (baseline), после — ответы BotFather
        async getMessages() {
            if (sent === 0) return [];
            return replies.map((text, i) => ({ id: 200 + i, out: false, message: text }));
        },
        async sendMessage() {
            if (sendError) {
                const e = new Error(sendError.message);
                e.errorMessage = sendError.rpc;
                throw e;
            }
            sent += 1;
            incomingId += 1;
            return { id: incomingId, out: true, message: '/start' };
        },
        _sentCount: () => sent
    };
    return { client, connect: async () => client.connect() };
}

const noSleep = async () => {};

async function runAll() {
    console.log('— probeBotFatherAbility —');
    {
        const factory = () => fakeClient({ replies: ['I can help you create bots'] });
        const verdict = await probeBotFatherAbility({}, { account: { id: 'a1' }, proxy: { is_working: true } }, { makeClient: factory, sleep: noSleep });
        assert(verdict.state === 'ok', `ответ BotFather → ok (${verdict.state})`);
    }
    {
        // Кейс Elizabeth: RPC отправки падает — сырая ошибка сохраняется
        const factory = () => fakeClient({ sendError: { rpc: 'PEER_FLOOD_INVALID', message: 'flood' } });
        const verdict = await probeBotFatherAbility({}, { account: { id: 'a2' }, proxy: { is_working: true } }, { makeClient: factory, sleep: noSleep });
        assert(verdict.state === 'send_error', 'падение отправки → send_error');
        assert(String(verdict.reason).includes('PEER_FLOOD_INVALID'), 'сырая RPC-ошибка в reason');
    }
    {
        const factory = () => fakeClient({ replies: ['Sorry, you can\'t use me'] });
        const verdict = await probeBotFatherAbility({}, { account: { id: 'a3' }, proxy: { is_working: true } }, { makeClient: factory, sleep: noSleep });
        assert(verdict.state === 'refused', 'отказ BotFather → refused');
    }
    {
        // Тихий лимит: отправилось, ответа нет (таймаут ответа инъекционно 0)
        const factory = () => fakeClient({ replies: [] });
        const verdict = await probeBotFatherAbility({}, { account: { id: 'a4' }, proxy: { is_working: true } }, { makeClient: factory, sleep: noSleep, replyTimeoutMs: 0 });
        assert(verdict.state === 'no_reply', 'безответ → no_reply');
    }
    {
        const verdict = await probeBotFatherAbility({}, { account: { id: 'a5' }, proxy: { is_working: false } }, { sleep: noSleep });
        assert(verdict.state === 'dead_proxy', 'мёртвый прокси → dead_proxy без коннекта');
    }

    console.log('— runBotFatherProbeScan —');
    {
        const supabase = makeMockSupabase({
            tg_accounts: [
                { id: 'ok-acc', owner_id: 'o1', account_type: 'userbot', runtime_status: 'online', health_summary: { status: 'online', spambot_state: 'clear' }, proxies: { is_working: true, name: 'p1' } },
                { id: 'dead-proxy-acc', owner_id: 'o1', account_type: 'userbot', runtime_status: 'online', health_summary: null, proxies: { is_working: false, name: 'p2' } },
                { id: 'quarantined-acc', owner_id: 'o1', account_type: 'userbot', runtime_status: 'restricted', health_summary: null, proxies: { is_working: true, name: 'p3' } }
            ]
        });
        const probeCalls = [];
        const results = await runBotFatherProbeScan({
            supabase,
            userbotService: {},
            ownerId: 'o1',
            deps: {
                sleep: noSleep,
                probe: async (account, proxy) => {
                    probeCalls.push(account.id);
                    return { state: 'ok', reason: null };
                }
            }
        });
        assert(results.length === 3, `все три аккаунта в скане (${results.length})`);
        assert(probeCalls.includes('ok-acc') && probeCalls.includes('dead-proxy-acc'), 'живые аккаунты прозондырованы');
        assert(!probeCalls.includes('quarantined-acc'), 'карантин скипается без пробы');
        const quarantined = results.find((r) => r.account_id === 'quarantined-acc');
        assert(quarantined.state === 'skipped', 'карантин → skipped');
        const row = supabase._tables.tg_accounts.find((r) => r.id === 'ok-acc');
        assert(row.health_summary.botfather_state === 'ok', 'вердикт в health_summary');
        assert(row.health_summary.spambot_state === 'clear' && row.health_summary.status === 'online', 'существующие поля health_summary не затёрты');
        assert(Boolean(row.health_summary.botfather_checked_at), 'отметка времени пробы стоит');
    }

    console.log(failures === 0 ? '\nВсе проверки пробы BotFather прошли' : `\nПровалено проверок: ${failures}`);
    process.exit(failures === 0 ? 0 : 1);
}

runAll();
