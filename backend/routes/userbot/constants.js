// Общие константы контура юзерботов (стадия 2a разрезки userbot.routes.js).
// Одна копия для helpers-* и register-модулей роутов; главный файл значения
// больше не экспортирует — это разрывает старый цикл userbot.routes.js ⇄ helpers-*.
import path from 'path';

const MAX_MANAGED_PROXIES_PER_ADMIN = 256;
const MAX_MANAGED_PROXIES_GLOBAL = 512;
export const MAX_MANAGED_PROXY_BATCH = 100;
export const DEFAULT_ADMIN_PROXY_GROUP = 'shop_sale';
// 60 сек: операция лёгкая (getMe + фото) и ручная; окно только чтобы
// не долбить кнопку. Сценарий «поменял фотку в TG — сразу стянул» работает.
export const USERBOT_PROFILE_SYNC_COOLDOWN_MS = 60 * 1000;
export const USERBOT_PROFILE_UPLOADS_DIR = path.join(process.cwd(), 'uploads', 'userbot-profiles');

export { MAX_MANAGED_PROXIES_PER_ADMIN, MAX_MANAGED_PROXIES_GLOBAL };
