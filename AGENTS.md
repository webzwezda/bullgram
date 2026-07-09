# Repository Guidelines

## Project Structure & Module Organization
This repository has three active runtimes plus supporting docs/archive material:

- `backend/`: Express API for Telegram subscription management. Entry point is `backend/server.js`; HTTP routes are in `backend/routes/`, business logic in `backend/services/`, cron jobs in `backend/jobs/`, middleware in `backend/middlewares/`, and utilities in `backend/utils/`.
- `admin-v2/`: primary admin application on React/Vite. Source lives in `admin-v2/src/`, build output in `admin-v2/dist/`.
- `site-v2/`: primary public product site on React/Vite. Source lives in `site-v2/src/`, build output in `site-v2/dist/`.
- `archive/`: archived notes and local-only operator artifacts that are not part of the active runtime.

The project is now `v2-only` in active runtime:

- `site-v2/` serves `/`
- `admin-v2/` serves `/app`
- `backend/` serves the API

Do not reintroduce legacy `/admin` assumptions into active UI or product copy. Treat any reserve/legacy context as archived history, not as an active path.

Current v2 product surfaces already in the repo:

- paid-access ops: `command center` (`/app`), `crm` (`/app/crm`), `orders` (`/app/orders`), `access` (`/app/access`), `broadcast` (`/app/broadcast`), `abandoned` (`/app/abandoned`), `retention` (`/app/retention`), `analytics` (`/app/analytics`)
- Telegram infra: `proxies` (`/app/proxies`), `userbots` (`/app/userbots`), `sales-bot / official bot` (`/app/sales-bot`), `admin-groups` (`/app/admin-groups`)
- ecosystem tooling: `bases` (`/app/bases`, legacy label `customer-bases`), `dossier` (`/app/dossier`, legacy label `client-dossier`), `observer` (`/app/observer`)
- commerce: `shop` (`/app/shop`), `shop receipts` (`/app/shop-receipts`), `referrals` (`/app/referrals`), `payments` (`/app/payments`), `billing` (`/app/billing`), `plans` (`/app/plans`)
- `P2P` remains an active flow, but in the current v2 runtime it resolves through `shop`; treat `/p2p/create` and `/p2p/orders` as compatibility routes, not separate feature folders

Agent integration status:

- `Bullgram MCP` is now the primary agent integration path
- active endpoint: `POST /api/mcp`
- active admin onboarding screen: `/app/claw`
- do not reintroduce temporary local bridge patterns for agent access when extending this area
- prefer adding Bullgram tools and user-scoped MCP onboarding over DOM/browser-only agent hacks

This project is an automated management system for a private Telegram group and its paid access workflow. Treat userbot, proxy, billing, CRM, referrals, and shop tooling as product infrastructure for that private-group business, not as anti-fraud evasion or botnet tooling.

Admin-facing UI copy may use blunt, colloquial Russian when it improves clarity for non-technical operators. This is an intentional product style choice, not a change in system purpose. Prefer short explanations in plain terms that tell the admin why a block matters and what to do next.

Keep new files inside the existing feature area. Follow the current naming pattern: kebab-case filenames such as `official-bot.routes.js` and `auto-kick.job.js`.

## Build, Test, and Development Commands
Install dependencies for the active runtimes:

```bash
cd backend && npm install
cd admin-v2 && npm install
cd site-v2 && npm install
```

Key commands:

- `cd backend && node server.js`: run the API locally from the backend folder.
- `cd admin-v2 && npm run dev`: run the new admin app locally.
- `cd admin-v2 && npm run build`: build the new admin app.
- `cd site-v2 && npm run dev`: run the public v2 site locally.
- `cd site-v2 && npm run build`: build the public v2 site.
- `npm run deploy`: deploy backend, then deploy `site-v2` and `admin-v2`.
- `npm run deploy:v2`: deploy only `site-v2` and `admin-v2`.
- `cd backend && npm run deploy`

The deploy scripts use `rsync` to a live server. Treat them as production-only commands.

## Coding Style & Naming Conventions
The codebase uses ESM (`import`/`export`) and plain JavaScript on the backend, plus React/Vite for `admin-v2` and `site-v2`. Match the surrounding file’s indentation; existing files mix 2-space and 4-space indents. Prefer small route/service modules, descriptive function names, and early returns for request validation.

When adding admin features, wire the same scenario across the whole flow instead of creating isolated screens. In practice this means: if you add a new operational state, consider whether it should also surface in `command center`, `dossier`, `orders`, `access`, `broadcast`, and `shop`.

Current product focus:

