#!/usr/bin/env node
/**
 * design/ui-sync.mjs — гейт синхронизации общих UI-файлов между admin-v2 и site-v2
 * (волна 6b, продолжение вокендоринга волны 6a). Запуск: node design/ui-sync.mjs
 * или через 5-й гейт npm run check:design. Только stdlib Node.
 *
 * Канон общих файлов — admin-v2 (админ-канон shadcn/ui); site-v2 держит байт-в-байт
 * копии. Правило: правишь в одном — переносишь во второе тем же коммитом.
 *
 * Расхождения:
 *   - файл отсутствует в любом из приложений → FAIL (указано, какой стороны не хватает);
 *   - sha256 не совпал → FAIL (какие файлы и их хэши).
 * Всё идентично → ok-список. Любой FAIL → exit 1.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DESIGN_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DESIGN_DIR, "..");
const APPS = ["admin-v2", "site-v2"];
const SHARED_FILES = [
  "src/lib/utils.js",
  "src/components/ui/button.jsx",
  "src/components/ui/input.jsx",
  "src/components/ui/badge.jsx",
  "src/components/ui/card.jsx",
];

function sha256(abs) {
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

const lines = [];
let failed = false;

for (const rel of SHARED_FILES) {
  const sides = APPS.map((app) => ({ app, abs: path.join(ROOT, app, rel) }));
  const missing = sides.filter((s) => !existsSync(s.abs));
  if (missing.length > 0) {
    failed = true;
    lines.push(`FAIL ${rel} — нет в: ${missing.map((m) => m.app).join(", ")}`);
    continue;
  }
  const [a, b] = sides;
  const hashA = sha256(a.abs);
  const hashB = sha256(b.abs);
  if (hashA !== hashB) {
    failed = true;
    lines.push(
      `FAIL ${rel} — хэши разошлись:\n` +
        `     ${a.app}  sha256=${hashA}\n` +
        `     ${b.app}  sha256=${hashB}`
    );
    continue;
  }
  lines.push(`ok   ${rel}  (${hashA.slice(0, 12)})`);
}

console.log(`== ui-sync — общие UI-файлы: ${APPS.join(" <-> ")} ==`);
for (const line of lines) console.log(line);

if (failed) {
  console.error(
    "\nFAIL ui-sync — общие файлы разошлись. Канон: admin-v2; перенеси правку во второе приложение байт-в-байт (или осознанно расшарь новый файл, добавив его в SHARED_FILES)."
  );
  process.exit(1);
}
console.log(`\nPASS ui-sync — ${SHARED_FILES.length}/${SHARED_FILES.length} файлов идентичны`);
