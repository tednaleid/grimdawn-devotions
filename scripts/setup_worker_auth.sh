#!/usr/bin/env bash
# ABOUTME: Verifies a pasted Cloudflare API token and stores it as a GitHub Actions secret.
# ABOUTME: Reads the token on stdin only, so it never lands in shell history or the process table.
set -euo pipefail

# Run from the repo root regardless of where it was invoked from, so the relative
# wrangler paths below resolve the same whether this runs via `just` or by hand.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

command -v gh >/dev/null 2>&1 || { echo "gh is not installed: https://cli.github.com"; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "jq is not installed"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "gh is not authenticated; run: gh auth login"; exit 1; }

printf 'Paste the Cloudflare API token (input hidden): '
read -rs TOKEN
printf '\n'
[ -n "$TOKEN" ] || { echo "no token given"; exit 1; }

echo "Verifying the token..."
# The header goes through curl's stdin (-H @-), not -H "Authorization: Bearer $TOKEN": an
# interpolated argument sits in this process's argv for its whole lifetime, readable via
# ps/procfs. printf is a shell builtin, so it forks nothing and exposes no argv either.
STATUS=$(printf 'Authorization: Bearer %s' "$TOKEN" \
  | curl -sS -H @- "https://api.cloudflare.com/client/v4/user/tokens/verify" | jq -r '.result.status // "invalid"')
[ "$STATUS" = "active" ] || { echo "token is not active (status: $STATUS)"; exit 1; }

echo "Reading the account id..."
ACCOUNT=$(CLOUDFLARE_API_TOKEN="$TOKEN" ./web/node_modules/.bin/wrangler whoami 2>/dev/null \
  | grep -oE '[0-9a-f]{32}' | head -1)
[ -n "$ACCOUNT" ] || { echo "could not read an account id"; exit 1; }
echo "  account: $ACCOUNT"

echo "Confirming the token can deploy (dry run)..."
( cd worker && CLOUDFLARE_API_TOKEN="$TOKEN" ../web/node_modules/.bin/wrangler deploy --dry-run ) >/dev/null \
  || { echo "dry-run deploy failed; the token is probably missing Workers Scripts: Edit"; exit 1; }

echo "Storing the secret..."
printf '%s' "$TOKEN" | gh secret set CLOUDFLARE_API_TOKEN

echo
echo "Done. Set account_id = \"$ACCOUNT\" in worker/wrangler.toml and commit it."
echo "The account id is an identifier rather than a credential, so it belongs in the repo."
