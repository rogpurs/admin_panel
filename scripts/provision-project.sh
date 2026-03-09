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

resolve_branch() {
  local repo="$1"
  local preferred="$2"
  if [[ -n "$preferred" ]] && git ls-remote --heads "$repo" "$preferred" | grep -q .; then
    echo "$preferred"; return
  fi
  if git ls-remote --heads "$repo" main | grep -q .; then echo "main"; return; fi
  if git ls-remote --heads "$repo" master | grep -q .; then echo "master"; return; fi
  echo ""
}

has_npm_script() {
  local script_name="$1"
  node -e "const p=require('./package.json');process.exit(p.scripts&&p.scripts['$script_name']?0:1)" >/dev/null 2>&1
}

install_and_build() {
  local dir="$1"
  if [[ ! -f "$dir/package.json" ]]; then
    return
  fi
  echo "[provision] npm ci in $dir"
  cd "$dir"
  npm ci
  if has_npm_script build; then
    echo "[provision] npm run build in $dir"
    npm run build
  else
    echo "[provision] no build script in $dir"
  fi
}

echo "[provision] slug=$slug domain=$domain branch=$branch port=$port"
echo "[provision] project_dir=$project_dir"

if [[ ! "$slug" =~ ^[a-z0-9][a-z0-9-]{1,39}$ ]]; then
  echo "[error] invalid slug"; exit 2
fi
if [[ ! "$port" =~ ^[0-9]+$ ]]; then
  echo "[error] invalid port"; exit 2
fi

# 1) 先に準備中ページを返す設定を有効化
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

    proxy_intercept_errors on;
    error_page 502 503 504 =200 /__project_preparing;
  }

  location = /__project_preparing {
    default_type text/html; charset utf-8;
    return 200 '<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>準備中</title><style>body{font-family:sans-serif;background:#0f172a;color:#e2e8f0;display:grid;place-items:center;min-height:100vh;margin:0}main{max-width:560px;padding:24px;border:1px solid #334155;border-radius:14px;background:#111827}</style></head><body><main><h1>このプロジェクトは準備中です</h1><p>初期構築（clone/build/systemd）が完了するまで数分かかる場合があります。</p><p>ドメイン: $domain</p></main></body></html>';
  }
}
NG

sudo ln -sf "$nginx_site" "$nginx_link"
sudo nginx -t
sudo systemctl reload nginx

actual_branch="$(resolve_branch "$repo_url" "$branch")"
if [[ -z "$actual_branch" ]]; then
  echo "[error] no available branch found (tried: $branch, main, master)"; exit 2
fi

echo "[provision] selected branch=$actual_branch"
mkdir -p "$project_dir"

if [[ ! -d "$project_dir/.git" ]]; then
  echo "[provision] cloning repo..."
  git clone -b "$actual_branch" "$repo_url" "$project_dir"
else
  echo "[provision] repo exists, sync..."
  git -C "$project_dir" fetch --all
  git -C "$project_dir" checkout "$actual_branch"
  git -C "$project_dir" pull --ff-only
fi

# 2) 依存導入 + ビルド（root/server/client 全対応）
install_and_build "$project_dir"
install_and_build "$project_dir/server"
install_and_build "$project_dir/client"

# 3) 起動ディレクトリ決定
working_dir=""
if [[ -f "$project_dir/server/package.json" ]]; then
  working_dir="$project_dir/server"
elif [[ -f "$project_dir/package.json" ]]; then
  working_dir="$project_dir"
else
  echo "[error] package.json not found in server/ or root"; exit 2
fi

echo "[provision] working_dir=$working_dir"

# 4) systemd unit生成
sudo tee "/etc/systemd/system/$service_name" > /dev/null <<UNIT
[Unit]
Description=$slug app
After=network.target

[Service]
Type=simple
User=s55mz
WorkingDirectory=$working_dir
ExecStart=/usr/bin/npm start
Restart=always
Environment=NODE_ENV=production
Environment=PORT=$port
Environment=CORS_ORIGIN=https://$domain

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable --now "$service_name"
sudo systemctl restart "$service_name"
sudo systemctl status "$service_name" --no-pager -l | sed -n '1,30p'

echo "[provision] done"
