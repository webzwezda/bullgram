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

const FAILOVER_COOLDOWN_MS = 15 * 60 * 1000;

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
    bullrun_android_a52: Object.freeze({
        id: 'bullrun_android_a52',
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
    bullrun_android_redmi_note_11: Object.freeze({
        id: 'bullrun_android_redmi_note_11',
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
    bullrun_android_a34: Object.freeze({
        id: 'bullrun_android_a34',
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
    bullrun_iphone_13: Object.freeze({
        id: 'bullrun_iphone_13',
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
    bullrun_iphone_15_pro: Object.freeze({
        id: 'bullrun_iphone_15_pro',
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

const DEFAULT_QR_FINGERPRINT_PROFILE_ID = 'bullrun_android_a52';

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
        const tempPath = `${os.tmpdir()}/bullrun-restore-${Date.now()}-${Math.random().toString(16).slice(2)}.session`;
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
            authError: null
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
        await this.connectWithProxyFallback(client, userbot);
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
