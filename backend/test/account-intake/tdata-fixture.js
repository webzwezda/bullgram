// Шифрующая сторона tdata-формата для тестов приёмки: собирает валидные
// key_datas + mtp-авторизацию так, как их пишет Telegram Desktop (новый
// формат, wide-ids). Крипто-примитивы (createLocalKey/deriveAesKeyIv/IGE)
// берём из прод-сервиса — зеркальных реализаций крипты в тестах не держим.
// Дополнительно формат сверяется с реальной папкой Telegram Desktop
// (docs/plans/2026-11-15-intake-tdata-packs.md, §Верификация).
import { createHash, randomBytes } from 'node:crypto';
import { IGE } from 'teleproto/crypto/IGE.js';
import { createLocalKey, deriveAesKeyIv } from '../../services/tdata-format.js';

const TDF_MAGIC = Buffer.from('TDF$', 'latin1');
const APP_VERSION = 3004000; // версия Telegram Desktop из реального файла
const MTP_BLOCK_ID = 0x4b; // dbiMtpAuthorization
const WIDE_TAG = Buffer.alloc(8, 0xff);

function qba(bytes) {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(bytes.length, 0);
    return Buffer.concat([head, bytes]);
}

function i32(value) {
    const b = Buffer.alloc(4);
    b.writeInt32BE(value, 0);
    return b;
}

function i32le(value) {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(value >>> 0, 0);
    return b;
}

function u64(value) {
    const b = Buffer.alloc(8);
    b.writeBigUInt64BE(BigInt(value), 0);
    return b;
}

function tdf(payload) {
    const version = i32le(APP_VERSION);
    const md5 = createHash('md5')
        .update(payload)
        .update(i32le(payload.length))
        .update(version)
        .update(TDF_MAGIC)
        .digest();
    return Buffer.concat([TDF_MAGIC, version, payload, md5]);
}

// Зеркало decryptLocalBlob: [LE32 полн.длина][данные][нулевый паддинг] →
// [sha1[:16]][AES-256-IGE]; IGE.encryptIge сам не паддит — выравниваем заранее.
function encryptLocal(payload, key) {
    let full = Buffer.alloc(4 + payload.length);
    full.writeUInt32LE(full.length, 0);
    payload.copy(full, 4);
    if (full.length % 16 !== 0) {
        full = Buffer.concat([full, Buffer.alloc(16 - (full.length % 16))]);
    }
    const msgKey = createHash('sha1').update(full).digest().subarray(0, 16);
    const { aesKey, aesIv } = deriveAesKeyIv(key, msgKey);
    const ige = new IGE(aesKey, aesIv);
    try {
        return Buffer.concat([msgKey, ige.encryptIge(full)]);
    } finally {
        try { ige.dispose(); } catch {}
    }
}

// Собирает файлы одной tdata-папки (пути как из группировщика: <folder>/tdata/…).
// accountIndices.length > 1 или keyEntries.length > 1 — мультиаккаунтные кейсы.
// createLocalKey асинхронная (threadpool) — сборка тоже async.
export async function buildTdataFiles({
    folder = 'account-1',
    dcId = 2,
    userId = 777000111,
    authKey = randomBytes(256),
    passcode = '',
    accountIndices = [0],
    keyEntries = null,
    localKey = randomBytes(256),
    salt = randomBytes(32)
} = {}) {
    const passcodeKey = await createLocalKey(salt, Buffer.from(passcode, 'utf8'));

    // accountsInfo: счётчик + индексы + активный индекс
    const info = Buffer.concat([i32(accountIndices.length), ...accountIndices.map(i32), i32(accountIndices[0])]);
    const keyDatasPayload = Buffer.concat([
        qba(salt),
        qba(encryptLocal(localKey, passcodeKey)),
        qba(encryptLocal(info, localKey))
    ]);

    // mtp-авторизация: блок 75 → QByteArray → wide-ids + ключи + toDestroy=0
    const keys = keyEntries || [{ dcId, authKey }];
    const serialized = Buffer.concat([
        WIDE_TAG,
        u64(userId),
        i32(dcId),
        i32(keys.length),
        ...keys.flatMap((k) => [i32(k.dcId), k.authKey]),
        i32(0)
    ]);
    const mtpDescriptor = Buffer.concat([i32(MTP_BLOCK_ID), qba(serialized)]);

    return {
        files: [
            { relPath: `${folder}/tdata/key_datas`, name: 'key_datas', buffer: tdf(keyDatasPayload) },
            { relPath: `${folder}/tdata/D877F783D5D3EF8Cs`, name: 'D877F783D5D3EF8Cs', buffer: tdf(qba(encryptLocal(mtpDescriptor, localKey))) }
        ],
        authKey,
        localKey
    };
}
