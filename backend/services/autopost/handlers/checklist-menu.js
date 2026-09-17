/**
 * Бот-меню чек-листов: inline-действия (итог/закрытие) + диалог создания
 * «заголовок → пункты → канал(ы)» (кнопка «＋ Новый список»).
 *
 * Пикер каналов — свой минимальный с префиксом clch:<tg_chat_id>: общий
 * chpick:go (channel-select.js) шьёт текстовые/медийные autopost_items без
 * checklist_id — чек-лист через него публиковался бы как обычный текст.
 * Клавиатура визуально повторяет buildChannelPickerKeyboard 1:1.
 *
 * Диалог создания живёт в adminStates (ветки await_checklist_text /
 * await_checklist_channel, TTL 10 минут) — тот же компромисс, что у
 * await_text_post: рестарт сбрасывает, админ начинает заново. Сами списки
 * и тогглы — stateless, истина в БД.
 */
import { Markup } from 'telegraf';
import { log } from '../logger.js';
import { validateChecklistInput, renderChecklistSummary } from '../checklist.js';

const STATE_TTL_MS = 10 * 60 * 1000;

function adminName(from) {
    return [from?.first_name, from?.last_name].filter(Boolean).join(' ')
        || from?.username || String(from?.id || '');
}

function setAdminState(service, tgUserId, entry) {
    const prev = service.adminStates.get(tgUserId);
    if (prev?.timer) clearTimeout(prev.timer);
    const full = { ...entry, createdAt: Date.now() };
    full.timer = setTimeout(() => service.adminStates.delete(tgUserId), STATE_TTL_MS);
    service.adminStates.set(tgUserId, full);
}

function clearAdminState(service, tgUserId) {
    const prev = service.adminStates.get(tgUserId);
    if (prev?.timer) clearTimeout(prev.timer);
    service.adminStates.delete(tgUserId);
}

