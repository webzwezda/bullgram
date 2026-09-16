/**
 * Юнит-тесты discussion-фичи автопостера: форвард опубликованных постов
 * в привязанную группу обсуждений + чистая валидация включения
 * discussion_forward_enabled.
 * Запуск: node test/test-autopost-discussion.js
 *
 * Без сети: telegramClient подменяется фейком, БД и Telegraf не трогаются.
 */
import { forwardToDiscussion, validateDiscussionEnable, DISCUSSION_ENABLE_ERRORS } from '../services/autopost/discussion.js';

let failures = 0;
function assert(condition, label) {
    if (condition) {
        console.log(`  ✓ ${label}`);
    } else {
        console.error(`  ✗ ${label}`);
        failures++;
    }
}
function assertEqual(actual, expected, label) {
    const a = typeof actual === 'string' ? actual : JSON.stringify(actual);
    const e = typeof expected === 'string' ? expected : JSON.stringify(expected);
    if (a === e) {
        console.log(`  ✓ ${label}`);
    } else {
        console.error(`  ✗ ${label}\n    expected: ${e}\n    actual:   ${a}`);
        failures++;
    }
}

console.log('--- discussion.forwardToDiscussion: предпочитает forwardMessages ---');
{
    const calls = [];
    const client = {
        async forwardMessages(chatId, fromChatId, messageIds) {
            calls.push({ chatId, fromChatId, messageIds });
            return messageIds.map((id) => ({ message_id: id + 1000 }));
        },
        async forwardMessage() {
            throw new Error('forwardMessage не должен вызываться, когда есть forwardMessages');
        }
    };
    const result = await forwardToDiscussion(client, -100111, -100222, [101, 102, 103]);
    assert(calls.length === 1, 'forwardMessages вызван ровно один раз');
    assert(calls[0].chatId === -100222 && calls[0].fromChatId === -100111, 'назначение = linked-группа, источник = канал');
    assertEqual(calls[0].messageIds, [101, 102, 103], 'полный массив id одним вызовом (альбом остаётся сгруппированным)');
    assertEqual(result, [1101, 1102, 1103], 'id обсуждения возвращены в том же порядке');
}

console.log('--- discussion.forwardToDiscussion: фолбэк на forwardMessage ---');
{
    const calls = [];
    const client = {
        // Нет forwardMessages (старый клиент) — только по одному forwardMessage.
        async forwardMessage(chatId, fromChatId, messageId) {
            calls.push({ chatId, fromChatId, messageId });
            return { message_id: messageId + 5000 };
        }
    };
    const result = await forwardToDiscussion(client, -100111, -100222, [7, 8]);
    assertEqual(calls.map((c) => c.messageId), [7, 8], 'forwardMessage по одному id, в порядке');
    assert(calls.every((c) => c.chatId === -100222 && c.fromChatId === -100111), 'назначение/источник верные и в фолбэке');
    assertEqual(result, [5007, 5008], 'фолбэк-ids возвращены');
}

console.log('--- discussion.forwardToDiscussion: guards ---');
{
    const noCall = {
        async forwardMessage() { throw new Error('не должен вызываться'); },
        async forwardMessages() { throw new Error('не должен вызываться'); }
    };
    assertEqual(await forwardToDiscussion(noCall, -100111, -100222, []), [], 'пустой messageIds → [] (Telegram не вызывается)');
    assertEqual(await forwardToDiscussion(noCall, -100111, null, [1]), [], 'нет linkedChatId → []');
    assertEqual(await forwardToDiscussion(null, -100111, -100222, [1]), [], 'нет клиента → []');
    assertEqual(await forwardToDiscussion(noCall, -100111, -100222, 'не-массив'), [], 'не-массив messageIds → []');
}
{
    // Нормальный клиент: мусорные id отфильтрованы, валидные уходят в Telegram.
    const client = {
        async forwardMessages(chatId, fromChatId, messageIds) {
            return messageIds.map((id) => ({ message_id: id + 5000 }));
        }
    };
    assertEqual(await forwardToDiscussion(client, -100111, -100222, [0, -5, 3]), [5003], 'мусорные id (<=0) отфильтрованы');
}

console.log('--- discussion.forwardToDiscussion: частичный фолбэк ---');
{
    // Упало на втором из трёх: первый форвард уже в обсуждении — его id должен
    // приехать на ошибке (e.forwardedIds), чтобы publishItem сохранил его
    // в discussion_message_ids и message_delete смог убрать копию.
    const client = {
        async forwardMessage(chatId, fromChatId, messageId) {
            if (messageId === 8) throw new Error('TELEGRAM_TIMEOUT');
            return { message_id: messageId + 5000 };
        }
    };
    let caught = null;
    try {
        await forwardToDiscussion(client, -100111, -100222, [7, 8, 9]);
    } catch (e) {
        caught = e;
    }
    assert(caught !== null, 'ошибка пробрасывается вызывающему');
    assertEqual(caught?.forwardedIds, [5007], 'частично отправленные ids приложены к ошибке');
}

console.log('--- discussion.validateDiscussionEnable ---');
{
    const noLinked = validateDiscussionEnable({ chat: { id: -100111 }, memberStatus: 'administrator' });
    assert(noLinked.ok === false, 'нет linked_chat_id → не ok');
    assertEqual(noLinked.error, DISCUSSION_ENABLE_ERRORS.NO_LINKED_CHAT, 'нет linked_chat_id → текст про привязку группы');

    const nullChat = validateDiscussionEnable({ chat: null, memberStatus: 'administrator' });
    assert(nullChat.ok === false && nullChat.error === DISCUSSION_ENABLE_ERRORS.NO_LINKED_CHAT, 'null chat → NO_LINKED_CHAT');

    const admin = validateDiscussionEnable({ chat: { linked_chat_id: -100222 }, memberStatus: 'administrator' });
    assert(admin.ok === true && admin.error === null, 'бот админ в обсуждении → ok');
    assertEqual(admin.linkedChatId, -100222, 'linkedChatId сохранён в вердикте');

    assert(validateDiscussionEnable({ chat: { linked_chat_id: -100222 }, memberStatus: 'member' }).ok === true, 'обычный member — достаточно');

    const left = validateDiscussionEnable({ chat: { linked_chat_id: -100222 }, memberStatus: 'left' });
    assert(left.ok === false && left.error === DISCUSSION_ENABLE_ERRORS.BOT_NOT_MEMBER, 'left → BOT_NOT_MEMBER');

    const failedLookup = validateDiscussionEnable({ chat: { linked_chat_id: -100222 }, memberStatus: null });
    assert(failedLookup.ok === false && failedLookup.error === DISCUSSION_ENABLE_ERRORS.BOT_NOT_MEMBER, 'упавший getChatMember (null) → BOT_NOT_MEMBER');

    const kicked = validateDiscussionEnable({ chat: { linked_chat_id: -100222 }, memberStatus: 'kicked' });
    assert(kicked.ok === false && kicked.error === DISCUSSION_ENABLE_ERRORS.BOT_NOT_MEMBER, 'kicked → BOT_NOT_MEMBER');
}

if (failures > 0) {
    console.error(`\n❌ ${failures} test(s) failed`);
    process.exit(1);
}
console.log('\n✅ All discussion tests passed');
