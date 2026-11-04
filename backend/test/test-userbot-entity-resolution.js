/**
 * Юнит-тесты entity-resolution для свежих юзербот-сессий
 * (план 2026-11-04-userbot-entity-resolution).
 *
 * Свежая GramJS-сессия имеет пустой кэш сущностей: fetch/search на голом id
 * падали «Could not find the input entity», DM-резолв сканировал только первые
 * 80 диалогов, а waitForBotFatherReply принимал приветствие-меню BotFather
 * за ответ шага. Фикс: findPeerByDialogPages (пагинация диалогов) +
 * resolveChatPeerForRead + isBotFatherGreeting-фильтр.
 *
 * Офлайн, детерминированные: стиль test-userbot-ops.js (fake client).
 *
 * Запуск: node test/test-userbot-entity-resolution.js
 */
import { isBotFatherGreeting, findPeerByDialogPages } from '../services/userbot.service.js';

let failures = 0;
let passes = 0;
function ok(label) { passes++; console.log(`  ✓ ${label}`); }
function fail(label, expected, actual) {
  failures++;
  console.error(`  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`);
}
function assertEqual(actual, expected, label) {
  if (actual === expected) ok(label);
  else fail(label, expected, actual);
}

// ---------- isBotFatherGreeting ----------

console.log('isBotFatherGreeting');

const GREETING_MENU = 'I can help you create and manage Telegram bots. If you\'re new to the Bot API, please see the manual.\n\nYou can control me by sending these commands:\n\n/newbot - create a new bot\n/mybots - edit your bots';

assertEqual(isBotFatherGreeting(GREETING_MENU), true, 'приветствие с сигнатурой → true');
assertEqual(isBotFatherGreeting('Что-то ещё.\n/newbot - create a new bot\n/mybots - edit your bots'), true, 'меню без сигнатуры (/newbot + /mybots) → true');
assertEqual(isBotFatherGreeting('Alright, a new bot. How are we going to call it? Please choose a name for your bot.'), false, 'промпт имени → false');
assertEqual(isBotFatherGreeting('Done! Congratulations on your new bot. You will find it at t.me/x.'), false, 'успешное создание → false');
assertEqual(isBotFatherGreeting('Sorry, this username is already taken. Please try something different.'), false, 'taken → false');
assertEqual(isBotFatherGreeting('API Answer: /newbot started'), false, 'упоминание одного /newbot без /mybots → false');
assertEqual(isBotFatherGreeting(''), false, 'пустая строка → false');

// ---------- findPeerByDialogPages ----------

console.log('findPeerByDialogPages');

function makeFakeClient(pages) {
  const calls = [];
  return {
    calls,
    async getDialogs(params) {
      calls.push(params);
      const page = pages[calls.length - 1];
      return page ? [...page] : [];
    }
  };
}

function makeDialog(entityId, lastMessageId) {
  return { entity: { id: entityId }, id: lastMessageId };
}

{
  // found on page 2: пагинация по offsetId работает
  const page1 = Array.from({ length: 100 }, (_, i) => makeDialog(1000 - i, 2000 - i));
  const page2 = [makeDialog(42, 50), makeDialog(43, 49)];
  const client = makeFakeClient([page1, page2]);
  const normalize = async (dialog) => ({ normalized: dialog.entity.id });
  const peer = await findPeerByDialogPages(client, '42', { normalize });
  assertEqual(peer?.normalized, 42, 'target на 2-й странице найден');
  assertEqual(client.calls.length, 2, 'ровно 2 страницы запрошено');
  assertEqual(client.calls[1].offsetId, page1[page1.length - 1].id, 'offsetId 2-го вызова = last message id 1-й страницы');
  assertEqual(client.calls[0].offsetId, undefined, '1-й вызов без offsetId');
}

{
  const client = makeFakeClient([[makeDialog(1, 10)]]);
  const peer = await findPeerByDialogPages(client, '999', { normalize: async (d) => d.entity });
  assertEqual(peer, null, 'не найдено на всех страницах → null');
  assertEqual(client.calls.length, 2, 'после последней страницы останов (пустая страница)');
}

{
  const client = makeFakeClient([[]]);
  const peer = await findPeerByDialogPages(client, '1', { normalize: async (d) => d.entity });
  assertEqual(peer, null, 'пустая 1-я страница → null, без 2-го вызова');
  assertEqual(client.calls.length, 1, 'один вызов getDialogs');
}

{
  // maxTotal: кап на просмотренные диалоги
  const bigPage = Array.from({ length: 100 }, (_, i) => makeDialog(5000 - i, 6000 - i));
  const client = makeFakeClient([bigPage, bigPage]);
  const peer = await findPeerByDialogPages(client, '42', { maxTotal: 5, normalize: async (d) => d.entity });
  assertEqual(peer, null, 'maxTotal останавливает скан до нахождения');
  assertEqual(client.calls.length, 1, 'maxTotal: одна страница достаточна');
}

{
  // normalize не передан → возвращается dialog.entity
  const client = makeFakeClient([[makeDialog(7, 9)]]);
  const peer = await findPeerByDialogPages(client, '7');
  assertEqual(peer?.id, 7, 'без normalize возвращается entity');
}

// ---------- итог ----------

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
