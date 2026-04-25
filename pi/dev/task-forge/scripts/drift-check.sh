#!/usr/bin/env bash
# Drift checks for TaskForge V2-only runtime.
# Run: bash scripts/drift-check.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

FAIL=0
ok()   { echo "  ✅ $1"; }
fail() { echo "  ❌ $1"; FAIL=1; }

echo "=== TaskForge V2 drift checks ==="
echo ""

# ── 1. No active Deno usage (rejection checks are fine) ──────────────
echo "1. No active Deno usage in runtime (rejection/safety checks OK)"
DENO_HITS=$(rg -n '\bdeno\b' --type ts --glob '!node_modules/**' --glob '!tests/**' --glob '!docs/**' --glob '!agents/**' --glob '!.task-forge/**' v2/ src/ index.ts 2>/dev/null || true)
if [ -z "$DENO_HITS" ]; then
  ok "No Deno references"
else
  # Only count hits that aren't rejection/safety checks
  REAL_DENO=$(echo "$DENO_HITS" | grep -vE 'deno\\b.*test|Deno is not supported|Deno.*not supported|do(n|esn).*t.*deno|reject.*deno' || true)
  if [ -z "$REAL_DENO" ]; then
    ok "All Deno references are rejection/safety checks only"
  else
    fail "Active Deno usage found:"
    echo "$REAL_DENO" | while read line; do echo "    $line"; done
  fi
fi
echo ""

# ── 2. Event list parity ─────────────────────────────────────────────
echo "2. EVENTS.md event list matches v2/events.ts"
node --experimental-strip-types -e "
import { readFileSync } from 'fs';
const code = readFileSync('v2/events.ts', 'utf-8');
const doc = readFileSync('EVENTS.md', 'utf-8');

// Extract event types from events.ts: { type: \"event_name\"; ...
const codeEventMatches = code.matchAll(/\{\s*type:\s*\"(\w+)\"/g);
const codeEvents = new Set([...codeEventMatches].map(m => m[1]));

// Extract event names from EVENTS.md table: | \`event_name\` |
const docEventMatches = doc.matchAll(/\|\s*\x60(\w+)\x60\s*\|/g);
const docEvents = new Set([...docEventMatches].map(m => m[1]));

const missingInDoc = [...codeEvents].filter(e => !docEvents.has(e));
const extraInDoc = [...docEvents].filter(e => !codeEvents.has(e));

let ok = true;
if (missingInDoc.length) { console.log('Events in code but missing from EVENTS.md:', missingInDoc.join(', ')); ok = false; }
if (extraInDoc.length) { console.log('Events in EVENTS.md but missing from code:', extraInDoc.join(', ')); ok = false; }
if (ok) console.log('OK (' + codeEvents.size + ' events in both)');
process.exit(ok ? 0 : 1);
" 2>&1 && ok "Event list parity OK" || fail "Event list mismatch"
echo ""

# ── 3. Config contract parity ────────────────────────────────────────
echo "3. task-forge.json matches expected config shape"
node --experimental-strip-types -e "
import { readFileSync } from 'fs';
const config = JSON.parse(readFileSync('task-forge.json', 'utf-8'));

// Required top-level fields per the config schema
const required = ['modelTiers', 'roleAssignment', 'maxWorkers', 'maxRetries', 'defaultTurnBudget', 'maxTurnBudget', 'outputDir'];
const missing = required.filter(k => !(k in config));

if (missing.length) { console.log('Missing fields:', missing.join(', ')); process.exit(1); }

// Validate outputDir is a relative path (not absolute)  
const dir = config.outputDir;
if (dir !== '.task-forge') { console.log('outputDir is not .task-forge:', dir); process.exit(1); }

// Validate maxWorkers is reasonable
if (typeof config.maxWorkers !== 'number' || config.maxWorkers < 1 || config.maxWorkers > 8) {
  console.log('maxWorkers out of range:', config.maxWorkers); process.exit(1);
}

console.log('OK');
" 2>&1 && ok "Config contract OK" || fail "Config parity failed"
echo ""

# ── 4. V2 command services exist for all commands in help ─────────────
echo "4. V2 command services cover all /forge commands"
node --experimental-strip-types -e "
import { readFileSync, existsSync } from 'fs';

const commands = [
  { cmd: 'status',   file: 'v2/commands/status.ts' },
  { cmd: 'execute',  file: 'v2/commands/execute.ts' },
  { cmd: 'resume',   file: 'v2/commands/resume.ts' },
  { cmd: 'blocker',  file: 'v2/commands/blocker.ts' },
  { cmd: 'pause',    file: 'v2/commands/pause.ts' },
  { cmd: 'abort',    file: 'v2/commands/abort.ts' },
  { cmd: 'cost',     file: 'v2/commands/cost.ts' },
  { cmd: 'models',   file: 'v2/commands/models.ts' },
  { cmd: 'config',   file: 'v2/commands/config.ts' },
  { cmd: 'help',     file: 'v2/commands/help.ts' },
  { cmd: 'contract', file: 'v2/commands/contracts.ts' },
];

const missing = commands.filter(c => !existsSync(c.file));
if (missing.length) { console.log('Missing:', missing.map(c => c.file).join(', ')); process.exit(1); }
console.log('OK (' + commands.length + ' command modules)');
" 2>&1 && ok "All command services exist" || fail "Missing command services"
echo ""

# ── 5. Agent prompts do not instruct tsc --noEmit without -p ──────────
echo "5. Agent prompts are clean (no bare tsc instructions)"
BAD_TSC=$(grep -rn 'tsc --noEmit' agents/ 2>/dev/null | grep -v 'Do not prepend\|because bare\|-p tsconfig' || true)
if [ -z "$BAD_TSC" ]; then
  ok "Agent prompts clean"
else
  fail "Bare tsc instructions in agents/:"
  echo "$BAD_TSC"
fi
echo ""

# ── 6. Architecture file references exist ──────────────────────────
echo "6. Files referenced in ARCHITECTURE-V2.md exist"
node --experimental-strip-types -e "
import { readFileSync, existsSync } from 'fs';
const arch = readFileSync('ARCHITECTURE-V2.md', 'utf-8');
const refs = arch.matchAll(/\x60(v2\/[\w\/\-]+\.ts)\x60/g);
const missing = [...new Set([...refs].map(m => m[1]))].filter(f => !existsSync(f));
if (missing.length) { console.log('Missing:', missing.join(', ')); process.exit(1); }
console.log('OK');
" 2>&1 && ok "Architecture file references OK" || fail "Missing files"
echo ""

# ── Summary ──────────────────────────────────────────────────────────
echo "=== Result ==="
if [ "$FAIL" -eq 0 ]; then
  echo "✅ All drift checks passed"
else
  echo "❌ $FAIL drift check(s) failed — review above"
  exit 1
fi
