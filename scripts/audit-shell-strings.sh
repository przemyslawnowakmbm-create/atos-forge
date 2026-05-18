#!/usr/bin/env bash
# audit-shell-strings.sh
#
# CI guard against the `execSync(`...${var}...`)` anti-pattern. Returns
# non-zero if any file under forge-*/ uses template-string command execution.
#
# Allow-list:
#   • Test files (under tests/, *.test.cjs) — may exercise shell strings on purpose
#   • forge-cli/lib/exec.js — the canonical safe wrapper itself
#
# Usage:  bash scripts/audit-shell-strings.sh

set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Pattern: execSync followed by backtick-template-with-${interpolation}
PATTERN='execSync[[:space:]]*\(`[^`]*\${[^}]*}'

# Collect hits, excluding allow-listed files
hits=$(grep -REn "$PATTERN" \
  --include='*.js' --include='*.cjs' \
  forge-graph forge-containers forge-agents forge-session forge-verify \
  forge-assess forge-cli forge-system forge-config forge-analyze 2>/dev/null \
  | grep -v 'tests/' \
  | grep -v '\.test\.cjs' \
  | grep -v 'forge-cli/lib/exec\.js' \
  || true)

if [ -n "$hits" ]; then
  echo "ERROR: unsafe execSync(\`...\${var}...\`) found:" >&2
  echo "$hits" >&2
  echo "" >&2
  echo "Fix: replace with execFileSafe(cmd, [args]) from forge-cli/lib/exec.js" >&2
  exit 1
fi

echo "OK: no unsafe execSync template-string usages found."
