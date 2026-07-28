# n8n: collect & analyze posts

A complete walkthrough for an n8n workflow that polls messages from a
Telegram channel, classifies them, and stores the result in Google Sheets.

## Architecture

```
┌─────────────────┐  every 5 min  ┌──────────────────┐  fetch 100  ┌────────────┐
│  Cron trigger   │ ─────────────▶│  HTTP Request    │ ──────────▶ │ Bullgram   │
│                 │               │  (Bullgram API)  │             │ REST API   │
└─────────────────┘               └──────────────────┘             └────────────┘
                                          │
                                          ▼
                                  ┌──────────────────┐  classify  ┌────────────┐
                                  │  OpenAI node     │ ─────────▶ │  GPT-4     │
                                  │  (sentiment)     │             │            │
                                  └──────────────────┘             └────────────┘
                                          │
                                          ▼
                                  ┌──────────────────┐  append   ┌────────────┐
                                  │  Google Sheets   │ ─────────▶ │  Sheet     │
                                  └──────────────────┘             └────────────┘
```

## Prerequisites

1. A Bullgram account with at least one userbot activated
2. A Telegram channel where your userbot is a member
3. n8n (self-hosted or n8n.cloud)
4. Optional: OpenAI API key for classification

## Step 1: Issue a token

At [/app/integrations](https://bullgram.xyz/app/integrations):

- **Purpose**: `api`
- **Scopes**: `api:userbot:read`
- **Label**: `n8n-collector`

Copy the `brapi_...` value.

## Step 2: Find your userbot_id and chat_id

```bash
TOKEN="brapi_..."

# List userbots — pick the one that's a member of your target channel
curl -H "Authorization: Bearer $TOKEN" \
  https://bullgram.xyz/api/external/v1/userbots
```

Note the `id` field. Then list that userbot's dialogs:

```bash
USERBOT_ID="..."

curl -H "Authorization: Bearer $TOKEN" \
  "https://bullgram.xyz/api/external/v1/userbots/$USERBOT_ID/dialogs?type=channel"
```

Note the `id` of the target channel (starts with `-100`).

## Step 3: Build the n8n workflow

### Node 1: Schedule Trigger

- **Interval**: 5 minutes

### Node 2: HTTP Request (fetch messages)

- **Method**: GET
- **URL**: `https://bullgram.xyz/api/external/v1/userbots/{{$env.USERBOT_ID}}/messages`
- **Query params**:
  - `chat_id`: `{{$env.CHANNEL_ID}}`
  - `limit`: `100`
- **Authentication**: Header — name `Authorization`, value `Bearer {{$env.BULLGRAM_TOKEN}}`
- **Response format**: JSON

Store credentials in n8n's **Credentials** manager — don't hardcode the
token in the workflow JSON.

### Node 3: Code node (deduplicate + format)

```javascript
// Keep only items we haven't seen (compare with last_run_cursor in workflow static data)
const staticData = $getWorkflowStaticData('global');
const lastSeenId = staticData.last_seen_id || null;

const items = $input.all()[0].json.messages || [];
const fresh = lastSeenId
  ? items.filter((m) => Number(m.id) > Number(lastSeenId))
  : items;

if (fresh.length) {
  staticData.last_seen_id = fresh[0].id; // newest first, so fresh[0] is newest
}

// Emit one item per fresh message
return fresh.map((m) => ({ json: {
  message_id: m.id,
  date: m.date,
  sender: m.sender?.username || '(unknown)',
  text: m.text,
  text_truncated: m.text_truncated
}}));
```

### Node 4: OpenAI (optional — classify sentiment)

- **Resource**: Chat completion
- **Model**: `gpt-4o-mini`
- **Prompt**: 

```
Classify the sentiment of this Telegram message as one of: positive,
negative, neutral, question, complaint, praise.

Reply with a single word.

Message: {{ $json.text }}
```

### Node 5: Google Sheets (append)

- **Operation**: Append row
- **Sheet**: your destination
- **Columns**: message_id, date, sender, text, sentiment

## Step 4: Handle pagination across runs

The code node above uses `$getWorkflowStaticData` to track the newest
message ID seen. Each run fetches the latest 100 and filters to only-new
items. **Do not use the cursor mechanism here** — cursors are for
backfilling within a single run, not across runs.

## Step 5: Backfill historical data

For the first run, you may want to backfill the last 1000 messages. Run
this once manually:

```bash
USERBOT_ID="..."
CHAT_ID="..."
TOKEN="brapi_..."

# Loop through 10 pages of 100
cursor=""
for i in $(seq 1 10); do
  url="https://bullgram.xyz/api/external/v1/userbots/$USERBOT_ID/messages?chat_id=$CHAT_ID&limit=100"
  if [ -n "$cursor" ]; then
    url="$url&cursor=$cursor"
  fi
  response=$(curl -s -H "Authorization: Bearer $TOKEN" "$url")
  echo "$response" | jq '.messages | length'  # see how many we got
  cursor=$(echo "$response" | jq -r '.cursor // empty')
  if [ -z "$cursor" ]; then break; fi
  sleep 1  # be nice
done
```

## Variations

### Alert on specific keywords

Replace the OpenAI node with a **Switch** node that branches on regex
matches against `{{$json.text}}`. Send a Slack message on the
"complaint" branch.

### Daily digest

Replace the 5-minute cron with a daily one. Aggregate counts in the code
node. Send a single summary message via `bullgram_userbot_message_send`.

### Multi-channel monitoring

Parameterize with n8n's **Execute Workflow** node — call the fetcher
sub-workflow once per channel.

## Rate limit budget

Each 5-minute fetch = 1 read against the token bucket (120/min) and 1 read
against the userbot bucket (60/min). You have ample headroom for
multi-channel monitoring. Backfilling 1000 messages = 10 calls — still
tiny.

## Common pitfalls

- **Token in workflow JSON** — check your export before sharing. Use n8n
  Credentials for the bearer value.
- **Forgetting to set `last_seen_id` on first run** — without it, the
  first run will process the latest 100 messages even if you already
  saw them. Seed `staticData.last_seen_id` manually if needed.
- **Filtering by date** — `since`/`until` params exist but cursor
  pagination is more reliable. Use `since` only for absolute time bounds.
