// Проба BotFather: может ли аккаунт писать сервисным ботам. Инцидент
// 2026-11-15: свежие фарм-аккаунты получают скрытый софт-лимит на сообщения
// ботам, который SpamBot не показывает — вручную это проверяется только
// тыканьем START в Telegram Web. Проба автоматизирует ровно это: /start
// BotFather'у + ожидание ответа, вердикт пишется в health_summary
// (botfather_state/botfather_reason/botfather_checked_at).
//
// Вердикты: ok (ответ получен) | refused (отказ BotFather) | send_error
// (RPC упал — кейс скрытого лимита) | no_reply (отправилось, бот молчит) |
// resolve_error / connect_error / dead_proxy | skipped (карантин).
import { TelegramClient } from 'teleproto';
import { StringSession } from 'teleproto/sessions/index.js';
import { decrypt } from '../utils/crypto.js';
import { logger } from '../utils/logger.js';
import { withTimeout } from '../shared/utils.js';
import { isBotFatherRefusal } from './userbot/botfather-lib.js';

const CONNECT_TIMEOUT_MS = 30_000;
const STEP_TIMEOUT_MS = 30_000;
const REPLY_TIMEOUT_MS = 25_000;
const POLL_INTERVAL_MS = 1500;
const BOTFATHER_ID = '93372553';

// Активные сканы по владельцам: защита от параллельного запуска.
const runningScans = new Set();

function proxyDataOf(proxy) {
    if (!proxy) return undefined;
    return {
        proxy_host: proxy.host,
        proxy_port: proxy.port,
        proxy_username: proxy.username,
        proxy_password: proxy.password,
        provision_source: proxy.provision_source,
        inventory_group: proxy.inventory_group,
        is_working: proxy.is_working,
        force_ipv6: proxy.is_working === true
    };
}

// Клиент как у checkStockAccount: та же сборка, те же инварианты (грабля 5-6
// прокси-библии — prepareServiceClient + форс IPv6 для managed-слотов).
// Возвращает { client, connect } — коннект только через connectWithProxyFallback
// (голый client.connect() не умеет IPv4→IPv6 ретрай).
async function defaultMakeClient(userbotService, account, proxy) {
    const proxyData = proxyDataOf(proxy);
    const { token, fingerprint } = userbotService.parseSessionData(decrypt(account.session_data));
    const clientConfig = userbotService._getClientConfig(userbotService._buildProxy(proxyData), 1, fingerprint, proxyData);
    const client = new TelegramClient(new StringSession(token), fingerprint.api_id, fingerprint.api_hash, clientConfig);
    userbotService.prepareServiceClient(client);
    userbotService._forceManagedIpv6Dc(client, proxyData);
    return { client, connect: () => userbotService.connectWithProxyFallback(client, proxyData) };
}

