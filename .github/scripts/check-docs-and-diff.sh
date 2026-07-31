#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

required_files=(
  "README.md"
  "docs/testing/tdd-strategy.md"
  "docs/issues/README.md"
  "docs/prd/2026-07-30-ticket-automation-platform-v1-prd.md"
)

for required_file in "${required_files[@]}"; do
  test -f "$required_file"
done

if [[ -n "${GITHUB_BASE_REF:-}" ]]; then
  git diff --check "origin/${GITHUB_BASE_REF}...HEAD" --
elif git rev-parse --verify HEAD^ >/dev/null 2>&1; then
  git diff --check HEAD^ HEAD --
else
  git diff --check
fi

bash .github/scripts/scan-secrets.sh
echo "Documentation and diff checks passed."
