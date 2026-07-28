import { Code2, Boxes, Zap, Shield, FileJson, TerminalSquare, BookOpen, ArrowUpRight, ArrowRight } from 'lucide-react';
import { Card } from '../components/ui/card.jsx';

const API_BASE = 'https://bullgram.xyz/api/external/v1';
const DOCS_BASE = 'https://github.com/anthropics/bullgram/blob/main/docs/integrations';

const transports = [
  {
    name: 'MCP',
    tagline: 'Для AI-агентов',
    blurb: 'JSON-RPC 2.0 над HTTP. Claude Desktop, Cursor и любой MCP-совместимый агент подключаются одним блоком в config.',
    icon: Boxes,
    bg: 'bg-indigo-600',
    shadow: 'shadow-indigo-500/20',
    facts: [
      { k: 'Endpoint', v: 'POST /api/mcp' },
      { k: 'Protocol', v: 'JSON-RPC 2.0 · MCP 2025-03-26' },
      { k: 'Auth', v: 'Bearer brmcp_…' }
    ],
    links: [
      { label: 'MCP transport', href: `${DOCS_BASE}/transports/mcp.md` },
      { label: 'Claude Desktop setup', href: `${DOCS_BASE}/guides/claude-desktop.md` }
    ]
  },
  {
    name: 'REST',
    tagline: 'Для автоматизации',
    blurb: 'HTTP + JSON на /api/external/v1/*. OpenAPI 3.0.3, Scalar explorer, типизированные SDK через любой codegen.',
    icon: Zap,
    bg: 'bg-amber-500',
    shadow: 'shadow-amber-500/20',
    facts: [
      { k: 'Endpoint', v: '/api/external/v1/*' },
      { k: 'Spec', v: 'OpenAPI 3.0.3' },
      { k: 'Auth', v: 'Bearer brapi_…' }
    ],
    links: [
      { label: 'REST transport', href: `${DOCS_BASE}/transports/rest.md` },
      { label: 'curl cookbook', href: `${DOCS_BASE}/guides/curl-cookbook.md` },
      { label: 'TypeScript SDK', href: `${DOCS_BASE}/guides/sdk.md` }
    ]
  }
];

const operationsByTag = [
  {
    tag: 'proxy',
    accent: 'text-emerald-700',
    items: [
      { name: 'bullgram_infra_summary', slug: 'infra-summary', scope: 'read' },
      { name: 'bullgram_proxy_preview', slug: 'proxy-preview', scope: 'read' },
      { name: 'bullgram_proxy_import', slug: 'proxy-import', scope: 'write' }
    ]
  },
  {
    tag: 'userbot',
    accent: 'text-blue-700',
    items: [
      { name: 'bullgram_userbot_list', slug: 'userbot-list', scope: 'read' },
      { name: 'bullgram_userbot_health', slug: 'userbot-health', scope: 'read' },
      { name: 'bullgram_userbot_dialogs', slug: 'userbot-dialogs', scope: 'read' },
      { name: 'bullgram_userbot_messages', slug: 'userbot-messages', scope: 'read' },
      { name: 'bullgram_userbot_messages_search', slug: 'userbot-messages-search', scope: 'read' },
      { name: 'bullgram_userbot_participants', slug: 'userbot-participants', scope: 'read' },
      { name: 'bullgram_userbot_message_send', slug: 'userbot-message-send', scope: 'write' }
    ]
  }
];

const guides = [
  { title: 'Getting started', desc: '5 минут от выпуска токена до первого запроса.', href: `${DOCS_BASE}/getting-started.md` },
  { title: 'Authentication & tokens', desc: 'Параметры токенов: prefix, hint, purpose, scopes.', href: `${DOCS_BASE}/authentication.md` },
  { title: 'Scopes reference', desc: 'Матрица скоупов по доменам и видам доступа.', href: `${DOCS_BASE}/scopes.md` },
  { title: 'Rate limits', desc: 'Token-bucket, per-token override, реакция на 429.', href: `${DOCS_BASE}/rate-limits.md` },
  { title: 'Errors', desc: 'Канонические коды и стратегии восстановления.', href: `${DOCS_BASE}/errors.md` },
  { title: 'Safety & threat model', desc: 'Prompt injection, token theft, SpamBot, audit evasion.', href: `${DOCS_BASE}/safety.md` },
  { title: 'Security best practices', desc: 'DO/DON’T по хранению токенов и аудиту.', href: `${DOCS_BASE}/guides/security-best-practices.md` },
  { title: 'n8n: collect & analyze', desc: 'Готовый workflow для сбора и классификации постов.', href: `${DOCS_BASE}/guides/n8n-collect-and-analyze.md` },
  { title: 'Contributing & CI', desc: '6 CI gates, как добавить новую операцию.', href: `${DOCS_BASE}/contributing.md` }
];

