import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import QRCode from 'qrcode';
import { decrypt, encrypt } from '../utils/crypto.js';
import sqlite3 from 'sqlite3';
import axios from 'axios';
import { SocksProxyAgent } from 'socks-proxy-agent';
import fs from 'fs/promises';
import os from 'os';
import crypto from 'crypto';
import { logTelegramErrorEvent } from '../utils/telegram-error-events.js';
import { MCPError, ERROR_CODES } from '../shared/errors.js';
import { withTimeout } from '../shared/utils.js';
import { encodeCursor, decodeCursor } from '../shared/pagination.js';
import {
  sanitizeMessage,
  sanitizeDialog,
  sanitizeParticipant
} from '../shared/content-sanitizer.js';
import { getPeerFromCache } from '../utils/peer-cache.js';

const FAILOVER_COOLDOWN_MS = 15 * 60 * 1000;

// Брошенный QR держит подключённый клиент. Чистим такие сессии при каждом qr-start/qr-status.
const QR_SESSION_TTL_MS = 20 * 60 * 1000;

const DEFAULT_FINGERPRINT = Object.freeze({
    api_id: 4,
    api_hash: '014b35b6184100b085b0d0572f9b5103',
    deviceModel: 'Samsung SM-A515F',
    systemVersion: 'SDK 32',
    appVersion: '12.3.0 (63772)',
    systemLangCode: 'en-gb',
    langCode: 'en'
});

