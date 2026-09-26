#!/usr/bin/env node
/**
 * design/ui-sync.mjs — гейт синхронизации общих UI-файлов между приложениями
 * (волна 6b, продолжение вокендоринга волны 6a). Запуск: node design/ui-sync.mjs
 * или через 5-й гейт npm run check:design. Только stdlib Node.
 *
 * Канон общих файлов — admin-v2 (админ-канон shadcn/ui); site-v2 и userbot-v2 держат
 * байт-в-байт копии. Сравнение — каждое приложение из списка файла против канона
 * (admin-v2 против самого себя тривиально проходит). Правило: правишь в одном —
 * переносишь во все остальные тем же коммитом.
 *
 * Запись SHARED_FILES: строка «path» = файл во всех приложениях; { file, apps }
 * = файл только в перечисленных приложениях (например productTier.js — только
 * admin-v2 и userbot-v2, на site-v2 тарифов нет).
 *
 * Расхождения:
 *   - файл отсутствует в любом из приложений списка → FAIL (указано, какой стороны не хватает);
 *   - sha256 не совпал с каноном → FAIL (какие файлы и их хэши).
 * Всё идентично → ok-список. Любой FAIL → exit 1.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DESIGN_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DESIGN_DIR, "..");
const APPS = ["admin-v2", "site-v2", "userbot-v2"];
const CANONICAL_APP = "admin-v2";
const SHARED_FILES = [
  "src/lib/utils.js",
  "src/components/ui/button.jsx",
  "src/components/ui/input.jsx",
  "src/components/ui/badge.jsx",
  "src/components/ui/card.jsx",
  { file: "src/app/productTier.js", apps: ["admin-v2", "userbot-v2"] },
  { file: "src/ui/OpsRail.jsx", apps: ["admin-v2", "userbot-v2"] },
];

function sha256(abs) {
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

const lines = [];
let failed = false;

for (const entry of SHARED_FILES) {
  const rel = typeof entry === "string" ? entry : entry.file;
  const apps = typeof entry === "string" ? APPS : entry.apps;
  if (!apps.includes(CANONICAL_APP)) {
    failed = true;
    lines.push(`FAIL ${rel} — список apps не содержит канон ${CANONICAL_APP}`);
    continue;
  }
  const sides = apps.map((app) => ({ app, abs: path.join(ROOT, app, rel) }));
  const missing = sides.filter((s) => !existsSync(s.abs));
  if (missing.length > 0) {
    failed = true;
    lines.push(`FAIL ${rel} — нет в: ${missing.map((m) => m.app).join(", ")}`);
    continue;
  }
  const canonicalHash = sha256(sides.find((s) => s.app === CANONICAL_APP).abs);
  const drifted = sides.filter((s) => s.app !== CANONICAL_APP && sha256(s.abs) !== canonicalHash);
  if (drifted.length > 0) {
    failed = true;
    lines.push(
      `FAIL ${rel} — разошёлся с каноном ${CANONICAL_APP} (sha256=${canonicalHash.slice(0, 12)}):\n` +
        drifted
          .map((s) => `     ${s.app}  sha256=${sha256(s.abs)}`)
          .join("\n")
    );
    continue;
  }
  lines.push(`ok   ${rel}  (${canonicalHash.slice(0, 12)}, ${apps.join(" <-> ")})`);
}

console.log(`== ui-sync — общие UI-файлы, канон: ${CANONICAL_APP} ==`);
for (const line of lines) console.log(line);

if (failed) {
  console.error(
    "\nFAIL ui-sync — общие файлы разошлись. Канон: admin-v2; перенеси правку во все приложения из списка файла байт-в-байт (или осознанно расшарь новый файл, добавив его в SHARED_FILES)."
  );
  process.exit(1);
}
console.log(`\nPASS ui-sync — ${SHARED_FILES.length}/${SHARED_FILES.length} записей идентичны канону`);