const quickstart = `# 1. Выпусти токен на /app/integrations
TOKEN="brapi_paste_your_token"

# 2. Smoke test
curl -H "Authorization: Bearer $TOKEN" \\
     https://bullgram.xyz/api/external/v1/me

# 3. Первый вызов операции
curl -H "Authorization: Bearer $TOKEN" \\
     https://bullgram.xyz/api/external/v1/userbots`;

const CARD_CHROME = 'p-0 gap-0 border-0 shadow-lg shadow-slate-200/40 ring-1 ring-slate-200/50 bg-white overflow-hidden rounded-2xl';

function scopeBadge(scope) {
  if (scope === 'write') {
    return 'bg-orange-100 text-orange-700';
  }
  return 'bg-emerald-100 text-emerald-700';
}

export function DocsPage() {
  return (
    <section className="space-y-6">
      {/* Hero */}
      <Card className={CARD_CHROME}>
        <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6">
          <div className="flex flex-row items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-slate-900 flex items-center justify-center text-white shadow-md shadow-slate-500/20 shrink-0">
              <Code2 className="w-6 h-6" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-bold text-slate-900">Bullgram API</h2>
              <p className="text-sm font-medium text-slate-500 mt-0.5 leading-relaxed">
                Две поверхности — MCP для AI-агентов и REST для автоматизации — поверх одних и тех же 10 операций. OpenAPI 3.0.3, typed SDK, токены с гранулярными скоупами и audit-логом каждого вызова.
              </p>
            </div>
            <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white border border-slate-200 text-[11px] font-mono text-slate-600 shrink-0">
              v1 · 2025-03-26
            </span>
          </div>
        </div>
        <div className="p-5 sm:p-6 bg-white">
          <div className="flex flex-col sm:flex-row gap-2">
            <a
              className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold transition-colors shadow-md shadow-indigo-200"
              href={`${API_BASE}/docs`}
              target="_blank"
              rel="noreferrer"
            >
              <TerminalSquare className="w-4 h-4" /> Открыть API explorer
            </a>
            <a
              className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-xl bg-white border border-slate-200 text-slate-700 text-sm font-bold hover:bg-slate-50 transition-colors"
              href={`${API_BASE}/openapi.json`}
              target="_blank"
              rel="noreferrer"
            >
              <FileJson className="w-4 h-4" /> OpenAPI spec
            </a>
          </div>
        </div>
      </Card>

      {/* Transports */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {transports.map((t) => {
          const Icon = t.icon;
          return (
            <Card key={t.name} className={CARD_CHROME}>
              <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6">
                <div className="flex flex-row items-center gap-3.5">
                  <div className={`w-11 h-11 rounded-2xl ${t.bg} flex items-center justify-center text-white shadow-md ${t.shadow} shrink-0`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-2">
                      <h3 className="text-base font-bold text-slate-900">{t.name}</h3>
                      <span className="text-[11px] font-mono text-slate-500">{t.tagline}</span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="p-5 sm:p-6 bg-white space-y-4">
                <p className="text-sm text-slate-600 leading-relaxed">{t.blurb}</p>
                <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4 space-y-2">
                  {t.facts.map((f) => (
                    <div key={f.k} className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-3">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 w-20 shrink-0">{f.k}</div>
                      <code className="text-xs font-mono text-slate-900 break-all">{f.v}</code>
                    </div>
                  ))}
                </div>
                <ul className="space-y-1.5">
                  {t.links.map((l) => (
                    <li key={l.href}>
                      <a
                        href={l.href}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-sm font-semibold text-indigo-600 hover:text-indigo-700"
                      >
                        {l.label}
                        <ArrowUpRight className="w-3.5 h-3.5" />
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Quickstart */}
      <Card className={CARD_CHROME}>
        <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6">
          <div className="flex flex-row items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-emerald-600 flex items-center justify-center text-white shadow-md shadow-emerald-500/20 shrink-0">
              <TerminalSquare className="w-6 h-6" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-bold text-slate-900">Быстрый старт</h2>
              <p className="text-sm font-medium text-slate-500 mt-0.5">
                Токен на <code className="font-mono text-xs text-slate-700">/app/integrations</code>, smoke на
                <code className="font-mono text-xs text-slate-700 ml-1">/me</code>, первый вызов.
              </p>
            </div>
          </div>
        </div>
        <div className="p-5 sm:p-6 bg-white">
          <div className="rounded-2xl bg-slate-900 border border-slate-800 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800 bg-slate-900">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-400/80" />
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400/80" />
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/80" />
              </div>
              <span className="text-[11px] font-mono text-slate-500">quickstart.sh</span>
            </div>
            <pre className="px-4 py-4 text-xs font-mono leading-relaxed text-slate-200 overflow-x-auto"><code>{quickstart}</code></pre>
          </div>
        </div>
      </Card>

      {/* Operations */}
      <Card className={CARD_CHROME}>
        <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6">
          <div className="flex flex-row items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-violet-600 flex items-center justify-center text-white shadow-md shadow-violet-500/20 shrink-0">
              <Boxes className="w-6 h-6" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-bold text-slate-900">10 операций</h2>
              <p className="text-sm font-medium text-slate-500 mt-0.5 leading-relaxed">
                Каждая операция доступна через оба транспорта. Скоуп OR-match:{' '}
                <code className="font-mono text-xs text-slate-700">mcp:userbot:read</code> или{' '}
                <code className="font-mono text-xs text-slate-700">api:userbot:read</code> — тот же эффект.
              </p>
            </div>
          </div>
        </div>
        <div className="p-5 sm:p-6 bg-white">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {operationsByTag.map((group) => (
              <div key={group.tag} className="rounded-2xl bg-slate-50 border border-slate-200 p-4">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-3">{group.tag}</div>
                <ul className="space-y-1">
                  {group.items.map((op) => (
                    <li key={op.name}>
                      <a
                        href={`${DOCS_BASE}/operations/${op.slug}.md`}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center justify-between gap-2 px-2 py-2 rounded-lg hover:bg-white transition-colors group"
                      >
                        <code className="text-xs font-mono text-slate-900 group-hover:text-slate-900">{op.name}</code>
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${scopeBadge(op.scope)}`}>
                          {op.scope}
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="mt-4">
            <a
              href={`${DOCS_BASE}/operations/README.md`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-bold text-indigo-600 hover:text-indigo-700"
            >
              Все операции — индекс
              <ArrowRight className="w-4 h-4" />
            </a>
          </div>
        </div>
      </Card>

      {/* Guides */}
      <Card className={CARD_CHROME}>
        <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6">
          <div className="flex flex-row items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-blue-600 flex items-center justify-center text-white shadow-md shadow-blue-500/20 shrink-0">
              <BookOpen className="w-6 h-6" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-bold text-slate-900">Документация</h2>
              <p className="text-sm font-medium text-slate-500 mt-0.5">
                Концепты, гайды и reference. Markdown лежит в репозитории — правки через PR.
              </p>
            </div>
          </div>
        </div>
        <div className="p-5 sm:p-6 bg-white">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {guides.map((g) => (
              <a
                key={g.href}
                href={g.href}
                target="_blank"
                rel="noreferrer"
                className="flex flex-col gap-1.5 p-4 rounded-2xl bg-slate-50 border border-slate-200 hover:border-indigo-300 hover:bg-white transition-colors group"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm font-bold text-slate-900 group-hover:text-indigo-700">{g.title}</div>
                  <ArrowUpRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-indigo-500 shrink-0 mt-0.5" />
                </div>
                <div className="text-xs text-slate-500 leading-relaxed">{g.desc}</div>
              </a>
            ))}
          </div>
        </div>
      </Card>

      {/* Safety */}
      <Card className={CARD_CHROME}>
        <div className="bg-slate-50/50 border-b border-slate-100 p-5 sm:p-6">
          <div className="flex flex-row items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-amber-500 flex items-center justify-center text-white shadow-md shadow-amber-500/20 shrink-0">
              <Shield className="w-6 h-6" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-bold text-slate-900">Safety by default</h2>
              <p className="text-sm font-medium text-slate-500 mt-0.5 leading-relaxed">
                Контент из Telegram помечается{' '}
                <code className="font-mono text-xs text-slate-700">untrusted_content: true</code>,
                токены имеют allowlist по userbot-аккаунтам, каждый вызов пишется в audit-лог. Скоупы только read/write по доменам — никаких wildcard-токенов.
              </p>
            </div>
          </div>
        </div>
      </Card>
    </section>
  );
}