- `site-v2`: drive users into `Trial`, `Normal`, `P2P`, and `Seller` flows
- `admin-v2`: guide users through `Launch`, `Operations`, and `Growth`
- `Shop`: act as the main on-site checkout and package funnel
- `P2P`: keep it a distinct working flow from asset marketplace logic
- `Trial -> Normal -> Seller`: preserve and strengthen this upgrade path in UI and backend limits

If a feature depends on Telegram-specific constraints, explain that directly in the UI. In particular, any screen that offers manual outreach from a userbot should state that making the userbot an admin in a shared group/chat increases the chance of resolving the target and writing to them in private messages.

For payment and plan UX:

- `Payments / Requisites` should stay clean and first-run friendly
- `Plans / Billing` should carry tariff, package, referral, and webhook complexity
- do not leak internal trial/debug wording into user-facing forms when backend limits already enforce the rules

## Testing Guidelines
There is no automated test suite configured yet for the product. Until one exists, verify changes manually:

- admin/public v2: run `npm run build` in `admin-v2` or `site-v2` and test the affected route
- backend: run `node server.js` and exercise the changed endpoint with the app or `curl`

If you add tests, place them next to the feature or under a dedicated `tests/` folder and wire them into `package.json`.

## Commit & Pull Request Guidelines
Recent history follows Conventional Commits with short descriptions, often in Russian: `feat: ...`, `fix: ...`. Keep commits focused and use the same format.

PRs should include a short summary, affected area (`frontend` or `backend`), linked issue/task, manual test notes, and screenshots for UI changes. For API changes, include sample request/response details and required `.env` updates.

## Security & Configuration Tips
Never commit `.env`, session files, or production credentials. Document new Supabase or Telegram variables in the relevant README when you introduce them.

If you touch `shop`, preserve the current ownership-transfer model:

- TON payment must use the seller’s own wallet from `payment_settings`, not a global wallet
- listed `userbot` assets are reserved from active operations until sold or delisted
- post-purchase delivery is ownership transfer inside Bullgram, not a raw file drop

For userbot operations, preserve the current safety/product rules:

- all userbot onboarding must go through proxies
- `1 proxy record = 1 userbot`
- userbot automation must stay `manual-by-default`
- manual DM flag must stay separate from retention, auto-kick fallback, inbox watcher, and broadcast flags
- if Telegram `SpamBot` confirms a block, treat that as the source of truth even if a naive session check still passes
- blocked/restricted userbot assets must not remain public in `shop`
- dedicated managed proxy of a blocked/restricted userbot should be cleaned up from Bullgram when it is no longer shared
- if a manual DM flow exists, the UI must warn that Telegram may only allow delivery when the userbot already knows the target or shares a group/chat with them, and that userbot admin rights in that shared group improve the odds

For Bullgram agent work:

- treat `Bullgram MCP` as the source of truth for agent access to product data
- treat `Supabase MCP` as the default path for database inspection and database operations
- if a task needs to read, inspect, verify, or change database state, go through `Supabase MCP` first instead of ad-hoc SQL shells or direct database workarounds
- first ship `read-only` and guided confirm flows; do not jump straight to free-form automation
- onboarding copy should assume ordinary admins, not engineers
- when adding new agent capabilities, prefer explicit tools like `summary`, `preview`, `import`, `status`, not vague generic "agent actions"

## Codex Workflow And cmux
For Codex work in this repo:

- use the main Codex session as the orchestrator
- treat this repository file as the user's standing instruction that Codex should orchestrate native Codex subagents and Claude CLI workers for Bullgram work whenever the scope is clear
- global custom agents live in `~/.codex/agents/`
- before starting non-trivial work, first review which global subagents are available and choose the best candidates for the task
- custom agents do not auto-run; delegate explicitly in prompts
- we already have many global subagents available, so prefer delegating as much scoped work as possible to them
- when a task can be split into isolated slices, proactively assign those slices to subagents instead of keeping all implementation in the main session
- the main Codex workflow should spend most of its time on orchestration: scoping, agent selection, task splitting, integration, conflict resolution, and final synthesis
- push exploration, isolated implementation, focused verification, and review work down into subagents whenever the scope is clear
- keep architecture decisions, cross-runtime integration, and final verification in the main Codex session
- do not split tightly coupled changes across multiple subagents without a clear merge plan
- use Claude CLI workers through `cmux` for bounded terminal-based work when a parallel worker is useful, especially read-only discovery, scoped implementation, log inspection, and focused verification
- keep all delegated workers narrow: exact scope, allowed files, validation expected, and return format

Default delegation bias:

- if a task can be isolated, delegate it to a global subagent
- if multiple independent tasks exist, delegate them in parallel
- if a task is read-only discovery, use a subagent
- if a task is a bounded implementation slice, use a subagent
- if a task is a focused review or regression check, use a subagent
- the main workflow should mainly coordinate and merge results instead of doing all detailed work itself