// HH:MM в UTC — как formatHHMM в checklist.js, чтобы сводка и построчный
// список показывали одно и то же время отметки.
function hhmm(iso) {
    const d = new Date(iso);
    if (!iso || Number.isNaN(d.getTime())) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

function buildChecklistChannelKeyboard(channels, selectedIds) {
    const rows = channels.map((ch) => {
        const mark = selectedIds.includes(String(ch.tg_chat_id)) ? '✅ ' : '⬜ ';
        return [Markup.button.callback(`${mark}${ch.title}`, `clch:${ch.tg_chat_id}`)];
    });
    rows.push(selectedIds.length === 0
        ? [Markup.button.callback('Выбери хотя бы один канал', 'clch:none')]
        : [Markup.button.callback(`☑️ Создать список (${selectedIds.length})`, 'clch:go')]);
    rows.push([Markup.button.callback('❌ Отмена', 'clch:stop')]);
    return Markup.inlineKeyboard(rows);
}

/**
 * Единая точка создания списка из меню: строка чек-листа (created_by='admin') →
 * items → событие created (actor_source='admin') → строки очереди → collapseQueue.
 * Зеркало queue-пути checklist-create.js (publish_now=false).
 */
async function createQueuedChecklist(ctx, { service, bot, botId, payload, channelIds }) {
    const supabase = service.supabase;
    const title = payload.title || '';

    const { data: checklist, error: insertErr } = await supabase
        .from('autopost_checklists')
        .insert({ owner_id: bot.owner_id, bot_id: botId, title, created_by: 'admin' })
        .select()
        .single();
    if (insertErr) throw insertErr;

    const { error: itemsErr } = await supabase.from('autopost_checklist_items').insert(
        payload.items.map((text, idx) => ({ checklist_id: checklist.id, bot_id: botId, text, position: idx }))
    );
    if (itemsErr) throw itemsErr;

    // created — лента памяти агента. Канонический актор — админ (создание из меню
    // бота = действие админа). Best-effort: список уже создан.
    try {
        await supabase.from('autopost_checklist_events').insert({
            checklist_id: checklist.id,
            action: 'created',
            actor_source: 'admin',
            actor_tg_id: ctx.from.id,
            actor_name: adminName(ctx.from).slice(0, 100)
        });
    } catch (e) {
        log.warn('checklist', 'menu_created_event_failed', { botId, checklistId: checklist.id, err: e });
    }

    await service.addPostItem({
        botId,
        targetChannelIds: channelIds,
        fileIds: [],
        caption: title,
        status: 'queued',
        checklistId: checklist.id
    });

    for (const cid of channelIds) {
        await service.collapseQueue(botId, cid);
    }
    return checklist;
}

export function registerChecklistMenuHandler(bot, service, botId) {
    const supabase = service.supabase;

    // --- «＋ Новый список»: старт диалога ---
    bot.action('clnew', async (ctx) => {
        const tgUserId = ctx.from.id;
        const { isAdmin } = await service.getBotAdminContext(botId, tgUserId);
        if (!isAdmin) return ctx.answerCbQuery('Доступ запрещен');

        setAdminState(service, tgUserId, { action: 'await_checklist_text', attempts: 0 });
        await ctx.answerCbQuery();
        return ctx.reply('Пришли заголовок, а на следующих строках — пункты (по одному). /cancel — отмена');
    });

    // --- «Итог»: сводка + построчный список с атрибуцией ---
    bot.action(/clstate:(.+)/, async (ctx) => {
        const tgUserId = ctx.from.id;
        const { isAdmin } = await service.getBotAdminContext(botId, tgUserId);
        if (!isAdmin) return ctx.answerCbQuery('Доступ запрещен');

        let state;
        try {
            state = await service.getChecklistState(botId, ctx.match[1]);
        } catch (e) {
            return ctx.answerCbQuery('Список не найден');
        }

        const { checklist, items } = state;
        const lines = items.map((it) => {
            if (it.is_checked !== true) return `⬜ ${it.text}`;
            const meta = [it.checked_by_name, hhmm(it.checked_at)].filter(Boolean);
            return meta.length > 0 ? `✅ ${it.text} — ${meta.join(' ')}` : `✅ ${it.text}`;
        });
        await ctx.answerCbQuery();
        return ctx.reply(
            `☑️ ${checklist.title || 'Без названия'}\n${renderChecklistSummary(checklist, items)}` +
            (lines.length > 0 ? `\n\n${lines.join('\n')}` : '')
        );
    });

    // --- «Закрыть список»: подтверждение ---
    bot.action(/clcancel:(.+)/, async (ctx) => {
        const tgUserId = ctx.from.id;
        const { isAdmin } = await service.getBotAdminContext(botId, tgUserId);
        if (!isAdmin) return ctx.answerCbQuery('Доступ запрещен');

        const checklistId = ctx.match[1];
        const { data: checklist } = await supabase
            .from('autopost_checklists')
            .select('id, title, cancelled_at')
            .eq('id', checklistId)
            .eq('bot_id', botId)
            .maybeSingle();
        if (!checklist) return ctx.answerCbQuery('Список не найден');
        if (checklist.cancelled_at) return ctx.answerCbQuery('Список уже закрыт');

        await ctx.answerCbQuery();
        return ctx.editMessageText(
            `Закрыть список «${checklist.title || 'Без названия'}»? Очередь почистится, кнопки в каналах снимутся. Итог останется — «Итог» работает и после закрытия.`,
            Markup.inlineKeyboard([[
                Markup.button.callback('Да, закрыть', `clyes:${checklistId}`),
                Markup.button.callback('Отмена', `clno:${checklistId}`)
            ]])
        );
    });

    bot.action(/clyes:(.+)/, async (ctx) => {
        const tgUserId = ctx.from.id;
        const { isAdmin } = await service.getBotAdminContext(botId, tgUserId);
        if (!isAdmin) return ctx.answerCbQuery('Доступ запрещен');

        try {
            await service.cancelChecklist(botId, ctx.match[1], {
                source: 'admin',
                tgId: tgUserId,
                name: adminName(ctx.from).slice(0, 100)
            });
            await ctx.answerCbQuery('Закрыто');
            return ctx.editMessageText('Список закрыт.');
        } catch (e) {
            if (String(e?.message) === 'NOT_FOUND') return ctx.answerCbQuery('Список не найден');
            log.error('checklist', 'menu_cancel_failed', { botId, err: e });
            return ctx.answerCbQuery('Ошибка: ' + String(e?.message || e).slice(0, 100));
        }
    });

    bot.action(/clno:(.+)/, async (ctx) => {
        const tgUserId = ctx.from.id;
        const { isAdmin } = await service.getBotAdminContext(botId, tgUserId);
        if (!isAdmin) return ctx.answerCbQuery('Доступ запрещен');
        await ctx.answerCbQuery();
        return ctx.editMessageText('Отменено.');
    });

    // --- Пикер каналов (clch:) ---
    bot.action(/^clch:(-?\d+)$/, async (ctx) => {
        const tgUserId = ctx.from.id;
        const { isAdmin } = await service.getBotAdminContext(botId, tgUserId);
        if (!isAdmin) return ctx.answerCbQuery('Доступ запрещен');

        const state = service.adminStates.get(tgUserId);
        if (!state || state.action !== 'await_checklist_channel') {
            return ctx.answerCbQuery('Выбор устарел. Начни заново: «☑️ Чек-листы»');
        }

        const set = new Set(state.selectedChannelIds.map(String));
        if (set.has(String(ctx.match[1]))) set.delete(String(ctx.match[1]));
        else set.add(String(ctx.match[1]));
        state.selectedChannelIds = Array.from(set);
        service.adminStates.set(tgUserId, state);

        try {
            await ctx.editMessageReplyMarkup(
                buildChecklistChannelKeyboard(state.channels, state.selectedChannelIds).reply_markup
            );
        } catch (e) {
            // сообщение могли удалить — не критично
        }
        return ctx.answerCbQuery();
    });

    bot.action('clch:none', (ctx) => ctx.answerCbQuery('Сначала выбери канал'));

    bot.action('clch:stop', async (ctx) => {
        const tgUserId = ctx.from.id;
        const state = service.adminStates.get(tgUserId);
        if (state?.action === 'await_checklist_channel') clearAdminState(service, tgUserId);
        try { await ctx.deleteMessage(); } catch (e) {}
        await ctx.answerCbQuery('Отменено');
        return ctx.reply('Создание списка отменено.');
    });

    bot.action('clch:go', async (ctx) => {
        const tgUserId = ctx.from.id;
        const { bot: botRow, isAdmin } = await service.getBotAdminContext(botId, tgUserId);
        if (!isAdmin) return ctx.answerCbQuery('Доступ запрещен');

        const state = service.adminStates.get(tgUserId);
        if (!state || state.action !== 'await_checklist_channel' || state.selectedChannelIds.length === 0) {
            return ctx.answerCbQuery('Выбор устарел. Начни заново: «☑️ Чек-листы»');
        }

        const { payload, selectedChannelIds, channels } = state;
        const channelMap = new Map(channels.map((c) => [String(c.tg_chat_id), c]));
        // Defense-in-depth: в очередь идут только каналы, которые бот сам показал в пикере.
        const safeChannelIds = selectedChannelIds.filter((cid) => channelMap.has(String(cid)));
        try {
            await createQueuedChecklist(ctx, {
                service,
                bot: botRow,
                botId,
                payload,
                channelIds: safeChannelIds
            });
            clearAdminState(service, tgUserId);
            await ctx.answerCbQuery('Готово');
            try { await ctx.deleteMessage(); } catch (e) {}
            const titles = safeChannelIds.map((cid) => channelMap.get(String(cid))?.title || cid).join(', ');
            return ctx.reply(`☑️ Список в очереди: «${payload.title || 'Без названия'}» → ${titles}.`);
        } catch (err) {
            log.error('checklist', 'menu_create_failed', { botId, err });
            await ctx.answerCbQuery('Ошибка: ' + String(err?.message || err).slice(0, 100));
            return ctx.reply('❌ Не удалось создать список. Попробуй позже.');
        }
    });

    // --- Диалог создания: текст списка ---
    bot.on('text', async (ctx, next) => {
        const tgUserId = ctx.from.id;
        const state = service.adminStates.get(tgUserId);
        if (!state) return next();

        if (state.action === 'await_checklist_text') {
            const raw = ctx.message.text || '';
            const lines = raw.split('\n').map((l) => l.trim());
            const title = lines[0] || '';
            const items = lines.slice(1).filter((l) => l.length > 0);

            const verdict = validateChecklistInput({ title, items });
            if (!verdict.ok) {
                state.attempts = (state.attempts || 0) + 1;
                if (state.attempts >= 2) {
                    clearAdminState(service, tgUserId);
                    return ctx.reply(`❌ ${verdict.error} Создание списка отменено. Начни заново: «☑️ Чек-листы».`);
                }
                service.adminStates.set(tgUserId, state);
                return ctx.reply(`❌ ${verdict.error}\nПришли заголовок и пункты заново. /cancel — отмена`);
            }

            const { data: channels } = await supabase
                .from('channels')
                .select('tg_chat_id, title')
                .eq('autopost_bot_id', botId);
            if (!channels || channels.length === 0) {
                clearAdminState(service, tgUserId);
                return ctx.reply('Нет подключённых каналов. Добавь бота в канал как администратора и начни заново.');
            }

            const payload = { title: title.trim(), items };
            const channelsLite = channels.map((c) => ({ tg_chat_id: String(c.tg_chat_id), title: c.title }));

            // Один канал — пикер не нужен, сразу в очередь (как await_text_post).
            if (channelsLite.length === 1) {
                const { bot: botRow, isAdmin } = await service.getBotAdminContext(botId, tgUserId);
                if (!isAdmin) {
                    clearAdminState(service, tgUserId);
                    return ctx.reply('Доступ запрещен.');
                }
                try {
                    await createQueuedChecklist(ctx, {
                        service,
                        bot: botRow,
                        botId,
                        payload,
                        channelIds: [channelsLite[0].tg_chat_id]
                    });
                    clearAdminState(service, tgUserId);
                    return ctx.reply(`☑️ Список в очереди → ${channelsLite[0].title}.`);
                } catch (err) {
                    log.error('checklist', 'menu_create_failed', { botId, err });
                    clearAdminState(service, tgUserId);
                    return ctx.reply('❌ Не удалось создать список. Попробуй позже.');
                }
            }

            setAdminState(service, tgUserId, {
                action: 'await_checklist_channel',
                payload,
                channels: channelsLite,
                selectedChannelIds: []
            });
            return ctx.reply(
                'Куда опубликовать список? Тапни по каналам (можно несколько):',
                buildChecklistChannelKeyboard(channelsLite, [])
            );
        }

        // Админ на пикере — текст не нужен, подсказываем (зеркало await_channel_select).
        if (state.action === 'await_checklist_channel') {
            return ctx.reply('Ты выбираешь каналы. Нажми «☑️ Создать список» или «❌ Отмена» под сообщением выше.');
        }

        return next();
    });
}