export async function probeBotFatherAbility(userbotService, { account, proxy }, deps = {}) {
    const makeClient = deps.makeClient || (() => defaultMakeClient(userbotService, account, proxy));
    const sleep = deps.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const replyTimeoutMs = Number.isFinite(deps.replyTimeoutMs) ? deps.replyTimeoutMs : REPLY_TIMEOUT_MS;

    if (proxy?.is_working === false) {
        return { state: 'dead_proxy', reason: 'Прокси аккаунта мёртв — сначала гигиена прокси.' };
    }

    const { client, connect } = await makeClient();
    try {
        await withTimeout(connect(), CONNECT_TIMEOUT_MS, 'connect');
        const peer = await withTimeout(client.getInputEntity('botfather'), STEP_TIMEOUT_MS, 'resolve');
        const baseline = await withTimeout(client.getMessages(peer, { limit: 1 }), STEP_TIMEOUT_MS, 'baseline');
        const afterId = Math.max(Number(baseline?.[0]?.id || 0), 0);

        let sent;
        try {
            sent = await withTimeout(client.sendMessage(peer, { message: '/start' }), STEP_TIMEOUT_MS, 'send');
        } catch (sendError) {
            // Кейс Elizabeth: сам RPC отправки падает — Telegram режет сообщения
            // ботам на уровне аккаунта. Сырую ошибку сохраняем в reason.
            return { state: 'send_error', reason: `Telegram отклонил отправку: ${sendError?.errorMessage || sendError?.message || 'неизвестная ошибка'}` };
        }
        const sentId = Math.max(Number(sent?.id || 0), afterId);

        const deadline = Date.now() + replyTimeoutMs;
        while (Date.now() < deadline) {
            await sleep(POLL_INTERVAL_MS);
            const messages = await withTimeout(client.getMessages(peer, { limit: 5 }), STEP_TIMEOUT_MS, 'poll')
                .catch(() => []);
            const reply = (messages || []).find((m) => m?.out === false && Number(m?.id || 0) > sentId);
            if (reply) {
                const refusal = isBotFatherRefusal(reply.message || '');
                if (refusal) return { state: 'refused', reason: `BotFather отказал: ${refusal}` };
                return { state: 'ok', reason: null };
            }
        }
        return { state: 'no_reply', reason: 'Отправка прошла, но BotFather не ответил за 25с — похоже на тихий лимит.' };
    } catch (error) {
        const stage = String(error?.message || '').includes('resolve') ? 'resolve_error' : 'connect_error';
        return { state: stage, reason: String(error?.errorMessage || error?.message || error).slice(0, 300) };
    } finally {
        await client.disconnect().catch(() => {});
    }
}

function mergeBotfatherSummary(existing, { state, reason }) {
    return {
        ...(existing && typeof existing === 'object' ? existing : {}),
        botfather_state: state,
        botfather_reason: reason || '',
        botfather_checked_at: new Date().toISOString()
    };
}

const SKIP_STATUSES = new Set(['restricted', 'frozen', 'expired']);

// Скан по стоку владельца: последовательно, со сном между аккаунтами,
// вердикт каждого сразу в health_summary (UI видит движение без спец-поллинга).
export async function runBotFatherProbeScan({
    supabase,
    userbotService,
    ownerId,
    accountIds = null,
    deps = {}
}) {
    const sleep = deps.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const sleepMs = Number.isFinite(deps.sleepMs) ? deps.sleepMs : 20_000;
    const probe = deps.probe || ((account, proxy) => probeBotFatherAbility(userbotService, { account, proxy }, deps));

    let query = supabase
        .from('tg_accounts')
        .select('id, owner_id, runtime_status, session_data, health_summary, proxies(id, name, host, port, username, password, is_working, provision_source, inventory_group)')
        .eq('owner_id', ownerId)
        .eq('account_type', 'userbot');
    if (Array.isArray(accountIds) && accountIds.length > 0) {
        query = query.in('id', accountIds.map(String));
    }
    const { data: accounts, error } = await query;
    if (error) throw error;

    const results = [];
    for (const account of accounts || []) {
        let verdict;
        if (SKIP_STATUSES.has(account.runtime_status)) {
            verdict = { state: 'skipped', reason: `Статус ${account.runtime_status}: карантин, проба не имеет смысла.` };
        } else {
            verdict = await probe(account, account.proxies);
        }
        await supabase
            .from('tg_accounts')
            .update({ health_summary: mergeBotfatherSummary(account.health_summary, verdict) })
            .eq('id', account.id)
            .eq('owner_id', ownerId);
        results.push({ account_id: account.id, label: account.proxies?.name || account.id, ...verdict });
        logger.info({ account_id: account.id, state: verdict.state }, '[botfather-probe] вердикт');
        await sleep(sleepMs);
    }
    return results;
}

// Запуск фоном с гардом; возвращает false, если скан уже идёт.
export function launchBotFatherProbeScan(params) {
    const key = String(params.ownerId);
    if (runningScans.has(key)) return false;
    runningScans.add(key);
    runBotFatherProbeScan(params)
        .catch((error) => logger.error({ err: error }, '[botfather-probe] скан упал'))
        .finally(() => runningScans.delete(key));
    return true;
}

export { BOTFATHER_ID };
