# curl cookbook

Practical `curl` recipes for common Bullgram tasks. All examples assume:

```bash
TOKEN="brapi_paste_your_token_here"
BASE="https://bullgram.xyz/api/external/v1"
AUTH="Authorization: Bearer $TOKEN"
```

## Discovery

### List your userbots

```bash
curl -s -H "$AUTH" "$BASE/userbots" | jq
```

### Find a specific chat by name

```bash
USERBOT_ID="..."
curl -s -H "$AUTH" "$BASE/userbots/$USERBOT_ID/dialogs?search=news&limit=20" | jq
```

### Inspect a userbot's recent errors

```bash
USERBOT_ID="..."
curl -s -H "$AUTH" "$BASE/userbots/$USERBOT_ID/health" | jq
```

## Reading content

### Latest 100 messages from a channel

```bash
CHAT_ID="-1001234567890"
curl -s -H "$AUTH" \
  "$BASE/userbots/$USERBOT_ID/messages?chat_id=$CHAT_ID&limit=100" | jq '.messages[] | { id, date, sender: .sender.username, text }'
```

### Messages from a date range

```bash
curl -s -H "$AUTH" \
  "$BASE/userbots/$USERBOT_ID/messages?chat_id=$CHAT_ID&since=2026-07-01T00:00:00Z&until=2026-07-31T23:59:59Z" \
  | jq '.messages | length'
```

### Paginate through history

```bash
cursor=""
while true; do
  url="$BASE/userbots/$USERBOT_ID/messages?chat_id=$CHAT_ID&limit=200"
  if [ -n "$cursor" ]; then
    url="$url&cursor=$cursor"
  fi
  response=$(curl -s -H "$AUTH" "$url")
  count=$(echo "$response" | jq '.messages | length')
  echo "fetched: $count"
  cursor=$(echo "$response" | jq -r '.cursor // empty')
  if [ -z "$cursor" ]; then break; fi
  sleep 1
done
```

### Search for a keyword

```bash
QUERY="invoice past due"
curl -s -G -H "$AUTH" \
  --data-urlencode "chat_id=$CHAT_ID" \
  --data-urlencode "query=$QUERY" \
  --data-urlencode "limit=20" \
  "$BASE/userbots/$USERBOT_ID/messages/search" | jq
```

### List participants

```bash
curl -s -H "$AUTH" \
  "$BASE/userbots/$USERBOT_ID/participants?chat_id=$CHAT_ID&limit=200" | jq '.participants[] | { id, username, is_admin }'
```

## Writing

### Send a message

```bash
curl -s -X POST -H "$AUTH" -H "Content-Type: application/json" \
  -d "{\"chat_id\":\"$CHAT_ID\",\"text\":\"Daily digest: 12 new tickets today.\"}" \
  "$BASE/userbots/$USERBOT_ID/messages" | jq
```

### Reply to a message

```bash
REPLY_TO="8800"
curl -s -X POST -H "$AUTH" -H "Content-Type: application/json" \
  -d "{\"chat_id\":\"$CHAT_ID\",\"text\":\"Confirmed.\",\"reply_to_message_id\":\"$REPLY_TO\"}" \
  "$BASE/userbots/$USERBOT_ID/messages" | jq
```

## Proxies

### Preview a pasted proxy

```bash
RAW='socks5://user:pass@1.2.3.4:1080'
curl -s -X POST -H "$AUTH" -H "Content-Type: application/json" \
  -d "{\"raw\":\"$RAW\"}" \
  "$BASE/proxies/preview" | jq
```

### Import after confirmation

```bash
curl -s -X POST -H "$AUTH" -H "Content-Type: application/json" \
  -d "{\"raw\":\"$RAW\",\"confirmed\":true,\"name\":\"US-east-1\"}" \
  "$BASE/proxies/import" | jq
```

## Inspection

### Check your token's scopes

```bash
curl -s -H "$AUTH" "$BASE/me" | jq
```

### Fetch the OpenAPI spec

```bash
curl -s "$BASE/openapi.json" > openapi.json
```

### Test the live explorer

Open [bullgram.xyz/api/external/v1/docs](https://bullgram.xyz/api/external/v1/docs)
in a browser, click Authorize, paste your token.

## Bulk operations

### Export last 7 days to CSV

```bash
USERBOT_ID="..."
CHAT_ID="-1001234567890"
SINCE=$(date -u -v-7d +%Y-%m-%dT00:00:00Z 2>/dev/null || date -u -d '7 days ago' +%Y-%m-%dT00:00:00Z)

cursor=""
echo "id,date,sender,text"
while true; do
  url="$BASE/userbots/$USERBOT_ID/messages?chat_id=$CHAT_ID&since=$SINCE&limit=200"
  [ -n "$cursor" ] && url="$url&cursor=$cursor"
  response=$(curl -s -H "$AUTH" "$url")
  echo "$response" | jq -r '.messages[] | [.id, .date, (.sender.username // ""), (.text | gsub("\n"; " ") | gsub("\""; "\\\""))] | @csv'
  cursor=$(echo "$response" | jq -r '.cursor // empty')
  [ -z "$cursor" ] && break
  sleep 1
done > messages_week.csv
```

### Health-check all userbots

```bash
curl -s -H "$AUTH" "$BASE/userbots" | jq -r '.userbots[].id' | while read -r id; do
  status=$(curl -s -H "$AUTH" "$BASE/userbots/$id/health" | jq -r '.runtime_status')
  echo "$id: $status"
done
```

## Error handling patterns

### Detect rate-limit and back off

```bash
while true; do
  response=$(curl -s -w "\n%{http_code}" -H "$AUTH" "$BASE/userbots/$USERBOT_ID/dialogs?limit=200")
  code=$(echo "$response" | tail -1)
  body=$(echo "$response" | sed '$d')
  if [ "$code" = "429" ]; then
    retry=$(echo "$body" | jq -r '.error.retry_after_sec')
    echo "rate limited, sleeping $retry"
    sleep "$retry"
    continue
  fi
  echo "$body" | jq
  break
done
```

### Validate cursor before reuse

```bash
cursor_file="/tmp/bullgram_cursor"
[ -f "$cursor_file" ] && cursor=$(cat "$cursor_file") || cursor=""

url="$BASE/userbots/$USERBOT_ID/messages?chat_id=$CHAT_ID&limit=100"
[ -n "$cursor" ] && url="$url&cursor=$cursor"

response=$(curl -s -H "$AUTH" "$url")
if echo "$response" | jq -e '.error.code == -32013' >/dev/null; then
  echo "cursor stale, refetching"
  curl -s -H "$AUTH" "$BASE/userbots/$USERBOT_ID/messages?chat_id=$CHAT_ID&limit=100" > "$response"
fi

new_cursor=$(echo "$response" | jq -r '.cursor // empty')
[ -n "$new_cursor" ] && echo "$new_cursor" > "$cursor_file"
```

## Why curl?

These recipes double as the **canonical** way to test the API. If a curl
call works but your SDK doesn't, the bug is in your SDK wrapper — not
Bullgram. Always include the working curl call when reporting issues.
