# Contributing

How to develop against the Bullgram integrations surface. Covers the CI
pipeline, how to run gates locally, and the rules for adding new
operations or modifying existing ones.

## CI pipeline

Every push to `main` and every PR runs the [`CI` workflow](https://github.com/anthropics/bullgram/blob/main/.github/workflows/ci.yml)
which executes six gates in order:

| # | Gate | What it checks | Network |
|---|---|---|---|
| 01 | Backend tests | 143 unit + 24 dispatch + 47 REST tests pass | No |
| 02 | Docs integrity | Required pages exist; internal links resolve; no stale phase markers | No |
| 06 | Secrets scan | No real-looking `brapi_*` or `brmcp_*` tokens in source/docs | No |
| 03 | OpenAPI valid | `/api/external/v1/openapi.json` is `3.0.3`, exposes all 10 paths | Yes |
| 04 | MCP smoke | `POST /api/mcp` returns a JSON-RPC envelope | Yes |
| 05 | REST smoke | `/health`, `/openapi.json`, `/docs` return 200; `/me`, `/userbots` 401 without token | Yes |

Gates 1, 2, 6 are pure source checks — they always reflect the **current
commit**. Gates 3, 4, 5 hit prod (`https://bullgram.xyz`) and validate the
**currently deployed** surface. After a merge, the deploy workflow runs;
once it completes, re-running CI on the merged branch will exercise the
new code.

## Run gates locally

```bash
# All six gates, source + prod smoke
npm run ci

# Just the source gates (fast, no network)
npm run ci:source

# Just the live smoke gates (validates whatever BASE_URL points at)
BASE_URL=https://bullgram.xyz npm run ci:smoke

# Single gate
./ops/scripts/ci/gate-02-docs-integrity.sh
./ops/scripts/ci/gate-03-openapi-valid.sh
```

For local backend smoke, boot `backend/server.js` on a port and point
`BASE_URL` at it:

```bash
cd backend && PORT=3001 node server.js &
BASE_URL=http://localhost:3001 ./ops/scripts/ci/gate-05-rest-smoke.sh
```

## Adding a new operation

The operation registry at `backend/shared/operations.js` is the single
source of truth. New operations need:

1. **A handler** in `backend/mcp/tools/<domain>/<name>.js` that:
   - Imports `OPERATIONS` from the registry
   - Calls `OPERATIONS.set('bullrun_<domain>_<verb>', { ... })` with:
     - `description`, `inputSchema` (Zod), `handler`
     - `requiredScopes` — list BOTH prefixes (`mcp:domain:perm` AND
       `api:domain:perm`) so the same operation works over both transports
     - `transports.rest` — `{ method, path, tags, summary }` if REST-enabled
   - Imports `../index.js` for side-effect registration

2. **Tests** in `backend/test/` exercising:
   - Happy path
   - Each error path (auth, scope, allowlist, safe-mode, account_restricted)
   - The REST route (if `transports.rest` is set)

3. **A docs page** at `docs/integrations/operations/<name>.md` following
   the existing template. Add it to the operations index.

4. **Update required files** in `ops/scripts/ci/gate-02-docs-integrity.sh`
   if the new page should be link-checked.

## Modifying an existing operation

Within `v1`, changes are **additive only**:

- ✅ Adding an optional field to a response
- ✅ Adding a new optional query parameter
- ✅ Loosening validation (string → string|null)
- ❌ Removing a field — deprecate first, remove in `v2`
- ❌ Renaming a field — same
- ❌ Tightening validation that would reject previously-accepted input

Bump the changelog entry under `docs/integrations/changelog.md`.

## Test conventions

Tests in `backend/test/test-*.js` are plain Node scripts — no test runner.
They use a tiny custom assertion helper (`ok`, `fail`, `assertEqual`,
`assertRejects`) so output is grep-friendly.

```
--- description of the scenario ---
  ✓ short assertion
  ✗ short assertion (with actual vs expected)
N passed, M failed
```

A non-zero exit code at the end means failure. Tests must not depend on
network or env — mock supabase and userbot service in-memory.

## Commit message style

Conventional Commits. Russian is fine for the short description.

```
feat(integrations): add bullrun_userbot_messages_search operation
fix(external): preserve retry_after_sec in error envelope
docs(integrations): expand curl cookbook with rate-limit recipe
chore(ci): add gate-06 secrets scan
```
