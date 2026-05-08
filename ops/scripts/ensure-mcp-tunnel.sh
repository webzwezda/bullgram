#!/usr/bin/env bash
# Ensures the Supabase SSH tunnel is running in the background.
# Forwards:
#   localhost:8080  -> Kong REST API (localhost:8000)
#   localhost:5432  -> PostgreSQL direct (supabase-db container 172.19.0.11:5432)
# Safe to call multiple times — exits silently if tunnel is already alive.

REMOTE_HOST="${REMOTE_HOST:-64.188.70.180}"
REMOTE_USER="${REMOTE_USER:-root}"
PID_FILE="/tmp/supabase-mcp-tunnel.pid"

# Check if tunnel is already alive
if [ -f "$PID_FILE" ]; then
  pid=$(cat "$PID_FILE")
  if kill -0 "$pid" 2>/dev/null; then
    # Verify both ports are listening
    if lsof -i ":8080" -sTCP:LISTEN >/dev/null 2>&1 && lsof -i ":5432" -sTCP:LISTEN >/dev/null 2>&1; then
      exit 0
    fi
  fi
  rm -f "$PID_FILE"
fi

# Kill stale processes on both ports
for port in 8080 5432; do
  pids=$(lsof -t -i ":${port}" -sTCP:LISTEN 2>/dev/null || true)
  if [ -n "$pids" ]; then
    kill $pids 2>/dev/null || true
  fi
done
sleep 0.5

# Start tunnel:
# - 8080 -> Kong REST API on localhost
# - 5432 -> Direct PostgreSQL inside Docker network (bypasses PgBouncer)
ssh \
  -N \
  -f \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  -L "8080:localhost:8000" \
  -L "5432:172.19.0.11:5432" \
  "${REMOTE_USER}@${REMOTE_HOST}"

# Record PID
sleep 0.5
pids=$(lsof -t -i ":8080" -sTCP:LISTEN 2>/dev/null || true)
if [ -n "$pids" ]; then
  echo "$pids" | head -1 > "$PID_FILE"
fi
