#!/bin/bash
# VillaManager deployment script for the GCP VM (Ubuntu).
#
#   ./deploy.sh setup      First-time install on a fresh VM (Node, PM2, Nginx, build, start)
#   ./deploy.sh update     Release new code to a running server (default):
#                          backup DB -> git pull -> install -> build -> restart -> health check
#   ./deploy.sh rollback   Restore the code version and database from before the last update
#
# Run from anywhere; the script works from its own folder (the repo root).

set -euo pipefail

APP_NAME="villamanager-api"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$REPO_DIR/backend"
FRONTEND="$REPO_DIR/frontend"
DB_FILE="$BACKEND/database.sqlite"
BACKUP_DIR="$BACKEND/backups"
LAST_DEPLOY="$BACKUP_DIR/last-deploy.env"
KEEP_BACKUPS=20
NGINX_SITE="/etc/nginx/sites-available/villamanager"

log()  { echo -e "\n\033[1;34m==> $*\033[0m"; }
warn() { echo -e "\033[1;33m[warn] $*\033[0m"; }
fail() { echo -e "\033[1;31m[error] $*\033[0m"; exit 1; }

# Keep server settings in backend/.env: JWT secret (generated once so logins survive re-deploys),
# Sri Lanka timezone for "today", and the production flag that blocks the test-data scripts.
ensure_env() {
    cd "$BACKEND"
    touch .env
    chmod 600 .env
    grep -q '^JWT_SECRET=' .env || echo "JWT_SECRET=$(openssl rand -hex 48)" >> .env
    grep -q '^TZ=' .env         || echo "TZ=Asia/Colombo" >> .env
    grep -q '^NODE_ENV=' .env   || echo "NODE_ENV=production" >> .env
}

# Consistent online copy of the SQLite database (safe while the API is running), verified afterwards.
backup_db() {
    mkdir -p "$BACKUP_DIR"
    if [ ! -f "$DB_FILE" ]; then
        warn "No database at $DB_FILE yet - nothing to back up."
        BACKUP_FILE=""
        return
    fi
    BACKUP_FILE="$BACKUP_DIR/database-$(date +%Y%m%d-%H%M%S).sqlite"
    sqlite3 "$DB_FILE" ".backup '$BACKUP_FILE'"
    local check
    check=$(sqlite3 "$BACKUP_FILE" "PRAGMA integrity_check;")
    [ "$check" = "ok" ] || fail "Backup integrity check failed ($check). Aborting before any change."
    echo "Database backed up to $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"
    # Keep only the most recent backups
    ls -1t "$BACKUP_DIR"/database-*.sqlite 2>/dev/null | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm --
}

# Build the frontend. Assets from the previous build are kept so browsers that still have the old
# index.html cached don't get a blank page before they refresh.
build_frontend() {
    cd "$FRONTEND"
    npm install --no-audit --no-fund
    local old_assets=""
    if [ -d dist/assets ]; then
        old_assets="$(mktemp -d)"
        cp -a dist/assets/. "$old_assets/"
    fi
    npm run build
    if [ -n "$old_assets" ]; then
        cp -an "$old_assets/." dist/assets/ 2>/dev/null || true
        rm -rf "$old_assets"
    fi
}

# Make sure index.html is never cached, so users pick up new releases on the next page load.
ensure_nginx_no_cache() {
    [ -f "$NGINX_SITE" ] || return 0
    if ! grep -q 'location = /index.html' "$NGINX_SITE"; then
        sudo sed -i 's|^\(\s*\)location / {|\1location = /index.html {\n\1    add_header Cache-Control "no-cache";\n\1}\n\n\1location / {|' "$NGINX_SITE"
        sudo nginx -t && sudo systemctl reload nginx
        echo "Nginx: index.html set to no-cache."
    fi
}

start_or_restart_api() {
    cd "$BACKEND"
    if pm2 describe "$APP_NAME" > /dev/null 2>&1; then
        pm2 restart "$APP_NAME" --update-env
    else
        pm2 start server.js --name "$APP_NAME"
    fi
    pm2 save
}

# The API answers 401 (not logged in) when it is up; anything else means it didn't start.
health_check() {
    log "Health check"
    local code=""
    for _ in $(seq 1 15); do
        code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/api/rooms || true)
        [ "$code" = "401" ] && break
        sleep 1
    done
    if [ "$code" != "401" ]; then
        pm2 logs "$APP_NAME" --lines 40 --nostream || true
        fail "API did not come up (HTTP $code). See the logs above; './deploy.sh rollback' restores the previous version."
    fi
    echo "API is up."
    # Startup migrations and the one-time checkout tidy-up log here
    sleep 4
    pm2 logs "$APP_NAME" --lines 60 --nostream 2>/dev/null | grep -iE "backfill|error|connected" | tail -n 10 || true
}

