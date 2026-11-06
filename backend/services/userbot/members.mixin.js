// Стадия 2 разрезки монстра userbot.service.js (план §7.3b): методы перенесены из
// класса ДОСЛОВНО (тела/JSDoc/комментарии без изменений); this.* зовётся через
// цепочку прототипов mixin-композиции в services/userbot.service.js.
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { decrypt } from '../../utils/crypto.js';
import { withTimeout } from '../../shared/utils.js';
import { normalizeTelegramDate } from './helpers.js';

export const MembersMixin = (Base) => class extends Base {
    async createAuthorizedClient(userbot, retries = 1) {
        if (userbot?.proxy_id && userbot?.proxies?.is_working === false) {
            const failoverResult = await this.tryAutoFailoverUserbot(userbot);
            if (failoverResult.switched) {
                userbot = failoverResult.account;
            } else if (failoverResult.reason === 'cooldown') {
                throw new Error('Прокси сдох, но авто-переезд уже недавно срабатывал. Подожди немного или перепривяжи аккаунт вручную.');
            } else {
                throw new Error('У этого юзербота сдох прокси. Сначала перепривяжи его к живому.');
            }
        }

        const decryptedSession = decrypt(userbot.session_data);
        const { token, fingerprint } = this.parseSessionData(decryptedSession);
        const proxyConfig = this._buildProxy(userbot);
        const clientConfig = this._getClientConfig(proxyConfig, retries, fingerprint, userbot);

        const client = new TelegramClient(
            new StringSession(token),
            fingerprint.api_id,
            fingerprint.api_hash,
            clientConfig
        );

        this.prepareServiceClient(client);
        this._forceManagedIpv6Dc(client, userbot);
        await withTimeout(
            this.connectWithProxyFallback(client, userbot),
            90_000,
            'Подключение юзербота к Telegram'
        );
        return client;
    }

    async kickMemberFromChannel(userbot, chatId, tgUserId) {
        const client = await this.createAuthorizedClient(userbot, 1);

        try {
            const banRights = new Api.ChatBannedRights({
                untilDate: 0,
                viewMessages: true,
                sendMessages: true,
                sendMedia: true,
                sendStickers: true,
                sendGifs: true,
                sendGames: true,
                sendInline: true,
                sendPolls: true,
                changeInfo: true,
                inviteUsers: true,
                pinMessages: true
            });

            const unbanRights = new Api.ChatBannedRights({
                untilDate: 0,
                viewMessages: false,
                sendMessages: false,
                sendMedia: false,
                sendStickers: false,
                sendGifs: false,
                sendGames: false,
                sendInline: false,
                sendPolls: false,
                changeInfo: false,
                inviteUsers: false,
                pinMessages: false
            });

            await client.invoke(new Api.channels.EditBanned({
                channel: chatId,
                participant: tgUserId.toString(),
                bannedRights: banRights
            }));

            await client.invoke(new Api.channels.EditBanned({
                channel: chatId,
                participant: tgUserId.toString(),
                bannedRights: unbanRights
            }));

            return { success: true };
        } finally {
            await client.disconnect();
        }
    }

    async scanGroupActivity(userbot, tgChatId, limit = 200) {
        const client = await this.createAuthorizedClient(userbot, 1);
        try {
            const messages = await client.getMessages(tgChatId, { limit });
            const authorMap = new Map();

            for (const msg of messages) {
                if (!msg || !msg.senderId) continue;
                const id = String(msg.senderId);
                authorMap.set(id, (authorMap.get(id) || 0) + 1);
            }

            return authorMap;
        } finally {
            await client.disconnect();
        }
    }

    normalizeAuthorizationRecord(item) {
        return {
            hash: item?.hash ? String(item.hash) : '',
            current: !!item?.current,
            official_app: !!item?.officialApp,
            app_name: item?.appName || null,
            app_version: item?.appVersion || null,
            device_model: item?.deviceModel || null,
            platform: item?.platform || null,
            system_version: item?.systemVersion || null,
            api_id: item?.apiId || null,
            ip: item?.ip || null,
            country: item?.country || null,
            region: item?.region || null,
            date_created: normalizeTelegramDate(item?.dateCreated),
            date_active: normalizeTelegramDate(item?.dateActive)
        };
    }

    async getAccountAuthorizations(userbot) {
        const client = await this.createAuthorizedClient(userbot, 1);

        try {
            const result = await client.invoke(new Api.account.GetAuthorizations());
            const rows = (result?.authorizations || []).map(item => this.normalizeAuthorizationRecord(item));
            rows.sort((a, b) => Number(b.current) - Number(a.current) || String(b.date_active || '').localeCompare(String(a.date_active || '')));
            return rows;
        } finally {
            await client.disconnect();
        }
    }

    async resetOtherAuthorizations(userbot) {
        const client = await this.createAuthorizedClient(userbot, 1);

        try {
            await client.invoke(new Api.auth.ResetAuthorizations());
            const result = await client.invoke(new Api.account.GetAuthorizations());
            const rows = (result?.authorizations || []).map(item => this.normalizeAuthorizationRecord(item));
            rows.sort((a, b) => Number(b.current) - Number(a.current) || String(b.date_active || '').localeCompare(String(a.date_active || '')));
            return rows;
        } finally {
            await client.disconnect();
        }
    }

    async resetAuthorization(userbot, hash) {
        if (!hash && hash !== 0) {
            const error = new Error('Hash сессии не передан');
            error.statusCode = 400;
            throw error;
        }

        let hashLong;
        try {
            hashLong = BigInt(String(hash));
        } catch {
            const error = new Error('Некорректный hash сессии');
            error.statusCode = 400;
            throw error;
        }

        const client = await this.createAuthorizedClient(userbot, 1);
        try {
            await client.invoke(new Api.account.ResetAuthorization({ hash: hashLong }));
            const result = await client.invoke(new Api.account.GetAuthorizations());
            const rows = (result?.authorizations || []).map(item => this.normalizeAuthorizationRecord(item));
            rows.sort((a, b) => Number(b.current) - Number(a.current) || String(b.date_active || '').localeCompare(String(a.date_active || '')));
            return rows;
        } finally {
            await client.disconnect();
        }
    }

    // ============================================================
    // Plan 01 Phase 4 — Helpers for MCP/REST tools.
    // Each helper enforces the lifecycle contract:
    //   verify status → open client → run with 30s timeout → log Telegram errors → disconnect in finally
    // ============================================================
};
