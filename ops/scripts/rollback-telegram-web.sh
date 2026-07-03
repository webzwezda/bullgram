#!/usr/bin/env bash
# Rollback / kill-switch for Telegram Web (MTProto bridge + UI).
#
# Three layers of disable, in increasing reversibility:
#   1) Feature flag flip (TELEGRAM_WEB_ENABLED=false in backend/.env)
#      → REST returns 503, WS rejects with 1008. UI button auto-hides
#      via /api/userbot-web/status. PM2 restart needed.
#   2) nginx 404 kill-switch for /app/telegram-web/ — instant, no app
#      restart. Use this if backend itself is compromised.
#   3) Static artifact wipe — rm /var/www/bullrun-telegram-web/. Last
#      resort; requires redeploy to restore.
#
# Usage:
#   rollback-telegram-web.sh flag      # disable feature flag (default)
#   rollback-telegram-web.sh nginx     # also add nginx 404 kill
#   rollback-telegram-web.sh hard      # also wipe static artifacts
#   rollback-telegram-web.sh status    # show current state
#   rollback-telegram-web.sh restore   # re-enable everything

set -euo pipefail

DEPLOY_HOST="${DEPLOY_HOST:-}"
DEPLOY_USER="${DEPLOY_USER:-root}"
if [ -z "$DEPLOY_HOST" ]; then
  echo "DEPLOY_HOST env required (e.g. DEPLOY_HOST=1.2.3.4 ./ops/scripts/rollback-telegram-web.sh)" >&2
  exit 1
fi
SERVER="${DEPLOY_USER}@${DEPLOY_HOST}"
BACKEND_ENV="/var/www/backend/.env"
NGINX_CONF="/etc/nginx/sites-available/bullgram.xyz"
KILLSWITCH_CONF="/etc/nginx/conf.d/telegram-web-killswitch.conf"
STATIC_DIR="/var/www/bullrun-telegram-web"

ACTION="${1:-flag}"

case "$ACTION" in
    status)
        echo "==> Telegram Web status"
        ssh "$SERVER" bash -s <<'REMOTE'
            echo "Feature flag (TELEGRAM_WEB_ENABLED):"
            grep -E '^TELEGRAM_WEB_ENABLED=' /var/www/backend/.env 2>/dev/null || echo "  not set"
            echo
            echo "Static artifacts:"
            if [ -d /var/www/bullrun-telegram-web ] && [ -f /var/www/bullrun-telegram-web/index.html ]; then
                echo "  present ($(ls /var/www/bullrun-telegram-web | wc -l) files)"
            else
                echo "  MISSING"
            fi
            echo
            echo "Nginx killswitch:"
            if [ -f /etc/nginx/conf.d/telegram-web-killswitch.conf ]; then
                echo "  ACTIVE"
                cat /etc/nginx/conf.d/telegram-web-killswitch.conf
            else
                echo "  inactive"
            fi
            echo
            echo "Status endpoint:"
            curl -sS https://bullgram.xyz/api/userbot-web/status || true
REMOTE
        ;;

    flag)
        echo "==> Disabling TELEGRAM_WEB_ENABLED in backend .env"
        ssh "$SERVER" bash -s <<'REMOTE'
            if grep -q '^TELEGRAM_WEB_ENABLED=' /var/www/backend/.env; then
                sed -i 's/^TELEGRAM_WEB_ENABLED=.*/TELEGRAM_WEB_ENABLED=false/' /var/www/backend/.env
            else
                echo 'TELEGRAM_WEB_ENABLED=false' >> /var/www/backend/.env
            fi
            grep '^TELEGRAM_WEB_ENABLED=' /var/www/backend/.env
            pm2 restart bullrun-tg-backend
            echo
            echo "Status endpoint:"
            curl -sS http://localhost:3000/api/userbot-web/status || true
REMOTE
        echo "==> Done. UI button will auto-hide on next page load."
        ;;

    nginx)
        echo "==> Adding nginx killswitch for /app/telegram-web/"
        ssh "$SERVER" bash -s <<'REMOTE'
            cat > /etc/nginx/conf.d/telegram-web-killswitch.conf <<'EOF'
location ^~ /app/telegram-web/ {
    return 404;
}
EOF
            nginx -t
            systemctl reload nginx
            echo "Killswitch installed:"
            cat /etc/nginx/conf.d/telegram-web-killswitch.conf
REMOTE
        echo "==> Done. /app/telegram-web/* now returns 404 at nginx layer."
        ;;

    hard)
        echo "==> Wiping static artifacts at $STATIC_DIR"
        ssh "$SERVER" bash -s <<'REMOTE'
            if [ -d /var/www/bullrun-telegram-web ]; then
                mv /var/www/bullrun-telegram-web /var/www/bullrun-telegram-web.disabled.$(date +%s)
                echo "Moved to /var/www/bullrun-telegram-web.disabled.*"
            else
                echo "Already missing"
            fi
            if [ ! -f /etc/nginx/conf.d/telegram-web-killswitch.conf ]; then
                cat > /etc/nginx/conf.d/telegram-web-killswitch.conf <<'EOF'
location ^~ /app/telegram-web/ {
    return 404;
}
EOF
                systemctl reload nginx
            fi
REMOTE
        echo "==> Hard rollback complete. Requires redeploy to restore."
        ;;

    restore)
        echo "==> Restoring Telegram Web"
        ssh "$SERVER" bash -s <<'REMOTE'
            # Re-enable flag
            if grep -q '^TELEGRAM_WEB_ENABLED=' /var/www/backend/.env; then
                sed -i 's/^TELEGRAM_WEB_ENABLED=.*/TELEGRAM_WEB_ENABLED=true/' /var/www/backend/.env
            else
                echo 'TELEGRAM_WEB_ENABLED=true' >> /var/www/backend/.env
            fi
            # Remove nginx killswitch
            if [ -f /etc/nginx/conf.d/telegram-web-killswitch.conf ]; then
                rm /etc/nginx/conf.d/telegram-web-killswitch.conf
                nginx -t
                systemctl reload nginx
            fi
            # Restore most recent backup if hard-rolled back
            LATEST=$(ls -1d /var/www/bullrun-telegram-web.disabled.* 2>/dev/null | head -1 || true)
            if [ -n "$LATEST" ] && [ ! -d /var/www/bullrun-telegram-web ]; then
                mv "$LATEST" /var/www/bullrun-telegram-web
                chown -R www-data:www-data /var/www/bullrun-telegram-web
                echo "Restored artifacts from $LATEST"
            fi
            pm2 restart bullrun-tg-backend
            grep '^TELEGRAM_WEB_ENABLED=' /var/www/backend/.env
            curl -sS http://localhost:3000/api/userbot-web/status || true
REMOTE
        echo "==> Restored. Note: artifacts only auto-restored if 'hard' was the last action."
        ;;

    *)
        echo "Usage: $0 {flag|nginx|hard|status|restore}"
        echo
        echo "Layers (least to most destructive):"
        echo "  flag     — TELEGRAM_WEB_ENABLED=false + PM2 restart"
        echo "  nginx    — add /app/telegram-web/ → 404 killswitch"
        echo "  hard     — also move static dir aside + nginx kill"
        echo "  status   — show current state of all three layers"
        echo "  restore  — re-enable everything (assumes 'flag' or 'nginx' was last)"
        exit 1
        ;;
esac
