# Planning documents

These three plans describe the design and phasing for Bullgram's external
integration surface — MCP server, REST API, and documentation.

| Plan | Scope | Status |
|---|---|---|
| [01-mcp.md](./01-mcp.md) | MCP server rewrite — 10 tools, unified dispatcher, audit log | Revision 2 (approved) |
| [02-rest-api.md](./02-rest-api.md) | REST API at `/api/external/v1/*` parallel to MCP | Revision 2 (approved) |
| [03-documentation.md](./03-documentation.md) | Docs in `docs/integrations/`, site-v2 `/docs`, admin UI | Revision 2 (approved) |

## Status

**Historical design artifacts.** Once the code ships, the canonical
reference is:

- Code in `backend/shared/`, `backend/mcp/`, `backend/external/`
- Live docs at `https://bullgram.xyz/docs`
- Interactive API at `https://bullgram.xyz/api/docs`

Plans are kept for context — they explain *why* the code is shaped the
way it is. They are not updated after implementation begins.

## Critical path

```
Plan 03 P1-P2 (skeleton + operation pages as spec)  ──┐
Plan 01 P1-P3 (shared, singleton, move proxy tools) ──┼─→ Plan 01 P4-P7 (sequential)
Plan 02 P1-P2 (foundation, zod, OpenAPI)             ──┘   Plan 02 P3-P5 (parallel)
                                                          Plan 03 P3-P9 (sequential)
```

Realistic elapsed: **~17 days** for one focused developer.

## Decisions applied in Revision 2

- `UserbotService` is a **singleton** — one instance per process
- JWT blocked for new userbot tools — integration tokens only
- `token_id` nullable in `mcp_tool_log` — `auth_kind` is non-null instead
- Synchronous token-bucket rate limiter (no race window)
- Atomic SQL migration replaces `mcp:use` with granular scopes
- zod schemas are the single source of truth (not JSDoc)
- OpenAPI 3.0.3 (not 3.1 — generator compatibility)
- Site-v2 fetches docs from same-origin build-time copy (no GitHub raw)
- Mermaid diagrams only — no screenshots (don't rot)
- All UI work consolidated in Plan 03 Phase 8 (single owner)
