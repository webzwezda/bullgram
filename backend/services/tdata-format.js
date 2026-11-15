// Байтовый формат и крипто tdata (Telegram Desktop). Эталон — opentele (порт
// tdesktop), сверено с реальной папкой; план: docs/plans/2026-11-15-intake-tdata-packs.md.
//
//   TDF-контейнер: "TDF$" + версия u32 LE (версия приложения) + payload +
//                  md5-трейлер 16Б (md5(payload + dataSize LE + version LE + magic));
//                  payload — QDataStream big-endian: [u32 BE len][bytes] (QByteArray)
//   LocalKey:       PBKDF2-HMAC-SHA512( sha512(salt‖passcode‖salt), salt,
//                  1 итерация без пина / 100000 с пином, 256Б)
//   Зашифр. блоб:   [16Б msgKey][AES-256-IGE], KDF старого MTProto на SHA1
//                  (x=8 для расшифровки); sha1(расшифр.)[:16] == msgKey;
//                  внутри — [dataLen u32 LE][данные][паддинг до 16]
//
// IGE берём из teleproto (crypto/IGE.js), PBKDF2/хеши — node:crypto.
// Примитивы экспортированы и для тест-фикстур (шифрующая сторона) — крипта
// живёт в одном месте, зеркальных реализаций в тестах не держим.
import { createHash, pbkdf2 as pbkdf2Callback } from 'node:crypto';
import { promisify } from 'node:util';
import { IGE } from 'teleproto/crypto/IGE.js';

const pbkdf2 = promisify(pbkdf2Callback);

export const TDF_MAGIC = Buffer.from('TDF$', 'latin1');
export const SALT_SIZE = 32;
export const AUTH_KEY_SIZE = 256;

export class TdataError extends Error {
    constructor(message) {
        super(message);
        this.name = 'TdataError';
    }
}

// --- QDataStream (big-endian) поверх TDF-payload ---------------------------

export class BeReader {
    constructor(buffer) {
        this.buffer = buffer;
        this.offset = 0;
    }

    get remaining() {
        return this.buffer.length - this.offset;
    }

    // QByteArray: u32 BE длина (0xFFFFFFFF = null) + байты
    readByteArray() {
        if (this.remaining < 4) throw new TdataError('tdata: обрыв данных в потоке.');
        const length = this.buffer.readUInt32BE(this.offset);
        this.offset += 4;
        if (length === 0xffffffff) return null;
        if (length > this.remaining) throw new TdataError('tdata: обрыв данных в потоке.');
        const bytes = this.buffer.subarray(this.offset, this.offset + length);
        this.offset += length;
        return bytes;
    }

    readInt32() {
        if (this.remaining < 4) throw new TdataError('tdata: обрыв данных в потоке.');
        const value = this.buffer.readInt32BE(this.offset);
        this.offset += 4;
        return value;
    }

    readUInt64() {
        if (this.remaining < 8) throw new TdataError('tdata: обрыв данных в потоке.');
        const value = this.buffer.readBigUInt64BE(this.offset);
        this.offset += 8;
        return value;
    }

    readRaw(count) {
        if (this.remaining < count) throw new TdataError('tdata: обрыв данных в потоке.');
        const bytes = this.buffer.subarray(this.offset, this.offset + count);
        this.offset += count;
        return bytes;
    }
}

// --- TDF-контейнер -----------------------------------------------------------

export function readTdfContainer(buffer, { verifyMd5 = true } = {}) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 24 || !buffer.subarray(0, 4).equals(TDF_MAGIC)) {
        throw new TdataError('tdata: файл не в формате TDF — папка повреждена или это не tdata.');
    }
    const version = buffer.readUInt32LE(4);
    const rest = buffer.subarray(8);
    const dataSize = rest.length - 16;
    if (dataSize <= 0) throw new TdataError('tdata: файл TDF пуст.');
    if (verifyMd5) {
        const expected = rest.subarray(dataSize);
        const actual = createHash('md5')
            .update(rest.subarray(0, dataSize))
            .update(Buffer.from([dataSize, dataSize >> 8, dataSize >> 16, dataSize >> 24]))
            .update(Buffer.from([version, version >> 8, version >> 16, version >> 24]))
            .update(TDF_MAGIC)
            .digest();
        if (!actual.equals(expected)) {
            throw new TdataError('tdata: контрольная сумма MD5 не сошлась — файл битый.');
        }
    }
    return { version, payload: rest.subarray(0, dataSize) };
}

// --- Крипто tdesktop ----------------------------------------------------------

// Асинхронная PBKDF2: 100k итераций (пин-путь) — это ~76мс блокировки
// event loop, приёмка живёт в основном API-процессе — уходим в threadpool.
export async function createLocalKey(salt, passcode) {
    if (!Buffer.isBuffer(salt) || salt.length !== SALT_SIZE) {
        throw new TdataError('tdata: соль ключа повреждена.');
    }
    const hashedPasscode = createHash('sha512').update(salt).update(passcode).update(salt).digest();
    const iterations = passcode.length === 0 ? 1 : 100000;
    return pbkdf2(hashedPasscode, salt, iterations, 256, 'sha512');
}

// KDF старого MTProto (prepareAES_oldmtp, x=8 для расшифровки) — SHA1-сборка
export function deriveAesKeyIv(authKey, msgKey) {
    const x = 8;
    const sha1 = (parts) => createHash('sha1').update(Buffer.concat(parts)).digest();
    const a = sha1([msgKey, authKey.subarray(x, x + 32)]);
    const b = sha1([authKey.subarray(x + 32, x + 48), msgKey, authKey.subarray(x + 48, x + 64)]);
    const c = sha1([authKey.subarray(x + 64, x + 96), msgKey]);
    const d = sha1([msgKey, authKey.subarray(x + 96, x + 128)]);
    return {
        aesKey: Buffer.concat([a.subarray(0, 8), b.subarray(8, 20), c.subarray(4, 16)]),
        aesIv: Buffer.concat([a.subarray(8, 20), b.subarray(0, 8), c.subarray(16, 20), d.subarray(0, 8)])
    };
}

// Блоб tdesktop: [16Б msgKey][IGE-шифртекст]; внутри — [dataLen LE][данные][паддинг]
export function decryptLocalBlob(encrypted, key) {
    if (!Buffer.isBuffer(encrypted) || encrypted.length <= 16 || encrypted.length % 16 !== 0) {
        throw new TdataError('tdata: повреждённый зашифрованный блоб.');
    }
    const msgKey = encrypted.subarray(0, 16);
    const cipherText = encrypted.subarray(16);
    const { aesKey, aesIv } = deriveAesKeyIv(key, msgKey);
    const ige = new IGE(aesKey, aesIv);
    let decrypted;
    try {
        decrypted = ige.decryptIge(cipherText);
    } finally {
        try { ige.dispose(); } catch {}
    }
    if (!createHash('sha1').update(decrypted).digest().subarray(0, 16).equals(msgKey)) {
        throw new TdataError('tdata: SHA1-проверка не сошлась — неверный ключ (пин?).');
    }
    const dataLen = decrypted.readUInt32LE(0);
    const fullLen = decrypted.length;
    if (dataLen < 4 || dataLen > fullLen || dataLen <= fullLen - 16) {
        throw new TdataError('tdata: повреждённый блоб (длина данных).');
    }
    return decrypted.subarray(4, dataLen);
}
