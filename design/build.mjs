#!/usr/bin/env node
/**
 * design/build.mjs — пайплайн DTCG → Tailwind v4 @theme (волна 2 плана единой дизайн-системы).
 *
 * Читает design/tokens/*.json (единый источник, формат DTCG), резолвит алиасы {path}
 * и эммитит БАЙТ-ИДЕНТИЧНЫЕ копии в admin-v2/src/styles/tokens.css и
 * site-v2/src/styles/tokens.css — один @theme-блок. Идентичность копий —
 * часть доказательства «единого источника».
 *
 * Режимы:
 *   node design/build.mjs           — (пере)сгенерировать оба tokens.css
 *   node design/build.mjs --check   — гейт CI:
 *       1) оба tokens.css на диске байт-в-байт равны свежей генерации (иначе STALE, exit 1);
 *       2) каждый эммитнутый --color-{hue}-{step} байт-равен значению из
 *          admin-v2/node_modules/tailwindcss/theme.css (гейт нулевой визуальной дельты волны 3).
 *
 * Только stdlib Node, без зависимостей. Контракт маппинга — design/README.md,
 * раздел «Маппинг токенов → Tailwind v4 @theme».
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DESIGN_DIR = path.dirname(fileURLToPath(import.meta.url)); // <repo>/design
const ROOT = path.resolve(DESIGN_DIR, "..");
const TOKENS_DIR = path.join(DESIGN_DIR, "tokens");
const OUTPUTS = [
  path.join(ROOT, "admin-v2", "src", "styles", "tokens.css"),
  path.join(ROOT, "site-v2", "src", "styles", "tokens.css"),
];
const THEME_CSS = path.join(ROOT, "admin-v2", "node_modules", "tailwindcss", "theme.css");

// Группы semantic-цвета из design/tokens/color.semantic.json (порядок = порядок эммита).
const SEMANTIC_GROUPS = ["text", "surface", "border", "action", "feedback", "component"];

// ---------------------------------------------------------------------------
// Загрузка и резолв DTCG
// ---------------------------------------------------------------------------

function loadTokens() {
  const merged = {};
  const files = readdirSync(TOKENS_DIR).filter((f) => f.endsWith(".json")).sort();
  for (const file of files) {
    const json = JSON.parse(readFileSync(path.join(TOKENS_DIR, file), "utf8"));
    for (const [key, value] of Object.entries(json)) {
      if (key.startsWith("$")) continue; // $schema/$description — мета, не токены
      if (key in merged) throw new Error(`Конфликт верхнеуровневых групп «${key}» (файл ${file})`);
      merged[key] = value;
    }
  }
  return merged;
}

function getNode(tree, dotted) {
  let node = tree;
  for (const seg of dotted.split(".")) {
    if (!node || typeof node !== "object" || !(seg in node)) return undefined;
    node = node[seg];
  }
  return node;
}

/** $value ноды с доконца разрешёнными алиасами {path}. Числа проходят насквозь. */
function resolveTokenValue(tree, node, seen = new Set()) {
  let value = node.$value;
  let guard = 0;
  while (typeof value === "string" && value.startsWith("{") && value.endsWith("}")) {
    const ref = value.slice(1, -1).trim();
    if (seen.has(ref)) throw new Error(`Цикл алиасов: ${[...seen, ref].join(" -> ")}`);
    seen.add(ref);
    const target = getNode(tree, ref);
    if (!target || !("$value" in target)) throw new Error(`Алиас не разрешён: {${ref}}`);
    value = target.$value;
    if (++guard > 32) throw new Error("Слишком длинная цепочка алиасов");
  }
  return value;
}

/** Значение ноды как строка для CSS (числа — как есть: 100, 1.25, 1). */
function cssValue(tree, node) {
  const value = resolveTokenValue(tree, node);
  return typeof value === "number" ? String(value) : value;
}

