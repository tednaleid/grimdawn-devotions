#!/usr/bin/env bash
# ABOUTME: Stores a read-only Cloudflare Account Analytics token in the macOS keychain for `just stats`.
# ABOUTME: The token is typed into the keychain's own prompt, so it never lands in shell history or argv.
set -euo pipefail

SERVICE="grimdawn-devotions-stats"
ACCOUNT="cloudflare"

if ! command -v security >/dev/null 2>&1; then
  echo "No macOS keychain here. Export GD_STATS_TOKEN=<token> in your shell instead; just stats reads it."
  exit 0
fi
command -v jq >/dev/null 2>&1 || { echo "jq is not installed"; exit 1; }

echo "Create a token at https://dash.cloudflare.com/profile/api-tokens with Account > Account Analytics > Read."
echo "Paste it at the keychain prompt below."
security add-generic-password -U -s "$SERVICE" -a "$ACCOUNT" -w

echo "Verifying the token..."
# The header goes through curl's stdin (-H @-) so the token never appears in any process's argv.
STATUS=$(printf 'Authorization: Bearer %s' "$(security find-generic-password -s "$SERVICE" -a "$ACCOUNT" -w)" \
  | curl -sS -H @- "https://api.cloudflare.com/client/v4/user/tokens/verify" | jq -r '.result.status // "invalid"')
if [ "$STATUS" != "active" ]; then
  security delete-generic-password -s "$SERVICE" -a "$ACCOUNT" >/dev/null
  echo "token is not active (status: $STATUS); removed it from the keychain"
  exit 1
fi
echo "Done. Run: just stats"
