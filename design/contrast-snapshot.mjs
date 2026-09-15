#!/usr/bin/env node
/**
 * design/contrast-snapshot.mjs — слепок semantic-цветов для официального контраст-валидатора кита.
 *
 * Резолвит semantic-цветовые токены из design/tokens (алиасы {path}) и конвертирует
 * oklch → sRGB (hex) стандартным пайплайном (как браузер; v3-таблицы не используются —
 * см. design/README.md, «Нюанс Tailwind v4»). Результат — DTCG-подобный JSON в
 * /tmp/bullgram-contrast.json для:
 *
 *   python3 ~/.zcode/ux-ui-agent-skills/scripts/validate_contrast.py /tmp/bullgram-contrast.json
 *
 * Известный ожидаемый исход: exit 1 — единственный FAIL это собственная обязательная
 * пара валидатора semantic.border.strong ≥ 3:1 (WCAG 1.4.11): slate-300 на slate-50.
 * Только stdlib Node, без зависимостей.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DESIGN_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DESIGN_DIR, "..");
const TOKENS_DIR = path.join(DESIGN_DIR, "tokens");
const OUT_FILE = "/tmp/bullgram-contrast.json";

// ---------------------------------------------------------------------------
// Загрузка и резолв DTCG (зеркало design/build.mjs, только нужное здесь)
// ---------------------------------------------------------------------------

function loadTokens() {
  const merged = {};
  const files = readdirSync(TOKENS_DIR).filter((f) => f.endsWith(".json")).sort();
  for (const file of files) {
    const json = JSON.parse(readFileSync(path.join(TOKENS_DIR, file), "utf8"));
    for (const [key, value] of Object.entries(json)) {
      if (key.startsWith("$")) continue;
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

/** Semantic color-токен по dotted-пути → разрешённое строковое значение (oklch/hex). */
function semanticColor(tree, dotted) {
  const node = getNode(tree, dotted);
  if (!node || node.$type !== "color") throw new Error(`Не цветовой токен: ${dotted}`);
  return resolveTokenValue(tree, node);
}

// ---------------------------------------------------------------------------
// oklch ↔ sRGB: стандартная математика (Björn Ottosson), как рендерит браузер
// ---------------------------------------------------------------------------

const OKLAB_TO_LMS = [
  [1, 0.3963377774, 0.2158037573],
  [1, -0.1055613458, -0.0638541728],
  [1, -0.0894841775, -1.291485548],
];
const LMS_TO_LINEAR_SRGB = [
  [4.0767416621, -3.3077115913, 0.2309699292],
  [-1.2684380046, 2.6097574011, -0.3413193965],
  [-0.0041960863, -0.7034186147, 1.707614701],
];
const LINEAR_SRGB_TO_LMS = [
  [0.4122214708, 0.5363325363, 0.0514459929],
  [0.2119034982, 0.6806995451, 0.1073969566],
  [0.0883024619, 0.2817188376, 0.6299787005],
];
const LMS_TO_OKLAB = [
  [0.2104542553, 0.793617785, -0.0040720468],
  [1.9779984951, -2.428592205, 0.4505937099],
  [0.0259040371, 0.7827717662, -0.808675766],
];

function gammaEncode(c) {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, v)) * 255);
}

