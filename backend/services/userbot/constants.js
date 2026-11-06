// Leaf-модуль userbot.service.js (стадия 1 разрезки, план §7.3b):
// константы QR-логина, фингерпринт-профили, DC IPv6, права админов,
// тайминги BotFather. Код перенесён дословно; leaf не импортирует фасад.

export const FAILOVER_COOLDOWN_MS = 15 * 60 * 1000;

// Брошенный QR держит подключённый клиент. Чистим такие сессии при каждом qr-start/qr-status.
export const QR_SESSION_TTL_MS = 20 * 60 * 1000;
// Перезапусков выдачи токена QR (токен живёт ~30с, окно сессии 20 минут).
export const QR_TOKEN_RESTART_LIMIT = 60;
// Часы на выдачу первого QR в фоновой задаче: после — честный failed в qr-status.
export const QR_GENERATE_TIMEOUT_MS = 90 * 1000;

// Верхняя граница на connect к Telegram при генерации QR (та же ручка, что у
// health-check'ей: медленный прокси не должен висеть минутами).
export function getQrConnectTimeoutMs() {
    const raw = Number(process.env.USERBOT_HEALTH_CONNECT_TIMEOUT_MS || 25_000);
    return Number.isFinite(raw) && raw > 0 ? raw : 25_000;
}

export const DEFAULT_FINGERPRINT = Object.freeze({
    api_id: 4,
    api_hash: '014b35b6184100b085b0d0572f9b5103',
    deviceModel: 'Samsung SM-A515F',
    systemVersion: 'SDK 32',
    appVersion: '12.3.0 (63772)',
    systemLangCode: 'en-gb',
    langCode: 'en'
});

export const QR_FINGERPRINT_PROFILES = Object.freeze({
    bullgram_android_a52: Object.freeze({
        id: 'bullgram_android_a52',
        label: 'Bullgram Android A52',
        note: 'Рекомендуемый профиль Bullgram для QR-логина.',
        fingerprint: Object.freeze({
            api_id: 4,
            api_hash: '014b35b6184100b085b0d0572f9b5103',
            deviceModel: 'Samsung SM-A525F',
            systemVersion: 'SDK 33',
            appVersion: '12.3.0 (63772)',
            systemLangCode: 'en-us',
            langCode: 'en'
        })
    }),
    bullgram_android_redmi_note_11: Object.freeze({
        id: 'bullgram_android_redmi_note_11',
        label: 'Bullgram Redmi Note 11',
        note: 'Альтернативный Android-профиль Bullgram с русской локалью.',
        fingerprint: Object.freeze({
            api_id: 4,
            api_hash: '014b35b6184100b085b0d0572f9b5103',
            deviceModel: 'Redmi Note 11',
            systemVersion: 'SDK 32',
            appVersion: '12.3.0 (63772)',
            systemLangCode: 'ru-ru',
            langCode: 'ru'
        })
    }),
    bullgram_android_a34: Object.freeze({
        id: 'bullgram_android_a34',
        label: 'Bullgram Android A34',
        note: 'Запасной Android-профиль Bullgram для QR-логина.',
        fingerprint: Object.freeze({
            api_id: 4,
            api_hash: '014b35b6184100b085b0d0572f9b5103',
            deviceModel: 'Samsung SM-A346B',
            systemVersion: 'SDK 34',
            appVersion: '12.3.0 (63772)',
            systemLangCode: 'en-gb',
            langCode: 'en'
        })
    }),
    bullgram_iphone_13: Object.freeze({
        id: 'bullgram_iphone_13',
        label: 'Bullgram iPhone 13',
        note: 'Стабильный iPhone-профиль Bullgram для QR-логина.',
        fingerprint: Object.freeze({
            api_id: 4,
            api_hash: '014b35b6184100b085b0d0572f9b5103',
            deviceModel: 'iPhone 13',
            systemVersion: 'iOS 17.4',
            appVersion: '12.3 (30231)',
            systemLangCode: 'en-us',
            langCode: 'en'
        })
    }),
    bullgram_iphone_15_pro: Object.freeze({
        id: 'bullgram_iphone_15_pro',
        label: 'Bullgram iPhone 15 Pro',
        note: 'Свежий iPhone-профиль Bullgram для QR-логина.',
        fingerprint: Object.freeze({
            api_id: 4,
            api_hash: '014b35b6184100b085b0d0572f9b5103',
            deviceModel: 'iPhone 15 Pro',
            systemVersion: 'iOS 17.5',
            appVersion: '12.3 (30231)',
            systemLangCode: 'en-us',
            langCode: 'en'
        })
    })
});

export const DEFAULT_QR_FINGERPRINT_PROFILE_ID = 'bullgram_android_a52';

export const TELEGRAM_DC_IPV6 = Object.freeze({
    1: '2001:b28:f23d:f001::a',
    2: '2001:67c:4e8:f002::a',
    3: '2001:b28:f23d:f003::a',
    4: '2001:67c:4e8:f004::a',
    5: '2001:b28:f23f:f005::a'
});

// Права для channels.EditAdmin. Имена флагов сверены с api.d.ts
// (telegram 2.26.22) class ChatAdminRights: changeInfo/postMessages/editMessages/
// deleteMessages/banUsers/inviteUsers/pinMessages/addAdmins/anonymous/manageCall/
// other/manageTopics/postStories/editStories/deleteStories. Bot-API-имена
// (canManageChat, canPromoteMembers) в MTProto-схеме отсутствуют: право
// «назначать админов» — это addAdmins. 'revoke' = пустые права (разжать).
export const PROMOTE_ADMIN_RIGHTS_PRESETS = Object.freeze({
    all: Object.freeze({
        changeInfo: true,
        postMessages: true,
        editMessages: true,
        deleteMessages: true,
        banUsers: true,
        inviteUsers: true,
        pinMessages: true,
        addAdmins: true
    }),
    post_only: Object.freeze({ postMessages: true }),
    revoke: Object.freeze({})
});

export const BOTFATHER_STEP_TIMEOUT_MS = 20_000;

// Токен бота из ответа BotFather: «123456789:AA...long-secret...».
export const BOTFATHER_MENU_SIGNATURE = 'I can help you create and manage Telegram bots';