/** Листья DTCG-дерева: [{path: string[], node}] в порядке файла. */
function walkLeaves(node, prefix = [], out = []) {
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("$")) continue;
    const p = [...prefix, key];
    if (value && typeof value === "object") {
      if ("$value" in value) out.push({ path: p, node: value });
      else walkLeaves(value, p, out);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Эммит: DTCG → список CSS-переменных → один @theme-блок
// ---------------------------------------------------------------------------

function collectEntries(tree) {
  const entries = [];

  // 1. Примитивы: --color-{hue}-{step} всех ступеней 50–950 всех палитр + white/black.
  //    Значения как в токенах (oklch), БЕЗ преобразований.
  const prim = tree.primitive;
  if (!prim) throw new Error("Группа primitive не найдена в design/tokens");
  const ramps = Object.keys(prim).filter((h) => h !== "white" && h !== "black").sort();
  const fixed = ["white", "black"].filter((h) => h in prim);
  for (const hue of [...ramps, ...fixed]) {
    const hueNode = prim[hue];
    if ("$value" in hueNode) {
      // white/black — листовые ноды: --color-white / --color-black (hex как в токенах).
      entries.push({ name: `--color-${hue}`, value: cssValue(tree, hueNode), kind: "primitive-color" });
      continue;
    }
    const steps = Object.keys(hueNode).filter((s) => !s.startsWith("$")).sort((a, b) => Number(a) - Number(b));
    for (const step of steps) {
      entries.push({
        name: `--color-${hue}-${step}`,
        value: cssValue(tree, hueNode[step]),
        kind: "primitive-color",
      });
    }
  }

  // 2. Семантика цвета: --color-<путь через дефис>. Группы «text» и «component»
  //    отбрасываются: в v4 --text-* это namespace размера шрифта, цветовой --text-*
  //    сломал бы его; component.* — паттерны, а не namespace цвета (только их содержимое).
  //    Примеры: text.ink.muted → --color-ink-muted; component.money-zero → --color-money-zero.
  //    component.micro-label ($type: typography, нестандартный композит) — НЕ эммитится.
  for (const group of SEMANTIC_GROUPS) {
    if (!(group in tree)) continue;
    for (const { path: p, node } of walkLeaves(tree[group], [group])) {
      if (node.$type !== "color") continue; // micro-label и прочие композиты — не цвет
      const segs = p[0] === "text" || p[0] === "component" ? p.slice(1) : p;
      entries.push({ name: `--color-${segs.join("-")}`, value: cssValue(tree, node), kind: "semantic-color" });
    }
  }

  // 3. Типографика. font.family.* сознательно НЕ эммитится (TODO в шапке).
  const font = tree.font ?? {};
  const sizes = Object.keys(font.size ?? {}).filter((k) => !k.startsWith("$"));
  for (const size of sizes) {
    entries.push({ name: `--text-${size}`, value: cssValue(tree, font.size[size]), kind: "typography" });
    const lh = font.sizeLineHeight?.[size];
    if (lh) entries.push({ name: `--text-${size}--line-height`, value: cssValue(tree, lh), kind: "typography" });
  }
  for (const { path: p, node } of walkLeaves(font.weight ?? {}, ["font", "weight"])) {
    entries.push({ name: `--font-weight-${p[p.length - 1]}`, value: cssValue(tree, node), kind: "typography" });
  }
  for (const { path: p, node } of walkLeaves(tree.letterSpacing ?? {}, ["letterSpacing"])) {
    entries.push({ name: `--tracking-${p[p.length - 1]}`, value: cssValue(tree, node), kind: "typography" });
  }
  for (const { path: p, node } of walkLeaves(tree.lineHeight ?? {}, ["lineHeight"])) {
    entries.push({ name: `--leading-${p[p.length - 1]}`, value: cssValue(tree, node), kind: "typography" });
  }

  // 4. Отступы: только --spacing (базовый шаг); per-step spacing-переменных в v4 нет.
  //    spacing.json лежит в корне файла: база — это нода base верхнего уровня.
  if (tree.base?.$value) {
    entries.push({ name: "--spacing", value: cssValue(tree, tree.base), kind: "spacing" });
  }

  const names = new Set();
  for (const e of entries) {
    if (names.has(e.name)) throw new Error(`Дубликат переменной ${e.name}`);
    names.add(e.name);
  }
  return entries;
}

function generateCss(tree) {
  const entries = collectEntries(tree);
  const head = [
    "/* GENERATED — не править руками, источник design/tokens, npm run tokens:build. */",
    "/* Проверка актуальности: npm run tokens:check (байт-сверка + гейт нулевой дельты с theme.css). */",
    "/* Эммитится в admin-v2/src/styles/tokens.css и site-v2/src/styles/tokens.css — копии байт-идентичны. */",
    "/*",
    " * Сознательно НЕ эммитится (см. design/README.md, «Маппинг токенов → Tailwind v4 @theme»):",
    " * - font.family.* (--font-sans/--font-mono): переход admin-v2 на целевой sans-стек — осознанное",
    " *   решение волны 4; эммит сейчас нарушил бы гейт нулевой визуальной дельты (app'ы на разных стеках).",
    " * - radius.*: admin-v2 (shadcn --radius: 0.625rem) и site-v2 держат per-app override радиуса",
    " *   до отдельного решения; radius.json фиксирует только общую дефолтную шкалу.",
    " * - motion.*: в Tailwind v4 нет namespace для кастомных duration/ease токенов.",
    " * - component.micro-label: нестандартный DTCG-композит (fontSize+textCase+letterSpacing+color),",
    " *   одной CSS-переменной не выражается — паттерн живёт в документации, собирается из токенов.",
    " * - spacing.scale: per-step spacing-переменных в v4 нет, шкала выводится из --spacing.",
    " */",
    "@theme {",
  ];
  const body = [];
  let lastKind = null;
  const sectionTitle = {
    "primitive-color": "Примитивы: 12 палитр 50–950 + white/black (байт-в-байт из tailwindcss/theme.css)",
    "semantic-color": "Семантика цвета (алиасы разрешены в значения примитивов)",
    typography: "Типографика",
    spacing: "Отступы",
  };
  for (const e of entries) {
    if (e.kind !== lastKind) {
      body.push(`  /* ---- ${sectionTitle[e.kind]} ---- */`);
      lastKind = e.kind;
    }
    body.push(`  ${e.name}: ${e.value};`);
  }
  return [...head, ...body, "}", ""].join("\n");
}

// ---------------------------------------------------------------------------
// --check: гейт актуальности + гейт нулевой дельты
// ---------------------------------------------------------------------------

function parseThemeCss(file) {
  const map = new Map();
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*(--[\w-]+)\s*:\s*(.+?)\s*;\s*$/);
    if (m) map.set(m[1], m[2]);
  }
  return map;
}

