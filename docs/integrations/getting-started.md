# Getting started (5 minutes)

This walkthrough takes you from zero to your first successful Bullgram API
call. We'll issue a token, make a `GET /me` smoke test, then list your
userbots.

## 1. Issue an integration token

1. Sign in at [bullgram.xyz/app](https://bullgram.xyz/app).
2. Open **[/app/integrations](https://bullgram.xyz/app/integrations)**.
3. Click **New token**.
4. Pick:
   - **Purpose**: `api` (for REST) or `mcp` (for Claude Desktop / agents)
   - **Label**: anything memorable, e.g. `n8n-monitor`
   - **Scopes**: start with `api:userbot:read` — you can widen later
5. Copy the full `brapi_...` token **immediately**. You won't see it again.

## 2. Smoke test

```bash
TOKEN="brapi_paste_your_token_here"

curl -H "Authorization: Bearer $TOKEN" \
  https://bullgram.xyz/api/external/v1/me
```

Expected response (HTTP 200):

```json
{
  "auth_kind": "integration_token",
  "owner_id": "...",
  "token": { "id": "...", "purpose": "api", "scopes": ["api:userbot:read", ...] },
  "tier": "normal"
}
```

If you see HTTP 401, check:
- Token starts with `brapi_` (not `brmcp_`)
- Token was copied fully (no truncation)
- Token isn't revoked

## 3. List your userbots

```bash
curl -H "Authorization: Bearer $TOKEN" \
  https://bullgram.xyz/api/external/v1/userbots
```

You'll see your owned userbots with their IDs. Pick one and use it for the
next call.

## 4. Read a userbot's health

```bash
USERBOT_ID="11111111-1111-1111-1111-111111111111"

curl -H "Authorization: Bearer $TOKEN" \
  https://bullgram.xyz/api/external/v1/userbots/$USERBOT_ID/health
```

This is the cheapest way to verify the userbot is healthy. **Does not connect
to Telegram** — safe to poll every few seconds.

## 5. Read messages from a chat

You need a `chat_id` first. List dialogs to find one:

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "https://bullgram.xyz/api/external/v1/userbots/$USERBOT_ID/dialogs?limit=5"
```

Then fetch messages from a chat:

```bash
CHAT_ID="-1001234567890"

curl -H "Authorization: Bearer $TOKEN" \
  "https://bullgram.xyz/api/external/v1/userbots/$USERBOT_ID/messages?chat_id=$CHAT_ID&limit=10"
```

## 6. Paginate

The response includes `cursor` and `has_more`. Pass `cursor` back:

```bash
CURSOR="eyJvZmZzZXRfaWQiOjg3OTl9"

curl -H "Authorization: Bearer $TOKEN" \
  "https://bullgram.xyz/api/external/v1/userbots/$USERBOT_ID/messages?chat_id=$CHAT_ID&cursor=$CURSOR"
```

## 7. Try the interactive explorer

Open [bullgram.xyz/api/external/v1/docs](https://bullgram.xyz/api/external/v1/docs)
in your browser. Click **Authorize**, paste your token, and try any
operation live.

## Next steps

- Read the [REST transport](./transports/rest.md) reference
- Browse the [operations catalog](./operations/)
- Pick a [guide](./guides/) for your consumer (n8n, curl cookbook, SDK)
- Understand [scopes](./scopes.md) and [rate limits](./rate-limits.md)

## Common pitfalls

- **`brmcp_` token on REST** → 401 with a clear message. Issue a `brapi_`
  token.
- **Missing scope** → 403. Compare `required_scopes` and `present_scopes`
  in the error envelope.
- **`cursor` from a stale session** → 400 INVALID_CURSOR. Drop it and
  refetch page 1.
- **DMs failing** → check `USERBOT_DM_ENABLED` on the backend. Default is
  `false`.
