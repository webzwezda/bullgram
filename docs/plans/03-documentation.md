# Plan 03 — Documentation System

> **Revision 2** — applied audit findings: site-v2 uses build-time markdown copy (not GitHub raw fetch), added search (Algolia DocSearch), added `assets/` directory, Mermaid renderer configured, removed screenshots in favor of diagrams, defined `getting-started.md` content, added threat model to security-best-practices, removed duplicate UI work (lives only here), updated timeline to ~17 days with parallel execution.

## Goals

Ship a complete, professional documentation suite for Bullgram's external integration surface (MCP + REST API). Documentation must serve three audiences:

1. **AI agent developers** configuring Claude Desktop / Cursor / custom agents
2. **Automation engineers** wiring up n8n / Zapier / Python scripts via REST
3. **SDK users** who want typed clients generated from OpenAPI

### Functional goals

- Single source of truth in `docs/integrations/`, versioned with code, reviewed in PRs
- Operation-first: one page per operation, showing both transports (MCP tool + REST endpoint)
- Auto-generated REST reference from OpenAPI 3.0.3 spec via Scalar
- Hand-written guides for the most common integration patterns
- UI integration: every token in `/app/integrations` links to relevant docs
- Public face: `https://bullgram.xyz/docs` lands external developers on a polished entry page
- Search across all docs (Algolia DocSearch)

### Non-goals

