# Managed Proxy Self-Healing Plan, 2026-05-20

## Context

Userbot Telegram checks failed because the managed proxy runtime diverged from the product database.

Observed incident:

- `/api/userbot/check/:id` reached the backend, but Telegram check failed through proxy `193.23.197.169:21130`.
- Runtime error was `SocksClientError: connect ECONNREFUSED 193.23.197.169:21130`.
- Server had second IPv4 `193.23.197.169`, but `3proxy` was listening only on port `21081`.
- Supabase `proxies` had active managed proxy records for ports `21081`, `21115`, `21116`, `21123`, `21130`, `21131`.
- `/var/lib/bullrun/managed-proxies/state.json` only had `mp_1:21081`.
- After rebuilding runtime state from Supabase and running `scripts/restore-managed-proxies.mjs`, all six ports listened and userbot `Erik` checked as `online`.

Root cause:

- Current runtime treats local `state.json` as the source of truth.
- Product truth is in Supabase `proxies`.
- `bullrun-managed-proxies.service` and `scripts/restore-managed-proxies.mjs` only restore from stale `state.json`.
- Deploy and rollback restart the backend, but do not reconcile managed proxy runtime.

Secondary issue:

- `userbot.routes.js` health-check timeout/classification can mark an account as `dead_proxy` when a later Telegram profile or SpamBot inspection hangs, even after the session connected successfully.

## Goal

Make managed proxies recover automatically after deploy, reboot, Docker/container restart, or local state drift.

The system should not depend on one fragile local JSON file staying perfectly aligned with Supabase.

## Target Design

### 1. Supabase is the product source of truth

Use Supabase `proxies` rows as the canonical list for managed proxies.

Managed proxy rows should be selected by:

- `host = MANAGED_PROXY_PUBLIC_HOST` or detected public managed host.
- `username` matching `mp_%`.
- Active rows only, excluding deleted/released rows if such status exists.
- Preserve existing fields: `port`, `username`, `password`, `owner_id`, `inventory_group`, `source`, `status`.

`state.json` should become a runtime cache, not the canonical product state.

### 2. Add DB-backed reconciliation to `ManagedProxyService`

Add methods in `backend/services/managed-proxy.service.js`:

- `loadManagedProxyRowsFromDatabase(supabase)`
- `buildStateFromProxyRows(rows)`
- `reconcileRuntimeFromDatabase(supabase, options)`
- `getRuntimeHealth(supabase)`

`reconcileRuntimeFromDatabase` should:

- Load managed proxy rows from Supabase.
- Detect server public IPv4 and IPv6 prefix using the existing service helpers.
- Build deterministic state entries:
  - `port` from DB.
  - `username` and `password` from DB.
  - `sequence` from `mp_N`.
  - `ipv6` from the managed IPv6 prefix plus deterministic sequence offset.
  - `publicHost` from managed host.
- Compare DB rows, local state rows, and listening runtime ports.
- Write a backup before replacing `state.json`.
- Write fresh `state.json` and `3proxy.cfg` only when there is a diff.
- Ensure IPv6 addresses.
- Restart or recreate the `bullrun-managed-3proxy` container only when needed.
- Return a machine-readable summary:
  - `dbCount`
  - `stateCountBefore`
  - `stateCountAfter`
  - `missingPorts`
  - `extraStatePorts`
  - `runtimeRestored`
  - `containerRunning`

If Supabase is unavailable, the service may fall back to existing `state.json`, but it must log that this is a degraded fallback.

### 3. Upgrade restore script

Update `backend/scripts/restore-managed-proxies.mjs`:

- Load `.env`.
- Create Supabase client.
- Call `managedProxyService.reconcileRuntimeFromDatabase(supabase)`.
- Fall back to `restoreRuntimeFromState()` only when DB reconciliation cannot run and existing state is non-empty.
- Exit non-zero if both DB reconciliation and state restore fail.

This makes the existing systemd service useful after reboot without adding a second service.

### 4. Run reconcile during deploy and rollback

Update:

- `ops/scripts/deploy.sh`
- `ops/scripts/rollback.sh`

After backend files and dependencies are updated, run on the server:

```bash
cd /var/www/backend && node scripts/restore-managed-proxies.mjs
```

Then restart PM2.

Reason: deploy currently restarts backend only. If `state.json` is stale, the app comes back but proxy ports stay down.

### 5. Add lightweight backend self-healing job

Add `backend/jobs/managed-proxy-reconcile.job.js`.

Behavior:

- Start from `backend/server.js` with other jobs.
- Run once shortly after backend start.
- Then run every 2-5 minutes.
- Use an in-process lock to avoid overlapping Docker/container work.
- Default enabled in production:
  - `MANAGED_PROXY_RECONCILE_ENABLED=false` disables it.
  - `MANAGED_PROXY_RECONCILE_INTERVAL_MS` can tune the interval.
- Do nothing when DB, state, and runtime are already aligned.
- Log only counts and ports, never proxy passwords.

This covers drift that happens after deploy, not only reboot.

### 6. Add operator health visibility

Add an admin-only support endpoint, for example:

- `GET /api/userbot/proxies/managed-health`

Return:

- DB proxy count.
- State proxy count.
- Listening port count.
- Missing ports.
- Extra state ports.
- Container status.
- Last reconcile result if available.

No admin UI changes are required for the first pass unless the user asks. The endpoint and PM2 logs are enough for support/debugging.

### 7. Fix Telegram check classification

Update `backend/routes/userbot.routes.js` health-check flow:

