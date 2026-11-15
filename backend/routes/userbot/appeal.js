// Полуавтоматическая апелляция лимита SpamBot'а (план
// docs/plans/2026-11-15-spambot-verdicts-appeals.md, решение владельца
// 2026-11-15). Зона: POST /appeal/:id.
//
// Сценарий: платформа прокликивает @SpamBot — «Подать жалобу» → «Это ошибка» —
// и останавливается, как только Telegram требует человека (подтверждение,
// captcha, нестандартный экран). Финал человек завершает в Telegram Web этой
// сессии (deep-link #?tgaddr=https://t.me/SpamBot на фронте).
//
// Правила безопасности: одноразовый запуск по явному клику владельца, ровно
// один /start, без ретраев, FLOOD_WAIT уважается (wrapTelegramError), метки
// кнопок ищутся толерантными regex EN+RU — при смене меток честный
// needs_human, ничего не кликается вслепую.
import { authenticateUser } from '../../middlewares/auth.middleware.js';
import { decrypt } from '../../utils/crypto.js';
import { TelegramClient } from 'teleproto';
import { StringSession } from 'teleproto/sessions/index.js';
import { logTelegramErrorEvent } from '../../utils/telegram-error-events.js';
import { isSpambotProbeEnabled } from '../../services/userbot/health.mixin.js';
import { withTimeout } from './helpers-core.js';

const APPEAL_CONNECT_TIMEOUT_MS = Number(process.env.USERBOT_HEALTH_CONNECT_TIMEOUT_MS || 25000);
const APPEAL_STEP_TIMEOUT_MS = Number(process.env.USERBOT_SPAMBOT_PROBE_TIMEOUT_MS || 12000);

// Метки кнопок апелляции: EN + RU, регистр не важен. Telegram иногда меняет
// формулировки — не найдя кнопку, возвращаем needs_human, а не гадаем.
const COMPLAINT_BUTTON_RE = /жалоб|complaint|appeal|подать/i;
const MISTAKE_BUTTON_RE = /ошибк|error|mistake|wrong|не спам/i;
// Финальные ответы: «жалоба передана модераторам» vs «нужен человек».
const SUBMITTED_REPLY_RE = /(жалоб[аы].*(перед|отправ|принят)|complaint.*(forward|submit|review)|appeal.*submit)/i;
const HUMAN_STEP_REPLY_RE = /(подтверд|confirm|captcha|проверк|verify|официальн|official)/i;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Ждём новое входящее сообщение (id > afterId) с текстом; message объекты
// teleproto несут контент от Telegram — наружу отдаём только строку.
async function waitIncomingReply(client, spamBot, afterId, timeoutMs = APPEAL_STEP_TIMEOUT_MS) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        await sleep(2000);
        const messages = await client.getMessages(spamBot, { limit: 5 });
        const reply = (messages || []).find((message) =>
            !message?.out && Number(message?.id || 0) > afterId && String(message?.message || '').trim());
        if (reply) return reply;
    }
    return null;
}

async function findButtonByText(message, regex) {
    const buttons = await message.getButtons();
    const flat = (buttons || []).flat().filter(Boolean);
    return flat.find((button) => regex.test(String(button?.text || ''))) || null;
}

// Кликает цепочку «Подать жалобу» → «Это ошибка», на каждом шаге читая ответ
// бота. Возвращает { result, last_reply, instruction }.
async function runAppealFlow(client, spamBot) {
    const history = await client.getMessages(spamBot, { limit: 1 });
    let lastIncomingId = Number(history.find((message) => !message?.out)?.id || 0);

    await client.sendMessage(spamBot, { message: '/start' });
    let reply = await waitIncomingReply(client, spamBot, lastIncomingId);
    if (!reply) {
        return {
            result: 'needs_human',
            last_reply: '',
            instruction: 'SpamBot не ответил на /start. Открой чат @SpamBot в Telegram Web и подай апелляцию вручную.'
        };
    }
    lastIncomingId = Number(reply.id);

    // Шаг 1: «Подать жалобу».
    const complaintButton = await findButtonByText(reply, COMPLAINT_BUTTON_RE);
    if (!complaintButton) {
        return {
            result: 'needs_human',
            last_reply: reply.message,
            instruction: 'Кнопка «Подать жалобу» не найдена (Telegram сменил экран). Доформи апелляцию вручную в Telegram Web.'
        };
    }
    await complaintButton.click({});
    reply = await waitIncomingReply(client, spamBot, lastIncomingId);
    if (!reply) {
        return {
            result: 'needs_human',
            last_reply: '',
            instruction: 'После «Подать жалобу» SpamBot не ответил. Заверши апелляцию вручную в Telegram Web.'
        };
    }
    lastIncomingId = Number(reply.id);

    // Шаг 2: «Это ошибка».
    const mistakeButton = await findButtonByText(reply, MISTAKE_BUTTON_RE);
    if (!mistakeButton) {
        return {
            result: 'needs_human',
            last_reply: reply.message,
            instruction: 'Не нашли кнопку «Это ошибка» — возможно, Telegram просит уточнение. Доформи апелляцию вручную в Telegram Web.'
        };
    }
    await mistakeButton.click({});
    reply = await waitIncomingReply(client, spamBot, lastIncomingId);
    const finalText = String(reply?.message || '').trim();

    if (reply && HUMAN_STEP_REPLY_RE.test(finalText)) {
        return {
            result: 'needs_human',
            last_reply: finalText,
            instruction: 'Telegram требует подтверждение от человека. Открой Telegram Web этой сессии и заверши шаг вручную.'
        };
    }
    if (reply && SUBMITTED_REPLY_RE.test(finalText)) {
        return {
            result: 'submitted',
            last_reply: finalText,
            instruction: 'Апелляция отправлена модераторам Telegram. Ответ обычно приходит в этот же чат @SpamBot.'
        };
    }
    // Ответ есть, но не похож на стандартный финал — безопасный исход:
    // пусть человек посмотрит и доформит.
    return {
        result: 'needs_human',
        last_reply: finalText,
        instruction: 'SpamBot ответил нестандартно. Проверь чат @SpamBot в Telegram Web и заверши апелляцию вручную.'
    };
}

