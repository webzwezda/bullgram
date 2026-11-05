// console.* ratchet для backend prod-кода (фаза 3 логирования).
// Вызывается из ops/scripts/ci/gate-07-console-ratchet.sh.
//   node console-ratchet.mjs                  — сравнение с baseline
//   node console-ratchet.mjs --update-baseline — осознанное обновление baseline
// Правило миграции: «трогаешь файл — мигрируй его логи» на backend/utils/logger.js.
// План: docs/plans/2026-11-05-logging-research.md (§7, фаза 3).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const selfDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(selfDir, '..', '..', '..');
const backendDir = path.join(repoRoot, 'backend');
const baselinePath = path.join(selfDir, 'console-ratchet.baseline.json');

const update = process.argv.includes('--update-baseline');
const RE = /console\.(log|warn|error|info)/;
const SKIP_DIRS = new Set(['node_modules', 'test', 'scripts', 'logs']);

function* walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) continue;
            yield* walk(full);
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
            yield full;
        }
    }
}

const files = {};
let total = 0;
for (const file of walk(backendDir)) {
    const count = fs.readFileSync(file, 'utf8').split('\n')
        .filter((line) => RE.test(line)).length;
    if (count > 0) {
        const rel = 'backend/' + path.relative(backendDir, file).split(path.sep).join('/');
        files[rel] = count;
        total += count;
    }
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));

if (update) {
    baseline.total = total;
    baseline.files = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
    fs.writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + '\n');
    console.log(`PASS: baseline обновлён: total=${total}, files=${Object.keys(files).length} (осознанная операция — обоснуй в коммите)`);
    process.exit(0);
}

const failures = [];
if (total > baseline.total) {
    failures.push(`total: ${baseline.total} → ${total}`);
}
for (const [rel, count] of Object.entries(files)) {
    const allowed = baseline.files[rel] ?? 0;
    if (count > allowed) failures.push(`${rel}: ${allowed} → ${count}`);
}
if (failures.length) {
    console.log('FAIL: рост console.*. Новый код — через backend/utils/logger.js (pino).');
    console.log('Легаси мигрируется по правилу «трогаешь файл — мигрируй его логи».');
    for (const f of failures) console.log(`  - ${f}`);
    console.log('Нарочно допустить рост: ops/scripts/ci/gate-07-console-ratchet.sh --update-baseline');
    process.exit(1);
}
console.log(`PASS: console.* не вырос (${baseline.total} → ${total})`);
