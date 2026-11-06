/**
 * Сценарий: channel_update — валидация пустых аргументов, неизвестная таймзона,
 * битые слоты, чужой канал → NOT_FOUND, happy path + collapseQueue,
 * timezone-only без пересборки очереди. Секция 19 исходного
 * test-autopost-checklist-ops.js. Экспортирует run() — хост вызывает
 * сценарии строго по порядку.
 */
import { ERROR_CODES } from '../../shared/errors.js';
import { updateChannelHandler } from '../../mcp/tools/autopost/channel-update.js';
import { capture, assert, makeDb, REQ, BOT_ID, CHANNEL_TG_ID } from './shared.js';

export async function run() {

console.log('--- channel_update: валидация, NOT_FOUND, happy path + collapseQueue ---');
{
    // Ни одного поля → INVALID_PARAMS.
    {
        const mock = makeDb();
        const err = await capture(updateChannelHandler({
            supabase: mock,
            req: REQ,
            args: { bot_id: BOT_ID, channel_id: CHANNEL_TG_ID }
        }));
        assert(err?.code === ERROR_CODES.INVALID_PARAMS, 'neither field → INVALID_PARAMS');
    }
    // Неизвестная таймзона → INVALID_PARAMS.
    {
        const mock = makeDb();
        const err = await capture(updateChannelHandler({
            supabase: mock,
            req: REQ,
            args: { bot_id: BOT_ID, channel_id: CHANNEL_TG_ID, timezone: 'Mars/Olympus' }
        }));
        assert(err?.code === ERROR_CODES.INVALID_PARAMS && /таймзона/.test(err?.message), 'unknown timezone → INVALID_PARAMS');
    }
    // Битые слоты: не HH:MM, вне диапазона, не массив.
    {
        const mock = makeDb();
        for (const badTimes of [['25:00'], ['10:60'], ['9:00'], '10:00', ['10:00', '10:00', '10:00', '10:00', '10:00', '10:00', '10:00', '10:00', '10:00', '10:00', '10:00']]) {
            const err = await capture(updateChannelHandler({
                supabase: mock,
                req: REQ,
                args: { bot_id: BOT_ID, channel_id: CHANNEL_TG_ID, posting_times: badTimes }
            }));
            assert(err?.code === ERROR_CODES.INVALID_PARAMS, `bad posting_times (${JSON.stringify(badTimes).slice(0, 20)}) → INVALID_PARAMS`);
        }
        assert(mock.db.channels[0].posting_times === undefined, 'no partial write on bad times');
    }
    // Чужой/не привязанный канал → NOT_FOUND.
    {
        const mock = makeDb({ channels: [] });
        const err = await capture(updateChannelHandler({
            supabase: mock,
            req: REQ,
            args: { bot_id: BOT_ID, channel_id: '-100999', timezone: 'Europe/Moscow' }
        }));
        assert(err?.code === ERROR_CODES.NOT_FOUND && err?.message === 'Канал не найден или не привязан к этому боту.', 'foreign channel → NOT_FOUND');
    }
    // Happy path: таймзона + слоты сохраняются, очередь пересобирается.
    {
        const mock = makeDb();
        const res = await updateChannelHandler({
            supabase: mock,
            req: REQ,
            args: { bot_id: BOT_ID, channel_id: CHANNEL_TG_ID, timezone: 'Asia/Vladivostok', posting_times: ['10:00'] }
        });
        assert(mock.db.channels[0].timezone === 'Asia/Vladivostok', 'timezone persisted');
        assert(JSON.stringify(mock.db.channels[0].posting_times) === '["10:00"]', 'posting_times persisted');
        assert(res.channel.tg_chat_id === CHANNEL_TG_ID && res.channel.timezone === 'Asia/Vladivostok', 'response carries channel card');
        assert(JSON.stringify(res.channel.posting_times) === '["10:00"]', 'response carries slots');
        assert(mock.calls.rpc.includes('autopost_collapse_queue'), 'collapseQueue ran after slot change');
    }
    // Timezone-only: запись есть, очередь НЕ пересобирается.
    {
        const mock = makeDb();
        const res = await updateChannelHandler({
            supabase: mock,
            req: REQ,
            args: { bot_id: BOT_ID, channel_id: CHANNEL_TG_ID, timezone: 'Asia/Vladivostok' }
        });
        assert(mock.db.channels[0].timezone === 'Asia/Vladivostok', 'timezone-only persisted');
        assert(!mock.calls.rpc.includes('autopost_collapse_queue'), 'timezone-only skips collapseQueue');
        assert(res.channel.timezone === 'Asia/Vladivostok' && res.channel.posting_times === null, 'timezone-only response card');
    }
}

}
