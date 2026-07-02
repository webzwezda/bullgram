# userbot-web

Vendored [Ajaxy/telegram-tt](https://github.com/Ajaxy/telegram-tt) with BullRun
MTProto bridge patches. Built into `dist/` and deployed to
`/var/www/bullrun-telegram-web/`, served at `/app/telegram-web/`.

## Layout

```
userbot-web/
├── scripts/
│   ├── config.sh           # shared paths + upstream tag
│   ├── fetch-upstream.sh   # shallow clone of Ajaxy/telegram-tt@<tag>
│   ├── apply-patches.sh    # copy patches/* over upstream/*
│   ├── build.sh            # fetch → patch → npm ci → webpack build → dist/
│   └── clean.sh            # rm -rf upstream/ dist/
├── patches/
│   └── src/...             # full-file replacements, mirror upstream paths
├── upstream/               # gitignored — clone target
├── dist/                   # gitignored — build output
└── package.json            # build orchestrator (no runtime code)
```

## Build

```bash
cd userbot-web
npm run build    # fetch + patch + npm ci + webpack build + copy to dist/
```

Output: `userbot-web/dist/`. Deploy: `npm run deploy:telegram-web` from project root.

## Patches

Each file in `patches/` is a full replacement of the corresponding upstream
file at the same relative path. To add or modify a patch:

1. Copy the upstream file from `upstream/<path>` to `patches/<same/path>`.
2. Edit the patched copy. Keep changes minimal — every diff against upstream
   must have a comment block at the top explaining why.
3. `npm run patch` to apply (or `npm run build` for full pipeline).
4. Verify build still passes (`npm run build`).

Current patches:

- `src/lib/gramjs/extensions/PromisedWebSockets.ts` — transport rewrite.
  Routes MTProto bytes through BullRun backend MTProto bridge via WebSocket.
  Handshake: text frame `JSON.stringify({ip, port, dcId, isTestServer,
  isPremium})` → wait for text `"ok"` → binary frames verbatim. Reads
  `window.__BULLRUN_BRIDGE__ = { wsUrl, bridgeToken }` set by app entry.

- `src/lib/gramjs/network/connection/Connection.ts` — pass `dcId` to
  `socket.connect()` so the bridge can include it in audit logs.

## Upstream sync

Bump `UPSTREAM_TAG` in `scripts/config.sh`, then:

```bash
npm run clean
npm run build
```

Re-apply patches by hand if upstream changed the same files. Inspect each
patch's comment block to understand intent.

## What still needs patches (Phase 3d, 3e, 3f)

- App entry: extract `userbotId` from URL `/app/telegram-web/:userbotId`,
  fetch bridge token from `POST /api/userbot-web/web-session/:id`, set
  `window.__BULLRUN_BRIDGE__`, then init GramJS.
- Session storage: force GramJS to `MemorySession` (no IndexedDB persistence).
  Nuke `gramjs` IDB on boot.
- Auth bypass: remove phone/login UI. Replace with loading screen while
  session applies.
- Fingerprint consistency: pass `api_id`, `api_hash`, `deviceModel`, etc.
  from `fingerprint` to GramJS init.
- Branding: title, favicon, logos.
- Read-only gate: env flag hides send/edit UI until Phase 4 enables writes.
