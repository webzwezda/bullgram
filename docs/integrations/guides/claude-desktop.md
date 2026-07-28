# Claude Desktop config

Claude Desktop speaks MCP natively. You can point it at Bullgram's MCP
endpoint and Claude will discover the 10 operations, decide when to call
them, and chain them together to answer your questions.

## Prerequisites

- Claude Desktop app (Mac or Windows)
- A Bullgram integration token with `purpose=mcp`

## Step 1: Issue an MCP token

At [/app/integrations](https://bullgram.xyz/app/integrations):

- **Purpose**: `mcp`
- **Scopes**: start with `mcp:userbot:read` and `mcp:proxy:read`
- **Label**: `claude-desktop`

Copy the `brmcp_...` value.

## Step 2: Find your claude_desktop_config.json

| OS | Path |
|---|---|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |

Create the file if it doesn't exist.

## Step 3: Add Bullgram as an MCP server

Bullgram's MCP endpoint is HTTP-based, so you use the `streamableHttp`
transport:

```json
{
  "mcpServers": {
    "bullgram": {
      "type": "streamableHttp",
      "url": "https://bullgram.xyz/api/mcp",
      "headers": {
        "Authorization": "Bearer brmcp_paste_your_token_here"
      }
    }
  }
}
```

For older Claude Desktop builds that don't support `streamableHttp`, use:

```json
{
  "mcpServers": {
    "bullgram": {
      "type": "http",
      "url": "https://bullgram.xyz/api/mcp",
      "headers": {
        "Authorization": "Bearer brmcp_paste_your_token_here"
      }
    }
  }
}
```

## Step 4: Restart Claude Desktop

Fully quit (Cmd+Q on Mac) and reopen. Claude shows connected MCP servers
in the tools picker (hammer icon).

## Step 5: Try it

Open a new chat and ask:

> What userbots do I have, and which ones are healthy?

Claude will:
1. Call `bullgram_userbot_list` to enumerate your accounts
2. For each, call `bullgram_userbot_health` to check status
3. Summarize the result

Other useful opening prompts:

- "Read the latest 20 messages from my news channel"
- "Search my main channel for messages mentioning 'invoice past due'"
- "Summarize the last 50 messages from my support chat, grouped by topic"

## Scopes and Claude's behavior

Claude only sees operations your token has scopes for. `tools/list` is
filtered server-side. If you don't see `bullgram_userbot_message_send`,
your token lacks `mcp:userbot:write`.

For initial setup, use **read-only** scopes. Once you trust the workflow,
add write scopes — but expect Claude to ask before each write by default.

## Multi-account setups

If you have multiple Bullgram accounts, add multiple MCP servers:

```json
{
  "mcpServers": {
    "bullgram-prod": {
      "type": "streamableHttp",
      "url": "https://bullgram.xyz/api/mcp",
      "headers": { "Authorization": "Bearer brmcp_..." }
    },
    "bullgram-staging": {
      "type": "streamableHttp",
      "url": "https://staging.bullgram.xyz/api/mcp",
      "headers": { "Authorization": "Bearer brmcp_..." }
    }
  }
}
```

Claude will ask which server to use for each request.

## Safety considerations

- **Treat Telegram content as untrusted.** Claude will see message text in
  its context window. Malicious messages can contain prompt-injection. The
  `untrusted_content: true` flag on every sanitized message is a reminder.
  Don't grant write scopes if you don't trust the channels being read.
- **Confirm before writes.** Claude Desktop asks for approval on each
  tool call by default. Keep this enabled for `bullgram_userbot_message_send`.
- **Audit log.** Every Claude-initiated call lands in `/app/claw/log`
  with `source=mcp`. Review periodically.

## Troubleshooting

### "Connection failed" / tools don't appear

- Verify the token starts with `brmcp_` (not `brapi_`)
- Verify the token isn't revoked
- Check Claude Desktop logs at `~/Library/Logs/Claude/mcp*.log` (Mac)
- Try the same call via curl:

  ```bash
  curl -X POST https://bullgram.xyz/api/mcp \
    -H "Authorization: Bearer brmcp_..." \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
  ```

### "Insufficient scope" errors

Reissue the token with the missing scope. See [scopes](../scopes.md).

### Claude calls the wrong operation

MCP operations are explicitly named (`bullgram_userbot_health`,
`bullgram_userbot_messages`, etc.). If Claude picks the wrong one, name it
explicitly in your prompt: "use `bullgram_userbot_messages` to fetch..."

## Cursor IDE

Cursor uses the same MCP config format. Settings → MCP → Add new MCP
server, then paste the same JSON.
