// Приёмка пачек аккаунтов (account shop intake, Wave 1).
// Единственный парсер пачек: «поменял в одном месте — изменилось везде».
// Пачка = <basename>.session + <basename>.json + опционально <basename>/tdata/
// + опционально текстовая заметка с паролем 2FA (CP1251/utf8).
// Всё in-memory, без Telegram: sqlite/json-парсинг делегируем userbotService,
// здесь только группировка файлов, распаковка zip и разбор заметок.
import fs from 'fs';
import AdmZip from 'adm-zip';

const MAX_EXPANDED_ENTRIES = 400;
const MAX_EXPANDED_TOTAL_BYTES = 200 * 1024 * 1024;

// --- базовые нормализации -------------------------------------------------

export function stripExtension(name) {
    return String(name || '').replace(/\.[^.]+$/, '');
}

// Ключ сравнения basename: убираем '+', оставляем только цифры — так
// '+79991234567', '79991234567' и '7-999-123-45-67' склеиваются в одну пачку.
// Совсем без цифр — падаем на lowercase basename.
export function normalizePackKey(basename) {
    const raw = String(basename || '').trim();
    const digits = raw.replace(/\D+/g, '');
    return digits || raw.toLowerCase();
}

export function basenameOfPath(relPath) {
    const segments = String(relPath || '').split('/').map((part) => part.trim()).filter(Boolean);
    return segments[segments.length - 1] || String(relPath || '');
}

export function maskPhone(key) {
    const digits = String(key || '').replace(/\D+/g, '');
    if (digits.length < 6) {
        return `+${digits || key}`;
    }
    return `+${digits.slice(0, 2)}…${digits.slice(-3)}`;
}

function pathSegments(relPath) {
    return String(relPath || '').replace(/\\/g, '/').split('/').map((part) => part.trim()).filter(Boolean);
}

// Внутренний путь внутри tdata: «tdata/...» (сохраняем структуру при zip).
// Сегменты «..»/«.» вырезаем: путь уедет в blob и однажды будет распакован
// покупателем — traversal-сегменты в архиве недопустимы.
function innerTdataPath(relPath) {
    const segments = pathSegments(relPath);
    const index = segments.findIndex((segment) => segment.toLowerCase() === 'tdata');
    if (index === -1 || index === segments.length - 1) return null;
    return segments.slice(index).filter((segment) => segment !== '..' && segment !== '.').join('/');
}

// --- 1. normalizeEntries: multer-файлы + относительные пути → entries -----

export async function normalizeEntries(files = [], relPaths = []) {
    const paths = Array.isArray(relPaths) ? relPaths : [];
    const entries = [];
    let totalBytes = 0;
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!file?.path) continue;
        const relPath = String(paths[i] || file.originalname || basenameOfPath(file.originalname)).trim();
        const buffer = fs.readFileSync(file.path);
        totalBytes += buffer.length;
        if (totalBytes > MAX_EXPANDED_TOTAL_BYTES) {
            throw new Error(`Загрузка слишком большая (больше ${Math.round(MAX_EXPANDED_TOTAL_BYTES / 1024 / 1024)} МБ). Разбей её на части.`);
        }
        entries.push({
            relPath,
            name: basenameOfPath(relPath) || file.originalname || 'file',
            buffer
        });
    }
    return entries;
}

// --- 2. unpackZipEntries: разворачиваем zip, защищаемся от zip-bomb -------