function runCheck(tree) {
  let failed = false;

  // 1. STALE-гейт: оба файла на диске байт-в-байт равны свежей генерации.
  const css = generateCss(tree);
  for (const out of OUTPUTS) {
    if (!existsSync(out)) {
      console.error(`STALE: ${path.relative(ROOT, out)} не существует — запусти npm run tokens:build`);
      failed = true;
      continue;
    }
    if (readFileSync(out, "utf8") !== css) {
      console.error(`STALE: ${path.relative(ROOT, out)} отличается от свежей генерации — запусти npm run tokens:build`);
      failed = true;
    }
  }

  // 2. Гейт нулевой визуальной дельты: --color-{hue}-{step} байт-равны theme.css.
  if (!existsSync(THEME_CSS)) {
    console.error(`Эталон не найден: ${path.relative(ROOT, THEME_CSS)} — выполни npm --prefix admin-v2 install`);
    failed = true;
  } else {
    const theme = parseThemeCss(THEME_CSS);
    const entries = collectEntries(tree);
    const hues = Object.keys(tree.primitive).filter((h) => h !== "white" && h !== "black");
    const steps = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"];
    const rampRe = new RegExp(`^--color-(${hues.join("|")})-(${steps.join("|")})$`);

    let checked = 0;
    const errors = [];
    for (const e of entries.filter((x) => rampRe.test(x.name))) {
      if (!theme.has(e.name)) {
        errors.push(`${e.name}: нет в эталоне theme.css`);
        continue;
      }
      if (theme.get(e.name) !== e.value) {
        errors.push(`${e.name}: ${e.value} ≠ theme.css ${theme.get(e.name)}`);
        continue;
      }
      checked += 1;
    }

    // Информативная доп. сверка типографики/spacing (не фатально: расхождение
    // возможно в будущем как осознанное решение, а сегодня наборы = дефолт v4).
    let extraChecked = 0;
    const extraDrift = [];
    for (const e of entries.filter((x) => x.kind === "typography" || x.kind === "spacing")) {
      if (!theme.has(e.name)) continue;
      if (theme.get(e.name) === e.value) extraChecked += 1;
      else extraDrift.push(e.name);
    }

    if (errors.length > 0) {
      failed = true;
      console.error("Гейт нулевой дельты ПРОВАЛЕН — значения примитивов разошлись с theme.css:");
      for (const err of errors) console.error(`  x ${err}`);
    }

    // 3. Гейт полноты: под сверкой ровно 132 значения (12 палитр × 11 ступеней).
    //    Константа осознанная: набор примитивов заморожен железным правилом README
    //    («новая палитра в коде = новая рампа здесь»), так что её рост — тоже осознанная правка.
    //    Без этого ассерта удаление палитры из токенов проходило бы check зелёным.
    const EXPECTED_RAMP_CHECKS = 12 * 11;
    if (checked !== EXPECTED_RAMP_CHECKS) {
      failed = true;
      console.error(`Гейт полноты ПРОВАЛЕН: сверено ${checked} color-значений, ожидается ${EXPECTED_RAMP_CHECKS} (12 палитр × 11 ступеней) — набор примитивов эрозировал`);
    }
    if (extraDrift.length > 0) {
      console.warn(`Внимание: typography/spacing разошлись с theme.css (не фатально, проверь осознанность): ${extraDrift.join(", ")}`);
    }

    const emitted = entries.length;
    if (!failed) {
      console.log(`tokens:check OK — ${emitted} переменных эммитено, ${checked} сверено с эталоном, 0 расхождений.`);
      console.log(`Оба tokens.css актуальны и байт-идентичны. Доп. сверка typography/spacing с theme.css: ${extraChecked}/${extraChecked + extraDrift.length} совпадают (информативно).`);
      console.log(`Гейт нулевой визуальной дельты волны 3: пройден (${checked} color-значений = theme.css).`);
    }
  }

  if (failed) process.exit(1);
}

// ---------------------------------------------------------------------------

function main() {
  try {
    const tree = loadTokens();
    if (process.argv.includes("--check")) {
      runCheck(tree);
      return;
    }
    const css = generateCss(tree);
    for (const out of OUTPUTS) {
      writeFileSync(out, css);
      console.log(`записан ${path.relative(ROOT, out)}`);
    }
    const entries = collectEntries(tree);
    console.log(`итог: ${entries.length} переменных из design/tokens/*.json, копии байт-идентичны. Проверка: npm run tokens:check`);
  } catch (e) {
    console.error(`tokens:build — ошибка: ${e.message}`);
    process.exit(1);
  }
}

main();