const QR_FINGERPRINT_PROFILES = Object.freeze({
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

const DEFAULT_QR_FINGERPRINT_PROFILE_ID = 'bullgram_android_a52';

const TELEGRAM_DC_IPV6 = Object.freeze({
    1: '2001:b28:f23d:f001::a',
    2: '2001:67c:4e8:f002::a',
    3: '2001:b28:f23d:f003::a',
    4: '2001:67c:4e8:f004::a',
    5: '2001:b28:f23f:f005::a'
});

function isTimeoutLikeTelegramError(error) {
    const raw = String(
        error?.errorMessage
        || error?.message
        || error?.description
        || error
        || ''
    ).toUpperCase();

    return raw.includes('TIMEOUT')
        || raw.includes('TIMED OUT')
        || raw.includes('ETIMEDOUT')
        || raw.includes('TIMEOUTERROR')
        || raw.includes('CONNECTION')
        || raw.includes('SOCKS')
        || raw.includes('NETWORK');
}

function describeTelegramError(error) {
    return {
        message: String(error?.errorMessage || error?.message || error?.description || error || '').trim() || null,
        code: error?.code || null,
        name: error?.name || null
    };
}

function detectSpamBlockReason(messages = []) {
    const texts = (messages || [])
        .filter((message) => !message?.out)
        .map((message) => String(message?.message || '').trim())
        .filter(Boolean);

    for (const text of texts) {
        const normalized = text.toLowerCase();
        if (
            normalized.includes('your account was blocked')
            || normalized.includes('violations of the telegram terms of service')
            || normalized.includes('confirmed by our moderators')
            || normalized.includes('spam')
            || normalized.includes('your account is free as a bird')
            || normalized.includes('good news, no limits are currently applied')
        ) {
            return text;
        }
    }

    return '';
}

function buildHealthDetails({
    session = 'unknown',
    restriction = 'unknown',
    restrictionReason = '',
    spambotState = 'not_checked',
    spambotReason = '',
    spambotSource = ''
} = {}) {
    return {
        session,
        restriction,
        restriction_reason: restrictionReason || '',
        spambot: {
            state: spambotState,
            reason: spambotReason || '',
            source: spambotSource || ''
        }
    };
}

/**
 * Сервис для работы с юзерботами (GramJS)
 * Содержит бизнес-логику для работы с Telegram через юзербота
 */
export class UserbotService {
    constructor(supabase, apiId, apiHash) {
        this.supabase = supabase;
        this.apiId = Number(apiId || DEFAULT_FINGERPRINT.api_id);
        this.apiHash = apiHash || DEFAULT_FINGERPRINT.api_hash;
        this.qrSessions = new Map();
        this.spamBlockCache = new Map();
    }

    normalizeFailoverProxyIds(value) {
        if (Array.isArray(value)) {
            return value.map(item => String(item)).filter(Boolean);
        }

        if (typeof value === 'string' && value.trim()) {
            try {
                const parsed = JSON.parse(value);
                if (Array.isArray(parsed)) {
                    return parsed.map(item => String(item)).filter(Boolean);
                }
            } catch {
                return value.split(',').map(item => item.trim()).filter(Boolean);
            }
        }

        return [];
    }

    async tryAutoFailoverUserbot(userbot) {
        if (!userbot?.id || !userbot?.owner_id) return { switched: false, account: userbot, reason: 'no_account' };
        if (!userbot.proxy_id || userbot?.proxies?.is_working !== false) return { switched: false, account: userbot, reason: 'proxy_ok' };
        if (!userbot.allow_proxy_failover) return { switched: false, account: userbot, reason: 'disabled' };

        const lastFailoverAt = userbot.last_failover_at ? new Date(userbot.last_failover_at) : null;
        if (lastFailoverAt && !Number.isNaN(lastFailoverAt.getTime())) {
            const diff = Date.now() - lastFailoverAt.getTime();
            if (diff < FAILOVER_COOLDOWN_MS) {
                return {
                    switched: false,
                    account: userbot,
                    reason: 'cooldown',
                    retry_after_ms: FAILOVER_COOLDOWN_MS - diff
                };
            }
        }

        const allowedIds = this.normalizeFailoverProxyIds(userbot.failover_proxy_ids)
            .filter(id => id !== String(userbot.proxy_id));

        if (!allowedIds.length) {
            return { switched: false, account: userbot, reason: 'empty_pool' };
        }

        const { data: candidateProxies, error } = await this.supabase
            .from('proxies')
            .select('id, host, port, username, password, is_working, name, last_check_country, last_check_country_code')
            .eq('owner_id', userbot.owner_id)
            .eq('is_working', true)
            .in('id', allowedIds);

        if (error) throw error;

        const { data: occupiedProxyRows, error: occupiedProxyError } = await this.supabase
            .from('tg_accounts')
            .select('proxy_id')
            .eq('owner_id', userbot.owner_id)
            .eq('account_type', 'userbot')
            .neq('id', userbot.id)
            .in('proxy_id', allowedIds);

        if (occupiedProxyError) throw occupiedProxyError;

        const occupiedProxyIds = new Set(
            (occupiedProxyRows || [])
                .map((row) => String(row.proxy_id || ''))
                .filter(Boolean)
        );

        const nextProxy = (candidateProxies || []).find((proxy) =>
            allowedIds.includes(String(proxy.id)) && !occupiedProxyIds.has(String(proxy.id))
        );
        if (!nextProxy) {
            return { switched: false, account: userbot, reason: 'no_live_proxy' };
        }

        const { data: updatedAccount, error: updateError } = await this.supabase
            .from('tg_accounts')
            .update({
                proxy_id: nextProxy.id,
                last_failover_at: new Date().toISOString(),
                last_failover_from_proxy_id: userbot.proxy_id
            })
            .eq('id', userbot.id)
            .eq('owner_id', userbot.owner_id)
            .select('*, proxies(id, name, host, port, username, password, is_working, provision_source, inventory_group, last_check_country, last_check_country_code)')
            .single();

        if (updateError) throw updateError;

        return {
            switched: true,
            account: updatedAccount,
            reason: 'switched',
            from_proxy_id: userbot.proxy_id,
            to_proxy_id: nextProxy.id
        };
    }

    getQrFingerprintProfiles() {
        return Object.values(QR_FINGERPRINT_PROFILES).map((item) => ({
            id: item.id,
            label: item.label,
            note: item.note,
            is_system: true
        }));
    }

    getQrFingerprintProfile(profileId = DEFAULT_QR_FINGERPRINT_PROFILE_ID) {
        return QR_FINGERPRINT_PROFILES[profileId] || QR_FINGERPRINT_PROFILES[DEFAULT_QR_FINGERPRINT_PROFILE_ID];
    }

    async listQrFingerprintProfiles(ownerId) {
        try {
            const { data, error } = await this.supabase
                .from('userbot_fingerprint_presets')
                .select('id, owner_id, label, note, api_id, api_hash, device_model, system_version, app_version, system_lang_code, lang_code, sort_order, created_at')
                .or(`owner_id.is.null,owner_id.eq.${ownerId}`)
                .order('sort_order', { ascending: true })
                .order('created_at', { ascending: true });

            if (error) throw error;

            return (data || []).map((row) => this._mapFingerprintPresetRow(row));
        } catch (error) {
            console.warn('[USERBOT_FINGERPRINT_PRESETS] fallback to built-in profiles:', error?.message || error);
            return this.getQrFingerprintProfiles();
        }
    }

    async getQrFingerprintProfileForOwner(ownerId, profileId = DEFAULT_QR_FINGERPRINT_PROFILE_ID) {
        if (!profileId) {
            return this.getQrFingerprintProfile(DEFAULT_QR_FINGERPRINT_PROFILE_ID);
        }

        try {
            const { data, error } = await this.supabase
                .from('userbot_fingerprint_presets')
                .select('id, owner_id, label, note, api_id, api_hash, device_model, system_version, app_version, system_lang_code, lang_code, sort_order, created_at')
                .eq('id', profileId)
                .or(`owner_id.is.null,owner_id.eq.${ownerId}`)
                .maybeSingle();

            if (error) throw error;
            if (!data) return this.getQrFingerprintProfile(DEFAULT_QR_FINGERPRINT_PROFILE_ID);
            return this._mapFingerprintPresetRow(data);
        } catch (error) {
            console.warn('[USERBOT_FINGERPRINT_PRESET] fallback to built-in profile:', error?.message || error);
            return this.getQrFingerprintProfile(profileId);
        }
    }

    async saveQrFingerprintPreset(ownerId, input = {}) {
        const presetId = String(input.id || `custom_${crypto.randomUUID()}`);
        const label = String(input.label || '').trim();
        if (!label) {
            throw new Error('Назови свой пресет, чтобы потом не искать его вслепую.');
        }

        const fingerprint = this._normalizeFingerprint({
            ...input,
            api_id: input.api_id,
            api_hash: input.api_hash,
            deviceModel: input.device_model ?? input.deviceModel,
            systemVersion: input.system_version ?? input.systemVersion,
            appVersion: input.app_version ?? input.appVersion,
            systemLangCode: input.system_lang_code ?? input.systemLangCode,
            langCode: input.lang_code ?? input.langCode,
            profileId: presetId,
            profileLabel: label,
            source: 'custom_preset'
        });

        const payload = {
            id: presetId,
            owner_id: ownerId,
            label,
            note: String(input.note || '').trim() || null,
            api_id: Number(fingerprint.api_id),
            api_hash: fingerprint.api_hash,
            device_model: fingerprint.deviceModel,
            system_version: fingerprint.systemVersion,
            app_version: fingerprint.appVersion,
            system_lang_code: fingerprint.systemLangCode,
            lang_code: fingerprint.langCode,
            updated_at: new Date().toISOString()
        };

        const { data, error } = await this.supabase
            .from('userbot_fingerprint_presets')
            .upsert(payload, { onConflict: 'id' })
            .select('id, owner_id, label, note, api_id, api_hash, device_model, system_version, app_version, system_lang_code, lang_code, sort_order, created_at')
            .single();

        if (error) throw error;
        return this._mapFingerprintPresetRow(data);
    }

    _mapFingerprintPresetRow(row = {}) {
        const profile = {
            id: row.id,
            label: row.label,
            note: row.note || '',
            is_system: !row.owner_id,
            owner_id: row.owner_id || null,
            fingerprint: {
                api_id: Number(row.api_id || DEFAULT_FINGERPRINT.api_id),
                api_hash: row.api_hash || DEFAULT_FINGERPRINT.api_hash,
                deviceModel: row.device_model || DEFAULT_FINGERPRINT.deviceModel,
                systemVersion: row.system_version || DEFAULT_FINGERPRINT.systemVersion,
                appVersion: row.app_version || DEFAULT_FINGERPRINT.appVersion,
                systemLangCode: row.system_lang_code || DEFAULT_FINGERPRINT.systemLangCode,
                langCode: row.lang_code || DEFAULT_FINGERPRINT.langCode
            }
        };

        return profile;
    }

    getDefaultFingerprint(profileId = DEFAULT_QR_FINGERPRINT_PROFILE_ID) {
        const profile = this.getQrFingerprintProfile(profileId);
        return {
            ...profile.fingerprint,
            api_id: Number(profile.fingerprint.api_id || this.apiId || DEFAULT_FINGERPRINT.api_id),
            api_hash: profile.fingerprint.api_hash || this.apiHash || DEFAULT_FINGERPRINT.api_hash,
            profileId: profile.id,
            profileLabel: profile.label,
            source: 'qr_profile'
        };
    }

    parseSessionData(decryptedData) {
        const fallback = {
            token: decryptedData,
            fingerprint: this.getDefaultFingerprint()
        };

        if (!decryptedData || typeof decryptedData !== 'string') {
            return { token: '', fingerprint: this.getDefaultFingerprint() };
        }

        try {
            const parsed = JSON.parse(decryptedData);
            if (!parsed || typeof parsed !== 'object' || typeof parsed.token !== 'string') {
                return fallback;
            }

            return {
                token: parsed.token,
                fingerprint: this._normalizeFingerprint({
                    ...(parsed.fingerprint || {}),
                    profileId: parsed.fingerprint_profile_id,
                    profileLabel: parsed.fingerprint_profile_label,
                    source: parsed.fingerprint_source
                })
            };
        } catch {
            return fallback;
        }
    }

    prepareServiceClient(client, { silent = true, ignoreAuthKeyErrors = false } = {}) {
        if (!client) return client;

        if (silent && typeof client.setLogLevel === 'function') {
            client.setLogLevel('none');
        }

        client._updateLoop = async () => {};
        client._errorHandler = async (error) => {
            const raw = String(error?.errorMessage || error?.message || error || '');
            if (raw.includes('TIMEOUT')) {
                return;
            }
            if (ignoreAuthKeyErrors && (raw.includes('AUTH_KEY_UNREGISTERED') || raw.includes('SESSION_REVOKED'))) {
                return;
            }
            console.error('[GramJS _errorHandler]', error);
        };

        return client;
    }

    stringifySessionData(token, fingerprint = null, authSource = 'session_import') {
        return JSON.stringify({
            token,
            auth_source: authSource,
            fingerprint: this._normalizeFingerprint(fingerprint),
            fingerprint_profile_id: fingerprint?.profileId || null,
            fingerprint_profile_label: fingerprint?.profileLabel || null,
            fingerprint_source: fingerprint?.source || null
        });
    }

    async parseConfigJson(filePath) {
        const raw = await fs.readFile(filePath, 'utf8');
        return this.parseConfigJsonContent(raw);
    }

    parseConfigJsonContent(raw) {
        let parsed;

        try {
            parsed = JSON.parse(raw);
        } catch {
            throw new Error('JSON-файл поврежден или имеет неверный формат');
        }

        return this._normalizeFingerprint({
            api_id: parsed.app_id ?? parsed.api_id,
            api_hash: parsed.app_hash ?? parsed.api_hash,
            deviceModel: parsed.device ?? parsed.deviceModel,
            systemVersion: parsed.sdk ?? parsed.systemVersion,
            appVersion: parsed.app_version ?? parsed.appVersion,
            systemLangCode: parsed.system_lang_pack ?? parsed.systemLangCode,
            langCode: parsed.lang_pack ?? parsed.langCode,
            source: 'json_file'
        });
    }

    async extractSessionFromSqliteBuffer(buffer) {
        const tempPath = `${os.tmpdir()}/bullgram-restore-${Date.now()}-${Math.random().toString(16).slice(2)}.session`;
        await fs.writeFile(tempPath, buffer);
        try {
            return await this.extractSessionFromSqlite(tempPath);
        } finally {
            try {
                await fs.unlink(tempPath);
            } catch {}
        }
    }

    async validateSessionSqliteFile(filePath) {
        const stat = await fs.stat(filePath);
        if (!stat.isFile() || stat.size <= 0) {
            throw new Error('Файл `.session` пустой или недоступен.');
        }

        const handle = await fs.open(filePath, 'r');
        try {
            const header = Buffer.alloc(16);
            await handle.read(header, 0, header.length, 0);
            if (header.toString('utf8', 0, 15) !== 'SQLite format 3') {
                throw new Error('Файл `.session` не похож на SQLite Telegram session.');
            }
        } finally {
            await handle.close();
        }
    }

    async validateConfigJsonFile(filePath) {
        const stat = await fs.stat(filePath);
        if (!stat.isFile() || stat.size <= 0) {
            throw new Error('Файл `.json` пустой или недоступен.');
        }

        const raw = await fs.readFile(filePath, 'utf8');
        const normalized = this.parseConfigJsonContent(raw);

        if (!normalized.api_id || !normalized.api_hash) {
            throw new Error('В `.json` нет валидного app_id/app_hash.');
        }

        return normalized;
    }

    async saveRecoverySource({ accountId, ownerId, tgAccountId, sessionFilePath, sessionOriginalName, jsonFilePath = null, jsonOriginalName = null, fingerprint = null }) {
        const sessionBuffer = await fs.readFile(sessionFilePath);
        const normalizedFingerprint = this._normalizeFingerprint(fingerprint);

        const payload = {
            owner_id: ownerId,
            account_id: accountId,
            tg_account_id: String(tgAccountId),
            source_type: 'session_bundle',
            session_filename: sessionOriginalName || 'sessionFile.session',
            session_blob_encrypted: encrypt(sessionBuffer.toString('base64')),
            json_filename: jsonOriginalName || null,
            json_blob_encrypted: jsonFilePath ? encrypt(JSON.stringify(normalizedFingerprint)) : null,
            fingerprint: normalizedFingerprint,
            updated_at: new Date().toISOString(),
            last_restore_status: 'ready',
            last_restore_error: null
        };

        const { error } = await this.supabase
            .from('userbot_restore_sources')
            .upsert(payload, { onConflict: 'account_id' });

        if (error) throw error;
    }

    async deleteRecoverySource(ownerId, accountId) {
        const { error } = await this.supabase
            .from('userbot_restore_sources')
            .delete()
            .eq('owner_id', ownerId)
            .eq('account_id', accountId);

        if (error) throw error;
    }

    async getRecoverySource(ownerId, accountId) {
        const { data, error } = await this.supabase
            .from('userbot_restore_sources')
            .select('*')
            .eq('owner_id', ownerId)
            .eq('account_id', accountId)
            .maybeSingle();

        if (error) throw error;
        return data || null;
    }

    _normalizeFingerprint(fingerprint = {}) {
        const input = fingerprint && typeof fingerprint === 'object' ? fingerprint : {};
        const defaults = this.getDefaultFingerprint();

        return {
            api_id: Number(input.api_id || defaults.api_id),
            api_hash: input.api_hash || defaults.api_hash,
            deviceModel: input.deviceModel || defaults.deviceModel,
            systemVersion: input.systemVersion || defaults.systemVersion,
            appVersion: input.appVersion || defaults.appVersion,
            systemLangCode: input.systemLangCode || defaults.systemLangCode,
            langCode: input.langCode || defaults.langCode,
            profileId: input.profileId ?? input.fingerprint_profile_id ?? defaults.profileId ?? null,
            profileLabel: input.profileLabel ?? input.fingerprint_profile_label ?? defaults.profileLabel ?? null,
            source: input.source ?? input.fingerprint_source ?? defaults.source ?? null
        };
    }

    _normalizeProxyInput(proxyData = null) {
        if (!proxyData || typeof proxyData !== 'object') return null;

        const nested = proxyData.proxies && typeof proxyData.proxies === 'object'
            ? proxyData.proxies
            : null;

        const host = proxyData.proxy_host || proxyData.host || nested?.host || null;
        const port = proxyData.proxy_port || proxyData.port || nested?.port || null;
        const username = proxyData.proxy_username || proxyData.username || nested?.username || null;
        const password = proxyData.proxy_password || proxyData.password || nested?.password || null;

        if (!host || !port) return null;

        return {
            host: String(host),
            port: Number(port),
            username: username || null,
            password: password || null
        };
    }

    /**
     * Вспомогательная функция для сборки конфига прокси (для GramJS)
     * GramJS принимает плоский объект, пакет socks подключается автоматически
     */
    _buildProxy(proxyData) {
        const normalized = this._normalizeProxyInput(proxyData);
        if (!normalized) return undefined;

        const proxy = {
            ip: normalized.host,
            port: parseInt(normalized.port),
            socksType: 5
        };

        // Добавляем авторизацию только если есть
        if (normalized.username && normalized.password) {
            proxy.username = normalized.username;
            proxy.password = normalized.password;
        }

        console.log('[BUILD-PROXY] Собран конфиг прокси:', {
            ip: proxy.ip,
            port: proxy.port,
            socksType: proxy.socksType,
            hasAuth: !!(proxy.username && proxy.password)
        });

        return proxy;
    }

    _shouldUseIpv6TelegramDc(proxyData = null) {
        if (!proxyData || typeof proxyData !== 'object') return false;

        const nested = proxyData.proxies && typeof proxyData.proxies === 'object'
            ? proxyData.proxies
            : null;

        const provisionSource = String(
            proxyData.provision_source ||
            proxyData.proxy_provision_source ||
            nested?.provision_source ||
            ''
        );

        const username = String(
            proxyData.proxy_username ||
            proxyData.username ||
            nested?.username ||
            ''
        );

        if (proxyData.force_ipv6 === true || nested?.force_ipv6 === true) {
            return true;
        }

        const healthSuggestsIpv6Only = (
            (proxyData.is_working === true || nested?.is_working === true) &&
            !(
                proxyData.last_check_ip ||
                nested?.last_check_ip ||
                proxyData.last_check_country ||
                nested?.last_check_country ||
                proxyData.last_check_city ||
                nested?.last_check_city
            )
        );

        return (
            (provisionSource === 'manual_admin' && /^mp_\d+$/.test(username)) ||
            healthSuggestsIpv6Only
        );
    }

    /**
     * АНТИ-БАН: Генерация отпечатка реального Android-устройства (Филиппины)
     */
    _getClientConfig(proxyConfig, retries = 1, fingerprint = null, proxyData = null) {
        const normalized = this._normalizeFingerprint(fingerprint);
        const useIPV6 = this._shouldUseIpv6TelegramDc(proxyData);

        return {
            connectionRetries: retries,
            deviceModel: normalized.deviceModel,
            systemVersion: normalized.systemVersion,
            appVersion: normalized.appVersion,
            systemLangCode: normalized.systemLangCode,
            langCode: normalized.langCode,
            useIPV6,
            useWSS: false,
            proxy: proxyConfig
        };
    }

    _forceManagedIpv6Dc(client, proxyData = null) {
        if (!this._shouldUseIpv6TelegramDc(proxyData) || !client?.session) {
            return;
        }

        this._forceIpv6Dc(client);
    }

    _forceIpv6Dc(client) {
        if (!client?.session) {
            return;
        }

        const currentDcId = Number(client.session.dcId || 0) || 4;
        const ipv6Address = TELEGRAM_DC_IPV6[currentDcId];
        if (!ipv6Address) {
            return;
        }

        client._useIPV6 = true;
        client.session.setDC(currentDcId, ipv6Address, client.useWSS ? 443 : 80);
    }

    _isTelegramIpv6RetryableProxyError(error) {
        const raw = String(error?.errorMessage || error?.message || '');
        return (
            raw.includes('Socks5 proxy rejected connection - NotAllowed') ||
            raw.includes('Socks5 proxy rejected connection - ConnectionRefused')
        );
    }

    _clientUsesIpv6Dc(client) {
        const serverAddress = String(client?.session?.serverAddress || '');
        return serverAddress.includes(':');
    }

    async connectWithProxyFallback(client, proxyData = null) {
        try {
            await client.connect();
            return { usedIpv6Fallback: false };
        } catch (error) {
            const hasProxy = !!this._normalizeProxyInput(proxyData);
            const alreadyIpv6 = this._clientUsesIpv6Dc(client);

            if (!hasProxy || alreadyIpv6 || !this._isTelegramIpv6RetryableProxyError(error)) {
                throw error;
            }

            console.warn('[TELEGRAM-CONNECT] IPv4 DC через прокси не прошел, повторяем через IPv6 DC:', error.message);

            try { await client.disconnect(); } catch {}
            this._forceIpv6Dc(client);
            await client.connect();
            return { usedIpv6Fallback: true };
        }
    }

    /**
     * ПАРСИНГ .SESSION: Извлекаем ключи из базы SQLite и делаем StringSession
     */
    async extractSessionFromSqlite(filePath) {
        return new Promise((resolve, reject) => {
            const db = new sqlite3.Database(filePath, sqlite3.OPEN_READONLY, (err) => {
                if (err) return reject(new Error('Не удалось открыть файл сессии: ' + err.message));
            });

            db.get("SELECT dc_id, server_address, port, auth_key FROM sessions LIMIT 1", (err, row) => {
                db.close();
                if (err) return reject(new Error('Ошибка чтения базы: ' + err.message));
                if (!row || !row.auth_key) return reject(new Error("Не найден auth_key в файле сессии"));

                try {
                    const ipParts = row.server_address.split('.').map(Number);
                    if (ipParts.length !== 4) throw new Error("Поддерживается только IPv4");

                    const key = Buffer.from(row.auth_key);
                    const cleanKey = key.length > 256 ? key.slice(-256) : key;
                    if (cleanKey.length !== 256) throw new Error(`Неверный размер ключа: ${cleanKey.length} байт`);

                    const packed = Buffer.alloc(263);
                    packed.writeUInt8(row.dc_id, 0); 
                    for (let i = 0; i < 4; i++) packed.writeUInt8(ipParts[i], 1 + i);
                    packed.writeUInt16BE(row.port, 5);
                    cleanKey.copy(packed, 7);

                    const sessionString = '1' + packed.toString('base64');
                    resolve(sessionString);
                } catch (e) {
                    reject(new Error("Ошибка конвертации ключа: " + e.message));
                }
            });
        });
    }

    /**
     * ПРОВЕРКА ПРОКСИ: Тестовый запрос через SOCKS5
     */
    async checkProxy(proxyData) {
        try {
            const normalized = this._normalizeProxyInput(proxyData);
            if (!normalized) {
                throw new Error("Неверные данные прокси");
            }

            let proxyUrl = `socks5://`;
            if (normalized.username && normalized.password) {
                // Кодируем логин и пароль, чтобы спецсимволы не сломали URL
                proxyUrl += `${encodeURIComponent(normalized.username)}:${encodeURIComponent(normalized.password)}@`;
            }
            proxyUrl += `${normalized.host}:${normalized.port}`;

            const agent = new SocksProxyAgent(proxyUrl);

            const ipEndpoints = [
                'https://api64.ipify.org?format=json',
                'https://api.ipify.org?format=json',
                'https://ifconfig.co/json'
            ];

            let exitIp = '';
            let lastIpError = null;

            for (const endpoint of ipEndpoints) {
                try {
                    const ipResponse = await axios.get(endpoint, {
                        httpAgent: agent,
                        httpsAgent: agent,
                        timeout: 10000
                    });
                    exitIp = String(ipResponse?.data?.ip || ipResponse?.data?.ip_addr || '').trim();
                    if (exitIp) break;
                } catch (error) {
                    lastIpError = error;
                }
            }

            // Если IP-чек показал IPv6 exit — прокси форсит IPv6 исходящие
            if (exitIp && exitIp.includes(':')) {
                proxyData.force_ipv6 = true;
            }

            const telegramCheck = await this._checkTelegramConnectivity(proxyData);

            if (!exitIp) {
                if (telegramCheck.success) {
                    return {
                        success: true,
                        ip: '',
                        country: '',
                        countryCode: '',
                        city: '',
                        isp: '',
                        mode: 'telegram_only'
                    };
                }

                throw new Error(lastIpError?.message || telegramCheck.error || 'Прокси поднялся, но не удалось определить внешний IP');
            }

            if (!telegramCheck.success) {
                const rawTelegramError = String(telegramCheck.error || 'Telegram connect failed');
                const isExplicitTelegramBlock = (
                    rawTelegramError.includes('Socks5 proxy rejected connection - NotAllowed') ||
                    rawTelegramError.includes('Socks5 proxy rejected connection - ConnectionRefused')
                );

                if (isExplicitTelegramBlock) {
                    throw new Error('Прокси живой для web/IP, но Telegram через него не идет. Такой прокси не подходит для QR, импорта .session и работы юзерботов.');
                }

                throw new Error(`Прокси живой для web/IP, но Telegram через него не идет: ${rawTelegramError}`);
            }

            // Гео и провайдера можно безопасно получить уже обычным запросом по определенному IP.
            const geoResponse = await axios.get(`https://ipwho.is/${encodeURIComponent(exitIp)}`, {
                timeout: 10000
            });

            const geo = geoResponse?.data || {};
            if (geo.success === false) {
                throw new Error(geo.message || "Не удалось получить геоданные по IP");
            }

            return {
                success: true,
                ip: exitIp,
                country: geo.country || '',
                countryCode: geo.country_code || '',
                city: geo.city || '',
                isp: geo.connection?.isp || geo.connection?.org || ''
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async _checkTelegramConnectivity(normalizedProxy) {
        const proxyConfig = this._buildProxy(normalizedProxy);
        const clientConfig = this._getClientConfig(proxyConfig, 1, undefined, normalizedProxy);
        const client = new TelegramClient(
            new StringSession(''),
            this.apiId,
            this.apiHash,
            clientConfig
        );
        this.prepareServiceClient(client, { ignoreAuthKeyErrors: true });
        this._forceManagedIpv6Dc(client, normalizedProxy);

        try {
            await this.connectWithProxyFallback(client, normalizedProxy);
            try {
                await this._verifyTelegramRpc(client);
            } catch (error) {
                const raw = String(error?.message || '');
                if (raw.includes('Telegram RPC check timed out') && this._shouldUseIpv6TelegramDc(normalizedProxy)) {
                    return { success: true, mode: 'telegram_tcp_only' };
                }
                throw error;
            }
            return { success: true };
        } catch (error) {
            return { success: false, error: error?.message || 'Telegram connect failed' };
        } finally {
            try { await client.disconnect(); } catch {}
        }
    }

    async _verifyTelegramRpc(client) {
        const rpcPromise = client.invoke(new Api.help.GetNearestDc({}));
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Telegram RPC check timed out')), 12000);
        });

        await Promise.race([rpcPromise, timeoutPromise]);
    }

    /**
     * Генерация QR кода для авторизации
     */
    async generateQR(userId, proxyData = null, fingerprintSelection = {}, ownerId = null) {
        if (this.qrSessions.has(userId)) {
            const oldSession = this.qrSessions.get(userId);
            if (oldSession.client) try { await oldSession.client.disconnect(); } catch(e) {}
            this.qrSessions.delete(userId);
        }

        const proxyConfig = this._buildProxy(proxyData);
        const selectedProfileId = String(
            fingerprintSelection?.profile_id
            || fingerprintSelection?.fingerprint_profile_id
            || DEFAULT_QR_FINGERPRINT_PROFILE_ID
        ).trim();
        const wantsCustomFingerprint = fingerprintSelection?.custom_fingerprint && typeof fingerprintSelection.custom_fingerprint === 'object';
        let selectedProfile = null;
        let fingerprint = null;

        if (wantsCustomFingerprint) {
            const customLabel = String(
                fingerprintSelection?.custom_fingerprint?.label
                || fingerprintSelection?.preset_label
                || 'Свой профиль'
            ).trim();

            fingerprint = this._normalizeFingerprint({
                api_id: fingerprintSelection.custom_fingerprint.api_id,
                api_hash: fingerprintSelection.custom_fingerprint.api_hash,
                deviceModel: fingerprintSelection.custom_fingerprint.device_model ?? fingerprintSelection.custom_fingerprint.deviceModel,
                systemVersion: fingerprintSelection.custom_fingerprint.system_version ?? fingerprintSelection.custom_fingerprint.systemVersion,
                appVersion: fingerprintSelection.custom_fingerprint.app_version ?? fingerprintSelection.custom_fingerprint.appVersion,
                systemLangCode: fingerprintSelection.custom_fingerprint.system_lang_code ?? fingerprintSelection.custom_fingerprint.systemLangCode,
                langCode: fingerprintSelection.custom_fingerprint.lang_code ?? fingerprintSelection.custom_fingerprint.langCode,
                profileId: null,
                profileLabel: customLabel,
                source: 'custom_input'
            });

            if (fingerprintSelection?.save_as_preset && ownerId) {
                selectedProfile = await this.saveQrFingerprintPreset(ownerId, {
                    label: customLabel,
                    note: fingerprintSelection?.custom_fingerprint?.note || null,
                    ...fingerprintSelection.custom_fingerprint
                });
                fingerprint = this._normalizeFingerprint({
                    ...selectedProfile.fingerprint,
                    profileId: selectedProfile.id,
                    profileLabel: selectedProfile.label,
                    source: 'custom_preset'
                });
            }
        } else {
            selectedProfile = ownerId
                ? await this.getQrFingerprintProfileForOwner(ownerId, selectedProfileId)
                : this.getQrFingerprintProfile(selectedProfileId);

            fingerprint = this._normalizeFingerprint({
                ...selectedProfile.fingerprint,
                profileId: selectedProfile.id,
                profileLabel: selectedProfile.label,
                source: selectedProfile.is_system ? 'qr_profile' : 'custom_preset'
            });
        }

        const clientConfig = this._getClientConfig(proxyConfig, 5, fingerprint, proxyData);

        console.log('[QR-GENERATE] Создаем TelegramClient с proxyConfig:', proxyConfig);

        const client = new TelegramClient(new StringSession(''), fingerprint.api_id, fingerprint.api_hash, clientConfig);
        this.prepareServiceClient(client);
        this._forceManagedIpv6Dc(client, proxyData);

        try {
            console.log('[QR-GENERATE] Подключаемся к Telegram...');
            await this.connectWithProxyFallback(client, proxyData);
            await this._verifyTelegramRpc(client);
            console.log('[QR-GENERATE] ✅ Подключение успешно!');
        } catch (connectError) {
            console.error('[QR-GENERATE] ❌ Ошибка подключения:', connectError.message);
            if (String(connectError?.message || '').includes('Telegram RPC check timed out')) {
                throw new Error('Прокси открыл TCP до Telegram, но не тянет нормальный MTProto/QR поток. Такой прокси не подходит для QR и юзерботов.');
            }
            throw connectError;
        }

        const isIgnorableQrAuthError = (error) => {
            const raw = String(error?.errorMessage || error?.message || '');
            return (
                raw.includes('AUTH_KEY_UNREGISTERED') ||
                raw.includes('Cannot send requests while disconnected') ||
                raw.includes('TIMEOUT')
            );
        };

        const qrSession = {
            client,
            promise: null,
            proxyData,
            fingerprint,
            authState: 'pending',
            authError: null,
            createdAt: Date.now()
        };

        // Создаем Promise который резолвится когда QR код будет готов
        const waitForQr = new Promise((resolve, reject) => {
            let qrGenerated = false;
            let fatalError = null;
            let timeoutId = null;

            const authPromise = client.signInUserWithQrCode({ apiId: fingerprint.api_id, apiHash: fingerprint.api_hash }, {
                onError: (error) => {
                    console.error('[QR-GENERATE] onError callback:', error.message);
                    fatalError = error;
                },
                qrCode: async (code) => {
                    console.log('[QR-GENERATE] qrCode callback получен, генерируем изображение...');
                    try {
                        const qrUrl = `tg://login?token=${code.token.toString('base64url')}`;
                        const qrImageBase64 = await QRCode.toDataURL(qrUrl);
                        console.log('[QR-GENERATE] ✅ QR изображение готово, размер:', qrImageBase64.length);
                        qrGenerated = true;
                        if (timeoutId) clearTimeout(timeoutId);
                        resolve(qrImageBase64);
                    } catch (err) {
                        console.error('[QR-GENERATE] Ошибка генерации QR изображения:', err);
                        if (timeoutId) clearTimeout(timeoutId);
                        reject(err);
                    }
                }
            });

            authPromise
                .then(() => {
                    qrSession.authState = 'authorized';
                    qrSession.authError = null;
                })
                .catch((error) => {
                    const raw = String(error?.errorMessage || error?.message || error || '');
                    qrSession.authError = raw;
                    if (isIgnorableQrAuthError(error)) {
                        console.warn('[QR-GENERATE] Игнорируем фоновую ошибку QR auth flow:', raw);
                        if (!fatalError) {
                            fatalError = error;
                        }
                        qrSession.authState = 'pending';
                        return;
                    }

                    console.error('[QR-GENERATE] signInUserWithQrCode promise rejected:', raw);
                    if (!fatalError) {
                        fatalError = error;
                    }
                    qrSession.authState = 'failed';
                });

            // Через свежеподнятый прокси Telegram может отдавать QR не мгновенно.
            // Даем больше времени, чтобы не сносить живой контур ложным таймаутом.
            timeoutId = setTimeout(() => {
                if (!qrGenerated) {
                    console.error('[QR-GENERATE] ❌ Таймаут 90 секунд - QR не сгенерирован');
                    if (fatalError) {
                        reject(new Error(`Telegram не отдал QR вовремя. Последняя ошибка: ${fatalError.message}`));
                        return;
                    }
                    reject(new Error('Таймаут генерации QR кода (90 сек). Прокси живой, но Telegram не успел отдать QR. Попробуйте еще раз или проверьте задержки на прокси.'));
                }
            }, 90000);

            // Не даем promise жить без обработчика и засорять лог unhandled rejection.
            void authPromise.catch(() => {});
        });

        try {
            const qrCode = await waitForQr;
            qrSession.promise = waitForQr;
            this.qrSessions.set(userId, qrSession);
            return {
                success: true,
                qrCode: qrCode,
                fingerprint_profile_id: fingerprint.profileId || selectedProfile?.id || null,
                fingerprint_profile_label: fingerprint.profileLabel || selectedProfile?.label || null
            };
        } catch (error) {
            // При ошибке отключаем клиент
            try { await client.disconnect(); } catch(e) {}
            throw error;
        }
    }

    getQRStatus(userId) {
        if (!this.qrSessions.has(userId)) return { status: 'not_found' };
        return { status: 'pending' };
    }

    /**
     * Чистит брошенные QR-сессии старше TTL: иначе они держат подключённый клиент бессрочно.
     * Вызывается при каждом qr-start и qr-status. Ошибки disconnect глотаем.
     */
    async sweepStaleQrSessions(maxAgeMs = QR_SESSION_TTL_MS) {
        const now = Date.now();
        for (const [userId, sessionData] of this.qrSessions.entries()) {
            const startedAt = Number(sessionData?.createdAt || 0);
            if (!startedAt || (now - startedAt) < maxAgeMs) continue;

            this.qrSessions.delete(userId);
            if (sessionData?.client) {
                try {
                    await sessionData.client.disconnect();
                } catch (error) {
                    console.warn('[QR-SWEEP] Не удалось отключить брошенный QR-клиент:', error?.message || error);
                }
            }
        }
    }

    async checkPresence(userbot, channels) {
        const client = await this.createAuthorizedClient(userbot);

        const presenceMap = {};
        try {
            for (const channel of channels) {
                try {
                    const participants = await client.getParticipants(channel.tg_chat_id, { limit: 5000 });
                    presenceMap[channel.id] = participants.map(p => String(p.id));
                } catch (e) {
                    presenceMap[channel.id] = [];
                }
            }
            return { success: true, presence: presenceMap };
        } finally {
            await client.disconnect();
        }
    }

    async sendMessage(userbot, tg_user_id, message, options = {}) {
        const client = await this.createAuthorizedClient(userbot);
        let targetResolution = null;

        try {
            const spamBlock = await this.inspectSpamBlockStatus(client, {
                userbotId: userbot?.id || null
            });
            if (spamBlock.blocked) {
                const spamBlockError = new Error(spamBlock.reason || 'SpamBot подтвердил, что аккаунт ограничен Telegram.');
                spamBlockError.resolution_source = 'spambot';
                throw spamBlockError;
            }

            targetResolution = await this.resolveDirectMessageTarget(client, userbot, tg_user_id, options);
            if (!targetResolution?.peer) {
                throw new Error('Юзербот не знает этот TG ID. Написать можно только тому, с кем уже был диалог, общий чат или кого удалось найти в общей группе.');
            }

            await client.sendMessage(targetResolution.peer, { message: message });
            return { success: true };
        } catch (sendErr) {
            if (targetResolution?.source && !sendErr?.resolution_source) {
                sendErr.resolution_source = targetResolution.source;
            }
            await logTelegramErrorEvent(this.supabase, {
                owner_id: userbot?.owner_id,
                userbot_id: userbot?.id || null,
                tg_user_id: String(tg_user_id || ''),
                event_source: options?.event_source || 'userbot',
                event_type: options?.event_type || 'direct_message',
                error: sendErr,
                meta: {
                    message_length: String(message || '').length,
                    common_chat_id: options?.common_chat_id ? String(options.common_chat_id) : null,
                    resolution_source: sendErr?.resolution_source || null,
                    resolution_trace: Array.isArray(sendErr?.resolution_trace) ? sendErr.resolution_trace : []
                }
            });
            console.error('Ошибка отправки через юзербот:', {
                tg_user_id: String(tg_user_id),
                message_length: String(message || '').length,
                error_message: sendErr?.message || null,
                error_name: sendErr?.name || null,
                error_code: sendErr?.code || null,
                error_text: sendErr?.errorMessage || null,
                resolution_source: sendErr?.resolution_source || null,
                resolution_trace: Array.isArray(sendErr?.resolution_trace) ? sendErr.resolution_trace : []
            });
            throw new Error(this.getDirectMessageError(sendErr));
        } finally {
            await client.disconnect();
        }
    }

    async markDialogAsRead(userbot, tg_user_id, options = {}) {
        const client = await this.createAuthorizedClient(userbot);

        try {
            const targetResolution = await this.resolveDirectMessageTarget(client, userbot, tg_user_id, options);
            if (!targetResolution?.peer) {
                throw new Error('Юзербот не знает этот TG ID. Не могу отметить диалог как прочитанный.');
            }

            await client.invoke(new Api.messages.ReadHistory({
                peer: targetResolution.peer,
                maxId: 2147483647
            }));

            return { success: true };
        } finally {
            await client.disconnect();
        }
    }

    async normalizeInputPeer(client, candidate) {
        if (!candidate) return null;
        if (candidate.inputEntity) {
            return candidate.inputEntity;
        }
        if (
            candidate instanceof Api.InputPeerUser
            || candidate instanceof Api.InputPeerChat
            || candidate instanceof Api.InputPeerChannel
            || candidate instanceof Api.InputPeerSelf
        ) {
            return candidate;
        }

        return client.getInputEntity(candidate);
    }

    async resolveDirectMessageTarget(client, userbot, tgUserId, options = {}) {
        const normalizedId = String(tgUserId || '').trim();
        if (!normalizedId) return null;
        const preferredChatId = options?.common_chat_id ? String(options.common_chat_id).trim() : '';
        const allowAggressiveLookup = options?.aggressive_lookup === true;
        let timeoutLikeError = null;
        const resolutionTrace = [];

        const rememberResolutionError = (stage, error) => {
            resolutionTrace.push({
                stage,
                ...describeTelegramError(error)
            });
        };

        const rememberTimeout = (error) => {
            if (!timeoutLikeError && isTimeoutLikeTelegramError(error)) {
                timeoutLikeError = error;
            }
            rememberResolutionError('timeout_like', error);
        };

        try {
            const me = await client.getMe();
            if (me?.id && String(me.id) === normalizedId) {
                try {
                    return {
                        peer: await client.getInputEntity('me'),
                        source: 'self'
                    };
                } catch {
                    return {
                        peer: new Api.InputPeerSelf(),
                        source: 'self'
                    };
                }
            }
        } catch (error) {
            rememberTimeout(error);
        }

        if (preferredChatId) {
            try {
                const fromPreferredChat = await this.resolveTargetFromSpecificChat(client, preferredChatId, normalizedId);
                if (fromPreferredChat) {
                    return {
                        peer: await this.normalizeInputPeer(client, fromPreferredChat),
                        source: 'preferred_chat'
                    };
                }
            } catch (error) {
                rememberResolutionError('preferred_chat', error);
                rememberTimeout(error);
            }
        }

        try {
            const cachedPeer = await getPeerFromCache(this.supabase, userbot?.id, normalizedId);
            if (cachedPeer?.access_hash) {
                const cachedInputPeer = new Api.InputPeerUser({
                    userId: BigInt(normalizedId),
                    accessHash: BigInt(cachedPeer.access_hash)
                });
                await client.invoke(new Api.users.GetFullUser({ id: cachedInputPeer }));
                return {
                    peer: cachedInputPeer,
                    source: 'cached_access_hash'
                };
            }
        } catch (error) {
            rememberResolutionError('cached_access_hash', error);
            rememberTimeout(error);
        }

        try {
            const dialogs = await client.getDialogs({ limit: 80 });
            const dialog = (dialogs || []).find(item => String(item?.entity?.id || '') === normalizedId);
            if (dialog) {
                return {
                    peer: await this.normalizeInputPeer(client, dialog),
                    source: 'dialogs'
                };
            }
        } catch (error) {
            rememberResolutionError('dialogs', error);
            rememberTimeout(error);
        }

        try {
            return {
                peer: await client.getInputEntity(normalizedId),
                source: 'input_entity'
            };
        } catch (error) {
            rememberResolutionError('input_entity', error);
            rememberTimeout(error);
        }

        try {
            const entity = await client.getEntity(normalizedId);
            return {
                peer: await this.normalizeInputPeer(client, entity),
                source: 'entity'
            };
        } catch (error) {
            rememberResolutionError('entity', error);
            rememberTimeout(error);
        }

        if (allowAggressiveLookup) {
            try {
                const fromCommonChats = await this.resolveTargetFromCommonChats(client, normalizedId);
                if (fromCommonChats) {
                    return {
                        peer: await this.normalizeInputPeer(client, fromCommonChats),
                        source: 'common_chats'
                    };
                }
            } catch (error) {
                rememberResolutionError('common_chats', error);
                rememberTimeout(error);
            }

            try {
                const fromKnownChannels = await this.resolveTargetFromKnownChannels(client, userbot, normalizedId);
                if (fromKnownChannels) {
                    return {
                        peer: await this.normalizeInputPeer(client, fromKnownChannels),
                        source: 'known_channels'
                    };
                }
            } catch (error) {
                rememberResolutionError('known_channels', error);
                rememberTimeout(error);
            }
        }

        if (timeoutLikeError) {
            timeoutLikeError.resolution_trace = resolutionTrace;
            throw timeoutLikeError;
        }

        return null;
    }

    async resolveTargetFromSpecificChat(client, tgChatId, tgUserId) {
        const participants = await client.getParticipants(tgChatId, { limit: 5000 });
        return (participants || []).find(participant => String(participant?.id || '') === tgUserId) || null;
    }

    async resolveTargetFromCommonChats(client, tgUserId) {
        const dialogs = await client.getDialogs({ limit: 80 });
        const groupDialogs = (dialogs || []).filter(dialog => dialog.isChannel || dialog.isGroup);

        for (const dialog of groupDialogs.slice(0, 25)) {
            try {
                const participants = await client.getParticipants(dialog.entity, { limit: 5000 });
                const target = (participants || []).find(participant => String(participant?.id || '') === tgUserId);
                if (target) {
                    return target;
                }
            } catch {
                // some chats won't return participants; skip them
            }
        }

        return null;
    }

    async resolveTargetFromKnownChannels(client, userbot, tgUserId) {
        if (!userbot?.owner_id) return null;

        const { data: channels, error } = await this.supabase
            .from('channels')
            .select('id, tg_chat_id')
            .eq('owner_id', userbot.owner_id)
            .not('tg_chat_id', 'is', null);

        if (error) throw error;

        for (const channel of channels || []) {
            try {
                const participants = await client.getParticipants(channel.tg_chat_id, { limit: 5000 });
                const target = (participants || []).find(participant => String(participant?.id || '') === tgUserId);
                if (target) {
                    return target;
                }
            } catch {
                // ignore and keep searching other known channels
            }
        }

        return null;
    }

    getDirectMessageError(error) {
        const raw = String(
            error?.errorMessage
            || error?.message
            || error?.description
            || ''
        );
        const normalized = raw.toUpperCase();

        if (
            normalized.includes('YOUR ACCOUNT WAS BLOCKED')
            || normalized.includes('VIOLATIONS OF THE TELEGRAM TERMS OF SERVICE')
            || normalized.includes('CONFIRMED BY OUR MODERATORS')
        ) {
            return 'Telegram через SpamBot подтвердил, что этот аккаунт заблокирован за нарушения. Этим юзерботом больше нельзя писать.';
        }

        if (
            normalized.includes('PEER_ID_INVALID')
            || normalized.includes('INPUT ENTITY')
            || normalized.includes('CANNOT FIND ANY ENTITY')
            || normalized.includes('NO INPUT ENTITY')
        ) {
            const resolutionSource = error?.resolution_source ? ` Последняя попытка шла через ${error.resolution_source}.` : '';
            return `Юзербот не смог корректно собрать Telegram peer для этого адресата.${resolutionSource} Написать можно только тому, с кем уже был диалог, общий чат или кого удалось найти в общей группе.`;
        }

        if (normalized.includes('USER_IS_BLOCKED')) {
            return 'Этот пользователь заблокировал юзербота. Telegram не даст написать.';
        }

        if (normalized.includes('USER_PRIVACY_RESTRICTED')) {
            return 'У пользователя стоит приватность. Telegram не дает написать ему напрямую.';
        }

        if (normalized.includes('FLOOD_WAIT')) {
            return 'Telegram просит притормозить. По этому юзерботу сработал flood wait.';
        }

        if (normalized.includes('CHAT_WRITE_FORBIDDEN')) {
            return 'Юзербот не может писать в этот диалог. Telegram запретил отправку.';
        }

        if (normalized.includes('AUTH_KEY_UNREGISTERED') || normalized.includes('SESSION_REVOKED')) {
            return 'Сессия юзербота сдохла. Нужно переподключить аккаунт.';
        }

        return raw
            ? `Не удалось отправить сообщение. Telegram ответил: ${raw}`
            : 'Не удалось отправить сообщение.';
    }

    async inspectSpamBlockStatus(client, options = {}) {
        const cacheKey = String(options.userbotId || 'anonymous');
        const now = Date.now();
        const cached = this.spamBlockCache.get(cacheKey);
        if (cached && !options.force && (now - cached.checkedAt) < 15 * 60 * 1000) {
            return cached.result;
        }

        let result = {
            blocked: false,
            reason: '',
            source: 'cache_miss'
        };

        try {
            const spamBot = await client.getInputEntity('SpamBot');
            let messages = await client.getMessages(spamBot, { limit: 5 });
            let reasonText = detectSpamBlockReason(messages);

            if (!reasonText && options.activeProbe === true) {
                await client.sendMessage(spamBot, { message: '/start' });
                messages = await client.getMessages(spamBot, { limit: 5 });
                reasonText = detectSpamBlockReason(messages);
            }

            if (reasonText) {
                const normalized = reasonText.toLowerCase();
                result = {
                    blocked: normalized.includes('your account was blocked')
                        || normalized.includes('violations of the telegram terms of service')
                        || normalized.includes('confirmed by our moderators')
                        || normalized.includes('spam'),
                    reason: reasonText,
                    source: 'spambot'
                };
            } else {
                result = {
                    blocked: false,
                    reason: '',
                    source: 'spambot'
                };
            }
        } catch (error) {
            result = {
                blocked: false,
                reason: String(error?.message || error || '').trim(),
                source: 'spambot_error'
            };
        }

        this.spamBlockCache.set(cacheKey, {
            checkedAt: now,
            result
        });

        return result;
    }

    async inspectAccountHealth(client, options = {}) {
        const me = await client.getMe();
        if (!me) {
            return {
                status: 'expired',
                reason: 'Telegram не отдал профиль аккаунта.',
                details: buildHealthDetails({
                    session: 'dead',
                    restriction: 'unknown',
                    spambotState: 'not_checked'
                })
            };
        }

        if (me.deleted) {
            return { status: 'restricted', reason: 'Аккаунт удален или Telegram больше не считает его живым.' };
        }

        const restrictionReason = Array.isArray(me.restrictionReason)
            ? me.restrictionReason.map(item => item?.text || item?.reason || '').filter(Boolean).join(' | ')
            : '';

        if (me.restricted || restrictionReason) {
            return {
                status: 'restricted',
                reason: restrictionReason || 'У аккаунта есть ограничения Telegram.',
                details: buildHealthDetails({
                    session: 'alive',
                    restriction: 'restricted',
                    restrictionReason: restrictionReason || 'У аккаунта есть ограничения Telegram.',
                    spambotState: 'not_checked'
                })
            };
        }

        if (me.scam || me.fake) {
            return {
                status: 'restricted',
                reason: 'Telegram пометил аккаунт как подозрительный.',
                details: buildHealthDetails({
                    session: 'alive',
                    restriction: 'restricted',
                    restrictionReason: 'Telegram пометил аккаунт как подозрительный.',
                    spambotState: 'not_checked'
                })
            };
        }

        const spamBlock = await this.inspectSpamBlockStatus(client, {
            userbotId: options.userbotId || null,
            force: options.forceSpamCheck === true,
            activeProbe: options.activeSpamProbe === true
        });
        if (spamBlock.blocked) {
            return {
                status: 'restricted',
                reason: spamBlock.reason || 'SpamBot подтвердил, что аккаунт ограничен Telegram.',
                details: buildHealthDetails({
                    session: 'alive',
                    restriction: 'restricted',
                    restrictionReason: spamBlock.reason || 'SpamBot подтвердил, что аккаунт ограничен Telegram.',
                    spambotState: 'blocked',
                    spambotReason: spamBlock.reason || '',
                    spambotSource: spamBlock.source || 'spambot'
                })
            };
        }

        return {
            status: 'online',
            reason: 'Аккаунт живой, сессия отвечает.',
            details: buildHealthDetails({
                session: 'alive',
                restriction: 'clear',
                spambotState: spamBlock.source === 'spambot_error' ? 'error' : 'clear',
                spambotReason: spamBlock.reason || '',
                spambotSource: spamBlock.source || 'spambot'
            })
        };
    }

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

    /**
     * Snapshot of account health for external consumers.
     * Reads from DB runtime_status + cached SpamBot signal — does NOT connect to Telegram.
     */
    async getHealthSnapshot(userbot) {
        assertUserbotOperatable(userbot);
        const spamCached = this.spamBlockCache.get(String(userbot.id)) || null;
        const recentEvent = await this._lastTelegramEventFor(userbot.id);
        return {
            userbot_id: userbot.id,
            tg_username: userbot.tg_username || null,
            runtime_status: userbot.runtime_status || 'unknown',
            proxy_id: userbot.proxy_id || null,
            spambot_signal: spamCached?.result || null,
            spambot_checked_at: spamCached?.checkedAt ? new Date(spamCached.checkedAt).toISOString() : null,
            last_telegram_event: recentEvent
        };
    }

    /**
     * Enumerate dialogs the userbot is a member of.
     * Cursor payload: { offset_id: number } — opaque to clients.
     */
    async listDialogs(userbot, { limit = 50, cursor, type, search } = {}) {
        assertUserbotOperatable(userbot);
        const pageLimit = clampLimit(limit, 1, 100);
        const decoded = decodeCursor(cursor);
        const offsetId = decoded?.offset_id ? Number(decoded.offset_id) : undefined;

        const client = await this.createAuthorizedClient(userbot);
        try {
            const dialogs = await withTimeout(
                client.getDialogs({
                    limit: pageLimit + 1,           // fetch one extra to detect has_more
                    offsetId,
                    ...(search ? { search } : {})
                }),
                30_000,
                'listDialogs'
            );
            const hasMore = dialogs.length > pageLimit;
            const trimmed = dialogs.slice(0, pageLimit);
            const items = trimmed
                .map((d) => sanitizeDialog(d))
                .filter((d) => matchesDialogType(d, type));

            const nextOffsetId = hasMore && trimmed.length ? Number(trimmed[trimmed.length - 1]?.id) || null : null;
            return {
                dialogs: items,
                cursor: nextOffsetId ? encodeCursor({ offset_id: nextOffsetId }) : null,
                has_more: hasMore && items.length > 0
            };
        } catch (error) {
            throw await wrapTelegramError(this.supabase, userbot, error, 'listDialogs');
        } finally {
            await safeDisconnect(client);
        }
    }

    /**
     * Fetch messages from a chat with optional time-window filter.
     * Cursor payload: { offset_id } — GramJS standard pagination.
     */
    async fetchMessages(userbot, { chatId, since, until, limit = 50, cursor } = {}) {
        assertUserbotOperatable(userbot);
        const id = normalizeChatIdInput(chatId);
        const pageLimit = clampLimit(limit, 1, 200);
        const decoded = decodeCursor(cursor);
        const offsetId = decoded?.offset_id ? Number(decoded.offset_id) : undefined;
        const offsetDate = since ? Math.floor(new Date(since).getTime() / 1000) : undefined;

        const client = await this.createAuthorizedClient(userbot);
        try {
            const messages = await withTimeout(
                client.getMessages(id, {
                    limit: pageLimit + 1,
                    offsetId,
                    offsetDate,
                    ...(until ? { maxId: 0, minId: undefined } : {})
                }),
                30_000,
                'fetchMessages'
            );
            const filtered = until
                ? messages.filter((m) => {
                    if (!m?.date) return true;
                    const ts = m.date instanceof Date ? m.date.getTime() : new Date(m.date).getTime();
                    return ts <= new Date(until).getTime() + 1000;
                })
                : messages;
            const hasMore = filtered.length > pageLimit;
            const trimmed = filtered.slice(0, pageLimit);
            const items = trimmed.map((m) => sanitizeMessage(m)).filter(Boolean);

            const nextOffsetId = hasMore && trimmed.length ? Number(trimmed[trimmed.length - 1]?.id) || null : null;
            return {
                messages: items,
                cursor: nextOffsetId ? encodeCursor({ offset_id: nextOffsetId }) : null,
                has_more: hasMore && items.length > 0
            };
        } catch (error) {
            throw await wrapTelegramError(this.supabase, userbot, error, 'fetchMessages');
        } finally {
            await safeDisconnect(client);
        }
    }

    /**
     * Server-side text search within a chat.
     */
    async searchMessages(userbot, { chatId, query, limit = 50, cursor } = {}) {
        assertUserbotOperatable(userbot);
        const id = normalizeChatIdInput(chatId);
        const pageLimit = clampLimit(limit, 1, 200);
        const decoded = decodeCursor(cursor);
        const offsetId = decoded?.offset_id ? Number(decoded.offset_id) : undefined;

        const client = await this.createAuthorizedClient(userbot);
        try {
            const messages = await withTimeout(
                client.getMessages(id, {
                    limit: pageLimit + 1,
                    offsetId,
                    search: String(query || '')
                }),
                30_000,
                'searchMessages'
            );
            const hasMore = messages.length > pageLimit;
            const trimmed = messages.slice(0, pageLimit);
            const items = trimmed.map((m) => sanitizeMessage(m)).filter(Boolean);
            const nextOffsetId = hasMore && trimmed.length ? Number(trimmed[trimmed.length - 1]?.id) || null : null;
            return {
                messages: items,
                cursor: nextOffsetId ? encodeCursor({ offset_id: nextOffsetId }) : null,
                has_more: hasMore && items.length > 0
            };
        } catch (error) {
            throw await wrapTelegramError(this.supabase, userbot, error, 'searchMessages');
        } finally {
            await safeDisconnect(client);
        }
    }

    /**
     * List participants of a chat/group/channel.
     * GramJS server-side filter only for some classes; client-side filter for others.
     * Hard cap at 5000 to bound cost.
     */
    async listParticipants(userbot, { chatId, limit = 100, cursor } = {}) {
        assertUserbotOperatable(userbot);
        const id = normalizeChatIdInput(chatId);
        const pageLimit = clampLimit(limit, 1, 200);
        const decoded = decodeCursor(cursor);
        const offset = decoded?.offset ? Number(decoded.offset) : 0;
        const HARD_CAP = 5000;
        const effectiveOffset = Math.min(offset, HARD_CAP);

        const client = await this.createAuthorizedClient(userbot);
        try {
            const result = await withTimeout(
                client.getParticipants(id, {
                    limit: pageLimit + 1,
                    offset: effectiveOffset,
                    search: ''
                }),
                30_000,
                'listParticipants'
            );
            const list = Array.isArray(result) ? result : (result?.users || result?.participants || []);
            const hasMore = list.length > pageLimit && (effectiveOffset + pageLimit) < HARD_CAP;
            const trimmed = list.slice(0, pageLimit);
            const items = trimmed.map((p) => sanitizeParticipant(p));
            const nextOffset = hasMore ? effectiveOffset + trimmed.length : null;
            return {
                participants: items,
                cursor: nextOffset ? encodeCursor({ offset: nextOffset }) : null,
                has_more: hasMore
            };
        } catch (error) {
            throw await wrapTelegramError(this.supabase, userbot, error, 'listParticipants');
        } finally {
            await safeDisconnect(client);
        }
    }

    /**
     * Send a text message. For DMs (chatId > 0), respects USERBOT_DM_ENABLED flag
     * and uses resolveDirectMessageTarget for peer resolution.
     */
    async sendTextMessage(userbot, { chatId, text, replyToMessageId } = {}) {
        assertUserbotOperatable(userbot);
        const id = normalizeChatIdInput(chatId);
        const body = String(text || '');
        if (!body) {
            throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "text" is required and must be non-empty.', {});
        }

        const chatIdNum = Number(id);
        const isDm = Number.isFinite(chatIdNum) && chatIdNum > 0;
        if (isDm && String(process.env.USERBOT_DM_ENABLED || '').trim().toLowerCase() !== 'true') {
            throw new MCPError(
                ERROR_CODES.DM_DISABLED,
                'Direct messages are disabled on this server. Set USERBOT_DM_ENABLED=true to enable.',
                { auditStatus: 'error' }
            );
        }

        const client = await this.createAuthorizedClient(userbot);
        try {
            const target = isDm
                ? await this.resolveDirectMessageTarget(client, userbot, chatIdNum, {})
                : id;

            const sent = await withTimeout(
                client.sendMessage(target, {
                    message: body,
                    ...(replyToMessageId ? { replyTo: Number(replyToMessageId) } : {})
                }),
                30_000,
                'sendTextMessage'
            );
            return {
                message_id: String(sent?.id || ''),
                date: sent?.date ? normalizeTelegramDate(sent.date) : null
            };
        } catch (error) {
            throw await wrapTelegramError(this.supabase, userbot, error, 'sendTextMessage');
        } finally {
            await safeDisconnect(client);
        }
    }

    async leaveChat(userbot, { chatId } = {}) {
        assertUserbotOperatable(userbot);
        const id = normalizeChatIdInput(chatId);
        if (!id) {
            throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "chat_id" is required.', {});
        }

        const client = await this.createAuthorizedClient(userbot);
        try {
            const entity = await withTimeout(
                client.getInputEntity(id),
                30_000,
                'leaveChat.resolveEntity'
            );
            if (entity instanceof Api.InputPeerChat) {
                // basic-группа: LeaveChannel не работает — выход = удалить себя из чата.
                // userId требует InputUser (InputPeerSelf сервер отклоняет по схеме TL) —
                // паттерн broadcast-membership-cleanup.job.js (DeleteChatUser + InputUserSelf).
                await withTimeout(
                    client.invoke(new Api.messages.DeleteChatUser({
                        chatId: entity.chatId,
                        userId: new Api.InputUserSelf()
                    })),
                    30_000,
                    'leaveChat.deleteChatUser'
                );
                return { success: true, chat_id: String(id) };
            }
            await withTimeout(
                client.invoke(new Api.channels.LeaveChannel({ channel: entity })),
                30_000,
                'leaveChat.leaveChannel'
            );
            return { success: true, chat_id: String(id) };
        } catch (error) {
            throw await wrapTelegramError(this.supabase, userbot, error, 'leaveChat');
        } finally {
            await safeDisconnect(client);
        }
    }

    async joinChatByInvite(userbot, { inviteLink } = {}) {
        assertUserbotOperatable(userbot);
        const raw = String(inviteLink || '').trim();
        if (!raw) {
            throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "invite_link" is required.', {});
        }
        const parsed = parseTelegramInviteLink(raw);
        if (!parsed) {
            throw new MCPError(
                ERROR_CODES.INVALID_PARAMS,
                'Unsupported invite link. Use t.me/+hash, t.me/joinchat/hash, t.me/username, or @username.',
                {}
            );
        }
        if (parsed.kind === 'private_permalink') {
            throw new MCPError(
                ERROR_CODES.INVALID_PARAMS,
                't.me/c/<id> private permalinks cannot be joined directly. Need an invite hash (t.me/+hash or t.me/joinchat/hash).',
                {}
            );
        }

        const client = await this.createAuthorizedClient(userbot);
        try {
            let title = null;
            let chatId = null;
            let accessHash = null;
            let kind = parsed.kind === 'username' ? 'channel' : 'group';

            if (parsed.kind === 'invite_hash') {
                const result = await withTimeout(
                    client.invoke(new Api.messages.ImportChatInvite({ hash: parsed.value })),
                    30_000,
                    'joinChatByInvite.importInvite'
                );
                const chat = result?.chats?.[0] || null;
                title = chat?.title || null;
                chatId = chat?.id ? String(chat.id) : null;
                accessHash = chat?.accessHash != null ? String(chat.accessHash) : null;
                kind = chat?.className === 'Channel' ? 'channel' : 'group';
            } else {
                const entity = await withTimeout(
                    client.getEntity(parsed.value),
                    30_000,
                    'joinChatByInvite.resolveEntity'
                );
                await withTimeout(
                    client.invoke(new Api.channels.JoinChannel({ channel: entity })),
                    30_000,
                    'joinChatByInvite.joinChannel'
                );
                title = entity?.title || entity?.username || null;
                chatId = entity?.id ? String(entity.id) : null;
                accessHash = entity?.accessHash != null ? String(entity.accessHash) : null;
                kind = entity?.className === 'Channel' ? 'channel' : 'group';
            }

            return {
                chat_id: chatId,
                access_hash: accessHash,
                title,
                kind
            };
        } catch (error) {
            throw await wrapTelegramError(this.supabase, userbot, error, 'joinChatByInvite');
        } finally {
            await safeDisconnect(client);
        }
    }

    // ============================================================
    // Волна 1 userbot-ops: жизненный цикл группы/бота (план 2026-09-17).
    // Все имена Api.* сверены с node_modules/telegram/tl/api.d.ts (telegram 2.26.22).
    // Каждый метод: assertUserbotOperatable → флаг-гейт → createAuthorizedClient →
    // try → finally safeDisconnect → wrapTelegramError.
    // ============================================================

    /**
     * Создать группу или канал, где юзербот — владелец. Сразу выпускает invite-ссылку.
     * GramJS: channels.CreateChannel({ megagroup | broadcast, title, about }) →
     * result.chats[0] (Api.Channel: id/accessHash/title) → messages.ExportChatInvite({ peer }).
     */
    async createGroupChat(userbot, { title, kind = 'group', about = '' } = {}) {
        assertUserbotOperatable(userbot);
        assertFeatureEnabled('USERBOT_GROUP_ADMIN_ENABLED', 'Создание групп/каналов юзерботом');

        const titleStr = String(title || '').trim();
        if (!titleStr || titleStr.length > 128) {
            throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "title" is required (1-128 chars).', {});
        }
        const isChannel = String(kind || 'group') === 'channel';
        const aboutStr = String(about || '').trim().slice(0, 255);

        const client = await this.createAuthorizedClient(userbot);
        try {
            const result = await withTimeout(
                client.invoke(new Api.channels.CreateChannel({
                    title: titleStr,
                    about: aboutStr,
                    megagroup: !isChannel,
                    broadcast: isChannel
                })),
                30_000,
                'createGroupChat.createChannel'
            );
            const chat = result?.chats?.[0] || null;
            if (!chat?.id) {
                throw new MCPError(
                    ERROR_CODES.TELEGRAM_ERROR,
                    'Telegram не вернул созданный чат в ответе CreateChannel.',
                    { auditStatus: 'telegram_error' }
                );
            }

            const peer = new Api.InputPeerChannel({
                channelId: BigInt(String(chat.id)),
                accessHash: BigInt(String(chat.accessHash ?? '0'))
            });
            const exported = await withTimeout(
                client.invoke(new Api.messages.ExportChatInvite({ peer })),
                30_000,
                'createGroupChat.exportInvite'
            );

            console.log('[UserbotService] createGroupChat: создан чат:', {
                userbot_id: userbot.id,
                chat_id: String(chat.id),
                kind: isChannel ? 'channel' : 'group',
                title: chat.title || titleStr
            });

            // Bot API-формат: для супергрупп/каналов id маркируется префиксом -100.
            // Голый MTProto-id Bot API не находит («chat not found») — а именно Bot API
            // публикует автопост-бот. Invite/promote резолвят оба формата через getEntity.
            const botApiChatId = `-100${chat.id}`;

            return {
                chat_id: botApiChatId,
                mtproto_id: String(chat.id),
                access_hash: chat?.accessHash != null ? String(chat.accessHash) : null,
                title: chat?.title || titleStr,
                invite_link: exported?.link || null
            };
        } catch (error) {
            throw await wrapTelegramError(this.supabase, userbot, error, 'createGroupChat');
        } finally {
            await safeDisconnect(client);
        }
    }

    /**
     * Пригласить участников в группу/канал по одному, чтобы отказ одному не ронял остальных.
     * GramJS: channels.InviteToChannel({ channel, users: [entity] }).
     */
    async inviteGroupMembers(userbot, { chatId, members } = {}) {
        assertUserbotOperatable(userbot);
        assertFeatureEnabled('USERBOT_GROUP_ADMIN_ENABLED', 'Приглашение участников юзерботом');

        const id = normalizeChatIdInput(chatId);
        const rawMembers = Array.isArray(members) ? members : [];
        if (rawMembers.length === 0) {
            throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "members" must be a non-empty array of @usernames.', {});
        }
        const usernames = rawMembers.map((raw) => {
            const value = String(raw || '').trim();
            if (!/^@?[A-Za-z0-9_]{4,32}$/.test(value)) {
                throw new MCPError(
                    ERROR_CODES.INVALID_PARAMS,
                    `member "${value}" is not a valid @username.`,
                    {}
                );
            }
            return `@${value.replace(/^@/, '')}`;
        });

        const client = await this.createAuthorizedClient(userbot);
        try {
            const channel = await this.resolveChatPeer(client, id);
            const results = [];
            for (let i = 0; i < usernames.length; i++) {
                const username = usernames[i];
                try {
                    const user = await withTimeout(
                        client.getEntity(username),
                        30_000,
                        'inviteGroupMembers.resolveUser'
                    );
                    await withTimeout(
                        client.invoke(new Api.channels.InviteToChannel({ channel, users: [user] })),
                        30_000,
                        'inviteGroupMembers.invite'
                    );
                    results.push({ member: username, status: 'ok', error: null });
                } catch (memberError) {
                    const rawError = String(memberError?.errorMessage || memberError?.message || memberError);
                    // USER_ALREADY_PARTICIPANT — участник уже в чате, это не провал операции.
                    if (rawError.toUpperCase().includes('USER_ALREADY_PARTICIPANT')) {
                        results.push({ member: username, status: 'already', error: null });
                    } else {
                        results.push({
                            member: username,
                            status: 'failed',
                            error: rawError.slice(0, 300)
                        });
                    }
                }
                // Пауза между инвайтами (кроме последнего) — Telegram не любит серию InviteToChannel.
                if (i < usernames.length - 1) {
                    await new Promise((resolve) => setTimeout(resolve, 1000));
                }
            }
            return { results };
        } catch (error) {
            throw await wrapTelegramError(this.supabase, userbot, error, 'inviteGroupMembers');
        } finally {
            await safeDisconnect(client);
        }
    }

    /**
     * Назначить/разжать админа в группе или канале.
     * Права сверяются с api.d.ts (telegram 2.26.22): Api.ChatAdminRights —
     * changeInfo/postMessages/editMessages/deleteMessages/banUsers/inviteUsers/
     * pinMessages/addAdmins/anonymous/manageCall/other/manageTopics/... —
     * Bot-API-имена (canManageChat/canPromoteMembers) в MTProto отсутствуют:
     * право «назначать админов» = addAdmins.
     */
    async promoteGroupMember(userbot, { chatId, member, rights = 'all' } = {}) {
        assertUserbotOperatable(userbot);
        assertFeatureEnabled('USERBOT_GROUP_ADMIN_ENABLED', 'Назначение админов юзерботом');

        const id = normalizeChatIdInput(chatId);
        const memberStr = String(member || '').trim();
        if (!memberStr) {
            throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "member" is required.', {});
        }
        const preset = PROMOTE_ADMIN_RIGHTS_PRESETS[rights];
        if (!preset) {
            throw new MCPError(
                ERROR_CODES.INVALID_PARAMS,
                'Argument "rights" must be one of: all, post_only, revoke.',
                {}
            );
        }

        const client = await this.createAuthorizedClient(userbot);
        try {
            const channel = await this.resolveChatPeer(client, id);

            // Свои права: GetParticipant(channel, InputPeerSelf) — паттерн chat-admin-rights.service.js.
            const self = await withTimeout(
                client.invoke(new Api.channels.GetParticipant({
                    channel,
                    participant: new Api.InputPeerSelf()
                })),
                30_000,
                'promoteGroupMember.getSelf'
            );
            const selfRights = self?.participant?.adminRights;
            if (!selfRights || selfRights.addAdmins !== true) {
                throw new MCPError(
                    ERROR_CODES.FORBIDDEN,
                    'У юзербота нет прав назначать админов в этом чате.',
                    {}
                );
            }

            const targetUser = await this.resolveMemberInputUser(client, channel, memberStr);
            await withTimeout(
                client.invoke(new Api.channels.EditAdmin({
                    channel,
                    userId: targetUser,
                    adminRights: new Api.ChatAdminRights(preset),
                    rank: ''
                })),
                30_000,
                'promoteGroupMember.editAdmin'
            );

            return { chat_id: String(id), member: memberStr, rights };
        } catch (error) {
            throw await wrapTelegramError(this.supabase, userbot, error, 'promoteGroupMember');
        } finally {
            await safeDisconnect(client);
        }
    }

    /**
     * Выпустить свежую invite-ссылку или отозвать: конкретную (аргумент link)
     * либо текущую основную (revoke=true без link — достаём её из
     * channels.GetFullChannel → fullChat.exportedInvite.link, затем
     * messages.EditExportedChatInvite({ peer, link, revoked: true })).
     * Паттерн contour-admin-rights.service.js.
     */
    async exportGroupInviteLink(userbot, { chatId, link = null, revoke = false } = {}) {
        assertUserbotOperatable(userbot);
        assertFeatureEnabled('USERBOT_GROUP_ADMIN_ENABLED', 'Инвайт-ссылки юзерботом');

        const id = normalizeChatIdInput(chatId);
        const linkStr = link != null ? String(link).trim() : '';

        const client = await this.createAuthorizedClient(userbot);
        try {
            const peer = await this.resolveChatPeer(client, id);

            if (revoke && linkStr) {
                await withTimeout(
                    client.invoke(new Api.messages.EditExportedChatInvite({
                        peer,
                        link: linkStr,
                        revoked: true
                    })),
                    30_000,
                    'exportGroupInviteLink.revoke'
                );
                return { chat_id: String(id), revoked: true, invite_link: null };
            }

            if (revoke) {
                const full = await withTimeout(
                    client.invoke(new Api.channels.GetFullChannel({ channel: peer })),
                    30_000,
                    'exportGroupInviteLink.full'
                );
                const currentLink = full?.fullChat?.exportedInvite?.link || null;
                if (!currentLink) {
                    throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'У группы нет активной ссылки-инвайта', {});
                }
                await withTimeout(
                    client.invoke(new Api.messages.EditExportedChatInvite({
                        peer,
                        link: currentLink,
                        revoked: true
                    })),
                    30_000,
                    'exportGroupInviteLink.revokeCurrent'
                );
                return { chat_id: String(id), revoked: true, invite_link: null };
            }

            const exported = await withTimeout(
                client.invoke(new Api.messages.ExportChatInvite({ peer })),
                30_000,
                'exportGroupInviteLink.export'
            );
            return {
                chat_id: String(id),
                revoked: false,
                invite_link: exported?.link || null
            };
        } catch (error) {
            throw await wrapTelegramError(this.supabase, userbot, error, 'exportGroupInviteLink');
        } finally {
            await safeDisconnect(client);
        }
    }

    /**
     * Создать бота через DM-диалог с @BotFather — ОДИН клиент на операцию,
     * никаких персистентных клиентов (правило плана). Флоу: /newbot → имя →
     * username → парс токена из ответа. DM-гейта нет — как у SpamBot-инспектора.
     * Гард от параллельного запуска на одном юзерботе (RATE_LIMITED) и
     * редакция токена из raw_reply.
     */
    async botFatherCreateBot(userbot, { botName, botUsername, stepTimeoutMs } = {}) {
        assertUserbotOperatable(userbot);
        assertFeatureEnabled('USERBOT_BOTFATHER_ENABLED', 'Создание ботов через BotFather');

        const inFlightKey = String(userbot.id);
        if (botFatherCreateBotInFlight.has(inFlightKey)) {
            throw new MCPError(ERROR_CODES.RATE_LIMITED, 'Создание бота для этого юзербота уже идёт', {});
        }
        botFatherCreateBotInFlight.set(inFlightKey, true);

        const name = String(botName || '').trim();
        if (!name || name.length > 64) {
            throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "bot_name" is required (1-64 chars).', {});
        }
        const username = String(botUsername || '').trim().toLowerCase().replace(/^@/, '');
        if (!username) {
            throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "bot_username" is required.', {});
        }

        const client = await this.createAuthorizedClient(userbot);
        try {
            const peer = await withTimeout(
                client.getInputEntity('botfather'),
                30_000,
                'botFatherCreateBot.resolvePeer'
            );
            // Baseline: id последнего сообщения в диалоге — ответы BotFather ищем строго выше его.
            const baseline = await withTimeout(
                client.getMessages(peer, { limit: 1 }),
                30_000,
                'botFatherCreateBot.baseline'
            );
            const baselineId = Number(baseline?.[0]?.id || 0);

            const sendStep = async (text, label) => {
                const sent = await withTimeout(
                    client.sendMessage(peer, { message: text }),
                    30_000,
                    `${label}.send`
                );
                const afterId = Math.max(Number(sent?.id || 0), baselineId);
                return waitForBotFatherReply(client, peer, afterId, stepTimeoutMs, label);
            };

            await sendStep('/newbot', 'botFatherCreateBot.step1');
            await sendStep(name, 'botFatherCreateBot.step2');
            const reply = await sendStep(username, 'botFatherCreateBot.step3');

            if (/taken|unavailable/i.test(reply)) {
                throw new MCPError(
                    ERROR_CODES.INVALID_PARAMS,
                    `BotFather отклонил username: ${reply.slice(0, 300)}`,
                    {}
                );
            }
            const token = parseBotFatherToken(reply);
            if (!token) {
                throw new MCPError(
                    ERROR_CODES.TELEGRAM_ERROR,
                    `BotFather ответил без токена: ${reply.slice(0, 300)}`,
                    { auditStatus: 'telegram_error' }
                );
            }

            console.log('[UserbotService] botFatherCreateBot: бот создан:', {
                userbot_id: userbot.id,
                bot_username: `@${username}`
            });

            return {
                bot_username: `@${username}`,
                bot_token: token,
                raw_reply: token ? reply.replace(token, '<redacted>') : reply.slice(0, 1000)
            };
        } catch (error) {
            throw await wrapTelegramError(this.supabase, userbot, error, 'botFatherCreateBot');
        } finally {
            botFatherCreateBotInFlight.delete(inFlightKey);
            await safeDisconnect(client);
        }
    }

    // ============================================================
    // Волна 2 userbot-ops: банальные операции с сообщениями/чатами.
    // Без флагов-kill-switch (необратимость delete закрыта явным confirm-ом
    // на уровне операции); peer резолвим волновским resolveChatPeer.
    // ============================================================

    /**
     * Отредактировать СВОЁ сообщение. Чужие Telegram отклоняет с
     * MESSAGE_EDIT_FORBIDDEN — маппится wrapTelegramError-ом.
     * GramJS: messages.EditMessage({ peer, id, message }).
     */
    async editSentMessage(userbot, { chatId, messageId, text } = {}) {
        assertUserbotOperatable(userbot);

        const id = normalizeChatIdInput(chatId);
        const textStr = String(text ?? '');
        if (!textStr.trim() || textStr.length > 4096) {
            throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "text" is required (1-4096 chars).', {});
        }
        const msgId = normalizeMessageIdInput(messageId);

        const client = await this.createAuthorizedClient(userbot);
        try {
            const peer = await this.resolveChatPeer(client, id);
            await withTimeout(
                client.invoke(new Api.messages.EditMessage({
                    peer,
                    id: msgId,
                    message: textStr
                })),
                30_000,
                'editSentMessage.edit'
            );
            return { chat_id: String(id), message_id: msgId, edited: true };
        } catch (error) {
            throw await wrapTelegramError(this.supabase, userbot, error, 'editSentMessage');
        } finally {
            await safeDisconnect(client);
        }
    }

    /**
     * Удалить сообщения безвозвратно (revoke). GramJS-хелпер client.deleteMessages
     * сам выбирает channels.DeleteMessages для каналов/супергрупп и
     * messages.DeleteMessages({ revoke }) для ЛС/базик-чатов (api.d.ts + client/messages.js).
     */
    async deleteSentMessages(userbot, { chatId, messageIds } = {}) {
        assertUserbotOperatable(userbot);

        const id = normalizeChatIdInput(chatId);
        const rawIds = Array.isArray(messageIds) ? messageIds : [];
        if (rawIds.length === 0) {
            throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "message_ids" must be a non-empty array of message IDs.', {});
        }
        // Хелпер принимает только числовые id (client/messages.js deleteMessages).
        const ids = rawIds.map(normalizeMessageIdInput);

        const client = await this.createAuthorizedClient(userbot);
        try {
            // Резолвим peer заранее: внутри хелпера getInputEntity без fallback на диалоги.
            const peer = await this.resolveChatPeer(client, id);
            await withTimeout(
                client.deleteMessages(peer, ids, { revoke: true }),
                60_000,
                'deleteSentMessages.delete'
            );
            console.log('[UserbotService] deleteSentMessages: удалено:', {
                userbot_id: userbot.id,
                chat_id: String(id),
                count: ids.length
            });
            return { chat_id: String(id), deleted: ids.length };
        } catch (error) {
            throw await wrapTelegramError(this.supabase, userbot, error, 'deleteSentMessages');
        } finally {
            await safeDisconnect(client);
        }
    }

    /**
     * Переслать сообщения в другой чат. GramJS: messages.ForwardMessages
     * ({ fromPeer, id, randomId, toPeer }). Конструктор сам автогенерирует
     * randomId, но мы задаём их явно — намеренно, ради дедупликации
     * и тестируемости (детерминированный инвариант в тестах).
     */
    async forwardSentMessages(userbot, { fromChatId, messageIds, toChatId } = {}) {
        assertUserbotOperatable(userbot);

        const fromId = normalizeChatIdInput(fromChatId);
        const toId = normalizeChatIdInput(toChatId);
        const rawIds = Array.isArray(messageIds) ? messageIds : [];
        if (rawIds.length === 0) {
            throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "message_ids" must be a non-empty array of message IDs.', {});
        }
        const ids = rawIds.map(normalizeMessageIdInput);

        const client = await this.createAuthorizedClient(userbot);
        try {
            const fromPeer = await this.resolveChatPeer(client, fromId);
            const toPeer = await this.resolveChatPeer(client, toId);
            await withTimeout(
                client.invoke(new Api.messages.ForwardMessages({
                    fromPeer,
                    id: ids,
                    randomId: ids.map(() => randomPositiveLong()),
                    toPeer
                })),
                30_000,
                'forwardSentMessages.forward'
            );
            return { to_chat_id: String(toId), forwarded: ids.length };
        } catch (error) {
            throw await wrapTelegramError(this.supabase, userbot, error, 'forwardSentMessages');
        } finally {
            await safeDisconnect(client);
        }
    }

    /**
     * Закрепить/открепить сообщение в чате.
     * GramJS: messages.UpdatePinnedMessage({ peer, id, unpin }).
     */
    async pinChatMessage(userbot, { chatId, messageId, unpin = false } = {}) {
        assertUserbotOperatable(userbot);

        const id = normalizeChatIdInput(chatId);
        const msgId = normalizeMessageIdInput(messageId);

        const client = await this.createAuthorizedClient(userbot);
        try {
            const peer = await this.resolveChatPeer(client, id);
            await withTimeout(
                client.invoke(new Api.messages.UpdatePinnedMessage({
                    peer,
                    id: msgId,
                    unpin: unpin === true
                })),
                30_000,
                'pinChatMessage.pin'
            );
            return { chat_id: String(id), message_id: msgId, pinned: !(unpin === true) };
        } catch (error) {
            throw await wrapTelegramError(this.supabase, userbot, error, 'pinChatMessage');
        } finally {
            await safeDisconnect(client);
        }
    }

    /**
     * Отметить чат прочитанным. markDialogAsRead не подходит — он резолвит
     * DM-адресата, а не произвольный чат. Peer-ветки по классу результата
     * getInputEntity: каналы/супергруппы — channels.ReadMessageContents по id
     * последнего сообщения (пустой канал размечать нечем), остальные —
     * messages.ReadHistory({ peer, maxId: MAX_INT }).
     */
    async markChatRead(userbot, { chatId } = {}) {
        assertUserbotOperatable(userbot);

        const id = normalizeChatIdInput(chatId);

        const client = await this.createAuthorizedClient(userbot);
        try {
            const peer = await this.resolveChatPeer(client, id);
            const className = String(peer?.className || '');
            const isChannelPeer = className === 'InputPeerChannel' || className === 'Channel';

            if (isChannelPeer) {
                const latest = await withTimeout(
                    client.getMessages(peer, { limit: 1 }),
                    30_000,
                    'markChatRead.latest'
                );
                const latestId = Number(latest?.[0]?.id || 0);
                if (latestId > 0) {
                    await withTimeout(
                        client.invoke(new Api.channels.ReadMessageContents({
                            channel: peer,
                            id: [latestId]
                        })),
                        30_000,
                        'markChatRead.readContents'
                    );
                }
            } else {
                await withTimeout(
                    client.invoke(new Api.messages.ReadHistory({
                        peer,
                        maxId: 2147483647
                    })),
                    30_000,
                    'markChatRead.readHistory'
                );
            }
            return { chat_id: String(id), read: true };
        } catch (error) {
            throw await wrapTelegramError(this.supabase, userbot, error, 'markChatRead');
        } finally {
            await safeDisconnect(client);
        }
    }

    /**
     * Резолв пользователя Telegram по @username или tg_user_id (ровно один).
     * Фундамент access_hash для invite/promote. GramJS: client.getEntity(...)
     * → Api.User: id/username/firstName/lastName/verified/accessHash.
     */
    async resolveTelegramUser(userbot, { username, tgUserId } = {}) {
        assertUserbotOperatable(userbot);

        const usernameStr = String(username ?? '').trim();
        const idStr = String(tgUserId ?? '').trim();
        if (Boolean(usernameStr) === Boolean(idStr)) {
            throw new MCPError(
                ERROR_CODES.INVALID_PARAMS,
                'Pass exactly one of "username" or "tg_user_id".',
                {}
            );
        }
        // Формат username проверяем до getEntity: Telegram отвечает на мусор
        // невнятной peer-ошибкой, лучше валить сразу.
        if (usernameStr && !/^@?[a-zA-Z0-9_]{4,32}$/.test(usernameStr)) {
            throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Некорректный username', {});
        }
        const lookup = usernameStr
            ? `@${usernameStr.replace(/^@/, '')}`
            : idStr;

        const client = await this.createAuthorizedClient(userbot);
        try {
            const entity = await withTimeout(
                client.getEntity(lookup),
                30_000,
                'resolveTelegramUser.getEntity'
            );
            if (entity?.id == null) {
                throw new MCPError(
                    ERROR_CODES.TELEGRAM_ERROR,
                    'Telegram не вернул профиль пользователя.',
                    { auditStatus: 'telegram_error' }
                );
            }
            return {
                id: String(entity.id),
                username: entity.username || null,
                first_name: entity.firstName || entity.first_name || null,
                last_name: entity.lastName || entity.last_name || null,
                verified: entity.verified === true,
                access_hash: entity.accessHash != null ? String(entity.accessHash) : ''
            };
        } catch (error) {
            throw await wrapTelegramError(this.supabase, userbot, error, 'resolveTelegramUser');
        } finally {
            await safeDisconnect(client);
        }
    }

    /**
     * Резолв peer чата: свежий клиент не знает peer по сырому id — при провале
     * ищем в диалогах по bare id (паттерн resolveChatEntity / broadcast-cleanup resolvePeer).
     * User-ветка тоже принимается: волна-2 операции должны работать и по DM-пирам.
     */
    async resolveChatPeer(client, chatId) {
        try {
            return await client.getInputEntity(chatId);
        } catch (error) {
            const dialogs = await withTimeout(
                client.getDialogs({ limit: 300 }),
                120_000,
                'resolveChatPeer.scanDialogs'
            );
            const bare = String(chatId).replace(/^-100/, '');
            const hit = (dialogs || []).find(dialog =>
                String(dialog?.id || '').replace(/^-100/, '') === bare &&
                (dialog?.entity?.className === 'Channel'
                    || dialog?.entity?.className === 'Chat'
                    || dialog?.entity?.className === 'User'));
            if (!hit?.entity) throw error;
            return hit.entity;
        }
    }

    /**
     * InputUser участника с access_hash: сначала getEntity, без access_hash —
     * getParticipants-скан чата (паттерн chat-admin-rights.service.js findPromoterUserbot).
     * В скане username сравниваем case-insensitively, id нормализуем —
     * у участников Telegram отдаёт bare id без '-100'/'-'.
     */
    async resolveMemberInputUser(client, channel, member) {
        const raw = String(member || '').trim();
        const isNumericId = /^-?\d+$/.test(raw);
        const lookup = isNumericId ? raw : `@${raw.replace(/^@/, '')}`;
        const bareId = isNumericId ? raw.replace(/^-100/, '').replace(/^-/, '') : null;
        const bareUsername = isNumericId ? null : raw.replace(/^@/, '').toLowerCase();

        if (!isNumericId) {
            try {
                const entity = await withTimeout(
                    client.getEntity(lookup),
                    30_000,
                    'resolveMemberInputUser.getEntity'
                );
                if (entity?.id != null && entity?.accessHash != null) {
                    return new Api.InputUser({
                        userId: BigInt(String(entity.id)),
                        accessHash: BigInt(String(entity.accessHash))
                    });
                }
            } catch {
                // нет access_hash через getEntity — пробуем скан участников
            }
        }

        const participants = await withTimeout(
            client.getParticipants(channel, { limit: 5000 }),
            120_000,
            'resolveMemberInputUser.scanParticipants'
        );
        const target = (participants || []).find(p =>
            (bareId != null && String(p?.id || '') === bareId)
            || (bareUsername != null && String(p?.username || '').toLowerCase() === bareUsername));
        if (target?.id != null && target?.accessHash != null) {
            return new Api.InputUser({
                userId: BigInt(String(target.id)),
                accessHash: BigInt(String(target.accessHash))
            });
        }

        throw new MCPError(
            ERROR_CODES.INVALID_PARAMS,
            `Не удалось найти участника ${raw} в этом чате. Участник должен состоять в чате, иначе Telegram не отдаёт access_hash.`,
            {}
        );
    }

    async _lastTelegramEventFor(userbotId) {
        if (!userbotId) return null;
        const { data } = await this.supabase
            .from('telegram_error_events')
            .select('event_type, error_code, error_message, created_at')
            .eq('userbot_id', userbotId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        return data || null;
    }
}

// ============================================================
// Local helpers — pure functions for Plan 01 Phase 4 userbot helpers
// ============================================================

// ============================================================
// Волна 1 userbot-ops: чистые хелперы (план 2026-09-17).
// ============================================================

// Флаги-kill-switch для опасных операций (дефолт false — доктрина userbot-флагов).
function assertFeatureEnabled(envName, featureLabel) {
    const enabled = String(process.env[envName] || '').trim().toLowerCase() === 'true';
    if (!enabled) {
        throw new MCPError(
            ERROR_CODES.TOOL_DISABLED,
            `${featureLabel}: операция выключена на этом сервере. Включи ${envName} в .env (true) и перезапусти backend.`,
            {}
        );
    }
}

// Токен бота из ответа BotFather: «123456789:AA...long-secret...».
export function parseBotFatherToken(rawValue = '') {
    const match = String(rawValue || '').match(/(\d{6,10}:[A-Za-z0-9_-]{30,})/);
    return match ? match[1] : null;
}

// Права для channels.EditAdmin. Имена флагов сверены с api.d.ts
// (telegram 2.26.22) class ChatAdminRights: changeInfo/postMessages/editMessages/
// deleteMessages/banUsers/inviteUsers/pinMessages/addAdmins/anonymous/manageCall/
// other/manageTopics/postStories/editStories/deleteStories. Bot-API-имена
// (canManageChat, canPromoteMembers) в MTProto-схеме отсутствуют: право
// «назначать админов» — это addAdmins. 'revoke' = пустые права (разжать).
const PROMOTE_ADMIN_RIGHTS_PRESETS = Object.freeze({
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

const BOTFATHER_STEP_TIMEOUT_MS = 20_000;

// Ин-флайт-гард botFatherCreateBot: параллельный вызов на одном юзерботе путает
// baseline и ответы шагов — второй запуск отклоняем, пока первый не дойдёт до finally.
const botFatherCreateBotInFlight = new Map();

function botFatherSleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Поллинг DM-диалога с BotFather: ждём ВХОДЯЩЕЕ сообщение с id > afterId (в GramJS
// custom Message нет поля incoming — входящие опознаём по флагу out === false,
// свои исходящие не берём). Таймаут шага — TELEGRAM_ERROR.
async function waitForBotFatherReply(client, peer, afterId, timeoutMs, label) {
    const timeout = Number(timeoutMs) > 0 ? Number(timeoutMs) : BOTFATHER_STEP_TIMEOUT_MS;
    const interval = Math.min(1500, Math.max(50, Math.floor(timeout / 4)));
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
        await botFatherSleep(interval);
        const messages = await withTimeout(
            client.getMessages(peer, { limit: 5 }),
            30_000,
            `${label}.poll`
        );
        const fresh = (messages || []).find(m => m?.out === false && Number(m?.id || 0) > afterId);
        if (fresh) {
            return String(fresh?.message || '').trim();
        }
    }

    throw new MCPError(
        ERROR_CODES.TELEGRAM_ERROR,
        'BotFather не ответил вовремя — повтори операцию чуть позже.',
        { auditStatus: 'telegram_error' }
    );
}

function parseTelegramInviteLink(rawValue = '') {
    const value = String(rawValue || '').trim();
    if (!value) return null;

    const stripped = value
        .replace(/^@/, '')
        .replace(/^(https?:\/\/)?t\.me\//i, '')
        .replace(/^(https?:\/\/)?telegram\.me\//i, '')
        .replace(/\/+$/, '')
        .trim();

    const plusMatch = value.match(/(?:https?:\/\/)?t\.me\/\+([A-Za-z0-9_-]+)/i)
        || value.match(/^@(?:joinchat)\+(.+)$/i);
    if (plusMatch) {
        return { kind: 'invite_hash', value: plusMatch[1] };
    }

    const joinchatMatch = value.match(/(?:https?:\/\/)?t\.me\/joinchat\/([A-Za-z0-9_-]+)/i);
    if (joinchatMatch) {
        return { kind: 'invite_hash', value: joinchatMatch[1] };
    }

    const sMatch = value.match(/(?:https?:\/\/)?t\.me\/s\/([A-Za-z0-9_]{5,})/i);
    if (sMatch) {
        return { kind: 'username', value: sMatch[1] };
    }

    const privatePermalinkMatch = value.match(/(?:https?:\/\/)?t\.me\/c\/(\d+)/i);
    if (privatePermalinkMatch) {
        return { kind: 'private_permalink', value: privatePermalinkMatch[1] };
    }

    const usernameFromUrlMatch = value.match(/(?:https?:\/\/)?t\.me\/([A-Za-z][A-Za-z0-9_]{4,})\/?$/i);
    if (usernameFromUrlMatch) {
        return { kind: 'username', value: usernameFromUrlMatch[1] };
    }

    if (!/\s/.test(value) && /^[A-Za-z][A-Za-z0-9_]{4,}$/.test(stripped)) {
        return { kind: 'username', value: stripped };
    }

    return null;
}

function assertUserbotOperatable(userbot) {
    if (!userbot?.id) {
        throw new MCPError(ERROR_CODES.NOT_FOUND, 'Userbot not found.', {});
    }
    if (userbot.account_type && userbot.account_type !== 'userbot') {
        throw new MCPError(ERROR_CODES.INVALID_PARAMS, `Account ${userbot.id} is not a userbot.`, {});
    }
    if (userbot.runtime_status === 'pending_activation') {
        throw new MCPError(
            ERROR_CODES.SAFE_MODE_BLOCKED,
            `Userbot ${userbot.id} is in safe-mode (pending_activation). Activate it at /userbot/accounts first.`,
            {}
        );
    }
    if (userbot.runtime_status === 'restricted') {
        throw new MCPError(
            ERROR_CODES.ACCOUNT_RESTRICTED,
            `Userbot ${userbot.id} is restricted by Telegram.`,
            {}
        );
    }
}

function clampLimit(value, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, Math.floor(n)));
}

function normalizeChatIdInput(value) {
    if (value == null) {
        throw new MCPError(ERROR_CODES.INVALID_PARAMS, 'Argument "chat_id" is required.', {});
    }
    const str = String(value).trim();
    if (!/^-?\d+$/.test(str)) {
        throw new MCPError(ERROR_CODES.INVALID_PARAMS, `chat_id "${str}" is not a valid Telegram chat ID.`, {});
    }
    return str;
}

// Волна 2 userbot-ops: id сообщения — положительное целое (GramJS ждёт int).
function normalizeMessageIdInput(value) {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) {
        throw new MCPError(ERROR_CODES.INVALID_PARAMS, `message_id "${value}" is not a valid Telegram message ID.`, {});
    }
    return n;
}

// Положительный 63-битный long для randomId в messages.ForwardMessages.
function randomPositiveLong() {
    return BigInt(`0x${crypto.randomBytes(8).toString('hex')}`) >> 1n;
}

async function safeDisconnect(client) {
    if (!client) return;
    try {
        await withTimeout(client.disconnect(), 5_000, 'client.disconnect');
    } catch (e) {
        console.error('[UserbotService] disconnect failed:', e.message);
    }
}

async function wrapTelegramError(supabase, userbot, error, operationName) {
    if (error instanceof MCPError) return error;
    let eventId = null;
    try {
        const recorded = await logTelegramErrorEvent(supabase, {
            userbot_id: userbot?.id,
            owner_id: userbot?.owner_id,
            event_type: 'external_tool_error',
            error_code: String(error?.errorMessage || error?.code || '').slice(0, 100) || null,
            error_message: String(error?.message || error || '').slice(0, 1000),
            source: operationName
        });
        eventId = recorded?.id || null;
    } catch (logErr) {
        console.error(`[UserbotService] ${operationName}: failed to log Telegram error:`, logErr.message);
    }
    const secondsMatch = String(error?.message || '').match(/(\d+)\s*(?:seconds|секунд)/i);
    const retryAfterSec = secondsMatch ? Number(secondsMatch[1]) : null;
    return new MCPError(
        ERROR_CODES.TELEGRAM_ERROR,
        `Telegram error in ${operationName}: ${error?.errorMessage || error?.message || 'unknown'}`,
        {
            auditStatus: 'telegram_error',
            telegramErrorEventId: eventId,
            retryAfterSec,
            details: { operation: operationName, event_id: eventId }
        }
    );
}

function matchesDialogType(dialog, type) {
    if (!type) return true;
    return dialog.kind === type;
}

function normalizeTelegramDate(value) {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'number') {
        const date = new Date(value * 1000);
        return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
