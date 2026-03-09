#!/usr/bin/env bash
set -euo pipefail

slug="$1"
domain="$2"
repo_url="$3"
branch="$4"
port="$5"
purge_dir="${6:-0}"

APPS_ROOT="${APPS_ROOT:-/home/s55mz/apps}"
project_dir="$APPS_ROOT/$slug"
service_name="${slug}.service"
nginx_site="/etc/nginx/sites-available/$domain"
nginx_link="/etc/nginx/sites-enabled/$domain"

echo "[remove] slug=$slug domain=$domain purge_dir=$purge_dir"

sudo systemctl stop "$service_name" || true
sudo systemctl disable "$service_name" || true
sudo rm -f "/etc/systemd/system/$service_name"

sudo rm -f "$nginx_link"
sudo rm -f "$nginx_site"

sudo systemctl daemon-reload
sudo nginx -t
sudo systemctl reload nginx

if [[ "$purge_dir" == "1" ]]; then
  if [[ -d "$project_dir" ]]; then
    backup_dir="${project_dir}.deleted.$(date +%Y%m%d-%H%M%S)"
    mv "$project_dir" "$backup_dir"
    echo "[remove] moved project dir to $backup_dir"
  fi
fi

echo "[remove] done"
