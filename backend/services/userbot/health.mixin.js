// Стадия 2 разрезки монстра userbot.service.js (план §7.3b): методы перенесены из
// класса ДОСЛОВНО (тела/JSDoc/комментарии без изменений); this.* зовётся через
// цепочку прототипов mixin-композиции в services/userbot.service.js.
// 2026-11-15: честные вердикты SpamBot — активная проба /start (только ручные
// проверки), состояния clear/limited/blocked вместо булева blocked, липкость
// persisted-limited (план docs/plans/2026-11-15-spambot-verdicts-appeals.md).
import { Api } from 'teleproto';
import { detectSpamBlockReason, classifySpambotReply, buildHealthDetails } from './telegram-errors.js';
import { assertUserbotOperatable } from './botfather-lib.js';

const SPAMBOT_PROBE_REPLY_TIMEOUT_MS = Number(process.env.USERBOT_SPAMBOT_PROBE_TIMEOUT_MS || 12000);
const SPAMBOT_PROBE_POLL_INTERVAL_MS = 2000;

// Kill-switch активной пробы: ручные проверки шлют /start только пока флаг не
// выключен. Расписаний с пробой нет и не планируется (решение владельца).
export function isSpambotProbeEnabled() {
    return String(process.env.USERBOT_SPAMBOT_PROBE_ENABLED ?? 'true').trim().toLowerCase() !== 'false';
}

