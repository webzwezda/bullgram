# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Bullgram is a v2-only product for managing paid Telegram access with CRM, access control, orders, shop, referrals, userbot operations, managed proxies, and agent integrations.

**Three Active Runtimes:**
- `backend/` — Express API for Telegram subscription management, shop, billing, and userbot operations
- `admin-v2/` — Primary admin React/Vite app serving `/app`
- `site-v2/` — Public React/Vite site serving `/`

**Legacy Status:** The old `/admin` route is deprecated (410 Gone). Do not reintroduce legacy assumptions or copy legacy patterns.

## Development Commands

### Installation
```bash
npm run install:active  # Install all active runtime dependencies
```

### Local Development
```bash
cd backend && node server.js          # Run backend API
cd admin-v2 && npm run dev            # Run admin app
cd site-v2 && npm run dev             # Run public site
```

### Building
```bash
npm run build:v2      # Build both admin-v2 and site-v2
npm run build:site    # Build site-v2 only
npm run build:admin   # Build admin-v2 only
npm run analyze       # Bundle analysis (admin-v2)
```

### Deployment (Production Only)
```bash
npm run deploy        # Deploy backend + site-v2 + admin-v2
npm run deploy:v2     # Deploy only site-v2 and admin-v2
npm run rollback -- all <timestamp>        # Rollback all runtimes
npm run rollback:v2 -- <timestamp>         # Rollback v2 frontends
npm run rollback:backend -- <timestamp>    # Rollback backend only
```

Deploy scripts use `rsync` to production server and require PM2 restart after backend deploy.

## Architecture & Structure

### Backend Architecture
- **Entry point:** `backend/server.js`
- **Routing:** `backend/routes/` — HTTP endpoints organized by feature
- **Business logic:** `backend/services/` — Core services for userbots, official bots
- **Cron jobs:** `backend/jobs/` — Background tasks (auto-kick, retention, abandoned cart, inbox watcher)
- **Middleware:** `backend/middlewares/` — Express middleware (auth via Supabase JWT)
- **Utilities:** `backend/utils/` — Crypto, shop reservations, Telegram error handling

**Key Technologies:** Node.js, Express, Supabase (PostgreSQL + auth), Telegraf (official bots), GramJS (userbots), node-cron

### Frontend Architecture
Both `admin-v2` and `site-v2` use React + Vite with:
- **Entry points:** `admin-v2/src/main.jsx`, `site-v2/src/main.jsx`
- **Routing:** React Router v7 (admin-v2) or v6 (site-v2)
- **Styling:** Tailwind CSS v4, shadcn/ui components
- **State:** Supabase client for auth and data

**Admin-v2 structure:** `src/pages/` (feature routes), `src/ui/` (components), `src/api/` (backend calls)

### Multi-Tenancy
All backend requests enforce `owner_id` for data isolation. Each admin sees only their channels, bots, subscribers, orders, and settings.

## Core Business Rules (Never Break)

**Upgrade Path:** Preserve `Trial → Normal → Seller` progression in UI and backend limits.

**Shop & P2P:** Shop is the main checkout and package funnel. P2P is a distinct flow but currently resolves through shop — treat `/p2p/create` and `/p2p/orders` as compatibility routes, not separate features.

**Userbot Operations:**
- All userbot automation must remain `manual-by-default`
- Rule: `1 proxy record = 1 userbot`
- Manual DM flag must stay separate from retention, auto-kick fallback, inbox watcher, and broadcast flags
- When `@SpamBot` confirms a block, treat that as source of truth even if naive session check passes
- Blocked/restricted userbot assets must not remain public in shop
- If manual DM flow exists, warn that Telegram may only allow delivery when userbot knows target or shares a group/chat, and that userbot admin rights in that group improve odds

**Agent Access:**
- Bullgram MCP is primary path for product data (`POST /api/mcp`, `/app/claw`)
- Supabase MCP is primary path for database operations (via SSH tunnel: `npm run mcp:supabase:tunnel`)
- Prefer explicit tool names like `summary`, `preview`, `import`, `status` over vague "agent actions"

## Userbot Safety Requirements

When working with userbot operations:
1. All risky userbot scenarios must be opt-in via feature flags
2. New userbots start in `safe-mode` (`runtime_status=pending_activation`) after QR/file import
3. Background jobs should not touch accounts in `safe-mode` until manual activation
4. If Telegram `@SpamBot` confirms restriction, account gets `restricted` status and is removed from shop
5. Dedicated managed proxy of restricted userbot should be cleaned up from Bullgram when no longer shared

## Supabase MCP