function gammaDecode(byte) {
  const c = byte / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function mul3(m, v) {
  return m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
}

/** "oklch(55.4% 0.046 257.417)" → hex "#62748e". L может быть в % или долей. */
function oklchToHex(str) {
  const m = str.match(/^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)\s*\)$/);
  if (!m) throw new Error(`Не oklch-значение: ${str}`);
  const L = (m[2] === "%" ? Number(m[1]) / 100 : Number(m[1]));
  const C = Number(m[3]);
  const hDeg = Number(m[4]);
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const lms = mul3(OKLAB_TO_LMS, [L, a, b]).map((x) => x ** 3);
  const [r, g, bl] = mul3(LMS_TO_LINEAR_SRGB, lms);
  const hex = (x) => gammaEncode(x).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(bl)}`;
}

/** hex → [L, C, H] (H в градусах, 0–360). Для round-trip проверки конвертации. */
function hexToOklch(hex) {
  const plain = hex.replace("#", "");
  const rgb = [0, 2, 4].map((i) => gammaDecode(parseInt(plain.slice(i, i + 2), 16)));
  const lms = mul3(LINEAR_SRGB_TO_LMS, rgb).map((x) => Math.cbrt(x));
  const [L, a, b] = mul3(LMS_TO_OKLAB, lms);
  const C = Math.sqrt(a * a + b * b);
  let H = (Math.atan2(b, a) * 180) / Math.PI;
  if (H < 0) H += 360;
  return [L, C, H];
}

/** Round-trip hex → oklch (float) → sRGB hex: якорная проверка конвертации. */
function roundTrip(hex) {
  const [L, C, H] = hexToOklch(hex);
  const norm = `oklch(${(L * 100).toFixed(4)}% ${C.toFixed(6)} ${H.toFixed(4)})`;
  return oklchToHex(norm);
}

// ---------------------------------------------------------------------------

function main() {
  // 1. Якорная проверка конвертации: round-trip обязан возвращать исходный hex.
  //    #dc2626/#62748e — v3-якоря, #4f39f6/#e7000b — v4-рендер насыщенных шагов.
  const anchors = ["#dc2626", "#62748e", "#4f39f6", "#e7000b"];
  const anchorResults = anchors.map((hex) => ({ hex, back: roundTrip(hex) }));
  const bad = anchorResults.filter((r) => r.back !== r.hex);
  for (const r of anchorResults) {
    console.log(`round-trip ${r.hex} → oklch → ${r.back} ${r.back === r.hex ? "ok" : "MISMATCH"}`);
  }
  if (bad.length > 0) {
    console.error(`Конвертация oklch→sRGB не прошла round-trip на якорях: ${bad.map((r) => r.hex).join(", ")}`);
    process.exit(1);
  }

  // 2. Резолв semantic-цветов → hex (oklch конвертируется, hex проходит как есть).
  const tree = loadTokens();
  const resolve = (dotted) => {
    const value = semanticColor(tree, dotted);
    return value.startsWith("#") ? value.toLowerCase() : oklchToHex(value);
  };

  const color = (dotted) => ({ $type: "color", $value: resolve(dotted) });
  const semantic = {
    // Канонические пути набора (полная выкладка semantic-цветов в hex).
    text: {
      ink: {
        strong: color("text.ink.strong"),
        body: color("text.ink.body"),
        muted: color("text.ink.muted"),
        faint: color("text.ink.faint"),
      },
    },
    surface: {
      page: color("surface.page"),
      card: color("surface.card"),
      raised: color("surface.raised"),
      subtle: color("surface.subtle"),
      "subtle-strong": color("surface.subtle-strong"),
    },
    border: {
      default: color("border.default"),
      strong: color("border.strong"),
    },
    action: {
      primary: color("action.primary"),
      "primary-hover": color("action.primary-hover"),
      "primary-text": color("action.primary-text"),
      ton: color("action.ton"),
      "ton-hover": color("action.ton-hover"),
      "ton-text": color("action.ton-text"),
      destructive: color("action.destructive"),
      "destructive-text": color("action.destructive-text"),
    },
    feedback: Object.fromEntries(
      ["success", "warning", "error", "info"].map((kind) => [
        kind,
        { bg: color(`feedback.${kind}.bg`), text: color(`feedback.${kind}.text`) },
      ]),
    ),
    component: {
      "money-zero": color("component.money-zero"),
    },
    // Псевдонимы под схему официального валидатора кита (validate_contrast.py):
    // его обязательные/ advisory-пары читают semantic.text.primary/secondary/tertiary/link/on-action.
    // Маппинг на студийные правила: primary = основной текст (ink.body),
    // secondary = floor контентного текста (ink.muted), tertiary = декоративный (ink.faint),
    // link/on-action — из action-слоя.
    extra: {
      primary: color("text.ink.body"),
      secondary: color("text.ink.muted"),
      tertiary: color("text.ink.faint"),
      link: color("action.primary"),
      "on-action": color("action.primary-text"),
      "on-ton": color("action.ton-text"),
      "on-destructive": color("action.destructive-text"),
    },
  };

  // Валидатор читает semantic.text.primary и т.д. — поднимаем псевдонимы в text.
  Object.assign(semantic.text, semantic.extra);
  delete semantic.extra;

  const out = {
    $schema: "https://design-tokens.github.io/community-group/format/",
    $description: [
      "GENERATED — не править руками. Hex-слепок semantic-цветов Bullgram:",
      "node design/contrast-snapshot.mjs (резолв алиасов design/tokens + oklch→sRGB,",
      "round-trip проверен на #dc2626, #62748e, #4f39f6, #e7000b).",
      "Назначение: python3 ~/.zcode/ux-ui-agent-skills/scripts/validate_contrast.py /tmp/bullgram-contrast.json",
      "Известный ожидаемый FAIL валидатора: semantic.border.strong ≥ 3:1 (WCAG 1.4.11), slate-300 на slate-50.",
    ].join(" "),
    semantic,
  };
  writeFileSync(OUT_FILE, `${JSON.stringify(out, null, 2)}\n`);

  const count = JSON.stringify(semantic).match(/"\$value"/g).length;
  console.log(`semantic-цветов разрешено и записано: ${count} → ${OUT_FILE}`);
  console.log(`ключевые: ink.muted=${semantic.text.secondary.$value} border.strong=${semantic.border.strong.$value} action.primary=${semantic.action.primary.$value}`);
  console.log(`далее: python3 ~/.zcode/ux-ui-agent-skills/scripts/validate_contrast.py ${OUT_FILE}`);
  console.log(`ожидаемо exit 1: единственный FAIL — border.strong ≥ 3:1 (известный, WCAG 1.4.11).`);
}

main();