export const HealthMixin = (Base) => class extends Base {
    // getInputEntity работает из кэша сессии; у аккаунта без диалога со
    // SpamBot'ом он падает. getEntity (contacts.resolveUsername) диалога не
    // требует — собираем InputPeerUser вручную (идиома dm.mixin cached_access_hash).
    async resolveSpambotPeer(client) {
        try {
            return await client.getInputEntity('SpamBot');
        } catch (error) {
            const entity = await client.getEntity('@SpamBot');
            if (entity?.id == null || entity?.accessHash == null) throw error;
            return new Api.InputPeerUser({
                userId: BigInt(String(entity.id)),
                accessHash: BigInt(String(entity.accessHash))
            });
        }
    }

    // Активная проба: ровно один /start, читаем только сообщения ПОСЛЕ него —
    // старый хвост диалога (апелляция месяц назад) больше не маскирует текущий
    // вердикт. Ответ SpamBot'а обычно приходит за секунды; опрашиваем до таймаута.
    async probeSpambotVerdict(client, spamBot) {
        const history = await client.getMessages(spamBot, { limit: 1 });
        const lastIncomingId = Number(history.find((message) => !message?.out)?.id || 0);

        await client.sendMessage(spamBot, { message: '/start' });

        const deadline = Date.now() + SPAMBOT_PROBE_REPLY_TIMEOUT_MS;
        while (Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, SPAMBOT_PROBE_POLL_INTERVAL_MS));
            const messages = await client.getMessages(spamBot, { limit: 5 });
            const reply = (messages || []).find((message) =>
                !message?.out && Number(message?.id || 0) > lastIncomingId && String(message?.message || '').trim());
            if (reply) {
                const verdict = classifySpambotReply(reply.message);
                return {
                    blocked: verdict.state === 'blocked',
                    state: verdict.state,
                    reason: verdict.reason,
                    source: 'spambot_probe'
                };
            }
        }

        return {
            blocked: false,
            state: 'unknown',
            reason: 'SpamBot не ответил на /start за отведённое время.',
            source: 'spambot_probe'
        };
    }

    async inspectSpamBlockStatus(client, options = {}) {
        const cacheKey = String(options.userbotId || 'anonymous');
        const now = Date.now();
        const cached = this.spamBlockCache.get(cacheKey);
        const cacheFresh = Boolean(cached) && (now - cached.checkedAt) < 15 * 60 * 1000;
        const wantProbe = options.activeProbe === true && isSpambotProbeEnabled();

        // Пассивный путь — кэш 15 минут как раньше. Активная проба бьёт кэш,
        // кроме случая, когда свежая проба уже была (двойной клик кнопки).
        if (cacheFresh && !options.force && !wantProbe) {
            return cached.result;
        }
        if (cacheFresh && wantProbe && cached.result?.source === 'spambot_probe') {
            return cached.result;
        }

        let result;
        try {
            const spamBot = await this.resolveSpambotPeer(client);

            if (wantProbe) {
                result = await this.probeSpambotVerdict(client, spamBot);
            } else {
                // Пассивно: читаем хвост диалога. Вердиктом считаем только
                // знакомые фразы Telegram (limited/blocked); чистый или старый
                // хвост — это НЕ «чист сейчас», честно помечаем not_checked.
                const messages = await client.getMessages(spamBot, { limit: 5 });
                const reasonText = detectSpamBlockReason(messages);
                if (reasonText) {
                    const verdict = classifySpambotReply(reasonText);
                    result = {
                        blocked: verdict.state === 'blocked',
                        state: verdict.state === 'clear' ? 'unknown' : verdict.state,
                        reason: verdict.reason,
                        source: 'spambot_read'
                    };
                } else {
                    result = {
                        blocked: false,
                        state: 'unknown',
                        reason: '',
                        source: 'spambot_read'
                    };
                }
            }
        } catch (error) {
            result = {
                blocked: false,
                state: 'unknown',
                reason: String(error?.message || error || '').trim(),
                source: 'spambot_error'
            };
        }

        this.spamBlockCache.set(cacheKey, {
            checkedAt: now,
            result
        });

        return result;
    }

    // Заморозка Telegram (account frozen, read-only) не видна в getMe: чтения
    // работают, а флагов заморозки в профиле нет. Пассивное чтение SpamBot тоже
    // может промахнуться (хвост диалога — апелляция, а не вердикт). Но любой
    // «пишущий» метод замороженный аккаунт отклоняет ровно с FROZEN_METHOD_INVALID —
    // этим и щупаем: readHistory по себе с max_id=0 не меняет ничего.
    async probeFrozenState(client) {
        try {
            await client.invoke(new Api.messages.ReadHistory({
                peer: new Api.InputPeerSelf(),
                maxId: 0
            }));
            return false;
        } catch (error) {
            const text = String(error?.errorMessage || error?.message || error || '');
            if (text.includes('FROZEN_METHOD_INVALID')) {
                return true;
            }
            // Прочие ошибки (сеть, лимиты) — не признак заморозки.
            return false;
        }
    }

    async inspectAccountHealth(client, options = {}) {
        const me = await client.getMe();
        if (!me) {
            return {
                status: 'expired',
                reason: 'Telegram не отдал профиль аккаунта.',
                details: buildHealthDetails({
                    session: 'dead',
                    restriction: 'unknown',
                    spambotState: 'not_checked'
                })
            };
        }

        if (me.deleted) {
            return { status: 'restricted', reason: 'Аккаунт удален или Telegram больше не считает его живым.' };
        }

        const frozen = await this.probeFrozenState(client);
        if (frozen) {
            return {
                status: 'frozen',
                reason: 'Аккаунт заморожен Telegram: read-only, действия запрещены. Апелляция — через @SpamBot.',
                details: buildHealthDetails({
                    session: 'alive',
                    restriction: 'restricted',
                    restrictionReason: 'Аккаунт заморожен Telegram (read-only).',
                    spambotState: 'not_checked'
                })
            };
        }

        const restrictionReason = Array.isArray(me.restrictionReason)
            ? me.restrictionReason.map(item => item?.text || item?.reason || '').filter(Boolean).join(' | ')
            : '';

        if (me.restricted || restrictionReason) {
            return {
                status: 'restricted',
                reason: restrictionReason || 'У аккаунта есть ограничения Telegram.',
                details: buildHealthDetails({
                    session: 'alive',
                    restriction: 'restricted',
                    restrictionReason: restrictionReason || 'У аккаунта есть ограничения Telegram.',
                    spambotState: 'not_checked'
                })
            };
        }

        if (me.scam || me.fake) {
            return {
                status: 'restricted',
                reason: 'Telegram пометил аккаунт как подозрительный.',
                details: buildHealthDetails({
                    session: 'alive',
                    restriction: 'restricted',
                    restrictionReason: 'Telegram пометил аккаунт как подозрительный.',
                    spambotState: 'not_checked'
                })
            };
        }

        const persistedSpambotState = String(options.persistedHealthSummary?.spambot_state || '');
        const activeProbe = options.activeSpamProbe === true;

        // Липкость limited (решение владельца 2026-11-15): пассивная проверка
        // не имеет права снять сохранённый limited — лимит виден только живой
        // пробой, и пассивный «хвост без фраз» не доказательство чистоты.
        if (!activeProbe && persistedSpambotState === 'limited') {
            const persistedReason = String(options.persistedHealthSummary?.spambot_reason || '')
                || 'Аккаунт лимитирован Telegram: писать может только тем, у кого его номер в контактах.';
            return {
                status: 'limited',
                reason: persistedReason,
                details: buildHealthDetails({
                    session: 'alive',
                    restriction: 'limited',
                    restrictionReason: persistedReason,
                    spambotState: 'limited',
                    spambotReason: persistedReason,
                    spambotSource: 'persisted'
                })
            };
        }

        const spamBlock = await this.inspectSpamBlockStatus(client, {
            userbotId: options.userbotId || null,
            force: options.forceSpamCheck === true,
            activeProbe
        });
        const spambotState = String(spamBlock.state || (spamBlock.blocked ? 'blocked' : 'unknown'));
        // Определённый вердикт даёт только активная проба (или знакомые фразы
        // Telegram в хвосте). «Спамбот не ответил / ошибка чтения» — не вердикт.
        const definitiveSpambot = ['clear', 'limited', 'blocked'].includes(spambotState);

        if (spambotState === 'blocked' || (!definitiveSpambot && spamBlock.blocked)) {
            return {
                status: 'restricted',
                reason: spamBlock.reason || 'SpamBot подтвердил, что аккаунт ограничен Telegram.',
                details: buildHealthDetails({
                    session: 'alive',
                    restriction: 'restricted',
                    restrictionReason: spamBlock.reason || 'SpamBot подтвердил, что аккаунт ограничен Telegram.',
                    spambotState: 'blocked',
                    spambotReason: spamBlock.reason || '',
                    spambotSource: spamBlock.source || 'spambot'
                })
            };
        }

        if (spambotState === 'limited') {
            const limitedReason = spamBlock.reason
                || 'Аккаунт лимитирован Telegram: писать может только тем, у кого его номер в контактах.';
            return {
                status: 'limited',
                reason: limitedReason,
                details: buildHealthDetails({
                    session: 'alive',
                    restriction: 'limited',
                    restrictionReason: limitedReason,
                    spambotState: 'limited',
                    spambotReason: spamBlock.reason || '',
                    spambotSource: spamBlock.source || 'spambot'
                })
            };
        }

        // Хвост без знакомых фраз / ошибка чтения — «не проверено», не «чисто».
        const honestSpambotState = definitiveSpambot
            ? spambotState
            : (spamBlock.source === 'spambot_error' ? 'error' : 'not_checked');
        return {
            status: 'online',
            reason: 'Аккаунт живой, сессия отвечает.',
            details: buildHealthDetails({
                session: 'alive',
                restriction: 'clear',
                spambotState: honestSpambotState,
                spambotReason: spamBlock.reason || '',
                spambotSource: spamBlock.source || 'spambot'
            })
        };
    }

    /**
     * Snapshot of account health for external consumers.
     * Reads from DB runtime_status + cached SpamBot signal — does NOT connect to Telegram.
     * 2026-11-15: кэш процесса не переживает рестарт — fallback к персистентному
     * health_summary, чтобы spambot_signal не был вечным null.
     */
    async getHealthSnapshot(userbot) {
        assertUserbotOperatable(userbot);
        const spamCached = this.spamBlockCache.get(String(userbot.id)) || null;
        const summary = userbot.health_summary || null;
        const persistedVerdict = ['clear', 'limited', 'blocked'].includes(String(summary?.spambot_state || ''));
        const spamSignal = spamCached?.result || (persistedVerdict
            ? {
                blocked: summary.spambot_state === 'blocked',
                state: summary.spambot_state,
                reason: String(summary.spambot_reason || ''),
                source: 'persisted'
            }
            : null);
        const spamCheckedAt = spamCached?.checkedAt
            ? new Date(spamCached.checkedAt).toISOString()
            : (persistedVerdict ? (summary.spambot_checked_at || null) : null);
        const recentEvent = await this._lastTelegramEventFor(userbot.id);
        return {
            userbot_id: userbot.id,
            tg_username: userbot.tg_username || null,
            runtime_status: userbot.runtime_status || 'unknown',
            proxy_id: userbot.proxy_id || null,
            spambot_signal: spamSignal,
            spambot_checked_at: spamCheckedAt,
            last_telegram_event: recentEvent
        };
    }
};