export function unpackZipEntries(entries = []) {
    const result = [];
    let expandedCount = 0;
    let expandedBytes = 0;

    for (const entry of entries) {
        const name = String(entry.name || '');
        if (name.toLowerCase().endsWith('.zip')) {
            let zip;
            try {
                zip = new AdmZip(entry.buffer);
            } catch (error) {
                throw new Error(`Архив «${name}» поврежден или не читается как zip.`);
            }

            const scope = stripExtension(name);
            for (const zipEntry of zip.getEntries()) {
                if (zipEntry.isDirectory) continue;
                const innerPath = String(zipEntry.entryName || '').replace(/\\/g, '/');
                const lowerPath = innerPath.toLowerCase();
                if (lowerPath.endsWith('.zip') || lowerPath.endsWith('.rar')) {
                    throw new Error(`Внутри архива «${name}» лежит вложенный архив «${innerPath}». Распакуй всё вручную: приёмка принимает zip только одним уровнем.`);
                }
                result.push({
                    relPath: scope ? `${scope}/${innerPath}` : innerPath,
                    name: basenameOfPath(innerPath),
                    buffer: zipEntry.getData(),
                    scope
                });
                expandedCount += 1;
                expandedBytes += zipEntry.header.size;
                if (expandedCount > MAX_EXPANDED_ENTRIES) {
                    throw new Error(`В архиве слишком много файлов (больше ${MAX_EXPANDED_ENTRIES}). Разбей загрузку на части.`);
                }
                if (expandedBytes > MAX_EXPANDED_TOTAL_BYTES) {
                    throw new Error(`Распакованный архив слишком большой (больше ${Math.round(MAX_EXPANDED_TOTAL_BYTES / 1024 / 1024)} МБ). Разбей загрузку на части.`);
                }
            }
        } else {
            const segments = pathSegments(entry.relPath);
            const scope = segments.length > 1 ? segments[0] : null;
            result.push({ ...entry, scope });
        }
    }

    return result;
}

// --- 3. groupAccountPacks: собираем пачки из плоского списка файлов -------

// pack = { key, label, sessionEntry, jsonEntry, tdataEntries[], passwordEntry, scope }
export function groupAccountPacks(entries = []) {
    const sessions = [];
    const jsons = [];
    const tdatas = [];
    const texts = [];
    const rejects = [];

    for (const entry of entries) {
        const segments = pathSegments(entry.relPath);
        const tdataIndex = segments.findIndex((segment) => segment.toLowerCase() === 'tdata');
        if (tdataIndex !== -1 && tdataIndex < segments.length - 1) {
            tdatas.push({ entry, dirName: tdataIndex > 0 ? segments[tdataIndex - 1] : null });
            continue;
        }
        const lowerName = String(entry.name || '').toLowerCase();
        if (lowerName.endsWith('.session')) sessions.push(entry);
        else if (lowerName.endsWith('.json')) jsons.push(entry);
        else if (lowerName.endsWith('.txt')) texts.push(entry);
        else if (lowerName.endsWith('.rar') || lowerName.endsWith('.zip')) {
            rejects.push({
                name: entry.relPath,
                reason: 'Приёмка понимает только zip одним уровнем — распакуй архив и загрузи содержимое.'
            });
        }
        // прочий мусор (картинки, readme без .txt и т.п.) молча игнорируем
    }

    const packs = [];
    const packByKey = new Map();

    const packForEntry = (entry) => {
        const label = stripExtension(entry.name);
        const key = normalizePackKey(label);
        let pack = packByKey.get(key);
        if (!pack) {
            pack = { key, label, sessionEntry: null, jsonEntry: null, tdataEntries: [], passwordEntry: null, scope: entry.scope || null };
            packs.push(pack);
            packByKey.set(key, pack);
        }
        if (!pack.scope && entry.scope) pack.scope = entry.scope;
        return pack;
    };

    for (const entry of sessions) {
        const pack = packForEntry(entry);
        if (pack.sessionEntry) {
            rejects.push({ name: entry.relPath, reason: `Дубликат .session для пачки «${pack.label}» — оставлен первый файл, этот отброшен.` });
            continue;
        }
        pack.sessionEntry = entry;
    }

    for (const entry of jsons) {
        const pack = packForEntry(entry);
        if (pack.jsonEntry) {
            rejects.push({ name: entry.relPath, reason: `Дубликат .json для пачки «${pack.label}» — оставлен первый файл, этот отброшен.` });
            continue;
        }
        pack.jsonEntry = entry;
    }

    // Неполные пачки — reject с понятным действием, в обработку не идут.
    const completePacks = [];
    for (const pack of packs) {
        if (pack.sessionEntry && !pack.jsonEntry) {
            rejects.push({
                name: pack.label,
                reason: `У пачки «${pack.label}» есть .session, но нет .json с fingerprint. Доложи файл <имя>.json — без него импорт делать нельзя.`
            });
        } else if (!pack.sessionEntry && pack.jsonEntry) {
            rejects.push({
                name: pack.label,
                reason: `У пачки «${pack.label}» есть .json, но нет .session. Доложи файл <имя>.session — без него аккаунт не подключить.`
            });
        } else if (pack.sessionEntry && pack.jsonEntry) {
            completePacks.push(pack);
        }
    }

    const sameScope = (pack, scope) => Boolean(scope) && String(pack.scope || '').toLowerCase() === String(scope).toLowerCase();

    // tdata: сначала по имени ближайшей папки, иначе — если в scope ровно одна пачка.
    for (const { entry, dirName } of tdatas) {
        let pack = dirName ? packByKey.get(normalizePackKey(stripExtension(dirName))) : null;
        if (!completePacks.includes(pack)) pack = null;
        if (!pack) {
            const scopePacks = completePacks.filter((candidate) => sameScope(candidate, entry.scope));
            if (scopePacks.length === 1) pack = scopePacks[0];
        }
        if (pack) {
            pack.tdataEntries.push(entry);
        } else {
            rejects.push({ name: entry.relPath, reason: 'Файлы tdata не удалось привязать ни к одной пачке — переименуй папку под номер телефона или грузи одну пачку на архив.' });
        }
    }

    // Заметка с паролем: сначала scope (ровно одна пачка), иначе по basename.
    for (const entry of texts) {
        let pack = null;
        const scopePacks = completePacks.filter((candidate) => sameScope(candidate, entry.scope));
        if (scopePacks.length === 1) pack = scopePacks[0];
        if (!pack) {
            const byKey = packByKey.get(normalizePackKey(stripExtension(entry.name)));
            if (completePacks.includes(byKey)) pack = byKey;
        }
        if (pack) {
            if (!pack.passwordEntry) pack.passwordEntry = entry;
        } else {
            rejects.push({ name: entry.relPath, reason: 'Текстовый файл не удалось привязать ни к одной пачке — пропущен.' });
        }
    }

    return { packs: completePacks, rejects };
}

