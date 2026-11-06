/**
 * Общие ассерты, константы, флаг-гейты, мок GramJS-клиента и мок supabase
 * для сценариев test-userbot-ops.
 * Живые биндинги: counters мутируется по мере проверок, хост-файл
 * (test/test-userbot-ops.js) читает его в финальной сводке; savedFlags
 * захватывается здесь до любых сценариев и восстанавливается хостом в эпилоге.
 */
import { Api } from 'telegram';
import { UserbotService } from '../../services/userbot.service.js';

export const counters = { failures: 0 };
export function assert(condition, label) {
    if (condition) {
        console.log(`  ✓ ${label}`);
    } else {
        console.error(`  ✗ ${label}`);
        counters.failures++;
    }
}
export async function capture(promise) {
    try {
        await promise;
        return null;
    } catch (e) {
        return e;
    }
}

export const OWNER_ID = '9fd78a21-33b6-4d68-b0f7-a8ddf2e0bce3';
export const USERBOT_ID = '11111111-1111-4111-8111-111111111111';
export const REQ = { user: { id: OWNER_ID } };

// --- Флаги-kill-switch: сохраняем и восстанавливаем окружение ---
const FLAG_KEYS = ['USERBOT_GROUP_ADMIN_ENABLED', 'USERBOT_BOTFATHER_ENABLED'];
export const savedFlags = Object.fromEntries(FLAG_KEYS.map((k) => [k, process.env[k]]));
export function setFlags({ group = false, botfather = false }) {
    for (const [key, enabled] of [['USERBOT_GROUP_ADMIN_ENABLED', group], ['USERBOT_BOTFATHER_ENABLED', botfather]]) {
        if (enabled) {
            process.env[key] = 'true';
        } else {
            delete process.env[key];
        }
    }
}

export function makeUserbot(patch = {}) {
    return {
        id: USERBOT_ID,
        owner_id: OWNER_ID,
        account_type: 'userbot',
        runtime_status: 'active',
        ...patch
    };
}

/**
 * Мок GramJS-клиента: invoke маршрутизируется по className TL-запроса,
 * переопределяемые хуки передаются в overrides.
 */
export function makeMockClient(overrides = {}) {
    const invokes = [];
    const invokeHandlers = overrides.invoke || {};
    const client = {
        invokes,
        async invoke(request) {
            invokes.push(request);
            // request.className у namespaced-запросов полный: «channels.CreateChannel» —
            // хуки в тестах ключуем по короткому имени после точки.
            const shortName = String(request?.className || '').split('.').pop();
            const handler = invokeHandlers[shortName];
            if (handler) return handler(request);
            return {};
        },
        async getInputEntity(target) {
            if (overrides.getInputEntity) return overrides.getInputEntity(target);
            return new Api.InputPeerChannel({ channelId: BigInt(500), accessHash: BigInt(900) });
        },
        async getEntity(target) {
            if (overrides.getEntity) return overrides.getEntity(target);
            return { id: 777, accessHash: 888, username: String(target).replace(/^@/, '') };
        },
        async getDialogs() {
            return overrides.getDialogs ? overrides.getDialogs() : [];
        },
        async getParticipants() {
            return overrides.getParticipants ? overrides.getParticipants() : [];
        },
        async getMessages() {
            return overrides.getMessages ? overrides.getMessages() : [];
        },
        async sendMessage() {
            return overrides.sendMessage ? overrides.sendMessage() : { id: 1 };
        },
        deleteCalls: [],
        async deleteMessages(entity, ids, opts) {
            client.deleteCalls.push({ entity, ids, opts });
            if (overrides.deleteMessages) return overrides.deleteMessages(entity, ids, opts);
            return {};
        },
        async disconnect() {}
    };
    return client;
}


export function invokeOfClass(client, shortName) {
    return client.invokes.find((r) => String(r?.className || '').split('.').pop() === shortName);
}
export function countInvokesOfClass(client, shortName) {
    return client.invokes.filter((r) => String(r?.className || '').split('.').pop() === shortName).length;
}
export function firstDeleteCall(client) {
    return (client.deleteCalls || [])[0] || null;
}

export function makeService(mockClient) {
    const service = new UserbotService({ from: () => { throw new Error('supabase не нужен в этих тестах'); } });
    service.createAuthorizedClient = async () => mockClient;
    return service;
}

// --- Минимальный supabase-мок для bot_init: profiles (maybeSingle) + autopost_bots (thenable) ---
export function makeDb({ profiles = [], bots = [] } = {}) {
    const db = { profiles: [...profiles], autopost_bots: [...bots] };
    function chain(table) {
        const state = { filters: {} };
        const b = {
            select() { return b; },
            eq(k, v) { state.filters[k] = v; return b; },
            maybeSingle() { return Promise.resolve(runSingle()); },
            then(resolve, reject) { return Promise.resolve(runMany()).then(resolve, reject); }
        };
        function runMany() {
            const rows = (db[table] || []).filter((row) =>
                Object.entries(state.filters).every(([k, v]) => String(row[k]) === String(v)));
            return { data: rows, error: null };
        }
        function runSingle() {
            const { data } = runMany();
            return { data: data[0] ?? null, error: null };
        }
        return b;
    }
    return { from: chain, db };
}
