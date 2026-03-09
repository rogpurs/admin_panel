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
  echo "[deploy] npm ci in $dir"
  cd "$dir"
  npm ci
  if has_npm_script build; then
    echo "[deploy] npm run build in $dir"
    npm run build
  else
    echo "[deploy] no build script in $dir"
  fi
}

echo "[deploy] slug=$slug domain=$domain branch=$branch port=$port"

if [[ ! -d "$project_dir/.git" ]]; then
  echo "[error] project repo not found: $project_dir"; exit 2
fi

actual_branch="$(resolve_branch "$repo_url" "$branch")"
if [[ -z "$actual_branch" ]]; then
  echo "[error] no available branch found (tried: $branch, main, master)"; exit 2
fi

echo "[deploy] selected branch=$actual_branch"
git -C "$project_dir" fetch --all
git -C "$project_dir" checkout "$actual_branch"
git -C "$project_dir" pull --ff-only

install_and_build "$project_dir"
install_and_build "$project_dir/server"
install_and_build "$project_dir/client"

echo "[deploy] restart service: $service_name"
sudo systemctl restart "$service_name"
sudo systemctl status "$service_name" --no-pager -l | sed -n '1,25p'

echo "[deploy] done"
