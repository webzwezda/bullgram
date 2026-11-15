// tdata (Telegram Desktop) → сессия Bullgram: офлайновый конвертер для приёмки
// пачек. План: docs/plans/2026-11-15-intake-tdata-packs.md.
//
//   tdata/key_datas            TDF: соль32 → wrappedLocalKey → accountsInfo
//   tdata/D877F783D5D3EF8Cs    TDF: mtp-авторизация (blockId 0x4B) под localKey
//   (легаси: key_data внутри D877F783D5D3EF8C/*/ — v1 не поддерживаем)
//
// Байтовый формат и крипто — tdata-format.js. Сервис чистый и офлайновый:
// никаких коннектов к Telegram, никаких логов с ключевым материалом; наружу —
// понятные русские ошибки для оператора.
import sqlite3 from 'sqlite3';
import fs from 'node:fs/promises';
import os from 'node:os';
import { logger } from '../utils/logger.js';
import { TELEGRAM_DC_IPV4 } from './userbot/constants.js';
import {
    AUTH_KEY_SIZE,
    BeReader,
    TdataError,
    createLocalKey,
    decryptLocalBlob,
    readTdfContainer
} from './tdata-format.js';

const MTP_AUTHORIZATION_BLOCK_ID = 0x4b; // dbiMtpAuthorization = 75
const MAX_MTP_KEYS = 100;
// (userId<<32)|mainDcId == -1 в wide-формате tdesktop; после тега идут
// u64 userId + i32 dc (сверено с реальной папкой: блок 75 → ff×8 → id)
const WIDE_IDS_TAG = Buffer.from('ffffffffffffffff', 'hex');

// --- key_datas ---------------------------------------------------------------

// Возвращает { localKey, passcodeIndex } — какой из паролей подошёл.
export async function unwrapLocalKey(keyDatasPayload, passcodes) {
    const stream = new BeReader(keyDatasPayload);
    const salt = stream.readByteArray();
    if (!Buffer.isBuffer(salt) || salt.length !== 32) {
        throw new TdataError('tdata: соль key_datas повреждена.');
    }
    const wrappedLocalKey = stream.readByteArray();
    if (!Buffer.isBuffer(wrappedLocalKey) || wrappedLocalKey.length === 0) {
        throw new TdataError('tdata: локальный ключ спрятан под новым локальным пином (Argon2) — сними пин в Telegram Desktop и перезалей папку.');
    }
    for (let index = 0; index < passcodes.length; index += 1) {
        const candidate = Buffer.isBuffer(passcodes[index]) ? passcodes[index] : Buffer.from(String(passcodes[index] ?? ''), 'utf8');
        try {
            const localKey = decryptLocalBlob(wrappedLocalKey, await createLocalKey(salt, candidate));
            if (localKey.length !== AUTH_KEY_SIZE) continue;
            return { localKey, passcodeIndex: index };
        } catch {
            // не тот пароль — пробуем следующий
        }
    }
    throw new TdataError('tdata запаролен локальным пином: приложи к пачке заметку .txt с паролем или сними пин в Telegram Desktop.');
}

function parseAccountsInfo(payload) {
    const stream = new BeReader(payload);
    const count = stream.readInt32();
    if (count <= 0 || count > 8) {
        throw new TdataError('tdata: странный счётчик аккаунтов в key_datas.');
    }
    const indices = [];
    for (let i = 0; i < count; i += 1) indices.push(stream.readInt32());
    return indices;
}

// --- mtp-авторизация ---------------------------------------------------------

