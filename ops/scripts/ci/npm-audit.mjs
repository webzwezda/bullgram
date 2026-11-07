// gate-08 core: npm audit по lockfiles всех рантаймов (--package-lock-only,
// без установки). Блокируют high/critical в PROD-зависимостях, кроме
// задокументированных исключений в npm-audit-baseline.json.
// Запуск: node ops/scripts/ci/npm-audit.mjs  (вызывается gate-08-npm-audit.sh)
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const RUNTIMES = [".", "backend", "admin-v2", "site-v2", "userbot-v2", "bots-v2", "treasury-v2", "profile-v2", "docs-site", "blog-site"];
const BASELINE_PATH = join(dirname(fileURLToPath(import.meta.url)), "npm-audit-baseline.json");

function loadBaseline() {
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  } catch {
    return {};
  }
}

function ghsaIds(vuln) {
  const ids = new Set();
  for (const via of vuln.via ?? []) {
    if (typeof via === "object" && via.url) {
      const m = via.url.match(/GHSA-[A-Za-z0-9-]+/);
      if (m) ids.add(m[0]);
    }
  }
  return ids;
}

const baseline = loadBaseline();
const ignored = new Set(Object.keys(baseline));
let fail = 0;
const usedIgnored = new Set();

console.log("==> gate-08: npm audit (--omit=dev --audit-level=high, --package-lock-only)");

for (const rt of RUNTIMES) {
  const dir = rt === "." ? ROOT : join(ROOT, rt);
  const res = spawnSync("npm", ["audit", "--omit=dev", "--audit-level=high", "--package-lock-only", "--json"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 120_000,
  });
  if (res.error || !res.stdout) {
    console.error(`FAIL: ${rt}: npm audit не выполнился: ${res.error?.message ?? res.stderr?.slice(0, 200)}`);
    fail = 1;
    continue;
  }
  let report;
  try {
    report = JSON.parse(res.stdout);
  } catch {
    console.error(`FAIL: ${rt}: npm audit вернул не-json (registry недоступен?)`);
    fail = 1;
    continue;
  }
  const vulns = report.vulnerabilities ?? {};
  const blocking = [];
  for (const [pkg, vuln] of Object.entries(vulns)) {
    if (vuln.severity !== "high" && vuln.severity !== "critical") continue;
    for (const id of ghsaIds(vuln)) {
      if (ignored.has(id)) {
        usedIgnored.add(id);
        continue;
      }
      blocking.push(`${pkg}: ${vuln.title ?? "vulnerable"} [${id}] fix: ${vuln.fixAvailable === true ? "npm audit fix" : typeof vuln.fixAvailable === "object" ? `npm audit fix --force (${vuln.fixAvailable.version})` : "нет"}`);
    }
  }
  if (blocking.length > 0) {
    console.error(`FAIL: ${rt}:`);
    for (const line of blocking) console.error(`  - ${line}`);
    fail = 1;
  } else {
    console.log(`    ${rt}: OK`);
  }
}

for (const id of ignored) {
  if (!usedIgnored.has(id)) {
    console.error(`FAIL: в baseline висит неиспользуемое исключение ${id} — удали его из npm-audit-baseline.json (фикс вышел или пакет ушёл)`);
    fail = 1;
  }
}

if (fail) {
  console.error("gate-08 FAILED");
  process.exit(1);
}
console.log("gate-08 passed: prod-дерево чисто по high/critical (исключения — только из baseline)");