// --- 4. parseTwoFaPassword: пароль 2FA из текстовой заметки ---------------

// Однобайтовая карта CP1251 → Unicode (только то, что реально встречается в
// заметках: кириллица, ё/Ё, типографская пунктуация). Ручная таблица вместо
// зависимости iconv-lite.
const CP1251_MAP = (() => {
    const map = {};
    const put = (startCode, chars) => {
        for (let i = 0; i < chars.length; i++) map[startCode + i] = chars[i];
    };
    // 0x80–0x8F: Ѐ Ё Ђ Ѓ Є Ѕ І Ї Ј Љ Њ Ћ Ќ soft-hyphen Ў Џ
    put(0x80, '\u0400\u0401\u0402\u0403\u0404\u0405\u0406\u0407\u0408\u0409\u040A\u040B\u040C\u00AD\u040E\u040F');
    // 0x90–0x9F: А–П, 0xA0–0xAF: Р–Я
    put(0x90, 'АБВГДЕЖЗИЙКЛМНОП');
    put(0xA0, 'РСТУФХЦЧШЩЪЫЬЭЮЯ');
    // 0xB0–0xBF: NBSP Ў ў Ј ¤ Ґ ¦ § Ё © Є « ¬ soft-hyphen ® Ї °
    put(0xB0, '\u00A0\u040E\u045E\u0408\u00A4\u0490\u00A6\u00A7\u0401\u00A9\u0404\u00AB\u00AC\u00AD\u00AE\u0407\u00B0');
    return map;
})();

