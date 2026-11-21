/**
 * fetchMessages time-window semantics (fix 2026-11-21).
 *
 * The pre-fix build ignored `until` (no-op {maxId:0} + an epoch-units bug that
 * made the post-filter match everything) and mapped `since` to Telegram's
 * offsetDate — which is an UPPER bound, so "since" queries returned messages
 * OLDER than since. This suite pins the corrected semantics:
 *   - until = upper bound AND pagination start point (offsetDate = until+1s)
 *   - since = lower bound; paging stops below it (has_more=false)
 *   - bounds ride inside the cursor; legacy {offset_id} cursors still work
 *
 * Запуск: node test/userbot-fetch-messages-window.test.js
 * (gate-01 гоняет все test/*.test.js)
 */
import { DialogsMixin } from '../services/userbot/dialogs.mixin.js';

const BASE = class {
    constructor() { this.supabase = {}; }
};

function makeService(scriptedPages) {
    const calls = [];
    const fakeClient = {
        async getMessages(_peer, params) {
            calls.push(params);
            const page = scriptedPages[calls.length - 1];
            return page ? [...page] : [];
        },
        async disconnect() {}
    };
    const svc = new (DialogsMixin(BASE))();
    svc.createAuthorizedClient = async () => fakeClient;
    svc.resolveChatPeerForRead = async () => ({});
    return { svc, calls };
}

const USERBOT = { id: 'ub-1', session_data: 'x' };
const CHAT = '-100123';

function msg(id, dateSec, extra = {}) {
    return { id, date: dateSec, message: `m${id}`, media: null, ...extra };
}

let failures = 0;
function assertEqual(actual, expected, label) {
    if (JSON.stringify(actual) === JSON.stringify(expected)) {
        console.log(`  ✓ ${label}`);
    } else {
        failures++;
        console.error(`  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`);
    }
}

// Reference epoch: 2026-07-27T10:00:00Z = 1785146400
const T0 = 1785146400;

