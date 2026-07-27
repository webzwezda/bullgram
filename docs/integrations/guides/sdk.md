# Building a TypeScript SDK

The OpenAPI spec at [`/openapi.json`](https://bullgram.xyz/api/external/v1/openapi.json)
is auto-generated from the live operation registry. Point any
OpenAPI-compatible generator at it to produce a typed client.

This guide walks through generating a TypeScript client with
`openapi-generator-cli`, then using it from a Node script.

## Prerequisites

- Node.js 22+
- `npx` (bundled with npm)

## Step 1: Generate the client

```bash
mkdir bullgram-sdk && cd bullgram-sdk
npm init -y

npx @openapitools/openapi-generator-cli generate \
  -i https://bullgram.xyz/api/external/v1/openapi.json \
  -g typescript-fetch \
  -o ./client \
  --additional-properties=supportsES6=true,typescriptThreePlus=true
```

This creates a `client/` directory with:
- `api.ts` — one method per operation
- `configuration.ts` — auth setup
- `models/` — types for every request/response shape

## Step 2: Use the client

```typescript
import { Configuration, BullgramExternalApiApi } from './client';

const config = new Configuration({
  basePath: 'https://bullgram.xyz/api/external/v1',
  accessToken: process.env.BULLGRAM_TOKEN,
});

const api = new BullgramExternalApiApi(config);

async function main() {
  // /me smoke test
  const me = await api.me();
  console.log(`Authenticated as ${me.owner_id}, tier=${me.tier}`);

  // List userbots
  const { userbots } = await api.bullrunUserbotList({ limit: 20 });
  console.log(`Found ${userbots.length} userbots`);

  // Get health for the first one
  const [first] = userbots;
  if (first) {
    const health = await api.bullrunUserbotHealth({ userbotId: first.id });
    console.log(`${first.tg_username}: ${health.runtime_status}`);
  }

  // Fetch latest messages
  const chatId = '-1001234567890';
  const { messages, cursor, hasMore } = await api.bullrunUserbotMessages({
    userbotId: first.id,
    chatId,
    limit: 50,
  });
  console.log(`Got ${messages.length} messages, has_more=${hasMore}`);

  // Send a digest
  await api.bullrunUserbotMessageSend({
    userbotId: first.id,
    bullrunUserbotMessageSendRequest: {
      chat_id: chatId,
      text: `Daily digest: ${messages.length} new messages today.`,
    },
  });
}

main().catch(console.error);
```

## Step 3: Regenerate when the API changes

The spec is generated from the live registry, so it always reflects the
running backend. To pull in new operations:

```bash
npx @openapitools/openapi-generator-cli generate \
  -i https://bullgram.xyz/api/external/v1/openapi.json \
  -g typescript-fetch \
  -o ./client
```

Add this as a script in `package.json`:

```json
{
  "scripts": {
    "sdk:regenerate": "openapi-generator-cli generate -i https://bullgram.xyz/api/external/v1/openapi.json -g typescript-fetch -o ./client"
  }
}
```

## Other generators

The same spec works with any OpenAPI 3.0.3 generator:

| Language | Generator command |
|---|---|
| Python | `-g python` |
| Go | `-g go` |
| Rust | `-g rust` |
| Java | `-g java` |
| Ruby | `-g ruby` |
| PHP | `-g php` |
| C# | `-g csharp` |

Run `openapi-generator-cli list` for the full set (~50 languages).

## Minimal hand-rolled alternative

If you don't want a code generator, here's a 50-line typed wrapper:

```typescript
// bullgram.ts
export class BullgramClient {
  constructor(
    private token: string,
    private base = 'https://bullgram.xyz/api/external/v1'
  ) {}

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      ...init,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        ...(init.headers || {}),
      },
    });
    const body = await res.json();
    if (!res.ok) throw new BullgramError(body.error.code, body.error.message, body.error);
    return body as T;
  }

  health() { return this.call('/health'); }
  me() { return this.call('/me'); }

  listUserbots(opts: { limit?: number; includeReserved?: boolean } = {}) {
    const qs = new URLSearchParams();
    if (opts.limit != null) qs.set('limit', String(opts.limit));
    if (opts.includeReserved) qs.set('include_reserved', 'true');
    return this.call(`/userbots${qs.toString() ? '?' + qs : ''}`);
  }

  userbotHealth(userbotId: string) {
    return this.call(`/userbots/${userbotId}/health`);
  }

  fetchMessages(userbotId: string, opts: {
    chatId: string;
    since?: string;
    until?: string;
    limit?: number;
    cursor?: string;
  }) {
    const qs = new URLSearchParams({ chat_id: opts.chatId });
    if (opts.since) qs.set('since', opts.since);
    if (opts.until) qs.set('until', opts.until);
    if (opts.limit != null) qs.set('limit', String(opts.limit));
    if (opts.cursor) qs.set('cursor', opts.cursor);
    return this.call(`/userbots/${userbotId}/messages?${qs}`);
  }

  sendMessage(userbotId: string, body: { chat_id: string; text: string; reply_to_message_id?: string }) {
    return this.call(`/userbots/${userbotId}/messages`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }
}

export class BullgramError extends Error {
  constructor(public code: number, message: string, public details?: unknown) {
    super(message);
  }
}
```

Usage:

```typescript
import { BullgramClient } from './bullgram';

const client = new BullgramClient(process.env.BULLGRAM_TOKEN!);
const me = await client.me();
console.log(me);
```

## Type-safe pagination helper

```typescript
async function* paginate<T>(
  fetchPage: (cursor?: string) => Promise<{ items: T[]; cursor?: string; has_more: boolean }>
): AsyncGenerator<T> {
  let cursor: string | undefined;
  do {
    const page = await fetchPage(cursor);
    for (const item of page.items) yield item;
    cursor = page.cursor;
    if (!page.has_more) break;
  } while (cursor);
}

// Usage
for await (const msg of paginate((cursor) =>
  client.fetchMessages(USERBOT_ID, { chatId: CHAT_ID, limit: 200, cursor })
    .then((r: any) => ({ items: r.messages, cursor: r.cursor, has_more: r.has_more }))
)) {
  console.log(msg.id, msg.text);
}
```

## Pinning versions

The OpenAPI spec carries `info.version: 'v1'`. We won't break shape within
`v1` — new fields are additive, removed fields get a deprecation window.
For mission-critical codegen pipelines, snapshot the spec into your repo
and regenerate from the snapshot:

```bash
curl -s https://bullgram.xyz/api/external/v1/openapi.json > spec/v1.json
npx openapi-generator-cli generate -i spec/v1.json -g typescript-fetch -o ./client
```

Bump the snapshot when you're ready to adopt new operations.
