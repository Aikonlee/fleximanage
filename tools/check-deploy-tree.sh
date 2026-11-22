#!/usr/bin/env bash
# Read-only deployment drift guard.
# Compares files in a deployed directory against a git ref (default: HEAD),
# excluding expected runtime, build, and dependency artifacts, and prints any
# deployed-only files. Exits 0 when no unexpected files exist, 1 on drift,
# and 2 on usage/environment errors.
#
# Usage:
#   tools/check-deploy-tree.sh <deployed-dir> [git-ref]

set -euo pipefail

usage() {
  echo "Usage: $0 <deployed-dir> [git-ref]" >&2
  exit 2
}

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  usage
fi

DEPLOY_DIR="$1"
GIT_REF="${2:-HEAD}"

if [ ! -d "$DEPLOY_DIR" ]; then
  echo "ERROR: Deployed directory does not exist: $DEPLOY_DIR" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if ! git -C "$REPO_DIR" rev-parse --verify "${GIT_REF}^{commit}" >/dev/null 2>&1; then
  echo "ERROR: Cannot resolve git ref '$GIT_REF' in $REPO_DIR" >&2
  exit 2
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

GIT_FILES="$TMP_DIR/git-files.txt"
DEPLOY_FILES="$TMP_DIR/deploy-files.txt"
DRIFT_FILES="$TMP_DIR/drift-files.txt"

git -C "$REPO_DIR" ls-tree -r --name-only "$GIT_REF" | LC_ALL=C sort -u > "$GIT_FILES"

(
  cd "$DEPLOY_DIR"
  find . \
    \( \
      -path './.git' -o \
      -name 'node_modules' -o \
      -name '.npm' -o \
      -path './logs' -o \
      -path './backend/logs' -o \
      -path './tmp' -o \
      -path './backend/tmp' -o \
      -path './coverage' -o \
      -path './dist' -o \
      -path './frontend/build' -o \
      -path './backend/public' -o \
      -path './backend/bin/tls' -o \
      -path './backend/bin/smoke' -o \
      -path './backend/bin/cert.*' \
    \) -prune -o \
    \( -type f -o -type l \) \
    ! -name '*.log' \
    ! -name '*.tmp' \
    ! -name '*.swp' \
    ! -name '*.swo' \
    ! -name '*.pid' \
    ! -name '.DS_Store' \
    ! -path './.env' \
    ! -path './.env.local' \
    ! -path './.env.*.local' \
    ! -path './backend/.env' \
    ! -path './backend/audit-*.json' \
    -print
) | sed 's|^\./||' | LC_ALL=C sort -u > "$DEPLOY_FILES"

# Pre-existing trusted gitignored deployment scripts present in both the
# trusted baseline worktree and deployed trees (listed by exact path rather
# than excluding backend/scripts/ so new files there are still reported).
LC_ALL=C comm -13 "$GIT_FILES" "$DEPLOY_FILES" | while IFS= read -r path; do
  case "$path" in
    'backend/scripts/cpu-optimization-benchmark.js' | \
    'backend/scripts/query_devices.js' | \
    'backend/scripts/quick-validation-demo.js' | \
    'backend/scripts/verify_device_tokens.js')
      continue
      ;;
  esac
  printf '%s\n' "$path"
done > "$DRIFT_FILES"

if [ -s "$DRIFT_FILES" ]; then
  DRIFT_COUNT="$(wc -l < "$DRIFT_FILES" | tr -d ' ')"
  echo "Deployment drift detected: ${DRIFT_COUNT} deployed-only file(s) not in ${GIT_REF}:" >&2
  cat "$DRIFT_FILES"
  exit 1
fi

echo "OK: No deployed-only drift files found in $DEPLOY_DIR compared to $GIT_REF"
exit 0