- API reference for internal `/api/*` routes
- User-facing product docs for end-users of paid channels
- Video tutorials
- Translation to non-English languages (per project convention)
- Screenshots (use diagrams instead — they don't rot)

---

## Documentation Architecture

```
                         ┌──────────────────────────┐
                         │  https://bullgram.xyz/docs│
                         │  (site-v2 page)          │
                         └────────────┬──────────────┘
                                      │
                                      ▼
                ┌──────────────────────────────────────────┐
                │  Landing page (server-rendered HTML)     │
                │  - "Get started in 5 minutes"            │
                │  - Links to MCP and REST tracks          │
                │  - Link to interactive explorer          │
                │  - Search bar (Algolia DocSearch)        │
                └────────────┬─────────────────────────────┘
                             │
        ┌────────────────────┼────────────────────────┐
        ▼                    ▼                        ▼
┌────────────────┐  ┌────────────────┐    ┌────────────────────┐
│ Markdown docs  │  │ Scalar API     │    │ README.md          │
│ served from   │  │ Explorer       │    │ (root + backend/)  │
│ site-v2 build │  │ /api/docs      │    │ quickstart links   │
│ (build-time   │  │ (auto from     │    │                    │
│  copy, no     │  │  OpenAPI 3.0.3)│    │                    │
│  runtime fetch)│  │                │    │                    │
└────────────────┘  └────────────────┘    └────────────────────┘
```

Three sources, clear separation:

- **Markdown docs** in repo: long-form guides, conceptual explanations, MCP tool reference, transport-agnostic contracts
- **Scalar API Explorer** at `/api/docs`: live interactive REST reference, auto-generated from OpenAPI (Plan 02). Try-out button. Always in sync with code.
- **README.md** files: 5-minute quickstarts, links to deeper docs

---

## File Layout (revised)

```
docs/
├── README.md                              # NEW — index of all docs
├── integrations/                          # NEW — external integration docs
│   ├── README.md                          # overview, 5-min quickstart
│   ├── getting-started.md                 # issue token, first call (content defined below)
│   ├── authentication.md                  # tokens, scopes, lifecycle
│   ├── scopes.md                          # AUTO-GENERATED from source
│   ├── rate-limits.md                     # limits, retry strategy
│   ├── errors.md                          # error code reference
│   ├── safety.md                          # safe-mode, content sanitization, account hygiene, THREAT MODEL
│   ├── transports/
│   │   ├── mcp.md                         # JSON-RPC protocol, MCP client config
│   │   └── rest.md                        # REST conventions, pagination, versioning
│   ├── operations/                        # one page per operation
│   │   ├── README.md                      # index (AUTO-GENERATED stub + manual narrative)
│   │   ├── list-userbots.md
│   │   ├── get-userbot-health.md
│   │   ├── list-dialogs.md
│   │   ├── fetch-messages.md
│   │   ├── search-messages.md
│   │   ├── send-message.md
│   │   ├── list-participants.md
│   │   ├── proxy-summary.md
│   │   ├── proxy-preview.md
│   │   └── proxy-import.md
│   ├── guides/
│   │   ├── n8n-collect-and-analyze.md     # primary use case
│   │   ├── n8n-cross-post.md              # broadcast pattern
│   │   ├── claude-desktop.md              # config + walkthrough
│   │   ├── cursor.md                      # config + walkthrough
│   │   ├── curl-cookbook.md               # copy-paste recipes
│   │   ├── typescript-client.md           # using OpenAPI-generated SDK (post-MVP)
│   │   ├── python-client.md               # using OpenAPI-generated SDK (post-MVP)
│   │   └── security-best-practices.md     # allowed_userbot_ids, rotation, threat model
│   ├── assets/                            # NEW — downloadable artifacts
│   │   ├── n8n-collect-analyze.json       # ready-to-import n8n workflow
│   │   ├── claude-desktop-config.json     # ready-to-edit Claude Desktop config
│   │   └── diagrams/                      # Mermaid source files for diagrams used in docs
│   ├── changelog.md                       # versioned, dated
│   └── support.md                         # how to get help, status page
├── plans/                                 # these three planning docs
│   ├── README.md                          # NEW — "Historical planning docs" disclaimer
│   ├── 01-mcp.md
│   ├── 02-rest-api.md
│   └── 03-documentation.md
└── (existing: autopost_design_spec.md, migration.sql, references/)
```

---

## Site-v2 Integration — Build-Time Copy

Revision 1 had site-v2 fetch markdown from GitHub raw URLs at runtime. **Removed** — too brittle (GitHub downtime, branch renames, private repo, CORS).

### Build-time strategy

Markdown files are copied into site-v2's public dir at build time:

```js
// scripts/copy-docs-to-site.js
import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docsSrc = path.resolve(__dirname, '../docs/integrations');
const docsDest = path.resolve(__dirname, '../site-v2/public/docs');

await mkdir(docsDest, { recursive: true });
await cp(docsSrc, docsDest, { recursive: true });
console.log('Docs copied to site-v2/public/docs');
```

```json
// package.json (root)
{
  "scripts": {
    "build:docs": "node scripts/copy-docs-to-site.js && node scripts/build-scope-docs.js",
    "build:v2": "npm run build:docs && cd site-v2 && npm run build"
  }
}
```

The `npm run build:v2` script (already used by deploy) now also copies docs.

### Rendering on site-v2

site-v2 fetches from its own origin (no CORS issue, no external dependency):

```jsx
// site-v2/src/pages/DocsPage.jsx
import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMermaid from 'remark-mermaidjs';

const DOCS_BASE = '/docs';

export function DocsPage() {
  const [path, setPath] = useState('README.md');
  const [content, setContent] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`${DOCS_BASE}/${path}`)
      .then((r) => r.ok ? r.text() : Promise.reject(r.status))
      .then(setContent)
      .catch((e) => setError(e));
  }, [path]);

  if (error) return <div>Failed to load docs. <a href="https://github.com/webzwezda/bullrun/tree/main/docs/integrations">View on GitHub</a></div>;

  return (
    <div className="docs-container">
      <nav>
        <a onClick={() => setPath('README.md')}>Home</a>
        <a onClick={() => setPath('getting-started.md')}>Getting started</a>
        <a onClick={() => setPath('transports/mcp.md')}>MCP</a>
        <a onClick={() => setPath('transports/rest.md')}>REST</a>
        <a onClick={() => setPath('operations/README.md')}>Operations</a>
        <a onClick={() => setPath('guides/n8n-collect-and-analyze.md')}>n8n guide</a>
      </nav>
      <article>
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMermaid]}
          components={{
            a: ({ node, ...props }) => /* rewrite .md links to internal navigation */ null
          }}
        >
          {content}
        </ReactMarkdown>
      </article>
    </div>
  );
}
```

### Bundle impact

- `react-markdown` + `remark-gfm` + `remark-mermaidjs`: ~80KB gzipped
- Acceptable for a docs page (lazy-loaded only when user visits `/docs`)

### Routing

```jsx
// site-v2/src/App.jsx
<Route path="/docs" element={<DocsPage />} />
<Route path="/docs/*" element={<DocsPage />} />
```

### Fallback

If fetch fails (e.g., user visits old docs URL after rename), show "View on GitHub" link. Never a hard failure.

---

## Search — Algolia DocSearch

DocSearch is **free for open-source projects** (Bullgram is AGPL-3.0). Application: https://docsearch.algolia.com/apply/

Once approved:

```jsx
// site-v2/src/pages/DocsPage.jsx
import { DocSearch } from '@docsearch/js';
import '@docsearch/css';

useEffect(() => {
  DocSearch({
    container: '#docsearch',
    appId: process.env.ALGOLIA_APP_ID,
    apiKey: process.env.ALGOLIA_API_KEY,
    indexName: 'bullgram-docs',
    debug: false
  });
}, []);
```

Algolia crawls `bullgram.xyz/docs/*` daily, indexes content, provides search-as-you-type.

### Pre-approval fallback

While waiting for approval (1-2 weeks), use `lunr.js` for client-side search over the build-time docs copy:

```jsx
import lunr from 'lunr';

const index = lunr(function() {
  this.ref('path');
  this.field('title');
  this.field('content');
  for (const doc of allDocsManifest) this.add(doc);
});
```

`allDocsManifest` is built by `scripts/copy-docs-to-site.js` — walks `docs/integrations/`, strips frontmatter, indexes each file.

Swap to DocSearch when approved. Both use the same search box UI.

---

## Mermaid Diagrams

All diagrams use Mermaid syntax (text-based, version-controllable). Rendered client-side via `remark-mermaidjs`:

```markdown
\`\`\`mermaid
graph LR
  A[HTTP Request] --> B[Auth Middleware]
  B --> C[Dispatcher]
  C --> D[UserbotService]
\`\`\`
```

Renderer bundled with `react-markdown` plugins. No screenshots required.

### Why not screenshots

- Screenshots rot when UI changes
- Hard to localize
- Not accessible (need alt text per screenshot)
- Cannot be diffed in PRs
- Take time to capture and edit

Diagrams in source are PR-reviewable, change with code, accessible.

---

## Operation Page Template

Same as revision 1 — see example below. Pages are partially auto-generated from `shared/operations.js` (stub with name, schemas, examples) + hand-written narrative.

```markdown
# Fetch messages

> Read messages from a chat the userbot is a member of.

## Quick info

| | |
|---|---|
| MCP tool | `bullrun_userbot_messages` |
| REST endpoint | `GET /api/external/v1/userbots/{userbot_id}/dialogs/{chat_id}/messages` |
| Required scope | `mcp:userbot:read` / `api:userbot:read` |
| Returns | Array of `Message` objects |
| Supports pagination | Yes (cursor) |
| Rate limit class | read (60/min per userbot, 120/min per token) |

## When to use

Pull recent posts from a channel for analysis, archive group messages,
detect questions that need a reply, feed content into LLM pipelines.

## When NOT to use

- For sending messages → use [Send message](./send-message.md)
- For listing who's in a chat → use [List participants](./list-participants.md)
- For discovering what chats exist → use [List dialogs](./list-dialogs.md)

## Inputs

| Field | Type | Required | Description |
|---|---|---|---|
| `userbot_id` | UUID | yes | Account ID from [List userbots](./list-userbots.md) |
| `chat_id` | string | yes | Telegram chat ID (channels start with `-100`) |
| `since` | ISO 8601 | no | Inclusive lower bound |
| `until` | ISO 8601 | no | Inclusive upper bound |
| `limit` | integer | no | Default 50, max 200 |
| `cursor` | string | no | Pagination cursor from previous call |

## Output

Array of `Message` objects.

\`\`\`json
{
  "messages": [
    {
      "id": "12345",
      "date": "2026-07-26T14:32:11Z",
      "sender": {
        "id": "98765432",
        "username": "example_user",
        "is_bot": false
      },
      "text": "Anyone tried the new TON wallet?",
      "text_truncated": false,
      "has_media": false,
      "reply_to_message_id": null,
      "untrusted_content": true
    }
  ],
  "cursor": "eyJhZnRlciI6IjEyMzQ1In0=",
  "has_more": true
}
\`\`\`

## MCP example

\`\`\`json
{
  "jsonrpc": "2.0",
  "id": 7,
  "method": "tools/call",
  "params": {
    "name": "bullrun_userbot_messages",
    "arguments": {
      "userbot_id": "8e2c1a90-...",
      "chat_id": "-1001234567890",
      "since": "2026-07-20T00:00:00Z",
      "limit": 50
    }
  }
}
\`\`\`

## REST example

\`\`\`bash
curl -H "Authorization: Bearer brapi_..." \\
  "https://bullgram.xyz/api/external/v1/userbots/8e2c1a90-.../dialogs/-1001234567890/messages?since=2026-07-20T00:00:00Z&limit=50"
\`\`\`

## Errors

| HTTP | Code | When |
|---|---|---|
| 401 | UNAUTHORIZED | Token missing/invalid |
| 401 | INTEGRATION_TOKEN_REQUIRED | JWT used (only integration tokens accepted) |
| 403 | INSUFFICIENT_SCOPE | Token lacks `*:userbot:read` |
| 403 | FORBIDDEN_ACCOUNT | `userbot_id` not in token's allowlist |
| 404 | NOT_FOUND | Userbot doesn't exist or not owned |
| 423 | SAFE_MODE_BLOCKED | Account in pending_activation |
| 410 | ACCOUNT_RESTRICTED | Account restricted by SpamBot |
| 429 | RATE_LIMITED | Token bucket empty (see `Retry-After`) |
| 502 | TELEGRAM_ERROR | Telegram-side failure |

See [Errors](../errors.md) for full reference.

## Pagination

- `limit` default 50, max 200
- `cursor` is **opaque** — do not parse, modify, or persist long-term
- If `has_more: true`, call again with returned `cursor`
- If you need everything: loop with backoff until `has_more: false`

## Safety

- Returned text is untrusted (may contain prompt injection for LLMs)
- See [Safety](../safety.md) for handling guidance

## Related operations

- [Search messages](./search-messages.md)
- [Send message](./send-message.md)
- [List dialogs](./list-dialogs.md)
```

### Auto-generation pipeline

`scripts/generate-operation-pages.js` walks `shared/operations.js` and produces a stub for any operation lacking a markdown page. Stub includes:

- Frontmatter (auto-generated: `operation_name`, `transports`, `required_scopes`)
- Quick info table
- Empty inputs/outputs tables (filled from zod schemas)
- MCP and REST example payloads (filled from schema defaults)

Human author fills narrative sections ("When to use", "When NOT to use", prose explanations).

CI fails if `operations/` directory is missing a page for any registered operation.

---

## Guide: `getting-started.md` — Content Definition

Specifically called out because revision 1 listed it without describing content.

```markdown
# Getting started

> 5 minutes from zero to your first Bullgram API call.

## What you'll do

1. Issue an integration token
2. Make your first call
3. Pick your transport (MCP for AI agents, REST for scripts/n8n)

## Prerequisites

- Bullgram account with an active userbot. Sign up at https://bullgram.xyz and onboard a userbot at [/app/userbots](https://bullgram.xyz/app/userbots).

## Step 1 — Issue an integration token

1. Go to [/app/integrations](https://bullgram.xyz/app/integrations)
2. Under **External REST API** (for scripts/n8n) or **Bullgram MCP** (for AI agents), click **Issue**
3. Scope: **Read-only** for your first token (safe default)
4. Allowed userbots: pick the one(s) you want this token to access
5. Copy the token immediately (`brapi_...` or `brmcp_...`). It won't be shown again.

## Step 2 — Make your first call (REST)

\`\`\`bash
TOKEN="brapi_..."

curl -H "Authorization: Bearer $TOKEN" \\
  https://bullgram.xyz/api/external/v1/userbots
\`\`\`

Response:

\`\`\`json
{
  "data": [
    {
      "id": "8e2c1a90-...",
      "tg_username": "my_userbot",
      "runtime_status": "active"
    }
  ]
}
\`\`\`

## Step 3 — Make your first call (MCP)

If you're using an MCP-aware agent (Claude Desktop, Cursor), add this to your client config:

\`\`\`jsonc
{
  "mcpServers": {
    "bullgram": {
      "transport": { "type": "http", "url": "https://bullgram.xyz/api/mcp" },
      "auth": { "type": "bearer", "token": "brmcp_..." }
    }
  }
}
\`\`\`

Restart your client. Verify tools are visible:

\`\`\`bash
curl -X POST https://bullgram.xyz/api/mcp \\
  -H "Authorization: Bearer brmcp_..." \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
\`\`\`

## Step 4 — Pick your path

- **I want AI agents to do things** → read [MCP transport guide](./transports/mcp.md)
- **I want to script things (Python, n8n, Zapier)** → read [REST transport guide](./transports/rest.md)
- **I want copy-paste recipes** → [curl cookbook](./guides/curl-cookbook.md)
- **I want a real-world example** → [n8n: collect and analyze posts](./guides/n8n-collect-and-analyze.md)

## What's next

- Browse the [operations index](./operations/README.md)
- Read about [authentication](./authentication.md) for scope/allowlist details
- Read about [safety](./safety.md) to understand account restrictions

## Troubleshooting

**401 UNAUTHORIZED** — token is missing or revoked. Re-issue at `/app/integrations`.

**403 INSUFFICIENT_SCOPE** — token doesn't have the required scope. Issue a new token with the right scope, or use the existing token for read-only operations only.

**423 SAFE_MODE_BLOCKED** — your userbot is in safe-mode. Activate it at `/app/userbots` first (requires the userbot to pass a live Telegram check).

**429 RATE_LIMITED** — too many calls. Wait `Retry-After` seconds. If persistent, contact support for higher quota.

See [Errors](./errors.md) for full reference.
```

---

## Guide: `security-best-practices.md` — Threat Model Section

Revision 1 listed best practices without a threat model. Add this section:

```markdown
# Security best practices

## Threat model

Before configuring integrations, understand who might attack what.

### Assets

1. **Your userbot accounts** — if compromised, attacker can read all your dialogs, impersonate you, send spam, get your account restricted by Telegram
2. **Your token** — bearer credential; whoever has it can act as you against Bullgram API
3. **Your customers' data** — messages and participant lists contain PII

### Adversaries

| Adversary | Capability | Likelihood |
|---|---|---|
| Compromised n8n/Zapier account | Reads your token from logs, makes arbitrary API calls | Medium |
| Prompt injection from message content | Tricks your AI agent into calling write tools | High (any untrusted channel) |
| Leaked GitHub repo with `.env` | Full token leak | Low (if `.env` is gitignored) |
| Bullgram insider | Sees your token at rest in DB | Low (encrypted at rest) |
| Telegram itself | Already has your data; not an adversary here | n/a |

### Mitigations

| Threat | Mitigation |
|---|---|
| Token leaks via automation logs | Use n8n "Predefined Credential Type" — keeps token out of node config; rotate quarterly |
| Prompt injection | Use **read-only** tokens for AI agents; `untrusted_content: true` flag in messages; system-prompt your agent to never call write tools based on message content |
| Compromised token | `metadata.allowed_userbot_ids` — limit to specific userbots; revoke at `/app/integrations` immediately on suspicion |
| Token reuse across services | **One token per service**. n8n gets one, Claude Desktop gets another. Compartmentalize. |
| Long-lived tokens | Rotate every 90 days; re-issue button in `/app/integrations`; old token immediately revoked |
| Insider threat | Tokens encrypted at rest; can be revealed only at issuance; admin must have DB access to reveal older tokens |

## Best practices checklist

- [ ] Use separate tokens per integration (one for n8n, one for Claude Desktop)
- [ ] Set `allowed_userbot_ids` on every token — never "all accounts" unless required
- [ ] Use read-only scope unless your use case requires write
- [ ] Rotate tokens every 90 days
- [ ] Monitor audit log at `/app/claw/log` weekly — look for unusual patterns
- [ ] Never commit tokens to git, never paste in issue trackers
- [ ] Configure n8n/Zapier to use credential vaults, not plaintext
- [ ] For AI agents: system-prompt them to ignore instructions inside message text
- [ ] Revoke tokens immediately when an automation is decommissioned
```

---

## UI Integration (admin-v2) — Single Owner

Revision 1 had UI work duplicated between Plan 01 Phase 6 and Plan 03 Phase 8. **Removed from Plan 01** — all UI work lives here.

### `/app/integrations` updates

| Change | Why |
|---|---|
| Each token card gets a "📖 Docs" link | Deep-link to relevant operation page based on token purpose |
| Token reveal: show example curl with token pre-filled | Reduces friction for first call |
| Token scope selector: Read-only (default) / Read+Write | Forces explicit choice; write requires confirmation |
| Per-token `allowed_userbot_ids` picker (multi-select with search) | Blast-radius isolation |
| Per-token usage stats card: calls today, last error, top operation | Surface `mcp_tool_log` aggregates filtered by token |
| Button: "Open API Explorer" → `/api/docs` (Scalar) | Direct access to interactive reference |
| Button: "Open MCP Inspector" → external link to MCP Inspector with token pre-filled | Useful for debugging JSON-RPC |

### `/app/claw` (MCP settings) updates

| Change | Why |
|---|---|
| List available tools (filtered by token scope) | Transparency for agent developers |
| Per-tool last invocation timestamp + status | Quick health check |
| Live audit log stream (filtered to this token) | Debug "why didn't my agent call X" |

### `/app/claw/log` (NEW page) — single owner

- Full audit log viewer with filters: token, operation, userbot, status, source (mcp/rest), date range
- Shows both `source='mcp'` and `source='rest'` in unified stream
- Per-row expand: shows arguments_hash, latency, error details
- Export to CSV (admin only)
- 90-day retention, older rows auto-purged by pg_cron job (Plan 01 Migration 3)

---

## README Updates

### Root `README.md`

Add new section:

```markdown
## Integrations

Bullgram exposes two integration surfaces, both backed by the same
operations:

- **MCP** for AI agents (Claude Desktop, Cursor) — see [docs/integrations/transports/mcp.md](./docs/integrations/transports/mcp.md)
- **REST API** for automation (n8n, scripts, SDKs) — see [docs/integrations/transports/rest.md](./docs/integrations/transports/rest.md)

Issue tokens at [/app/integrations](https://bullgram.xyz/app/integrations).
Browse the interactive API reference at [https://bullgram.xyz/api/docs](https://bullgram.xyz/api/docs).

Quick start: [docs/integrations/getting-started.md](./docs/integrations/getting-started.md)
```

### `backend/README.md`

Add reference:

```markdown
## External surfaces

- `POST /api/mcp` — MCP server (JSON-RPC 2.0) — see [docs/integrations/transports/mcp.md](../docs/integrations/transports/mcp.md)
- `/api/external/v1/*` — REST API — see [docs/integrations/transports/rest.md](../docs/integrations/transports/rest.md)

Internal `/api/*` routes are for the web app only and are not documented externally.
```

### `docs/plans/README.md` (NEW)

```markdown
# Planning documents

These three plans (`01-mcp.md`, `02-rest-api.md`, `03-documentation.md`)
describe the design and phasing for Bullgram's external integration
surface (MCP + REST API + documentation).

**Status:** historical design artifacts. Once the code ships, the
canonical reference is:

- Code in `backend/shared/`, `backend/mcp/`, `backend/external/`
- Live docs at `https://bullgram.xyz/docs`
- Interactive API at `https://bullgram.xyz/api/docs`

Plans are kept for context — they explain *why* the code is shaped the
way it is. They are not updated after implementation begins.
```

---

## Documentation Build Pipeline

### `package.json` (root) new scripts

```json
{
  "scripts": {
    "build:openapi": "node scripts/build-openapi.js",
    "build:scope-docs": "node scripts/build-scope-docs.js",
    "generate:operation-pages": "node scripts/generate-operation-pages.js",
    "copy:docs-to-site": "node scripts/copy-docs-to-site.js",
    "build:docs": "npm run build:openapi && npm run build:scope-docs && npm run generate:operation-pages && npm run copy:docs-to-site",
    "validate:openapi": "node scripts/validate-openapi.js",
    "check:docs-links": "node scripts/check-docs-links.js",
    "validate:doc-snippets": "node scripts/validate-doc-snippets.js"
  }
}
```

### CI gates (`.github/workflows/deploy.yml`)

```yaml
- name: Build OpenAPI spec
  run: npm run build:openapi
- name: Validate OpenAPI spec
  run: npm run validate:openapi
- name: Check docs in sync
  run: |
    git diff --exit-code docs/integrations/scopes.md || (echo "scopes.md out of sync — run npm run build:scope-docs" && exit 1)
    git diff --exit-code backend/external/openapi/generated.json || (echo "openapi spec out of sync — run npm run build:openapi" && exit 1)
- name: Check operations pages exist
  run: |
    npm run generate:operation-pages
    git diff --exit-code docs/integrations/operations/ || (echo "operation page stubs missing" && exit 1)
- name: Check doc links resolve
  run: npm run check:docs-links
- name: Validate code snippets
  run: npm run validate:doc-snippets
```

Six CI gates. Drift = CI fail.

---

## Content Style Guide

Same as revision 1 — direct voice, imperative for steps, concrete examples, English only.

### Token / ID conventions

- Tokens look real but are clearly fake: `brmcp_abcd1234_efgh5678...`
- UUIDs valid format but obviously documentation: `8e2c1a90-...`
- Telegram chat IDs use `-100` prefix for channels: `-1001234567890`
- All examples use `https://bullgram.xyz` (production domain)

### Diagrams

Mermaid only. No screenshots. Diagrams are PR-reviewable text.

---

## Implementation Phases (revised)

### Phase 1 — Skeleton (0.5 day)

1. Create `docs/integrations/` directory with empty files for all planned pages
2. Create `docs/plans/README.md` with "historical" disclaimer
3. Update root `README.md` and `backend/README.md` with stub Integrations section pointing at `docs/integrations/README.md`

### Phase 2 — Operations pages (2 days) — runs in parallel with Plan 01/02 Phase 1-3

These can be written before code is shipped; they double as the spec.

1. Write `scripts/generate-operation-pages.js` to produce stubs from `shared/operations.js`
2. Fill each of 10 operation pages following the template
3. Source of truth for tool names, input schemas, error codes
4. Plan 01/02 reference these pages for behavior contracts

### Phase 3 — Transport pages (1 day)

1. `transports/mcp.md` — JSON-RPC envelope, initialize handshake, MCP client config (Claude Desktop JSON, Cursor JSON), examples
2. `transports/rest.md` — URL conventions, pagination, versioning, error response shape, common headers, rate limit headers
3. Cross-link to relevant operations

### Phase 4 — Conceptual pages (1 day)

1. `authentication.md` — token issuance flow, purpose vs scope, allowlist, rotation, revocation
2. `scopes.md` — auto-generated (Phase 6) + manual narrative
3. `rate-limits.md` — defaults, per-class (read/write), retry strategy, when to contact support
4. `errors.md` — full error code table with examples and recovery guidance
5. `safety.md` — safe-mode, content sanitization, account hygiene, anti-prompt-injection
6. `getting-started.md` — 5-min quickstart (content defined above)
7. `guides/security-best-practices.md` — threat model + best practices checklist

### Phase 5 — Guides (2 days)

1. `n8n-collect-and-analyze.md` — primary use case from project conversation
2. `n8n-cross-post.md` — broadcast pattern
3. `claude-desktop.md` — config + walkthrough
4. `cursor.md` — config + walkthrough
5. `curl-cookbook.md` — 10 copy-paste recipes
6. `typescript-client.md` — using `@bullgram/api-client` (post-MVP, marked Coming soon)
7. `python-client.md` — using `bullgram-api` (post-MVP, marked Coming soon)

### Phase 6 — Build pipeline & auto-generation (1 day)

1. `scripts/build-openapi.js` (depends on Plan 02)
2. `scripts/build-scope-docs.js`
3. `scripts/validate-openapi.js` (uses `@apidevtools/swagger-parser`)
4. `scripts/generate-operation-pages.js`
5. `scripts/copy-docs-to-site.js`
6. `scripts/check-docs-links.js` — verifies all internal `[](./...)` links resolve
7. `scripts/validate-doc-snippets.js` — validates JSON/bash syntax of every fenced code block
8. CI integration in `.github/workflows/deploy.yml`

### Phase 7 — Site-v2 public docs page (1.5 days)

1. New `site-v2/src/pages/DocsPage.jsx` with hero, two cards, quickstart, search
2. Install `react-markdown`, `remark-gfm`, `remark-mermaidjs`, `@docsearch/js` (or `lunr` fallback)
3. Route registration in `site-v2/src/App.jsx`
4. Lazy-load the DocsPage to avoid bloating initial bundle
5. Link from site-v2 header / footer
6. SEO meta tags (title, description, og:image)

### Phase 8 — UI integration (1.5 days) — single owner

1. `IntegrationsPage` (`/app/integrations`): add scope selector, allowlist picker, usage stats, "Open API Explorer" button
2. `McpSettingsPage` (`/app/claw`): add tool list with availability, per-tool last-invocation status
3. New `/app/claw/log` page: audit log viewer with filters
4. Token reveal: show example curl with token pre-filled
5. (Plan 01 Phase 6 was removed — this is the single owner of all UI work)

### Phase 9 — Polish (0.5 day)

1. Proofread all pages
2. Verify every internal link resolves (script passes)
3. Verify every code snippet is valid syntax (script passes)
4. Add `docs/integrations/changelog.md` initial entry: `## v1.0.0 — Initial release`
5. Add `docs/integrations/support.md` with contact channels (link to GitHub Issues for now; defer status page)

**Total: ~11 days.** Runs in parallel with Plan 01/02 — critical path is ~17 days for everything end-to-end (Plan 01: 6d + Plan 02: 5.5d overlap with Plan 03: 11d).

---

## Realistic Timeline

### Sequential (worst case)

Plan 01 (6d) → Plan 02 (5.5d) → Plan 03 (11d) = **22.5 days**

### Parallel (best case)

```
Week 1 (Days 1-5):
  - Plan 01 Phase 1 (shared infra)         1d
  - Plan 02 Phase 1 (foundation)           1d  (after Plan 01 P1)
  - Plan 03 Phase 1 (skeleton)             0.5d (parallel)
  - Plan 03 Phase 2 (operation pages)      2d  (parallel — spec-first)
  - Plan 01 Phase 2-3 (singleton, migrate) 1.5d
  - Plan 01 Phase 4 (service helpers)      1.5d (overlaps Week 2)

Week 2 (Days 6-10):
  - Plan 01 Phase 5-7 (tools, sanitizer, hardening)  2.5d
  - Plan 02 Phase 2-3 (zod schemas, OpenAPI, handlers) 3d
  - Plan 03 Phase 3-4 (transport, conceptual)        2d  (parallel)
  - Plan 03 Phase 5 (guides)                         2d  (parallel)

Week 3 (Days 11-15):
  - Plan 02 Phase 4-5 (hardening, doc sync)         1.5d
  - Plan 03 Phase 6 (build pipeline)                1d
  - Plan 03 Phase 7 (site-v2 docs page)             1.5d
  - Plan 03 Phase 8 (UI integration)                1.5d

Week 3-4 (Days 16-17):
  - Plan 03 Phase 9 (polish)                        0.5d
  - Buffer for integration issues                   0.5d
```

**Realistic elapsed: ~17 days** for one developer, focused.

---

## Maintenance Strategy

### Docs live with code

- Each operation page is in the same PR as the operation implementation
- When behavior changes, docs change in the same commit
- CI fails if `scopes.md`, `generated.json`, or operation page stubs drift

### Reviewers

- Code reviewer checks docs in same PR
- For breaking changes: tag with `docs-breaking` label, requires maintainer sign-off

### Changelog discipline

- Every external-facing change adds an entry to `docs/integrations/changelog.md`
- Format: `## [YYYY-MM-DD] — description`
- Link from `docs/integrations/README.md`

### Link/script automation (replaces "quarterly audit")

- `npm run check:docs-links` runs in CI — every internal link must resolve
- `npm run validate:doc-snippets` runs in CI — every code block must be valid syntax
- These replace the "quarterly manual audit" from revision 1 — automated, deterministic, no calendar dependency

### Status page (deferred)

Revision 1 linked to a status page that doesn't exist. **Removed from `support.md`** until we commit to one. For now, `support.md` lists:

1. GitHub Issues (public bugs)
2. Email (security issues)
3. `/app/claw/log` for self-service debugging

---

## Quality Gates

Before declaring docs done:

- [ ] Every operation page exists and follows the template
- [ ] Every guide has at least one working end-to-end example
- [ ] Scalar explorer renders all REST endpoints with try-out working
- [ ] `scopes.md` is auto-generated and matches code
- [ ] `check:docs-links` passes (every internal link resolves)
- [ ] `validate:doc-snippets` passes (every code block is valid syntax)
- [ ] Public `https://bullgram.xyz/docs` page renders and links work
- [ ] `/app/integrations` UI shows all new fields
- [ ] `/app/claw/log` audit log page works
- [ ] README files in root and backend reference the new docs
- [ ] Search (DocSearch or lunr) returns relevant results
- [ ] Mermaid diagrams render on site-v2

---

## Risk Mitigation (updated)

| Risk | Mitigation |
|---|---|
| Docs drift from code | CI gate on auto-generated files; operation pages in same PR as code |
| Markdown link rot | `check:docs-links` script in CI |
| Code examples break silently | `validate:doc-snippets` script in CI |
| Site-v2 docs page goes down | Build-time copy means docs are part of site-v2 bundle; no external fetch |
| Scalar releases breaking change | Pin major version; spec is OpenAPI 3.0.3, portable |
| Token rotation invalidates guide examples | All examples use clearly-fake tokens |
| Multi-language demand | English-only is project convention; defer translation indefinitely |
| DocSearch rejected | lunr.js fallback ready; swap UI when DocSearch approved |
| Screenshots rot | No screenshots — Mermaid diagrams only |
| Site-v2 bundle bloat from markdown renderer | Lazy-load DocsPage; only loads on `/docs` route |

---

## Cross-Plan Dependencies (updated)

| This plan depends on | For |
|---|---|
| Plan 01 (MCP) | Tool names, scope names, error codes, `shared/operations.js` |
| Plan 02 (REST API) | OpenAPI spec, endpoint paths, status codes |

| Plan 01/02 depend on this plan for | What |
|---|---|
| Behavior contracts | Operation pages define exact input/output schemas |
| Error reference | `errors.md` is the canonical error code list |
| Safety documentation | `safety.md` defines content sanitization expectations |

| Removed from Plan 01 (consolidated here) | Where it lives now |
|---|---|
| Plan 01 Phase 6 (UI updates) | This plan Phase 8 |
| Plan 01 audit log viewer mention | This plan Phase 8 (`/app/claw/log`) |

**Recommended sequencing:**

1. Plan 03 Phase 1-2 (skeleton + operation pages as spec) — **starts first**
2. Plan 01 Phase 1-3 (shared infra, singleton, move proxy tools) — **parallel**
3. Plan 02 Phase 1-2 (foundation, zod + OpenAPI) — **parallel**
4. Plan 01 Phase 4-7 (service helpers, tool handlers, sanitizer, hardening) — **sequential**
5. Plan 02 Phase 3-5 (handlers, hardening) — **parallel**
6. Plan 03 Phase 3-9 (transport pages, conceptual, guides, pipeline, UI) — **sequential, after code ships**

Critical path: 17 days elapsed for one focused developer.
