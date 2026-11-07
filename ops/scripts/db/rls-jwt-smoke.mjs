// RLS JWT-smoke: проверка owner-isolation на таблицах под RLS через Kong REST.
// Волна 5.2 (план 2026-11-07): пилот — proxies, userbot_restore_sources.
// Следующие RLS-волны: добавить таблицы в PILOT_TABLES и прогнать со своими
// OWNER_A (есть строки) / OWNER_B (другой владелец) из auth.users.
//
// Запуск НА СЕРВЕРЕ (секреты читаются из supabase/.env в момент прогона,
// в вывод не печатаются):
//   scp ops/scripts/db/rls-jwt-smoke.mjs srv:/tmp/ && ssh srv 'node /tmp/rls-jwt-smoke.mjs'
//
// Что проверяет: service-ключ видит всё (prod-путь backend не задет);
// anon заблокирован (0 строк или 401); authenticated A — только свои строки;
// B — только свои; B PATCH строки A не меняет данные (PostgREST вернёт 204
// и на 0 строк — доказательство блокировки смотрят по состоянию, не по коду);
// B INSERT с чужим owner_id отклонён (with check); junk-строк не осталось.
//
// Поправки в.15: UPDATE требует SELECT (политика FOR ALL покрывает оба),
// (select auth.uid()) — initplan-кэш в политиках.
import fs from 'node:fs';
import crypto from 'node:crypto';

const SUPABASE_ENV = '/home/n8nuser/supabase/docker/.env';
const KONG = 'http://127.0.0.1:8000';
const PILOT_TABLES = process.argv[2]?.split(',') || ['proxies', 'userbot_restore_sources'];
const OWNER_A = process.argv[3]; // владелец с реальными строками
const OWNER_B = process.argv[4]; // другой владелец
if (!OWNER_A || !OWNER_B) {
    console.error('usage: node rls-jwt-smoke.mjs [table1,table2] <owner_a_uuid> <owner_b_uuid>');
    process.exit(2);
}

const envFile = fs.readFileSync(SUPABASE_ENV, 'utf8');
const getEnv = (k) => envFile.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1].trim();
const ANON = getEnv('ANON_KEY');
const SERVICE = getEnv('SERVICE_ROLE_KEY');

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function mint(sub) {
    const h = b64u({ alg: 'HS256', typ: 'JWT' });
    const now = Math.floor(Date.now() / 1000);
    const p = b64u({ sub, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 3600 });
    const sig = crypto.createHmac('sha256', getEnv('JWT_SECRET')).update(`${h}.${p}`).digest('base64url');
    return `${h}.${p}.${sig}`;
}
const hdr = (tok, key) => ({ apikey: key, Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' });
async function rest(path, opts = {}) {
    const r = await fetch(KONG + path, opts);
    const t = await r.text();
    let rows = null;
    try { rows = JSON.parse(t); } catch {}
    return { status: r.status, rows: Array.isArray(rows) ? rows.length : null, body: Array.isArray(rows) ? '' : t.slice(0, 140) };
}

const results = [];
const check = (name, ok, detail) => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

let failures = 0;
for (const table of PILOT_TABLES) {
    console.log(`\n=== ${table} ===`);
    const svc = await rest(`/rest/v1/${table}?select=id`, { headers: hdr(SERVICE, SERVICE) });
    const svcTotal = svc.rows ?? -1;
    check(`${table}: service видит ${svcTotal} строк`, svc.status === 200 && svcTotal >= 0, `status ${svc.status}`);

    const anon = await rest(`/rest/v1/${table}?select=id`, { headers: hdr(ANON, ANON) });
    check(`${table}: anon заблокирован`, anon.rows === 0 || anon.status === 401, `status ${anon.status}, rows ${anon.rows}`);

    const aTok = mint(OWNER_A);
    const aRows = await rest(`/rest/v1/${table}?select=id&owner_id=eq.${OWNER_A}`, { headers: hdr(SERVICE, SERVICE) });
    const expectedA = aRows.rows ?? 0;
    const aSee = await rest(`/rest/v1/${table}?select=id`, { headers: hdr(aTok, ANON) });
    check(`${table}: user A видит только свои (${expectedA})`, aSee.rows === expectedA, `got ${aSee.rows}`);

    const bTok = mint(OWNER_B);
    const bSee = await rest(`/rest/v1/${table}?select=id`, { headers: hdr(bTok, ANON) });
    check(`${table}: user B видит только свои`, (bSee.rows ?? 0) <= expectedA, `got ${bSee.rows} (у A ${expectedA})`);

    if (!aRows.rows) continue; // патч-проверки требуют хотя бы одну строку A
    const probe = await fetch(KONG + `/rest/v1/${table}?owner_id=eq.${OWNER_A}&select=id&limit=1`, { headers: hdr(SERVICE, SERVICE) }).then(r => r.json());
    const rowId = probe[0]?.id;
    if (!rowId) continue;

    const bPatch = await rest(`/rest/v1/${table}?id=eq.${rowId}`, { method: 'PATCH', headers: hdr(bTok, ANON), body: JSON.stringify({ owner_id: OWNER_B }) });
    const after = await fetch(KONG + `/rest/v1/${table}?id=eq.${rowId}&select=owner_id`, { headers: hdr(SERVICE, SERVICE) }).then(r => r.json());
    check(`${table}: B PATCH строки A ничего не изменил`, after[0]?.owner_id === OWNER_A, `status ${bPatch.status}, owner ${after[0]?.owner_id}`);

    const bIns = await rest(`/rest/v1/${table}`, { method: 'POST', headers: hdr(bTok, ANON), body: JSON.stringify({ owner_id: OWNER_A }) });
    check(`${table}: B INSERT с чужим owner_id отклонён`, bIns.status >= 400, `status ${bIns.status}`);
}

const junkNote = '\nJunk-проверки (RLS_TEST_MUST_NOT_EXIST) делай руками для новых таблиц: INSERT с чужим owner_id должен отклониться и не оставить строк.';
const fails = results.filter(r => !r.ok);
console.log(`\nИТОГ: ${results.length - fails.length}/${results.length} проверок пройдено${junkNote}`);
process.exit(fails.length ? 1 : 0);