- Keep strict proxy failure classification for connect-level failures:
  - `ECONNREFUSED`
  - `ETIMEDOUT`
  - SOCKS auth/connect errors before Telegram session is established.
- If `connectWithProxyFallback` succeeds and `getMe` succeeds, treat the session as alive.
- If later `SpamBot` or profile inspection times out, mark the check as degraded, not `dead_proxy`.
- Only explicit Telegram auth/session failures should mark an account as expired:
  - `AUTH_KEY_UNREGISTERED`
  - `SESSION_REVOKED`
  - equivalent GramJS session invalid errors.
- Log health-check stages:
  - `connect_start`
  - `connect_ok`
  - `connect_fail`
  - `get_me_ok`
  - `inspection_timeout`
  - `final_status`

This prevents a live userbot from being incorrectly moved to `dead_proxy` because a secondary inspection was slow.

## Implementation Order

1. Implement DB-backed reconcile in `managed-proxy.service.js`.
2. Upgrade `restore-managed-proxies.mjs` to use Supabase reconciliation.
3. Add deploy/rollback reconcile hook.
4. Add backend periodic reconcile job and wire it in `server.js`.
5. Add admin health endpoint.
6. Fix userbot health-check classification.
7. Deploy.
8. Verify runtime on the server.

## Verification Plan

Local/static checks:

```bash
node --check backend/services/managed-proxy.service.js
node --check backend/scripts/restore-managed-proxies.mjs
node --check backend/jobs/managed-proxy-reconcile.job.js
node --check backend/routes/userbot.routes.js
```

Server checks:

```bash
cd /var/www/backend && node scripts/restore-managed-proxies.mjs
ss -lntp | grep 3proxy
nc -vz 193.23.197.169 21081
nc -vz 193.23.197.169 21115
nc -vz 193.23.197.169 21116
nc -vz 193.23.197.169 21123
nc -vz 193.23.197.169 21130
nc -vz 193.23.197.169 21131
pm2 logs bullrun-tg-backend --lines 100
```

Product check:

- Open `/app/userbots`.
- Press `Проверить Telegram` on the affected account.
- Expected backend result: `nextStatus: online`.
- Expected nginx result: no upstream timeout for `/api/userbot/check/:id`.
- Expected UI result: account remains usable; no false `dead_proxy`.

Boot check:

```bash
systemctl restart bullrun-managed-proxies
systemctl status bullrun-managed-proxies --no-pager
ss -lntp | grep 3proxy
```

## Rollback Plan

- Before replacing state, write a timestamped backup under `/var/lib/bullrun/managed-proxies/`.
- If DB-backed reconcile fails in production:
  - disable periodic job with `MANAGED_PROXY_RECONCILE_ENABLED=false`;
  - restore previous `state.json`;
  - run `node scripts/restore-managed-proxies.mjs`;
  - restart backend with PM2.

## MVP Boundary

First implementation should focus on keeping proxies alive and preventing false `dead_proxy` statuses.

Defer UI polish unless needed:

- no new dashboard cards yet;
- no redesign of `/app/userbots`;
- no changes to shop payment logic;
- no changes to userbot sale/ownership transfer flow.

## Open Questions

- Should we add an explicit `managed` or `provision_source = managed_proxy` marker to `proxies` later? Current reliable selector is `host + mp_%`, but an explicit marker would be cleaner.
- Should failed reconcile alert an admin in Telegram or only log to PM2 for now?

## Implementation Notes

Implemented before deploy:

- Added DB-backed managed proxy reconciliation to `backend/services/managed-proxy.service.js`.
- Updated `backend/scripts/restore-managed-proxies.mjs` to reconcile from Supabase first and fall back to state restore only if DB reconcile fails.
- Added periodic backend job `backend/jobs/managed-proxy-reconcile.job.js` and wired it in `backend/server.js`.
- Added deploy/rollback hooks so managed proxies reconcile before PM2 backend restart.
- Added admin-only health endpoint `GET /api/userbot/proxies/managed-health`.
- Changed userbot health-check classification so connect-level failures can still become `dead_proxy`, but SpamBot/profile timeout after successful connect + `getMe` becomes degraded `online`.

Local checks passed:

```bash
node --check backend/services/managed-proxy.service.js
node --check backend/scripts/restore-managed-proxies.mjs
node --check backend/jobs/managed-proxy-reconcile.job.js
node --check backend/routes/userbot.routes.js
node --check backend/server.js
```

Production verification after deploy:

- `npm run deploy` completed at deploy timestamp `20260519-231216`.
- Deploy hook ran `node scripts/restore-managed-proxies.mjs` on the server.
- First production reconcile result: `publicHost=193.23.197.169`, `dbCount=6`, `stateCountAfter=6`, `missingPorts=[]`.
- Follow-up reconcile result: `restored=false`, `stateChanged=false`, `missingPorts=[]`.
- `ss -lntp` showed `3proxy` listening on `21081`, `21115`, `21116`, `21123`, `21130`, `21131`.
- `nc -vz 193.23.197.169 <port>` succeeded for all six managed proxy ports.
- PM2 backend stayed `online`; startup and interval `ManagedProxyReconcile` logs reported `missingPorts=[]`.
- `/app/userbots` production frontend loaded without browser errors.
- Pressing `Проверить Telegram` for `@Erik` produced backend stages `connect_start`, `connect_ok`, `get_me_ok`, and final `nextStatus: online`.
- UI showed `Сессия жива`.
