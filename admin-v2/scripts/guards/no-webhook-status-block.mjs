// Guard: нейтральный webhook-статус-блок на /sales-bot запрещён владельцем
// (2026-09-15): «Webhook включён; апдейты уже приходили» оказался шумом,
// раньше страница работала без него. Статус webhook рендерится ТОЛЬКО на
// error-карточке (webhookConnectionError). Скрипт падает, если кто-то
// вернул нейтральные состояния или их тексты в OfficialBotsSection.
// Запускается автоматически после каждого build (postbuild).
import { readFile } from 'node:fs/promises';

const FILE = 'src/pages/bots/OfficialBotsSection.jsx';
const FORBIDDEN = [
  'Webhook включён',
  'апдейты уже приходили',
  'апдейтов ещё не было',
  'Бот получает сообщения',
  'Тестовый режим',
  'webhookStatusMeta'
];

const source = await readFile(FILE, 'utf8');
const hits = FORBIDDEN.filter((marker) => source.includes(marker));

if (hits.length > 0) {
  console.error(`[guard] ${FILE}: нейтральный webhook-статус-блок возвращён. Запрещённые маркеры: ${hits.join(', ')}`);
  console.error('[guard] Статус webhook на /sales-bot рендерится только на error-карточке (решение владельца 2026-09-15).');
  process.exit(1);
}

console.log('[guard] no-webhook-status-block: OK');