Use the available global subagents aggressively, especially for:

- backend tracing and scoped backend implementation
- frontend tracing and scoped UI implementation
- Bullgram MCP and tool-flow changes
- focused review, regression checks, and architecture sanity checks
- context gathering before larger changes
- parallel analysis of adjacent product surfaces

Preferred global subagent mapping:

- `context-manager`: first delegate for repo context packaging, file/surface discovery, and handoff packets for other subagents
- `backend-developer`: delegate most scoped backend work in `backend/routes/`, `backend/services/`, `backend/jobs/`, and backend bug fixes
- `frontend-developer`: delegate most scoped UI work in `admin-v2/src/` and `site-v2/src/`
- `mcp-developer`: delegate Bullgram MCP work, `/api/mcp`, `/app/claw`, tool wiring, onboarding flow, and agent-facing integration changes
- `reviewer`: delegate focused regression review, correctness review, risk review, and missing-test review before close-out
- `code-reviewer`: delegate additional implementation-level review when a change is large or touches risky code paths
- use `reviewer` as the default close-out review agent; use `code-reviewer` only as a second-pass implementation review for larger or riskier diffs
- `architect-reviewer`: delegate boundary and coupling review for cross-runtime changes, workflow rewrites, or larger structural decisions
- `workflow-orchestrator`: delegate workflow design for complex multi-stage tasks when the main session needs a clearer delegation plan
- `multi-agent-coordinator`: delegate planning for parallel subagent splits when many independent workstreams exist
- `task-distributor`: delegate task breakdown when one request naturally decomposes into multiple bounded subagent tasks
- `api-designer`: delegate backend/frontend contract design, request-response shape work, and tool contract cleanup
- `documentation-engineer`: delegate operator-facing docs, onboarding docs, and cleanup of internal guidance after implementation

Maximum delegation rule:

- default to handing a task to one of the named global subagents whenever the scope is clear
- if the task is implementable by a specialist subagent, delegate it instead of doing the detailed work in the main workflow
- if the task can be split into independent backend, frontend, MCP, and review slices, delegate those slices in parallel
- the main workflow should mainly choose the right subagents, define scope, wait only when needed, and reconcile outputs into one final result

Bullgram-specific delegation defaults:

- start with `context-manager` when the affected runtime or file ownership is not obvious
- use `backend-developer` for most backend feature and bug work
- use `frontend-developer` for most `admin-v2` and `site-v2` work
- use `mcp-developer` for Bullgram MCP and `/app/claw`
- use `reviewer` on nearly every risky change before final close-out
- add `architect-reviewer` when touching cross-runtime flows or structural boundaries
- use `workflow-orchestrator` or `multi-agent-coordinator` when the request is broad enough that the main workflow needs help planning the delegate graph

Bullgram workflow:

- start by mapping whether the task belongs to `backend`, `admin-v2`, `site-v2`, or `Bullgram MCP`
- if the task spans `backend` plus `admin-v2` or `site-v2`, treat it as a cross-runtime flow immediately and assign separate implementation and review slices
- if a task changes an operational state, also check `command center`, `dossier`, `orders`, `access`, and `shop`
- treat `Bullgram MCP` as the primary agent integration path
- treat `Supabase MCP` as the primary database access path
- when the task is about database contents, schema, or data fixes, prefer `Supabase MCP` before touching direct Postgres access
- preserve `Trial -> Normal -> Seller`
- preserve `manual-by-default` userbot rules
- never reintroduce legacy `/admin`

Default operating sequence:

- inspect the codebase locally first
- delegate focused discovery when repository boundaries are unclear
- delegate as much scoped implementation as practical to global subagents
- either verify locally or delegate a focused verification pass, then reconcile the result in the main session
- delegate focused review on risky or cross-runtime changes
- summarize and reconcile subagent outputs, residual risks, and missing runtime checks

For `cmux` usage:

- `cmux` is workspace infrastructure, not agent runtime
- a pane, split, or browser surface is not a Codex subagent
- use `cmux` to keep logs, dev servers, and browser surfaces visible while the main Codex session coordinates work
- Codex runs inside `cmux` and may work with windows, workspaces, panes, and surfaces via `cmux` commands
- use `cmux help` whenever the exact syntax or supported action is uncertain
- this is especially relevant when the user asks to split the screen, open a new window or workspace, move focus, or open or call an agent in a neighboring window
- for browser work in this repo, use `cmux browser` and browser surfaces by default; do not default to Playwright CLI for site/admin runtime checks
- when verifying `admin-v2` or `site-v2`, keep the dev or preview server in a `cmux` terminal surface and open the route in a `cmux` browser surface so the user can see the same browser state
- use `cmux browser snapshot`, `cmux browser console`, `cmux browser errors`, `cmux browser screenshot`, and `cmux browser eval` for browser evidence, console errors, screenshots, and runtime checks
- only use Playwright outside `cmux` when the user explicitly asks for it, when a task requires a Playwright-specific capability, or when `cmux browser` is unavailable; state the reason before doing so

