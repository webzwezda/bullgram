# Spike: MTProto Bridge proof-of-concept

**Goal:** prove that a Node-side GramJS client can connect to Telegram through a WS-to-TCP bridge that routes via SOCKS5. This is the riskiest technical assumption of the [telegram-web-integration plan](../../../docs/telegram-web-integration-plan.md).

## Result: SUCCESS (2026-07-02)

```
[bridge] Target 2001:b28:f23d:f001::a:80
[bridge] Connected, ACK sent
[socket] Bridge ACK received
[run] Connected!
[run] getMe OK: id=8414225338, name=Erik
[run] getDialogs OK: 4 dialogs
       - bullrun.ru (id=-1001323964374, unread=3)
       - 10379 (id=6199873263, unread=0)
       - Илья Сергеевич (id=488609412, unread=0)
       - Telegram (id=777000, unread=0)
[run] SPIKE SUCCESS — bridge works end-to-end
```

Tested against real userbot `Erik` (`43cd7bf3-d38f-4e12-bcf5-c86c4906528b`) on production data. Source IP seen by Telegram is identical to `createAuthorizedClient` (same SOCKS5 proxy `193.23.197.169:21130`).

## Architecture

```
run.js (Node-side GramJS, uses BullrunBridgeSocket)
  │
  │ WS (text frame "ip:port" → ACK "ok" → binary frames)
  ▼
bridge.js (ws server on localhost:8765)
  │
  │ raw TCP via SocksClient.createConnection
  ▼
userbot's SOCKS5 proxy → Telegram DC IP:443
```

## Protocol

1. Client connects to `ws://localhost:8765`.
2. Client sends text frame `JSON.stringify({ip, port})` (legacy `ip:port` text also accepted, parsed via `lastIndexOf(':')` for IPv6 safety).
3. Bridge opens TCP through SOCKS5 to that destination.
4. Bridge sends text frame `"ok"` (ACK) on success, or `"error:<msg>"` then close.
5. After ACK, all subsequent binary frames are piped verbatim in both directions.

## Run

```bash
cd backend
SUPABASE_URL=https://bullgram.xyz node test/spike-mtproto-bridge/run.js <userbot_id>
```

Override env:
- `SUPABASE_URL` — required to bypass the 301 redirect from `bullrun.ru` → `bullgram.xyz` when running locally (supabase-js doesn't follow).
- `BRIDGE_PORT` (default `8765`).

## What was validated

- GramJS's `networkSocket` override works as expected (`telegramBaseClient.js:91`).
- Raw MTProto bytes flow through WS-to-TCP pipe without corruption.
- SOCKS5 routing through userbot's existing proxy works for the bridge.
- **IPv6 destination is supported**: GramJS connects to `2001:b28:f23d:f001::a:80` (IPv6 Telegram DC), the `socks` library correctly relays this to an IPv4 SOCKS5 proxy.
- Backend's existing `_forceIpv6Dc` pattern (`userbot.service.js:745`) is consistent with what GramJS does by default for these proxies.
- `messages.getDialogs` returns real dialog list — full MTProto round-trip including auth_key lookup works.

## Findings for the production plan

1. **JSON frames beat text frames** — for the production bridge, the first message should be `JSON.stringify({dcId, ip, port, version})`. Plain `ip:port` text broke on IPv6 (`"2001:b28:f23d:f001::a:80".split(':')` → `['2001', 'b28:f23d:f001::a', '80']`). Fixed by JSON parse with fallback to `lastIndexOf(':')`.

2. **DC IP table is NOT needed on the bridge** — GramJS resolves the DC IP from the StringSession and passes it to the socket's `connect(port, ip)`. The bridge just needs to forward whatever IP it receives. The plan's `DC IP table` is dead code.

3. **Multi-DC should work for free** — GramJS opens separate socket instances per DC (each calls `new BullrunBridgeSocket()` → new WS). The production bridge should accept multiple WS connections under one bridge_token, each with its own dcId in the JSON handshake.

4. **`useWSS: false` required** — without it GramJS throws `Cannot use WSS with proxy`. The bridge provides raw TCP transport, so we always use `useWSS: false` and skip TLS.

5. **Update loop must be disabled for the spike** — but in production, we WANT updates (for live message delivery in telegram-tt). The bridge handles this fine since it's a transparent byte pipe.

6. **Connection time**: ~1.4s from `Connecting...` to `getMe OK` over IPv4→IPv6→SOCKS5→TCP bridge. Acceptable for UI.