cmd_setup() {
    log "First-time setup"
    sudo apt update
    sudo apt install -y curl nginx sqlite3 git
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs
    sudo npm install -g pm2

    log "Backend"
    ensure_env
    cd "$BACKEND"
    npm install --omit=dev --no-audit --no-fund
    start_or_restart_api
    pm2 startup | tail -n 1 | sudo bash

    log "Frontend"
    build_frontend

    log "Nginx"
    sudo rm -f /etc/nginx/sites-enabled/default
    cat << 'EOF' | sudo tee "$NGINX_SITE" > /dev/null
server {
    listen 80;
    server_name _;

    root /home/YOUR_USERNAME/villa-manager/frontend/dist;
    index index.html;

    location = /index.html {
        add_header Cache-Control "no-cache";
    }

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF
    chmod 755 "/home/$(whoami)"
    sudo sed -i "s|YOUR_USERNAME|$(whoami)|g" "$NGINX_SITE"
    sudo ln -sf "$NGINX_SITE" /etc/nginx/sites-enabled/villamanager
    sudo nginx -t && sudo systemctl restart nginx

    health_check
    echo "====================================================="
    echo "Setup complete. Open the VM's external IP in a browser."
    echo "Default login is admin / admin123 - change it under Manage Logins."
    echo "====================================================="
}

cmd_update() {
    cd "$REPO_DIR"
    command -v sqlite3 > /dev/null || fail "sqlite3 is not installed (sudo apt install -y sqlite3)."
    [ -z "$(git status --porcelain --untracked-files=no)" ] || fail "The server copy has local code changes. Commit or discard them first (git status)."

    local prev_commit
    prev_commit="$(git rev-parse HEAD)"

    log "1/6 Backing up the database"
    backup_db

    log "2/6 Fetching new code"
    git fetch --quiet
    if [ "$(git rev-parse HEAD)" = "$(git rev-parse '@{u}')" ]; then
        warn "Already up to date with $(git rev-parse --abbrev-ref '@{u}'). Continuing to rebuild and restart anyway."
    else
        git --no-pager log --oneline HEAD..'@{u}'
    fi
    git pull --ff-only
    printf 'PREV_COMMIT=%s\nBACKUP_FILE=%s\nDEPLOYED_AT=%s\n' "$prev_commit" "${BACKUP_FILE:-}" "$(date -Iseconds)" > "$LAST_DEPLOY"

    log "3/6 Server settings (.env)"
    ensure_env

    log "4/6 Backend dependencies"
    cd "$BACKEND"
    npm install --omit=dev --no-audit --no-fund

    log "5/6 Building frontend"
    build_frontend
    ensure_nginx_no_cache

    log "6/6 Restarting API (applies database migrations on start)"
    start_or_restart_api
    health_check

    echo "====================================================="
    echo "Update complete: $(git -C "$REPO_DIR" rev-parse --short HEAD)"
    [ -n "${BACKUP_FILE:-}" ] && echo "Database backup: $BACKUP_FILE"
    echo "If anything looks wrong: ./deploy.sh rollback"
    echo "====================================================="
}

cmd_rollback() {
    [ -f "$LAST_DEPLOY" ] || fail "No record of a previous update ($LAST_DEPLOY)."
    # shellcheck disable=SC1090
    source "$LAST_DEPLOY"
    echo "This will restore:"
    echo "  code     -> $PREV_COMMIT"
    echo "  database -> ${BACKUP_FILE:-<no backup recorded>}"
    echo "Anything entered in the app since $DEPLOYED_AT will be lost."
    read -r -p "Type 'rollback' to continue: " answer
    [ "$answer" = "rollback" ] || fail "Cancelled."

    log "Stopping API"
    pm2 stop "$APP_NAME" || true

    if [ -n "${BACKUP_FILE:-}" ] && [ -f "$BACKUP_FILE" ]; then
        log "Restoring database"
        cp "$DB_FILE" "$BACKUP_DIR/database-before-rollback-$(date +%Y%m%d-%H%M%S).sqlite"
        cp "$BACKUP_FILE" "$DB_FILE"
    else
        warn "No database backup to restore; keeping the current database."
    fi

    log "Restoring code"
    cd "$REPO_DIR"
    git checkout --quiet "$PREV_COMMIT"
    cd "$BACKEND" && npm install --omit=dev --no-audit --no-fund
    build_frontend
    start_or_restart_api
    health_check
    warn "The repo is now on a detached commit ($PREV_COMMIT). Run 'git checkout main' before the next update."
}

case "${1:-update}" in
    setup)    cmd_setup ;;
    update)   cmd_update ;;
    rollback) cmd_rollback ;;
    *) echo "Usage: $0 [setup|update|rollback]"; exit 1 ;;
esac
