// Стадия 2 разрезки монстра userbot.service.js (план §7.3b): методы перенесены из
// класса ДОСЛОВНО (тела/JSDoc/комментарии без изменений); this.* зовётся через
// цепочку прототипов mixin-композиции в services/userbot.service.js.
import { Api } from 'teleproto';
import { detectSpamBlockReason, buildHealthDetails } from './telegram-errors.js';
import { assertUserbotOperatable } from './botfather-lib.js';

export const HealthMixin = (Base) => class extends Base {
    async inspectSpamBlockStatus(client, options = {}) {
        const cacheKey = String(options.userbotId || 'anonymous');
        const now = Date.now();
        const cached = this.spamBlockCache.get(cacheKey);
        if (cached && !options.force && (now - cached.checkedAt) < 15 * 60 * 1000) {
            return cached.result;
        }

        let result = {
            blocked: false,
            reason: '',
            source: 'cache_miss'
        };

        try {
            const spamBot = await client.getInputEntity('SpamBot');
            let messages = await client.getMessages(spamBot, { limit: 5 });
            let reasonText = detectSpamBlockReason(messages);

            if (!reasonText && options.activeProbe === true) {
                await client.sendMessage(spamBot, { message: '/start' });
                messages = await client.getMessages(spamBot, { limit: 5 });
                reasonText = detectSpamBlockReason(messages);
            }

            if (reasonText) {
                const normalized = reasonText.toLowerCase();
                result = {
                    blocked: normalized.includes('your account was blocked')
                        || normalized.includes('violations of the telegram terms of service')
                        || normalized.includes('confirmed by our moderators')
                        || normalized.includes('spam'),
                    reason: reasonText,
                    source: 'spambot'
                };
            } else {
                result = {
                    blocked: false,
                    reason: '',
                    source: 'spambot'
                };
            }
        } catch (error) {
            result = {
                blocked: false,
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

        const spamBlock = await this.inspectSpamBlockStatus(client, {
            userbotId: options.userbotId || null,
            force: options.forceSpamCheck === true,
            activeProbe: options.activeSpamProbe === true
        });
        if (spamBlock.blocked) {
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

        return {
            status: 'online',
            reason: 'Аккаунт живой, сессия отвечает.',
            details: buildHealthDetails({
                session: 'alive',
                restriction: 'clear',
                spambotState: spamBlock.source === 'spambot_error' ? 'error' : 'clear',
                spambotReason: spamBlock.reason || '',
                spambotSource: spamBlock.source || 'spambot'
            })
        };
    }

    /**
     * Snapshot of account health for external consumers.
     * Reads from DB runtime_status + cached SpamBot signal — does NOT connect to Telegram.
     */
    async getHealthSnapshot(userbot) {
        assertUserbotOperatable(userbot);
        const spamCached = this.spamBlockCache.get(String(userbot.id)) || null;
        const recentEvent = await this._lastTelegramEventFor(userbot.id);
        return {
            userbot_id: userbot.id,
            tg_username: userbot.tg_username || null,
            runtime_status: userbot.runtime_status || 'unknown',
            proxy_id: userbot.proxy_id || null,
            spambot_signal: spamCached?.result || null,
            spambot_checked_at: spamCached?.checkedAt ? new Date(spamCached.checkedAt).toISOString() : null,
            last_telegram_event: recentEvent
        };
    }
};
