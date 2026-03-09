#!/usr/bin/env bash
set -euo pipefail

APPS_ROOT="${APPS_ROOT:-/home/s55mz/apps}"
admin_dir="$APPS_ROOT/admin-panel"

echo "[self-update] admin_dir=$admin_dir"
cd "$admin_dir"

git fetch --all
git checkout main
git pull --ff-only
npm ci

echo "[self-update] scheduling restart admin-panel.service"
nohup bash -c 'sleep 2; sudo systemctl restart admin-panel.service' >/tmp/admin_self_update_restart.log 2>&1 &

echo "[self-update] done"
