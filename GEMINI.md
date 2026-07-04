# GEMINI.md

## Project Overview
**Bullgram** is a "v2-only" product ecosystem designed to manage paid access to Telegram groups and channels. It provides a comprehensive suite of tools including a CRM, order management, automated subscription handling, userbot operations, and managed proxy services.

The project is structured into three active runtimes:
- **`backend/`**: Express.js API, background jobs, and Telegram services (Official Bots & Userbots).
- **`admin-v2/`**: Primary administrative dashboard (React 19, Vite, Tailwind v4).
- **`site-v2/`**: Public-facing marketing and checkout site (React 18, Vite).

### Core Technologies
- **Runtime**: Node.js 22.22.0, npm 10.x
- **Database/Auth**: Supabase (PostgreSQL + JWT Auth)
- **Backend**: Express.js, Telegraf (Official Bots), GramJS (Userbots)
- **Frontend**: React (18/19), Vite, Tailwind CSS (v4 in admin), shadcn/ui
- **Infrastructure**: Managed Proxies, Systemd units, rsync-based deployment

## Building and Running

### Prerequisites
- Node.js `22.22.0` (enforced by `.nvmrc`)
- npm `10.x`

### Installation
Install dependencies for all active runtimes from the root:
```bash
npm run install:active
```

### Local Development
Run each component in its own terminal:
- **Backend**: `cd backend && node server.js` (requires `.env`)
- **Admin**: `cd admin-v2 && npm run dev`
- **Site**: `cd site-v2 && npm run dev`

### Production Build
```bash
npm run build:v2      # Builds both frontends
```

### Deployment (Production Only)
```bash
npm run deploy        # Full deploy: backend + both frontends
npm run deploy:v2     # Frontend only deploy
```

## Development Conventions

### General Rules
- **V2-Only**: Legacy `/admin` is deprecated. Do not reintroduce legacy patterns.
- **Naming**: Use `kebab-case` for backend files (e.g., `official-bot.routes.js`).
- **Isolation**: All data access must enforce `owner_id` multi-tenancy.
- **Simplicity**: Prefer small modules and early returns.

### Userbot Operations (Strict Rules)
- **1 Proxy = 1 Userbot**: Every userbot must have its own dedicated proxy.
- **Manual-by-Default**: Automation must be opt-in. Background jobs should not touch accounts in `safe-mode` (`pending_activation`).
- **Lifecycle**: GramJS clients must follow: `Init -> Disable Updates -> Connect -> Execute -> Cleanup (Disconnect in finally)`.
- **Safety**: Check `@SpamBot` status; restricted accounts must be removed from the shop.

### Agent Integration
- **Bullgram MCP**: Primary path for product data (`POST /api/mcp`).
- **Supabase MCP**: Primary path for database inspection/operations. Use the SSH tunnel: `npm run mcp:supabase:tunnel`.
- **Orchestration**: The main agent session acts as an orchestrator, delegating scoped tasks to sub-agents (backend, frontend, reviewer, etc.) as defined in `AGENTS.md`.

### Configuration
- Backend requires a `.env` file. Use `backend/.env.example` as a template.
- Key feature flags (default to `false`): `USERBOT_DM_ENABLED`, `USERBOT_INBOX_WATCH_ENABLED`, `USERBOT_RETENTION_DM_ENABLED`.

## Key Files
- `AGENTS.md`: Detailed "working contract" for AI agents and orchestration rules.
- `CLAUDE.md`: Specific guidance for Claude-based workers.
- `backend/server.js`: API entry point and job initialization.
- `admin-v2/src/config.js`: Frontend configuration and API endpoints.
- `ops/scripts/`: Deployment and infrastructure management scripts.
