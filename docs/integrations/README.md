# Bullgram Integrations

Bullgram exposes two integration surfaces, both backed by the same
operations:

- **MCP** — JSON-RPC 2.0 at `POST /api/mcp` for AI agents (Claude Desktop, Cursor)
- **REST API** — conventional HTTP at `/api/external/v1/*` for automation (n8n, scripts, SDKs)

## Quickstart

```bash
# 1. Issue a token at /app/integrations
TOKEN="brapi_paste_your_token"

# 2. Smoke test
curl -H "Authorization: Bearer $TOKEN" https://bullgram.xyz/api/external/v1/me

# 3. List userbots
curl -H "Authorization: Bearer $TOKEN" https://bullgram.xyz/api/external/v1/userbots
```

Full walkthrough: [getting started (5 minutes)](./getting-started.md).

## Documentation index

### Getting started
- [Getting started (5 minutes)](./getting-started.md)
- [Authentication & tokens](./authentication.md)
- [Scopes reference](./scopes.md)

### Transports
- [MCP transport](./transports/mcp.md)
- [REST transport](./transports/rest.md)

### Operations
- [Operations index](./operations/README.md) — 10 operations across 3 tags

### Concepts
- [Rate limits](./rate-limits.md)
- [Errors](./errors.md)
- [Safety & threat model](./safety.md)

### Guides
- [Security best practices](./guides/security-best-practices.md)
- [n8n: collect & analyze posts](./guides/n8n-collect-and-analyze.md)
- [Claude Desktop config](./guides/claude-desktop.md)
- [curl cookbook](./guides/curl-cookbook.md)
- [TypeScript SDK](./guides/sdk.md)

### Reference
- [Interactive API explorer](https://bullgram.xyz/api/external/v1/docs) — Scalar
- [OpenAPI 3.0.3 spec](https://bullgram.xyz/api/external/v1/openapi.json)
- [Changelog](./changelog.md)
- [Support](./support.md)
- [Contributing & CI](./contributing.md)

## Issue a token

Tokens are issued at [/app/integrations](https://bullgram.xyz/app/integrations).
Two purposes are supported:

- **`mcp`** — prefix `brmcp_...`, for AI agents
- **`api`** / **`custom`** — prefix `brapi_...`, for REST automation

Each token has scoped permissions. See [scopes](./scopes.md) for the full
matrix.

## Source code map

```
backend/
├── shared/         # Cross-transport infrastructure
│   ├── dispatch.js          # Unified dispatcher (auth → scope → rate → audit → handler)
│   ├── operations.js        # Operation registry (single source of truth)
│   ├── errors.js            # Canonical JSON-RPC error codes
│   ├── rate-limiter.js      # Token-bucket limiter
│   ├── scope-guard.js       # Integration-token + scope + allowlist checks
│   ├── audit-log.js         # mcp_tool_log writers
│   ├── content-sanitizer.js # GramJS-aware message/dialog sanitization
│   └── pagination.js        # Opaque cursor encode/decode
├── mcp/            # MCP transport
│   └── tools/               # 10 operation handlers (self-registering)
├── external/       # REST transport
│   ├── router.js            # Mounts /api/external/v1/*
│   ├── auth.js              # brapi_ integration-token middleware
│   ├── errors.js            # JSON error envelope formatter
│   ├── openapi.js           # Spec generator + Scalar explorer HTML
│   └── operation-routes.js  # Auto-wires routes from registry
└── test/
    ├── test-mcp-shared.js       # 143 unit tests for shared/ modules
    ├── test-mcp-dispatch.js     # 24 dispatcher integration tests
    └── test-external-rest.js    # 47 REST integration tests
```
