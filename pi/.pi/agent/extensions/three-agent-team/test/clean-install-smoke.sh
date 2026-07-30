#!/usr/bin/env bash
# Clean-install extension-load smoke test.
# Exports staged tree to temp dir, installs deps, and loads the extension.
set -eu

TMP=$(mktemp -d /tmp/team-import-clean-smoke-XXXXXX)
cleanup() { rm -r "$TMP"; }
trap cleanup EXIT

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# Walk up from test/ → three-agent-team/ → extensions/ → agent/ → .pi/ → pi/ → repo-root/
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../../../.." && pwd)"

echo "=== Exporting tree ==="
cd "$REPO_ROOT"
git checkout-index --all --prefix="$TMP/" 2>/dev/null

echo "=== Installing deps ==="
cd "$TMP"
git init -q
git config user.email test@test
git config user.name Test
npm ci --no-audit --no-fund

echo "=== Verifying yaml dependency ==="
node -e "require('yaml')"
echo "yaml: OK"

echo "=== Loading extension ==="
node --input-type=module --eval "
  await import('./pi/.pi/agent/extensions/three-agent-team/index.ts');
  console.log('extension-load: PASS');
"

echo "SUCCESS: clean-install smoke test passed"