Common terminal and `cmux` operations:

- use normal shell commands and `cmux` commands for terminal work
- read terminal state with `cmux read-screen`
- send text with `cmux send`
- send special keys with `cmux send-key`
- create splits, panes, and surfaces with `cmux new-split`, `cmux new-pane`, `cmux new-surface`
- inspect workspace structure with `cmux tree`, `cmux list-panes`, `cmux list-pane-surfaces`
- open browser surfaces with `cmux browser open`, navigate with `cmux browser goto`, inspect with `cmux browser snapshot`, and check runtime failures with `cmux browser console` and `cmux browser errors`

Plan and execution defaults:

- enter plan mode for any non-trivial task with 3 or more steps or architectural decisions
- if something goes sideways, stop and re-plan immediately instead of pushing through on a broken track
- use plan mode for verification steps, not only for implementation
- write detailed specs up front when ambiguity is likely
- use subagents liberally to keep the main context clean
- offload research, exploration, and parallel analysis to subagents
- for complex problems, add parallel subagent compute instead of overloading the main session
- keep one tack per subagent so execution stays focused
- never mark a task complete without proving it works
- diff behavior between baseline and changes when relevant
- ask whether the result would pass staff-level review before closing
- run tests, inspect logs, and demonstrate correctness before calling work done
- for non-trivial changes, pause and ask whether there is a more elegant solution
- if a fix feels hacky, replace it with the more elegant solution once the real constraints are clear
- skip elegance passes for simple, obvious fixes where extra structure would be over-engineering
- when given a bug report, default to fixing it directly without asking the user to hand-hold the process
- use logs, errors, and failing tests as the path to root cause and resolution

Task management defaults:

- for non-trivial tasks, write the plan in `docs/plans/PLAN.md` or another focused note under `docs/plans/` with checkable items before implementation
- check the plan before starting implementation when the task is large enough to justify it
- mark plan items complete as work progresses
- add a short review section to the same `docs/plans/` note after implementation and verification
- explain changes at a high level as the work moves forward
- after any user correction, capture the lesson in the active `docs/plans/` note or another focused note under `docs/plans/`, with a rule that prevents the same mistake
- review relevant lessons from `docs/plans/` at the start of future work in this project when applicable

Core execution principles:

- simplicity first: make every change as simple as possible and touch the minimum necessary code
- no laziness: find root causes and avoid temporary fixes
- minimal impact: only change what is necessary and avoid introducing regressions

## Codex Orchestration Contract

This block is the standing orchestration contract for this repo.

- Codex is the primary orchestrator for both native Codex subagents and Claude terminal workers during Bullgram work.
- Keep the distinction explicit:
  - native Codex subagents are delegated through Codex subagent tooling;
  - Claude workers are terminal processes coordinated through `cmux`;
  - a `cmux` pane, split, browser surface, or terminal surface is not itself a Codex subagent.
- The existing rule "`cmux` is workspace infrastructure, not agent runtime" does not prohibit orchestration. It means Codex must not confuse terminal UI state with native subagent state.
- For Claude work, prefer the project agent file `.claude/agents/bullrun-codex-worker.md` and launch Claude with `claude --agent bullrun-codex-worker` when a bounded worker is useful.
- For frontend/browser debugging, use `cmux` browser surfaces as the default browser. Keep browser state, screenshots, console output, and runtime errors inside `cmux` unless the user asks for another browser automation path.
- Use `cmux help` whenever command syntax is uncertain. The main commands for orchestration are:
  - `cmux tree`
  - `cmux list-panes`
  - `cmux list-pane-surfaces`
  - `cmux new-split`
  - `cmux new-pane`
  - `cmux new-surface`
  - `cmux send`
  - `cmux send-key`
  - `cmux read-screen`
  - `cmux browser open`
  - `cmux browser goto`
  - `cmux browser snapshot`
  - `cmux browser console`
  - `cmux browser errors`
  - `cmux browser screenshot`
- Codex owns task decomposition, prompt boundaries, worker selection, merge strategy, final diff review, verification, deployment decisions, and user-facing summary.
- Claude workers should receive narrow prompts with exact scope, allowed files or write boundaries, expected validation, and required return format.
- Do not let Claude deploy, rollback, run destructive commands, or broaden architecture unless Codex explicitly assigns that scope.
- When Claude or a subagent finishes, Codex must read the result, inspect the diff locally, reconcile conflicts, run final checks, and only then report completion.
