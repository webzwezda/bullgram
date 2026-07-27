import { Code2, BookOpen, Boxes, Zap, Shield, FileJson, TerminalSquare, ArrowUpRight } from 'lucide-react';

const API_BASE = 'https://bullgram.xyz/api/external/v1';
const DOCS_BASE = 'https://github.com/anthropics/bullgram/blob/main/docs/integrations';

const transports = [
  {
    name: 'MCP',
    icon: Boxes,
    tagline: 'Для AI-агентов',
    blurb: 'JSON-RPC 2.0 над HTTP. Claude Desktop, Cursor и любой MCP-совместимый агент подключаются одним блоком в config.',
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
    icon: Zap,
    tagline: 'Для автоматизации',
    blurb: 'HTTP + JSON на /api/external/v1/*. OpenAPI 3.0.3, Scalar explorer, типизированные SDK через любой codegen.',
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
    items: [
      { name: 'infra_summary', scope: 'read' },
      { name: 'proxy_preview', scope: 'read' },
      { name: 'proxy_import', scope: 'write' }
    ]
  },
  {
    tag: 'userbot',
    items: [
      { name: 'userbot_list', scope: 'read' },
      { name: 'userbot_health', scope: 'read' },
      { name: 'userbot_dialogs', scope: 'read' },
      { name: 'userbot_messages', scope: 'read' },
      { name: 'userbot_messages_search', scope: 'read' },
      { name: 'userbot_participants', scope: 'read' },
      { name: 'userbot_message_send', scope: 'write' }
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

export function DocsPage() {
  return (
    <section className="docs-page">
      <header className="docs-page__hero">
        <div className="docs-page__eyebrow">
          <Code2 className="w-4 h-4" /> Integrations · v1
        </div>
        <h1>Bullgram API</h1>
        <p>
          Две поверхности — MCP для AI-агентов и REST для автоматизации —
          поверх одних и тех же 10 операций. OpenAPI 3.0.3, typed SDK,
          токены с гранулярными скоупами и audit-логом каждого вызова.
        </p>
        <div className="docs-page__hero-actions">
          <a
            className="site-button site-button--primary"
            href={`${API_BASE}/docs`}
            target="_blank"
            rel="noreferrer"
          >
            <TerminalSquare className="w-4 h-4" /> Открыть API explorer
          </a>
          <a
            className="site-button"
            href={`${API_BASE}/openapi.json`}
            target="_blank"
            rel="noreferrer"
          >
            <FileJson className="w-4 h-4" /> OpenAPI spec
          </a>
        </div>
      </header>

      <div className="docs-page__quickstart">
        <div className="docs-page__quickstart-head">
          <TerminalSquare className="w-4 h-4" /> Быстрый старт
        </div>
        <pre className="docs-page__code"><code>{quickstart}</code></pre>
      </div>

      <div className="docs-page__transports">
        {transports.map((t) => {
          const Icon = t.icon;
          return (
            <article key={t.name} className="docs-page__transport-card">
              <header>
                <div className="docs-page__transport-icon">
                  <Icon className="w-5 h-5" />
                </div>
                <div>
                  <h3>{t.name}</h3>
                  <div className="docs-page__transport-tagline">{t.tagline}</div>
                </div>
              </header>
              <p>{t.blurb}</p>
              <dl className="docs-page__facts">
                {t.facts.map((f) => (
                  <div key={f.k}>
                    <dt>{f.k}</dt>
                    <dd>{f.v}</dd>
                  </div>
                ))}
              </dl>
              <ul className="docs-page__card-links">
                {t.links.map((l) => (
                  <li key={l.href}>
                    <a href={l.href} target="_blank" rel="noreferrer">
                      {l.label} <ArrowUpRight className="w-3 h-3 inline" />
                    </a>
                  </li>
                ))}
              </ul>
            </article>
          );
        })}
      </div>

      <section className="docs-page__operations">
        <header className="docs-page__section-head">
          <h2>10 операций</h2>
          <p>
            Каждая операция доступна через оба транспорта. Скоуп OR-match:
            <code className="docs-page__inline-code">mcp:userbot:read</code> или
            <code className="docs-page__inline-code">api:userbot:read</code> — тот же эффект.
          </p>
        </header>
        <div className="docs-page__op-grid">
          {operationsByTag.map((group) => (
            <div key={group.tag} className="docs-page__op-group">
              <h3>{group.tag}</h3>
              <ul>
                {group.items.map((op) => (
                  <li key={op.name}>
                    <a href={`${DOCS_BASE}/operations/${op.name.replace(/_/g, '-')}.md`} target="_blank" rel="noreferrer">
                      <span className="docs-page__op-name">{op.name}</span>
                      <span className={`docs-page__op-scope docs-page__op-scope--${op.scope}`}>
                        {op.scope}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <a
          className="docs-page__see-all"
          href={`${DOCS_BASE}/operations/README.md`}
          target="_blank"
          rel="noreferrer"
        >
          Все операции — индекс <ArrowUpRight className="w-3.5 h-3.5 inline" />
        </a>
      </section>

      <section className="docs-page__guides">
        <header className="docs-page__section-head">
          <h2>Документация</h2>
          <p>Концепты, гайды и reference. Markdown лежит в репозитории — правки через PR.</p>
        </header>
        <div className="docs-page__guide-grid">
          {guides.map((g) => (
            <a
              key={g.href}
              className="docs-page__guide-card"
              href={g.href}
              target="_blank"
              rel="noreferrer"
            >
              <BookOpen className="w-4 h-4" />
              <div>
                <div className="docs-page__guide-title">{g.title}</div>
                <div className="docs-page__guide-desc">{g.desc}</div>
              </div>
            </a>
          ))}
        </div>
      </section>

      <section className="docs-page__safety">
        <Shield className="w-5 h-5" />
        <div>
          <div className="docs-page__safety-title">Safety by default</div>
          <p>
            Контент из Telegram помечается <code className="docs-page__inline-code">untrusted_content: true</code>,
            токены имеют allowlist по userbot-аккаунтам, каждый вызов пишется в audit-лог.
            Скоупы только read/write по доменам — никаких wildcard-токенов.
          </p>
        </div>
      </section>
    </section>
  );
}
