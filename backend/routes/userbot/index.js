// Агрегатор роут-модулей юзербота (стадия 2b разрезки userbot.routes.js).
// Фабрика создаёт сервисы и единый ctx замыканий; register-модули вешают роуты
// строго в исходном порядке регистрации прежнего главного файла.
// Фасад для server.js — ../userbot.routes.js (реэкспортирует default отсюда).
import express from 'express';
import { UserbotService } from '../../services/userbot.service.js';
import { ManagedProxyService } from '../../services/managed-proxy.service.js';
import { registerProxiesList } from './proxies-list.js';
import { registerProxiesCrud } from './proxies-crud.js';
import { registerProxiesCheck } from './proxies-check.js';
import { registerProxyPoolStats } from './proxy-pool-stats.js';
import { registerBindProxy } from './bind-proxy.js';
import { registerSessions } from './sessions.js';
import { registerIntake } from './intake.js';
import { registerQr } from './qr.js';
import { registerProfile } from './profile.js';
import { registerProfileUsername } from './profile-username.js';
import { registerLifecycle } from './lifecycle.js';
import { registerHealthCheck } from './health-check.js';
import { registerSyncAudit } from './sync-audit.js';
import { registerOpsCenter } from './ops-center.js';
import { registerOpsCenterFeed } from './ops-center-feed.js';
import { registerErrorsMembers } from './errors-members.js';
import { registerCrm } from './crm.js';
import { registerMessaging } from './messaging.js';

export default function (supabase) {
    const router = express.Router();

    // api_id/api_hash подставляет конструктор UserbotService из дефолтного отпечатка.
    const userbotService = new UserbotService(supabase);
    const managedProxyService = new ManagedProxyService();


    // Единый контекст замыканий фабрики для всех register-модулей стадии 2a.
    const ctx = { supabase, userbotService, managedProxyService };

    // ==========================================
    // 1. УПРАВЛЕНИЕ ПУЛОМ ПРОКСИ
    // ==========================================
    registerProxiesList(router, ctx);
    registerProxiesCrud(router, ctx);
    registerProxiesCheck(router, ctx);
    registerProxyPoolStats(router, ctx);
    registerBindProxy(router, ctx);
    registerSessions(router, ctx);
    registerIntake(router, ctx);

    // ==========================================
    // 3. ГЕНЕРАЦИЯ QR (Классический метод)
    // ==========================================
    // GET /fingerprint-profiles живёт внутри registerQr первым роутом —
    // порядок регистрации прежнего главного файла сохранён.
    registerQr(router, ctx);

    // ==========================================
    // 4. УДАЛЕНИЕ И ПРОВЕРКА АККАУНТОВ
    // ==========================================
    registerProfile(router, ctx);
    registerProfileUsername(router, ctx);

    // GET /recovery-status живёт внутри registerLifecycle первым роутом.
    // DELETE /:id, POST /restore/:id, POST /safe-mode/:id, PATCH /custom-label/:id.
    // Должно идти ПОСЛЕ registerProxiesCheck: DELETE /proxies/:id матчится раньше дженерика.
    registerLifecycle(router, ctx);

    registerHealthCheck(router, ctx);

    // 5. CRM И СИНХРОНИЗАЦИЯ КАНАЛОВ: POST /sync-channels, GET /admin-audit.
    registerSyncAudit(router, ctx);

    // Рабочий центр: GET /ops-center.
    registerOpsCenter(router, ctx);

    // Лента центра: thread/mark-read/join-invite + authorizations.
    registerOpsCenterFeed(router, ctx);

    // 6. GET /error-events, POST /fetch-members (сканер участников).
    registerErrorsMembers(router, ctx);

    // 7-8. CRM база клиентов: подписки, продления, batch-кик.
    registerCrm(router, ctx);

    // 9-11. POST /send-message, POST /crm/import, GET /crm/presence.
    registerMessaging(router, ctx);

    return router;
}