A Supabase MCP server (`supabase`) is configured in `.mcp.json` and connects to the self-hosted Supabase instance.

**Tools available:** `execute_sql`, `apply_migration`, `list_tables`, `list_auth_users`, `generate_typescript_types`, `explain_query`, and others from `selfhosted-supabase-mcp`.

**Connection:** SSH tunnel auto-starts on session launch via `SessionStart` hook (`ops/scripts/ensure-mcp-tunnel.sh`):
- `localhost:8080` → Kong REST API
- `localhost:5432` → PostgreSQL direct (bypasses PgBouncer)

**Access:** `supabase_admin` role with service-role key — full read/write.

## Environment & Configuration

**Required:** Node.js 22.22.0, npm 10.x (see `.nvmrc`)

**Environment Files:**
- Backend: `backend/.env` (use `backend/.env.example` as template)
- No `.env` files in admin-v2 or site-v2

**Userbot Feature Flags (all default to `false` unless explicitly enabled):**
```env
USERBOT_DM_ENABLED=false                    # Manual DM from admin UI
USERBOT_INBOX_WATCH_ENABLED=false           # Background inbox watcher
USERBOT_RETENTION_DM_ENABLED=false          # Retention DM fallback
USERBOT_AUTO_KICK_FALLBACK_ENABLED=false    # Userbot fallback for kicks
USERBOT_AUTO_KICK_DM_ENABLED=false          # DM after auto-kick
USERBOT_BROADCAST_ENABLED=false             # Userbot-based broadcasts
RESTRICTED_USERBOT_AUTO_DELETE_ENABLED=true # Auto-delete restricted accounts
RESTRICTED_USERBOT_DELETE_AFTER_HOURS=72    # Quarantine window
```

## Coding Conventions

**File Naming:** Use kebab-case for backend files (`official-bot.routes.js`, `auto-kick.job.js`)

**Style:**
- Backend: ESM (`import`/`export`), plain JavaScript
- Frontend: React with functional components and hooks
- Match surrounding file indentation (2-space or 4-space)
- Prefer small modules, descriptive function names, early returns for validation

**Commit Format:** Conventional Commits with short descriptions, often in Russian:
- `feat: ...` — New feature
- `fix: ...` — Bug fix

**When Adding Features:** Wire the scenario across the entire flow, not isolated screens. If adding an operational state, consider whether it should surface in: command center, dossier, orders, access, broadcast, and shop.

## Testing & Verification

No automated test suite exists yet. Verify changes manually:
- Frontend: Run `npm run build` and test affected route
- Backend: Run `node server.js` and exercise endpoint via app or `curl`
- After deploy: Restart PM2 (`pm2 restart bullrun-tg-backend`)

## Product Surfaces

**Admin-v2 Routes:** `/app` (command center), `/app/crm`, `/app/orders`, `/app/access`, `/app/broadcast`, `/app/abandoned`, `/app/retention`, `/app/analytics`, `/app/proxies`, `/app/userbots`, `/app/botfather`, `/app/admin-groups`, `/app/bases`, `/app/dossier`, `/app/observer`, `/app/shop`, `/app/shop-receipts`, `/app/referrals`, `/app/payments`, `/app/billing`, `/app/plans`, `/app/claw`

**Backend Endpoints:** See `backend/README.md` for full API documentation. Key areas:
- `/api/userbot/*` — Userbot operations, health checks, manual actions
- `/api/official-bot/*` — Official bot management
- `/api/mcp` — Bullgram MCP endpoint

## Telegram Client Lifecycle (GramJS Userbot)

When working with userbot client code, strictly follow this lifecycle:
1. **Init** — Create TelegramClient with decrypted session
2. **Disable Updates** — `client._updateLoop = async () => {}`
3. **Connect** — `await client.connect()`
4. **Execute** — Perform operations
5. **Cleanup** — `await client.disconnect()` in `finally` block

This prevents memory leaks and hanging sessions.

## Admin UI Copy Guidelines

Admin-facing UI may use blunt, colloquial Russian when it improves clarity for non-technical operators. Prefer short explanations in plain terms that tell the admin why a block matters and what to do next.

For payment/plan UX:
- `Payments/Requisites` should stay clean and first-run friendly
- `Plans/Billing` handles tariff, package, referral, and webhook complexity
- Don't leak internal trial/debug wording into user-facing forms

## Security Rules

- Never commit `.env`, session files, or production credentials
- Document new Supabase or Telegram variables in relevant README
- All API endpoints require JWT token in `Authorization: Bearer <token>` header
- Telegram sessions are encrypted before database storage
- Shop TON payments must use seller's own wallet from `payment_settings`, not global wallet
