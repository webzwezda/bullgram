#!/usr/bin/env node
/**
 * design/check-design.mjs — оркестратор гейтов качества design-системы (волна 5).
 * Запуск из корня репо: npm run check:design (или node design/check-design.mjs).
 * Только stdlib Node; kit-скрипты вызываются из ~/.zcode/ux-ui-agent-skills,
 * в репо не копируются и новых зависимостей не добавляют.
 *
 * Гейты:
 *   1. tokens    — validate_tokens.py design/tokens: exit 0 обязателен.
 *   2. contrast  — design/contrast-snapshot.mjs + validate_contrast.py.
 *                  exit 1 с ЕДИНСТВЕННЫМ FAIL `border.strong` — зелёный
 *                  (известный задокументированный FAIL, design/README.md);
 *                  любой другой FAIL — красный.
 *   3. hardcodes — lint_hardcodes.py admin-v2/src site-v2/src против ratchet-
 *                  снапшота design/lint-baseline.json: красный ТОЛЬКО если
 *                  текущих findings больше baseline (total + per-kind + per-file).
 *                  Меньше — зелёный с подсказкой обновить baseline осознанно.
 *   4. axe       — опциональный рендер-аудит design/qa/harness-studio-pairs.html
 *                  через axe_audit.mjs (нужен playwright + Chrome; при их
 *                  отсутствии шаг честно SKIPPED). Падение — только на
 *                  serious/critical. (axe_audit выходит 1 при любом violation,
 *                  поэтому решение принимается по распарсенному выводу.)
 *
 * Флаг --update-baseline: перезаписывает design/lint-baseline.json текущими
 * findings lint_hardcodes (осознанная операция при миграции на семантику).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DESIGN_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DESIGN_DIR, "..");
const KIT_SCRIPTS = path.join(os.homedir(), ".zcode", "ux-ui-agent-skills", "scripts");
const TOKENS_DIR = path.join(DESIGN_DIR, "tokens");
const CONTRAST_SNAPSHOT_SCRIPT = path.join(DESIGN_DIR, "contrast-snapshot.mjs");
const CONTRAST_JSON = "/tmp/bullgram-contrast.json";
const HARNESS = path.join(DESIGN_DIR, "qa", "harness-studio-pairs.html");
const BASELINE_FILE = path.join(DESIGN_DIR, "lint-baseline.json");
const LINT_TARGETS = ["admin-v2/src", "site-v2/src"];

// Известный ожидаемый FAIL validate_contrast.py на слепке semantic-цветов:
// его обязательная пара «essential control border (WCAG 1.4.11)» — border.strong
// = slate-300 на slate-50. Задокументирован в design/README.md («Валидация»).
const KNOWN_CONTRAST_FAILS = new Set(["essential control border (WCAG 1.4.11)"]);

const updateBaseline = process.argv.includes("--update-baseline");

// ---------------------------------------------------------------------------
// helpers

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8" });
  return {
    status: r.status,
    ok: r.status === 0,
    out: `${r.stdout ?? ""}${r.stderr ?? ""}`,
  };
}

function fail(section, message) {
  console.error(`\n[x] ${section}: FAIL`);
  if (message) console.error(message);
  process.exitCode = 1;
}

function pass(section, message = "") {
  console.log(`[ok] ${section}${message ? `: ${message}` : ""}`);
}

// ---------------------------------------------------------------------------
// 1. tokens: структура DTCG + резолв всех алиасов

function gateTokens() {
  const r = run("python3", [path.join(KIT_SCRIPTS, "validate_tokens.py"), TOKENS_DIR]);
  if (!r.ok) {
    fail("tokens", r.out.trim());
    return false;
  }
  const parsed = r.out.match(/Parsed (\d+\/\d+) token files, (\d+) tokens defined\./);
  pass("tokens", parsed ? `${parsed[1]} файлов, ${parsed[2]} токенов` : "OK");
  return true;
}

// ---------------------------------------------------------------------------
// 2. contrast: слепок semantic-цветов → официальный валидатор кита

function gateContrast() {
  const snap = run("node", [CONTRAST_SNAPSHOT_SCRIPT]);
  if (!snap.ok) {
    fail("contrast", `contrast-snapshot не смог собрать слепок:\n${snap.out.trim()}`);
    return false;
  }
  const v = run("python3", [path.join(KIT_SCRIPTS, "validate_contrast.py"), CONTRAST_JSON]);
  const out = v.out;
  if (/ERROR/.test(out)) {
    fail("contrast", `валидатор не смог выполниться (exit ${v.status}):\n${out.trim()}`);
    return false;
  }
  // Пары-FAIL печатаются строками «  FAIL <label>: …» (сводка ниже — «FAIL: N …»).
  const failLabels = [...out.matchAll(/^\s*FAIL (.+?):/gm)].map((m) => m[1].trim());
  // Failsafe дрейфа формата: валидатор упал, но ни одна FAIL-строка не распарсилась —
  // молча пропустить нельзя (ложно-зелёный), красим.
  if (v.status !== 0 && failLabels.length === 0) {
    fail("contrast", `валидатор завершился с exit ${v.status}, но FAIL-пар не распознано (дрейф формата?):\n${out.trim()}`);
    return false;
  }
  const known = failLabels.filter((l) => KNOWN_CONTRAST_FAILS.has(l));
  const unknown = failLabels.filter((l) => !KNOWN_CONTRAST_FAILS.has(l));
  if (unknown.length > 0) {
    fail(
      "contrast",
      `новые FAIL вне известного списка (${[...KNOWN_CONTRAST_FAILS].join("; ")}):\n` +
        unknown.map((l) => `  - ${l}`).join("\n") +
        `\n\nполный вывод валидатора:\n${out.trim()}`
    );
    return false;
  }
  pass(
    "contrast",
    known.length > 0
      ? `OK — ${known.length} known FAIL (${known.join("; ")}) — задокументирован, не регрессия`
      : "OK — обязательные пары проходят"
  );
  return true;
}

// ---------------------------------------------------------------------------
// 3. hardcodes: lint против ratchet-снапшота

function normalizeFile(f) {
  const abs = path.resolve(ROOT, f);
  return abs.startsWith(ROOT + path.sep) ? path.relative(ROOT, abs) : f;
}

function runHardcodes() {
  const r = run("python3", [path.join(KIT_SCRIPTS, "lint_hardcodes.py"), ...LINT_TARGETS]);
  const out = r.out;
  // Конфигурационная ошибка (путь не найден, нечего сканировать) — не ratchet.
  if (/^ERROR:/m.test(out) || /no lintable file/.test(out)) {
    fail("hardcodes", `lint_hardcodes не смог выполниться (exit ${r.status}):\n${out.trim()}`);
    return null;
  }
  const counts = { total: 0, kinds: {}, files: {} };
  for (const m of out.matchAll(/^(.+?):(\d+): hardcoded ([a-z-]+) '/gm)) {
    const file = normalizeFile(m[1]);
    const kind = m[3];
    counts.total += 1;
    counts.kinds[kind] = (counts.kinds[kind] ?? 0) + 1;
    counts.files[file] = (counts.files[file] ?? 0) + 1;
  }
  const scanned = out.match(/Scanned (\d+) file\(s\)\./);
  return { counts, scanned: scanned ? Number(scanned[1]) : null, exit: r.status };
}

function compareWithBaseline(current, baseline) {
  const diffs = [];
  if (current.total > baseline.total) {
    diffs.push(`total: ${current.total} > ${baseline.total}`);
  }
  for (const [kind, n] of Object.entries(current.kinds)) {
    const allowed = baseline.kinds?.[kind] ?? 0;
    if (n > allowed) diffs.push(`kind ${kind}: ${n} > ${allowed}`);
  }
  for (const [file, n] of Object.entries(current.files)) {
    const allowed = baseline.files?.[file] ?? 0;
    if (n > allowed) diffs.push(`file ${file}: ${n} > ${allowed}`);
  }
  return diffs;
}

function gateHardcodes() {
  const lint = runHardcodes();
  if (lint === null) return false;
  const { counts, scanned } = lint;

  if (updateBaseline) {
    // Failsafe дрейфа формата линтера: не распарсилось число сканов —
    // counts могут быть пустыми, перезапись baseline обнулила бы снапшот.
    if (scanned === null) {
      fail("hardcodes", `lint_hardcodes отработал (exit ${r.status}), но строку «Scanned N file(s)» распознать не удалось (дрейф формата?) — baseline НЕ перезаписан:\n${out.trim().slice(0, 2000)}`);
      return false;
    }
    const baseline = {
      $comment:
        "Ratchet-снапшот lint_hardcodes (admin-v2/src + site-v2/src) для npm run check:design. " +
        "Перегенерируется осознанно: node design/check-design.mjs --update-baseline. " +
        "Гейт красный, только если текущих findings стало БОЛЬШЕ снапшота (total / kind / file).",
      updatedAt: new Date().toISOString().slice(0, 10),
      total: counts.total,
      kinds: counts.kinds,
      files: counts.files,
    };
    writeFileSync(BASELINE_FILE, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(
      `[ok] hardcodes: baseline обновлён → total=${counts.total}` +
        ` (${Object.entries(counts.kinds).map(([k, n]) => `${k}=${n}`).join(", ")})`
    );
    return true;
  }

  if (!existsSync(BASELINE_FILE)) {
    fail(
      "hardcodes",
      `нет ${path.relative(ROOT, BASELINE_FILE)}. Создай осознанно: node design/check-design.mjs --update-baseline`
    );
    return false;
  }
  // Failsafe дрейфа формата: без «Scanned N file(s)» counts недостоверны —
  // ноль findings выглядел бы как «ratchet улучшился» (ложно-зелёный).
  if (scanned === null) {
    fail("hardcodes", `lint_hardcodes отработал (exit ${r.status}), но вывод не распознан (дрейф формата?) — гейт красный, а не зелёный:\n${out.trim().slice(0, 2000)}`);
    return false;
  }

  let baseline;
  try {
    baseline = JSON.parse(readFileSync(BASELINE_FILE, "utf8"));
  } catch (e) {
    fail("hardcodes", `baseline не читается (${e.message}). Перегенерируй: node design/check-design.mjs --update-baseline`);
    return false;
  }

  const diffs = compareWithBaseline(counts, baseline);
  if (diffs.length > 0) {
    fail(
      "hardcodes",
      `ratchet вырос (${counts.total} findings, baseline ${baseline.total}). Новые/подросшие:\n` +
        diffs.map((d) => `  - ${d}`).join("\n") +
        `\n\nПравило: новые raw-значения не добавляем — заводи semantic-токен или ссылку var(--…)/theme(…). ` +
        `Если делалась осознанная миграция и baseline надо поднять: node design/check-design.mjs --update-baseline`
    );
    return false;
  }

  const improved = counts.total < baseline.total;
  pass(
    "hardcodes",
    `${counts.total}/${baseline.total} findings${scanned ? ` (${scanned} файлов)` : ""} — ratchet ${
      improved ? "улучшился" : "не вырос"
    }` + (improved ? "\n     подсказка: findings стало меньше — обнови baseline осознанно: node design/check-design.mjs --update-baseline" : "")
  );
  return true;
}

// ---------------------------------------------------------------------------
// 4. axe (опционально): рендер-аудит harness-страницы

function gateAxe() {
  if (!existsSync(HARNESS)) {
    console.log("[--] axe: harness не найден, шаг пропущен");
    return true;
  }
  const script = path.join(KIT_SCRIPTS, "axe_audit.mjs");
  if (!existsSync(script)) {
    console.log("[--] axe: kit-скрипт axe_audit.mjs не найден — шаг пропущен");
    return true;
  }
  const r = run("node", [script, HARNESS]);
  const out = r.out;
  // SKIPPED = нет playwright/браузера/axe-core в этом окружении — не падение.
  if (/SKIPPED/.test(out)) {
    const reason = out.trim().split("\n").find((l) => /SKIPPED/.test(l)) ?? "";
    console.log(`[--] axe: SKIPPED (${reason.trim()})`);
    return true;
  }
  // Формат при нарушениях: «N violation(s); M serious/critical.»;
  // при нуле: «OK: 0 violations.» (axe_audit выходит 1 при любом violation,
  // поэтому решение принимаем по распарсенному выводу, не по exit-коду).
  const zero = /^OK: 0 violations\.?$/m.test(out);
  const m = out.match(/(\d+) violation\(s\); (\d+) serious\/critical/);
  if (!zero && !m) {
    fail("axe", `неожиданный вывод axe_audit (exit ${r.status}):\n${out.trim()}`);
    return false;
  }
  const total = zero ? 0 : Number(m[1]);
  const blocking = zero ? 0 : Number(m[2]);
  if (blocking > 0) {
    fail("axe", `${blocking} serious/critical нарушение(й) на ${path.relative(ROOT, HARNESS)}:\n${out.trim()}`);
    return false;
  }
  pass("axe", `0 serious/critical (${total} менее критичных violation) на harness`);
  return true;
}

// ---------------------------------------------------------------------------

console.log("== check:design — гейты design-системы Bullgram ==\n");
const results = {
  tokens: gateTokens(),
  contrast: gateContrast(),
  hardcodes: gateHardcodes(),
  axe: gateAxe(),
};

const red = Object.entries(results).filter(([, ok]) => !ok).map(([name]) => name);
console.log("\n== сводка ==");
console.log(`tokens     ${results.tokens ? "OK" : "FAIL"}`);
console.log(`contrast   ${results.contrast ? "OK (1 known FAIL: border.strong — WCAG 1.4.11, задокументирован)" : "FAIL"}`);
if (updateBaseline) {
  console.log("hardcodes  baseline обновлён (--update-baseline)");
} else {
  console.log(`hardcodes  ${results.hardcodes ? "OK (ratchet)" : "FAIL (ratchet)"}`);
}
console.log(`axe        ${results.axe ? "OK" : "FAIL"}`);
if (red.length > 0) {
  console.error(`\nFAIL check:design — упавшие гейты: ${red.join(", ")}`);
  process.exit(1);
}
console.log("\nPASS check:design");
