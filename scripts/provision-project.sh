#!/usr/bin/env bash
set -euo pipefail

slug="$1"
domain="$2"
repo_url="$3"
branch="$4"
port="$5"

APPS_ROOT="${APPS_ROOT:-/home/s55mz/apps}"
project_dir="$APPS_ROOT/$slug"
service_name="${slug}.service"
nginx_site="/etc/nginx/sites-available/$domain"
nginx_link="/etc/nginx/sites-enabled/$domain"

echo "[provision] slug=$slug domain=$domain branch=$branch port=$port"
echo "[provision] project_dir=$project_dir"

if [[ ! "$slug" =~ ^[a-z0-9][a-z0-9-]{1,39}$ ]]; then
  echo "[error] invalid slug"
  exit 2
fi

if [[ ! "$port" =~ ^[0-9]+$ ]]; then
  echo "[error] invalid port"
  exit 2
fi

mkdir -p "$project_dir"

if [[ ! -d "$project_dir/.git" ]]; then
  echo "[provision] cloning repo..."
  git clone -b "$branch" "$repo_url" "$project_dir"
else
  echo "[provision] repo exists, sync..."
  git -C "$project_dir" fetch --all
  git -C "$project_dir" checkout "$branch"
  git -C "$project_dir" pull --ff-only
fi

if [[ -d "$project_dir/server" ]]; then
  echo "[provision] build server"
  cd "$project_dir/server"
  npm ci
  npm run build || true
fi

if [[ -d "$project_dir/client" ]]; then
  echo "[provision] build client"
  cd "$project_dir/client"
  npm ci
  npm run build || true
fi

echo "[provision] write systemd unit: $service_name"
sudo tee "/etc/systemd/system/$service_name" > /dev/null <<UNIT
[Unit]
Description=$slug app
After=network.target

[Service]
Type=simple
User=s55mz
WorkingDirectory=$project_dir/server
ExecStart=/usr/bin/npm start
Restart=always
Environment=NODE_ENV=production
Environment=PORT=$port
Environment=CORS_ORIGIN=https://$domain

[Install]
WantedBy=multi-user.target
UNIT

echo "[provision] write nginx site: $domain"
sudo tee "$nginx_site" > /dev/null <<NG
server {
  listen 80;
  server_name $domain;

  location / {
    proxy_pass http://127.0.0.1:$port;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
}
NG

sudo ln -sf "$nginx_site" "$nginx_link"

sudo systemctl daemon-reload
sudo systemctl enable --now "$service_name"
sudo nginx -t
sudo systemctl reload nginx

echo "[provision] done"
