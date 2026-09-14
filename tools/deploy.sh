#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "error: set CLOUDFLARE_API_TOKEN (Workers Scripts Edit permission)" >&2
  echo "  https://dash.cloudflare.com/profile/api-tokens" >&2
  exit 1
fi

if [[ "$(git branch --show-current)" != main ]]; then
  echo "error: deploy from main; every deploy goes to production" >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "error: working tree is dirty; commit before deploying" >&2
  git status --short >&2
  exit 1
fi

echo "==> build  (commit=$(git rev-parse --short=8 HEAD))"
npm run build

echo "==> Cloudflare Workers static assets  (wrangler.jsonc)"
npx --no-install wrangler deploy