export function parseMtpAuthorization(payload) {
    const stream = new BeReader(payload);
    const blockId = stream.readInt32();
    if (blockId !== MTP_AUTHORIZATION_BLOCK_ID) {
        throw new TdataError('tdata: файл не является авторизацией (не тот block id).');
    }
    const serialized = stream.readByteArray();
    if (!Buffer.isBuffer(serialized) || serialized.length === 0) {
        throw new TdataError('tdata: пустая mtp-авторизация.');
    }
    const inner = new BeReader(serialized);
    let userId = inner.readInt32();
    let mainDcId = inner.readInt32();
    if (serialized.subarray(0, 8).equals(WIDE_IDS_TAG)) {
        inner.offset = 8;
        userId = Number(inner.readUInt64());
        mainDcId = inner.readInt32();
    }
    const count = inner.readInt32();
    if (count <= 0 || count > MAX_MTP_KEYS) {
        throw new TdataError('tdata: странный счётчик ключей в авторизации.');
    }
    const keys = [];
    for (let i = 0; i < count; i += 1) {
        const dcId = inner.readInt32();
        const authKey = inner.readRaw(AUTH_KEY_SIZE);
        keys.push({ dcId, authKey });
    }
    return { userId, mainDcId, keys };
}

// --- Сборка сессии ------------------------------------------------------------

// Та же упаковка, что extractSessionFromSqlite (session-parse.mixin.js):
// 263Б = dc(u8) | IPv4(4) | port(u16BE) | authKey(256) → '1' + base64
export function packSessionString(dcId, ipv4, port, authKey) {
    const octets = String(ipv4).split('.').map(Number);
    if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) {
        throw new TdataError('tdata: не удалось собрать адрес DC.');
    }
    const packed = Buffer.alloc(263);
    packed.writeUInt8(dcId, 0);
    octets.forEach((octet, i) => packed.writeUInt8(octet, 1 + i));
    packed.writeUInt16BE(port, 5);
    authKey.copy(packed, 7);
    return `1${packed.toString('base64')}`;
}