export function registerAppeal(router, ctx) {
    const { supabase, userbotService } = ctx;
    router.post('/appeal/:id', authenticateUser, async (req, res) => {
        try {
            const { data: account } = await supabase
                .from('tg_accounts')
                .select('*, proxies(host, port, username, password, is_working, provision_source, inventory_group)')
                .eq('id', req.params.id)
                .eq('owner_id', req.user.id)
                .single();
            if (!account) return res.status(404).json({ error: 'Аккаунт не найден' });
            if (!isSpambotProbeEnabled()) {
                return res.status(409).json({ error: 'Автопроба SpamBot выключена флагом USERBOT_SPAMBOT_PROBE_ENABLED.' });
            }
            // Апелляция имеет смысл только для лимита. Заморозка read-only:
            // Telegram отклонит любой «пишущий» вызов — остаётся только гид.
            if (account.runtime_status !== 'limited') {
                return res.status(409).json({
                    error: account.runtime_status === 'frozen'
                        ? 'Аккаунт заморожен (read-only) — апелляция только вручную через Telegram Web этой сессии.'
                        : 'Активного лимита нет — апелляция не нужна. Сначала запусти «Проверить Telegram».'
                });
            }

            const checkedAt = new Date().toISOString();
            const decryptedData = decrypt(account.session_data);
            if (!decryptedData) {
                return res.status(409).json({ error: 'Сессия не читается — апелляция невозможна.' });
            }
            const { token, fingerprint } = userbotService.parseSessionData(decryptedData);
            const proxyData = account.proxies
                ? { proxy_host: account.proxies.host, proxy_port: account.proxies.port, proxy_username: account.proxies.username, proxy_password: account.proxies.password }
                : undefined;
            const clientConfig = userbotService._getClientConfig(userbotService._buildProxy(proxyData), 1, fingerprint, proxyData);
            const client = new TelegramClient(new StringSession(token), fingerprint.api_id, fingerprint.api_hash, clientConfig);
            userbotService.prepareServiceClient(client);
            userbotService._forceManagedIpv6Dc(client, proxyData);

            try {
                await withTimeout(
                    userbotService.connectWithProxyFallback(client, proxyData),
                    APPEAL_CONNECT_TIMEOUT_MS,
                    'Telegram не ответил на подключение. Проверь прокси и повтори апелляцию.'
                );
                const spamBot = await userbotService.resolveSpambotPeer(client);
                const outcome = await withTimeout(
                    runAppealFlow(client, spamBot),
                    APPEAL_STEP_TIMEOUT_MS * 4,
                    'Апелляция не уложилась в отведённое время.'
                );

                await logTelegramErrorEvent(supabase, {
                    owner_id: req.user.id,
                    userbot_id: account.id,
                    event_source: 'userbot_appeal',
                    event_type: 'spambot_appeal',
                    restriction_kind: 'spambot_limited',
                    severity: 'info',
                    is_restriction: false,
                    error_message: `Апелляция SpamBot: ${outcome.result}.`,
                    meta: {
                        account_type: account.account_type || 'userbot',
                        appeal_result: outcome.result,
                        last_reply: String(outcome.last_reply || '').slice(0, 500)
                    }
                });

                return res.json({
                    ...outcome,
                    telegram_web_url: `/userbot/telegram-web/${account.id}`
                });
            } finally {
                await client.disconnect();
            }
        } catch (error) {
            console.error('[USERBOT_APPEAL] error', {
                accountId: req.params.id,
                ownerId: req.user?.id || null,
                error_message: String(error?.message || error || '').slice(0, 300)
            });
            return res.status(500).json({ error: 'Апелляция не прошла. Открой чат @SpamBot в Telegram Web и подай её вручную.' });
        }
    });
}
