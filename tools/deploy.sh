#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

: "${CF_PAGES_PROJECT:=night-flight}"

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "error: set CLOUDFLARE_API_TOKEN (Cloudflare Pages Edit permission)" >&2
  echo "  https://dash.cloudflare.com/profile/api-tokens" >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "error: working tree is dirty; commit before deploying" >&2
  git status --short >&2
  exit 1
fi

echo "==> build  (commit=$(git rev-parse --short=8 HEAD), branch=$(git branch --show-current))"
npm run build

echo "==> Cloudflare Pages  (project=$CF_PAGES_PROJECT)"
npx --no-install wrangler pages deploy dist --project-name="$CF_PAGES_PROJECT"