// Telethon-совместимый sqlite .session — реальный рабочий файл для покупателя
// (наш читатель берёт sessions.dc_id/server_address/port/auth_key).
// Файл с открытым auth key: личный каталог mkdtemp (0700) + безусловная уборка
// в finally — даже при падении INSERT ключ не остаётся в /tmp.
export async function buildSessionSqlite(dcId, ipv4, port, authKey) {
    const dir = await fs.mkdtemp(`${os.tmpdir()}/bullgram-tdata-`);
    const tempPath = `${dir}/session.sqlite`;
    const db = new sqlite3.Database(tempPath);
    try {
        await new Promise((resolve, reject) => {
            db.serialize(() => {
                db.run('CREATE TABLE version (version INTEGER PRIMARY KEY)');
                db.run(`CREATE TABLE sessions (
                    version INTEGER NOT NULL,
                    dc_id INTEGER NOT NULL,
                    server_address TEXT NOT NULL,
                    port INTEGER NOT NULL,
                    auth_key BLOB NOT NULL,
                    takeout_id INTEGER
                )`);
                db.run(`CREATE TABLE entities (
                    session_id INTEGER NOT NULL,
                    id INTEGER PRIMARY KEY,
                    hash INTEGER NOT NULL,
                    username TEXT,
                    phone TEXT,
                    name TEXT
                )`);
                db.run(`CREATE TABLE sent_files (
                    session_id INTEGER NOT NULL,
                    md5_prefix INTEGER NOT NULL,
                    file_size INTEGER NOT NULL,
                    type INTEGER NOT NULL,
                    id INTEGER NOT NULL,
                    hash INTEGER NOT NULL,
                    PRIMARY KEY(session_id, md5_prefix, file_size, type)
                )`);
                db.run(`CREATE TABLE update_state (
                    session_id INTEGER PRIMARY KEY,
                    pts INTEGER,
                    qts INTEGER,
                    date INTEGER,
                    seq INTEGER
                )`);
                db.run('INSERT INTO version (version) VALUES (7)');
                db.run('INSERT INTO sessions VALUES (1, ?, ?, ?, ?, NULL)', [dcId, ipv4, port, authKey], (err) => (err ? reject(err) : resolve()));
            });
        });
        return await fs.readFile(tempPath);
    } finally {
        await new Promise((resolve) => db.close(() => resolve()));
        await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
}

// --- Точка входа: файлы пачки → аккаунт ----------------------------------------

function isKeyDatas(entry) {
    const segments = String(entry.relPath || '').split('/').filter(Boolean);
    if (segments.length < 2 || segments[segments.length - 2].toLowerCase() !== 'tdata') return false;
    const name = String(entry.name || '').toLowerCase();
    return name === 'key_datas';
}

// files: [{ relPath, name, buffer }] — tdataEntries пачки из группировщика.
// passcodes: массив Buffer/строк, обычно ['', пароль из заметки].
export async function extractTdataAccount(files, passcodes = ['']) {
    const keyDatasEntry = files.filter(isKeyDatas);
    if (!keyDatasEntry.length && files.some((entry) => String(entry.name || '').toLowerCase() === 'key_data')) {
        throw new TdataError('Легаси-формат tdata (key_data из старого Telegram Desktop) не поддержан — перелогинь аккаунт в свежем Telegram Desktop и залей новую папку.');
    }
    if (keyDatasEntry.length > 1) {
        throw new TdataError('В пачке несколько файлов key_datas — похоже, слились две папки tdata; раздай аккаунтам свои папки.');
    }
    if (!keyDatasEntry.length) {
        throw new TdataError('В tdata нет файла key_datas внутри папки tdata — проверь целостность папки (новый формат Telegram Desktop).');
    }

    const keyDatas = readTdfContainer(keyDatasEntry[0].buffer);
    const keyStream = new BeReader(keyDatas.payload);
    keyStream.readByteArray(); // соль — unwrapLocalKey читает её сам
    keyStream.readByteArray(); // wrappedLocalKey — unwrapLocalKey расшифрует
    const accountsInfoBlob = keyStream.readByteArray();
    const { localKey, passcodeIndex } = await unwrapLocalKey(keyDatas.payload, passcodes);
    if (passcodeIndex > 0) {
        logger.info({ passcodeIndex }, '[tdata] ключ снят паролем из заметки');
    }
    if (!Buffer.isBuffer(accountsInfoBlob) || accountsInfoBlob.length === 0) {
        throw new TdataError('tdata: key_datas без списка аккаунтов — папка повреждена.');
    }
    const indices = parseAccountsInfo(decryptLocalBlob(accountsInfoBlob, localKey));
    if (indices.length !== 1) {
        throw new TdataError(`В этой папке tdata аккаунтов: ${indices.length} — раздай каждому свою папку и грузи по одной.`);
    }

    // mtp-авторизация: любой другой TDF-файл пачки, расшифровывающийся под
    // localKey с blockId 0x4B (это и новый D877F783D5D3EF8Cs, и легаси-файлы).
    const candidates = files.filter((entry) => entry !== keyDatasEntry[0]);
    const accounts = [];
    for (const entry of candidates) {
        try {
            const container = readTdfContainer(entry.buffer, { verifyMd5: false });
            const stream = new BeReader(container.payload);
            const blob = stream.readByteArray();
            if (!Buffer.isBuffer(blob) || blob.length === 0) continue;
            const payload = decryptLocalBlob(blob, localKey);
            accounts.push(parseMtpAuthorization(payload));
        } catch {
            // не mtp-файл (maps и прочее) — пропускаем
        }
    }
    if (accounts.length === 0) {
        throw new TdataError('В tdata не найден файл авторизации (mtp) — папка неполная, перезалей целиком.');
    }
    if (accounts.length > 1 || accounts[0].keys.length > 1) {
        throw new TdataError('В этой папке tdata несколько аккаунтов — раздай каждому свою папку и грузи по одной.');
    }

    const { userId, mainDcId, keys } = accounts[0];
    const mainKey = keys.find((k) => k.dcId === mainDcId);
    if (!mainKey) {
        throw new TdataError(`tdata: нет ключа для основного DC ${mainDcId} — папка повреждена.`);
    }
    const ipv4 = TELEGRAM_DC_IPV4[mainDcId];
    if (!ipv4) {
        throw new TdataError(`tdata: нестандартный DC ${mainDcId} — такой аккаунт не подключить.`);
    }

    const sessionString = packSessionString(mainDcId, ipv4, 443, mainKey.authKey);
    const sessionSqliteBuffer = await buildSessionSqlite(mainDcId, ipv4, 443, mainKey.authKey);
    return {
        userId,
        dcId: mainDcId,
        authKey: mainKey.authKey,
        sessionString,
        sessionSqliteBuffer
    };
}
