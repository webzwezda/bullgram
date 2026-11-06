// Стадия 2 разрезки монстра userbot.service.js (план §7.3b): методы перенесены из
// класса ДОСЛОВНО (тела/JSDoc/комментарии без изменений); this.* зовётся через
// цепочку прототипов mixin-композиции в services/userbot.service.js.
import { StringSession } from 'telegram/sessions/index.js';
import { encrypt } from '../../utils/crypto.js';
import sqlite3 from 'sqlite3';
import fs from 'fs/promises';
import os from 'os';
import { logger } from '../../utils/logger.js';

export const SessionParseMixin = (Base) => class extends Base {
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
            // err проходит через safeErr-сериализатор: SocksClientError.options
            // с userId/password прокси в лог не попадает (инцидент 2026-11-04).
            logger.error({ raw: raw.slice(0, 300), err: error }, '[GramJS _errorHandler]');
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
            this.validateSessionSqliteBuffer(header);
        } finally {
            await handle.close();
        }
    }

    // Проверка sqlite-заголовка прямо на буфере (intake пачек читает файлы в
    // память и не хочет писать их на диск). Общая логика с validateSessionSqliteFile.
    validateSessionSqliteBuffer(buffer) {
        if (!Buffer.isBuffer(buffer) || buffer.length <= 0) {
            throw new Error('Файл `.session` пустой или недоступен.');
        }
        if (buffer.toString('utf8', 0, 15) !== 'SQLite format 3') {
            throw new Error('Файл `.session` не похож на SQLite Telegram session.');
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

    async saveRecoverySource({
        accountId,
        ownerId,
        tgAccountId,
        sessionFilePath,
        sessionOriginalName,
        jsonFilePath = null,
        jsonOriginalName = null,
        fingerprint = null,
        sessionBuffer = null,
        jsonBuffer = null,
        tdataZipBuffer = null,
        tdataFilename = null,
        twoFaSecret = null,
        intakeBatchId = null
    }) {
        const resolvedSessionBuffer = Buffer.isBuffer(sessionBuffer) ? sessionBuffer : await fs.readFile(sessionFilePath);
        const normalizedFingerprint = this._normalizeFingerprint(fingerprint);

        let jsonBlob = null;
        if (jsonFilePath) {
            jsonBlob = await fs.readFile(jsonFilePath, 'utf8');
        } else if (Buffer.isBuffer(jsonBuffer) && jsonBuffer.length > 0) {
            jsonBlob = jsonBuffer.toString('utf8');
        }

        const payload = {
            owner_id: ownerId,
            account_id: accountId,
            tg_account_id: tgAccountId == null ? null : String(tgAccountId),
            source_type: 'session_bundle',
            session_filename: sessionOriginalName || 'sessionFile.session',
            session_blob_encrypted: encrypt(resolvedSessionBuffer.toString('base64')),
            json_filename: jsonOriginalName || null,
            json_blob_encrypted: jsonBlob ? encrypt(JSON.stringify(normalizedFingerprint)) : null,
            fingerprint: normalizedFingerprint,
            updated_at: new Date().toISOString(),
            last_restore_status: 'ready',
            last_restore_error: null
        };

        // Новые колонки попадают в апсерт только со значением: иначе повторный
        // импорт старым одиночным роутом затёр бы сохранённые tdata/2FA пачки.
        if (Buffer.isBuffer(tdataZipBuffer) && tdataZipBuffer.length > 0) {
            payload.tdata_blob_encrypted = encrypt(tdataZipBuffer.toString('base64'));
            payload.tdata_filename = tdataFilename || null;
        }
        if (twoFaSecret) {
            payload.two_fa_secret_encrypted = encrypt(twoFaSecret);
        }
        if (intakeBatchId) {
            payload.intake_batch_id = intakeBatchId;
        }

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
};
