import { DEFAULT_FINGERPRINT } from './userbot/constants.js';
import { ProxyMixin } from './userbot/proxy.mixin.js';
import { SessionParseMixin } from './userbot/session-parse.mixin.js';
import { FingerprintMixin } from './userbot/fingerprint.mixin.js';
import { QrMixin } from './userbot/qr.mixin.js';
import { DmMixin } from './userbot/dm.mixin.js';
import { MembersMixin } from './userbot/members.mixin.js';
import { HealthMixin } from './userbot/health.mixin.js';
import { DialogsMixin } from './userbot/dialogs.mixin.js';
import { ResolversMixin } from './userbot/resolvers.mixin.js';
import { GroupsMixin } from './userbot/groups.mixin.js';
import { MessagesOpsMixin } from './userbot/messages-ops.mixin.js';
import { BotfatherMixin } from './userbot/botfather.mixin.js';

// Стадия 1 разрезки монстра (план §7.3b): не-методный код переехал в
// leaf-модули services/userbot/*; стадия 2 — методы класса разъехались по
// mixin-файлам services/userbot/*.mixin.js (каждый метод перенесён ДОСЛОВНО,
// this.* работает через плоскую цепочку прототипов ниже; перекрытий имён нет).
// Named-экспорты для 21 импортёра по старому пути (test-userbot-ops,
// test-userbot-entity-resolution и др.). isBotFatherGreeting фасадом внутри
// не используется — только ре-экспорт; остальные три и импортируются, и ре-экспортятся.
export { isBotFatherRefusal, isBotFatherGreeting, findPeerByDialogPages, parseBotFatherToken } from './userbot/botfather-lib.js';

/**
 * Сервис для работы с юзерботами (GramJS)
 * Содержит бизнес-логику для работы с Telegram через юзербота
 */
export class UserbotService extends BotfatherMixin(MessagesOpsMixin(GroupsMixin(ResolversMixin(DialogsMixin(HealthMixin(MembersMixin(DmMixin(QrMixin(FingerprintMixin(SessionParseMixin(ProxyMixin(class UserbotBase {})))))))))))) {
    constructor(supabase, apiId, apiHash) {
        super(); // mixin-композиция: базовый конструктор пуст
        this.supabase = supabase;
        this.apiId = Number(apiId || DEFAULT_FINGERPRINT.api_id);
        this.apiHash = apiHash || DEFAULT_FINGERPRINT.api_hash;
        this.qrSessions = new Map();
        this.spamBlockCache = new Map();
    }
}
