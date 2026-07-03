#!/usr/bin/env bash
set -euo pipefail

LOCAL_PORT="${LOCAL_PORT:-8080}"
REMOTE_HOST="${REMOTE_HOST:-${DEPLOY_HOST:-}}"
REMOTE_USER="${REMOTE_USER:-root}"
REMOTE_PORT="${REMOTE_PORT:-8000}"

if [ -z "$REMOTE_HOST" ]; then
  echo "REMOTE_HOST (or DEPLOY_HOST) env required" >&2
  exit 1
fi

echo "Starting Supabase MCP tunnel on localhost:${LOCAL_PORT} -> ${REMOTE_HOST}:localhost:${REMOTE_PORT}"
exec ssh \
  -N \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  -L "${LOCAL_PORT}:localhost:${REMOTE_PORT}" \
  "${REMOTE_USER}@${REMOTE_HOST}"
