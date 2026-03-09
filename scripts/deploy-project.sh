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

resolve_branch() {
  local repo="$1"
  local preferred="$2"
  if [[ -n "$preferred" ]] && git ls-remote --heads "$repo" "$preferred" | grep -q .; then
    echo "$preferred"
    return
  fi
  if git ls-remote --heads "$repo" main | grep -q .; then
    echo "main"
    return
  fi
  if git ls-remote --heads "$repo" master | grep -q .; then
    echo "master"
    return
  fi
  echo ""
}

echo "[deploy] slug=$slug domain=$domain branch=$branch port=$port"

if [[ ! -d "$project_dir/.git" ]]; then
  echo "[error] project repo not found: $project_dir"
  exit 2
fi

actual_branch="$(resolve_branch "$repo_url" "$branch")"
if [[ -z "$actual_branch" ]]; then
  echo "[error] no available branch found (tried: $branch, main, master)"
  exit 2
fi

echo "[deploy] selected branch=$actual_branch"
git -C "$project_dir" fetch --all
git -C "$project_dir" checkout "$actual_branch"
git -C "$project_dir" pull --ff-only

if [[ -d "$project_dir/server" ]]; then
  echo "[deploy] build server"
  cd "$project_dir/server"
  npm ci
  npm run build || true
fi

if [[ -d "$project_dir/client" ]]; then
  echo "[deploy] build client"
  cd "$project_dir/client"
  npm ci
  npm run build || true
fi

echo "[deploy] restart service: $service_name"
sudo systemctl restart "$service_name"
sudo systemctl status "$service_name" --no-pager -l | sed -n '1,25p'

echo "[deploy] done"