async function main() {
    console.log('--- no bounds: newest-first single page, has_more via lookahead ---');
    {
        const { svc, calls } = makeService([
            [msg(30, T0 + 30), msg(29, T0 + 20), msg(28, T0 + 10)]
        ]);
        const res = await svc.fetchMessages(USERBOT, { chatId: CHAT, limit: 2 });
        assertEqual(calls[0].limit, 3, 'limit+1 lookahead');
        assertEqual(calls[0].offsetId, undefined, 'no cursor → start from newest');
        assertEqual(calls[0].offsetDate, undefined, 'no until → no offsetDate');
        assertEqual(res.messages.map((m) => m.id), ['30', '29'], 'newest-first page');
        assertEqual(res.has_more, true, 'lookahead item → has_more');
        const decoded = JSON.parse(Buffer.from(res.cursor, 'base64url').toString('utf8'));
        assertEqual(decoded.offset_id, 29, 'cursor carries last returned id');
        assertEqual(decoded.since, undefined, 'no since in cursor');
        assertEqual(decoded.until, undefined, 'no until in cursor');
    }

    console.log('--- until only: starts at until+1s, filters newer-than-until ---');
    {
        // Telegram returns items older than maxDate — including one dated AFTER
        // our until (boundary slack) which the final safety filter must drop.
        const { svc, calls } = makeService([
            [msg(40, T0 + 100), msg(39, T0 + 5), msg(38, T0 + 3)]
        ]);
        const res = await svc.fetchMessages(USERBOT, {
            chatId: CHAT,
            limit: 10,
            until: '2026-07-27T10:00:05Z' // T0+5
        });
        assertEqual(calls[0].offsetDate, T0 + 6, 'offsetDate = until_sec + 1 (inclusive bound)');
        assertEqual(res.messages.map((m) => m.id), ['39', '38'], 'message dated after until dropped');
        assertEqual(res.has_more, false, 'short page → feed exhausted');
        assertEqual(res.cursor, null, 'feed exhausted → no cursor');
    }

    console.log('--- since only: starts from newest, stops below since ---');
    {
        // Inside one page: item below since appears → stop there.
        const { svc, calls } = makeService([
            [msg(60, T0 + 30), msg(59, T0 + 20), msg(58, T0 + 5), msg(57, T0 - 5)]
        ]);
        const res = await svc.fetchMessages(USERBOT, {
            chatId: CHAT,
            limit: 3,
            since: '2026-07-27T10:00:10Z' // T0+10
        });
        assertEqual(calls[0].offsetDate, undefined, 'since alone is NOT the feed start (old bug)');
        assertEqual(res.messages.map((m) => m.id), ['60', '59'], 'stop at first message below since');
        assertEqual(res.has_more, false, 'window exhausted below since');
        assertEqual(res.cursor, null, 'no cursor when window exhausted');
    }
    {
        // Across pages: page 1 full (limit+1) → cursor; follow-up page stops below since.
        const { svc, calls } = makeService([
            [msg(51, T0 + 50), msg(50, T0 + 40), msg(49, T0 + 30), msg(48, T0 + 20)]
        ]);
        const res = await svc.fetchMessages(USERBOT, {
            chatId: CHAT,
            limit: 3,
            since: '2026-07-27T10:00:10Z'
        });
        assertEqual(calls[0].offsetDate, undefined, 'since alone is NOT the feed start (old bug)');
        assertEqual(res.messages.map((m) => m.id), ['51', '50', '49'], 'page 1 of window');
        assertEqual(res.has_more, true, 'full page → has_more');

        const { svc: svc2, calls: calls2 } = makeService([
            [msg(48, T0 + 20), msg(47, T0 + 15), msg(46, T0 + 5), msg(45, T0 - 10)]
        ]);
        const res2 = await svc2.fetchMessages(USERBOT, { chatId: CHAT, limit: 3, cursor: res.cursor });
        assertEqual(calls2[0].offsetId, 49, 'second page continues from cursor offset');
        assertEqual(calls2[0].offsetDate, undefined, 'later pages drop offsetDate');
        assertEqual(res2.messages.map((m) => m.id), ['48', '47'], 'follow-up page keeps the window');
        assertEqual(res2.has_more, false, 'below since → exhausted');
        assertEqual(res2.cursor, null, 'window exhausted → no cursor');
    }

    console.log('--- since + until window with paging and cursor carry ---');
    {
        const { svc, calls } = makeService([
            [msg(60, T0 + 90), msg(59, T0 + 60), msg(58, T0 + 30), msg(57, T0 + 20)]
        ]);
        const res = await svc.fetchMessages(USERBOT, {
            chatId: CHAT,
            limit: 3,
            since: '2026-07-27T10:00:20Z', // T0+20
            until: '2026-07-27T10:01:30Z'  // T0+90
        });
        assertEqual(calls[0].offsetDate, T0 + 91, 'window starts at until+1s');
        assertEqual(res.messages.map((m) => m.id), ['60', '59', '58'], 'page 1 of window');
        assertEqual(res.has_more, true, 'full page → has_more');
        const windowCursor = JSON.parse(Buffer.from(res.cursor, 'base64url').toString('utf8'));
        assertEqual(windowCursor.offset_id, 58, 'cursor offset_id');
        assertEqual(windowCursor.until, '2026-07-27T10:01:30Z', 'until travels in cursor');
        assertEqual(windowCursor.since, '2026-07-27T10:00:20Z', 'since travels in cursor');

        const { svc: svc2, calls: calls2 } = makeService([
            [msg(57, T0 + 20), msg(56, T0 + 15), msg(54, T0 + 5)]
        ]);
        const res2 = await svc2.fetchMessages(USERBOT, { chatId: CHAT, limit: 3, cursor: res.cursor });
        assertEqual(calls2[0].offsetId, 58, 'cursor offset continues pagination');
        assertEqual(calls2[0].offsetDate, T0 + 91, 'until from cursor keeps the start point');
        assertEqual(res2.messages.map((m) => m.id), ['57'], '56 dropped: below carried since');
        assertEqual(res2.has_more, false, 'short page → exhausted');
        assertEqual(res2.cursor, null, 'exhausted → no cursor');
    }

    console.log('--- legacy cursor {offset_id} still decodes ---');
    {
        const legacy = Buffer.from(JSON.stringify({ offset_id: 42 }), 'utf8').toString('base64url');
        const { svc, calls } = makeService([[msg(41, T0), msg(40, T0 - 5)]]);
        const res = await svc.fetchMessages(USERBOT, { chatId: CHAT, limit: 5, cursor: legacy });
        assertEqual(calls[0].offsetId, 42, 'legacy cursor honored');
        assertEqual(res.messages.length, 2, 'messages returned');
        assertEqual(res.has_more, false, 'short page → exhausted');
    }

    console.log('--- text_limit threads into sanitizeMessage ---');
    {
        const long = 'A'.repeat(5000);
        const { svc } = makeService([[msg(70, T0, { message: long })]]);
        const def = await svc.fetchMessages(USERBOT, { chatId: CHAT, limit: 1 });
        assertEqual(def.messages[0].text_truncated, true, 'default 4096 truncates 5000');
        const { svc: svc2 } = makeService([[msg(71, T0, { message: long })]]);
        const raised = await svc2.fetchMessages(USERBOT, { chatId: CHAT, limit: 1, textLimit: 200000 });
        assertEqual(raised.messages[0].text_truncated, false, 'textLimit 200000 keeps full text');
    }

    if (failures > 0) {
        console.error(`\nFAIL: ${failures} check(s) failed`);
        process.exit(1);
    }
    console.log('\nPASS: fetchMessages window semantics');
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