export function decodeCp1251(buffer) {
    let out = '';
    for (let i = 0; i < buffer.length; i++) {
        const byte = buffer[i];
        if (byte < 0x80) {
            out += String.fromCharCode(byte);
        } else if (byte >= 0xC0) {
            // 0xC0–0xFF — непрерывный диапазон А-я (U+0410–U+044F)
            out += String.fromCharCode(0x0410 + (byte - 0xC0));
        } else {
            out += CP1251_MAP[byte] || '\uFFFD';
        }
    }
    return out;
}

export function parseTwoFaPassword(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) return null;

    let text = buffer.toString('utf8');
    if (text.includes('\uFFFD')) {
        text = decodeCp1251(buffer);
    }

    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const passwordLines = lines.filter((line) => line.toLowerCase().includes('пароль'));
    if (!passwordLines.length) return null;

    // Берём последнюю строку с «пароль» и токен после последнего разделителя
    // («:», «—», «-», пробел) — фактически последнее слово строки.
    const tokens = passwordLines[passwordLines.length - 1].split(/[:\u2014\-\s]+/).filter(Boolean);
    const candidate = tokens[tokens.length - 1] || '';
    if (!candidate || candidate.length > 64) return null;
    return candidate;
}

// --- 5. zipTdataEntries: tdata обратно в zip с путями tdata/... -----------

export function zipTdataEntries(tdataEntries = []) {
    const zip = new AdmZip();
    for (const entry of tdataEntries) {
        const inner = innerTdataPath(entry.relPath);
        if (!inner) continue;
        zip.addFile(inner, entry.buffer);
    }
    return zip.toBuffer();
}

// --- 6. validatePack: sqlite-header + json fingerprint + извлечение сессии -

// Вся логика парсинга — в userbotService (validateSessionSqliteBuffer /
// parseConfigJsonContent / extractSessionFromSqliteBuffer); extractSession
// можно подменить в тестах.
export async function validatePack(pack, userbotService, { extractSession } = {}) {
    try {
        const sessionBuffer = pack.sessionEntry?.buffer;
        if (!Buffer.isBuffer(sessionBuffer) || sessionBuffer.length === 0) {
            throw new Error(`Пачка «${pack.label}»: файл .session пустой или не прочитался.`);
        }

        userbotService.validateSessionSqliteBuffer(sessionBuffer);

        const jsonBuffer = pack.jsonEntry?.buffer;
        if (!Buffer.isBuffer(jsonBuffer) || jsonBuffer.length === 0) {
            throw new Error(`Пачка «${pack.label}»: файл .json пустой или не прочитался.`);
        }
        // _normalizeFingerprint подставляет дефолты за отсутствующие поля, поэтому
        // валидируем сырцовый json ДО parseConfigJsonContent — иначе битый/чужой
        // .json молча проходит и аккаунт живёт на дефолтном fingerprint платформы.
        let rawJson;
        try {
            rawJson = JSON.parse(jsonBuffer.toString('utf8'));
        } catch {
            throw new Error(`Пачка «${pack.label}»: файл .json поврежден или не читается.`);
        }
        if (!rawJson || typeof rawJson !== 'object'
            || !(rawJson.app_id ?? rawJson.api_id)
            || !(rawJson.app_hash ?? rawJson.api_hash)) {
            throw new Error(`Пачка «${pack.label}»: в .json нет валидного app_id/app_hash.`);
        }
        const fingerprint = userbotService.parseConfigJsonContent(jsonBuffer.toString('utf8'));

        const extractor = extractSession || ((buffer) => userbotService.extractSessionFromSqliteBuffer(buffer));
        const sessionString = await extractor(sessionBuffer);
        if (!sessionString) {
            throw new Error(`Пачка «${pack.label}»: не удалось извлечь ключ сессии из .session.`);
        }

        return { ok: true, error: null, fingerprint, sessionBuffer, sessionString };
    } catch (error) {
        return {
            ok: false,
            error: error?.message || String(error),
            fingerprint: null,
            sessionBuffer: pack.sessionEntry?.buffer || null,
            sessionString: null
        };
    }
}
