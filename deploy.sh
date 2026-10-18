#!/bin/bash
# VillaManager deployment script for the GCP VM (Ubuntu).
#
#   ./deploy.sh setup      First-time install on a fresh VM (Node, PM2, Nginx, build, start)
#   ./deploy.sh update     Release new code to a running server (default):
#                          backup DB -> git pull -> install -> build -> restart -> health check
#   ./deploy.sh rollback   Restore the code version and database from before the last update
#   ./deploy.sh domain <domain> <email>
#                          Serve the app on a domain with HTTPS (Let's Encrypt, auto-renewing)
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

# Install exactly what package-lock.json says. Unlike `npm install`, `npm ci` never rewrites the
# lockfile, so the server copy stays clean for the next update. Falls back to `npm install` only
# if the lockfile is out of sync with package.json.
npm_install_locked() {
    if [ -f package-lock.json ]; then
        npm ci --no-audit --no-fund "$@" || { warn "npm ci failed; falling back to npm install"; npm install --no-audit --no-fund "$@"; }
    else
        npm install --no-audit --no-fund "$@"
    fi
}

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
    # Optional: reading grocery bills with Claude. Without a key, bills are still attached but items are typed in.
    grep -q '^ANTHROPIC_API_KEY=.' .env || warn "ANTHROPIC_API_KEY is not set in $BACKEND/.env - grocery bill reading is off (add the key, then: pm2 restart villamanager-api --update-env)."
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
    npm_install_locked
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
    npm_install_locked --omit=dev
    start_or_restart_api
    pm2 startup | tail -n 1 | sudo bash

    log "Frontend"
    build_frontend

    log "Nginx"
    sudo rm -f /etc/nginx/sites-enabled/default
    # Once a domain/HTTPS has been set up (./deploy.sh domain), Certbot owns parts of this file;
    # rewriting it would silently switch the site back to plain HTTP.
    if [ -f "$NGINX_SITE" ] && grep -q "managed by Certbot" "$NGINX_SITE"; then
        warn "Keeping existing Nginx config (HTTPS is configured)."
    else
    cat << 'EOF' | sudo tee "$NGINX_SITE" > /dev/null
server {
    listen 80;
    server_name _;

    root FRONTEND_DIST;
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
    sudo sed -i "s|FRONTEND_DIST|$FRONTEND/dist|g" "$NGINX_SITE"
    fi
    # Nginx must be able to traverse the home directory to reach frontend/dist
    chmod 755 "/home/$(whoami)"
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
    # Older deploys ran `npm install`, which can rewrite package-lock.json; that is not a real code
    # change, so put the lockfiles back before checking the copy is clean
    git checkout -- backend/package-lock.json frontend/package-lock.json 2>/dev/null || true
    if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
        git status --short --untracked-files=no
        fail "The server copy has local code changes (listed above). Commit or discard them first."
    fi

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
    npm_install_locked --omit=dev

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
    cd "$BACKEND" && npm_install_locked --omit=dev
    build_frontend
    start_or_restart_api
    health_check
    warn "The repo is now on a detached commit ($PREV_COMMIT). Run 'git checkout main' before the next update."
}

# Point a domain at the app and switch on HTTPS (free Let's Encrypt certificate, renewed automatically).
# Before running: the domain's DNS A record(s) must already point to this VM's static external IP,
# and the VM must allow HTTP and HTTPS traffic (GCP firewall).
cmd_domain() {
    local domain="${1:-}" email="${2:-}"
    [ -n "$domain" ] && [ -n "$email" ] || fail "Usage: $0 domain <domain> <email for certificate expiry notices>"
    domain="${domain#http://}"; domain="${domain#https://}"; domain="${domain%%/*}"
    [ -f "$NGINX_SITE" ] || fail "Nginx is not configured yet. Run '$0 setup' first."

    log "Checking DNS"
    local vm_ip dns_ip www_ip names
    vm_ip=$(curl -s -H "Metadata-Flavor: Google" "http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip" || true)
    [ -n "$vm_ip" ] || vm_ip=$(curl -s https://api.ipify.org || true)
    dns_ip=$(getent ahostsv4 "$domain" | awk 'NR==1 {print $1}' || true)
    www_ip=$(getent ahostsv4 "www.$domain" | awk 'NR==1 {print $1}' || true)
    echo "This VM:        ${vm_ip:-unknown}"
    echo "$domain -> ${dns_ip:-not found}"
    echo "www.$domain -> ${www_ip:-not found}"
    [ -n "$dns_ip" ] || fail "$domain does not resolve yet. Add an A record pointing to ${vm_ip:-the VM IP} and wait for DNS to update."
    [ -z "$vm_ip" ] || [ "$dns_ip" = "$vm_ip" ] || fail "$domain points to $dns_ip, not this VM ($vm_ip). Fix the A record first."

    # Include www only when it also points here, otherwise the certificate request would fail
    names=("$domain")
    if [ -n "$www_ip" ] && { [ -z "$vm_ip" ] || [ "$www_ip" = "$vm_ip" ]; }; then
        names+=("www.$domain")
    else
        warn "www.$domain does not point here - setting up $domain only."
    fi

    log "Setting the site name in Nginx"
    sudo sed -i "0,/server_name .*;/s//server_name ${names[*]};/" "$NGINX_SITE"
    sudo nginx -t && sudo systemctl reload nginx

    log "Requesting HTTPS certificate"
    sudo apt install -y certbot python3-certbot-nginx
    local cert_args=()
    for n in "${names[@]}"; do cert_args+=(-d "$n"); done
    sudo certbot --nginx "${cert_args[@]}" --redirect --agree-tos -m "$email" --non-interactive

    log "Checking"
    curl -s -o /dev/null -w "https://$domain -> HTTP %{http_code}\n" "https://$domain/" || warn "Could not reach https://$domain from the VM."
    sudo certbot renew --dry-run > /dev/null 2>&1 && echo "Automatic certificate renewal: OK" || warn "Renewal dry-run failed; check 'sudo certbot renew --dry-run'."
    echo "====================================================="
    echo "Done. Open https://$domain"
    echo "http:// and the IP address now redirect to https://$domain"
    echo "====================================================="
}

case "${1:-update}" in
    setup)    cmd_setup ;;
    update)   cmd_update ;;
    rollback) cmd_rollback ;;
    domain)   shift; cmd_domain "$@" ;;
    *) echo "Usage: $0 [setup|update|rollback|domain <domain> <email>]"; exit 1 ;;
esac
