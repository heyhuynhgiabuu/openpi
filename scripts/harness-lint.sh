#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# harness-lint.sh — pre-commit harness doc integrity check
#
# Usage:
#   ./scripts/harness-lint.sh              # check everything
#   ./scripts/harness-lint.sh --quiet       # only errors, skip info
#   ./scripts/harness-lint.sh --fix         # repair trivial issues (future)
#
# Exit codes:
#   0  — all checks pass (or only warnings)
#   1  — critical issue found (harness doc missing / broken)
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

QUIET=false
FIX=false
HAS_CRITICAL=false
HAS_WARNING=false
EXIT_CODE=0

for arg in "$@"; do
  case "$arg" in
    --quiet) QUIET=true ;;
    --fix)   FIX=true ;;
  esac
done

info()   { $QUIET && return 0; echo -e "  \033[90m•\033[0m $1"; }
warn()   { HAS_WARNING=true; echo -e "  \033[33m⚠\033[0m $1"; }
crit()   { HAS_CRITICAL=true; echo -e "  \033[31m✖\033[0m $1"; }
pass()   { $QUIET && return 0; echo -e "  \033[32m✔\033[0m $1"; }
heading(){ echo -e "\033[1m$1\033[0m"; }

# ── Required docs ──────────────────────────────────────────────────────────
heading "Harness docs"

REQUIRED_DOCS=(
  "docs/HARNESS.md"
  "docs/TEST_MATRIX.md"
)

ALL_REQUIRED_EXIST=true
for doc in "${REQUIRED_DOCS[@]}"; do
  if [ -f "$doc" ]; then
    info "$doc — exists"
  else
    crit "$doc — MISSING"
    ALL_REQUIRED_EXIST=false
  fi
done

$ALL_REQUIRED_EXIST && pass "All required harness docs present"

# ── Optional directories ───────────────────────────────────────────────────
heading "Optional harness directories"

OPTIONAL_DIRS=(
  "docs/stories"
  "docs/decisions"
)

for dir in "${OPTIONAL_DIRS[@]}"; do
  if [ -d "$dir" ]; then
    count=$(find "$dir" -maxdepth 1 -name '*.md' 2>/dev/null | wc -l | tr -d ' ')
    info "$dir — $count .md file(s)"
  else
    warn "$dir — does not exist (recommended)"
  fi
done

# ── TEST_MATRIX.md validation ─────────────────────────────────────────────
heading "Test matrix"

if [ -f "docs/TEST_MATRIX.md" ]; then
  WEAK_ROWS=$(grep -cE '^\|[[:space:]]*\w+[[:space:]]*\|[[:space:]]*\w+.*\|[[:space:]]*(planned|in_progress|changed)[[:space:]]*\|' docs/TEST_MATRIX.md 2>/dev/null || true)
  EMPTY_EVIDENCE=$(awk -F'|' 'NF>=5 && length($4)==0' docs/TEST_MATRIX.md 2>/dev/null | wc -l | tr -d ' ' || true)
  TOTAL_BEHAVIORS=$(grep -c '|.*|.*|.*|.*|' docs/TEST_MATRIX.md || true)

  info "$TOTAL_BEHAVIORS behaviors tracked"
  if [ "$WEAK_ROWS" -gt 0 ]; then
    warn "$WEAK_ROWS behavior(s) not yet implemented (planned/changed/in_progress)"
  fi
  if [ "$EMPTY_EVIDENCE" -gt 0 ]; then
    warn "$EMPTY_EVIDENCE row(s) missing evidence column"
  fi
  [ "$WEAK_ROWS" -eq 0 ] && [ "$EMPTY_EVIDENCE" -eq 0 ] && pass "Test matrix looks healthy"
else
  crit "docs/TEST_MATRIX.md not found — cannot validate"
fi

# ── Stories validation ────────────────────────────────────────────────────
heading "Story frontmatter"

if [ -d "docs/stories" ]; then
  STORY_FILES=()
  while IFS= read -r -d '' file; do
    STORY_FILES+=("$file")
  done < <(find docs/stories -maxdepth 1 -name '*.md' -print0 2>/dev/null || true)

  if [ ${#STORY_FILES[@]} -eq 0 ]; then
    warn "No story files in docs/stories/"
  else
    VALID_STORIES=0
    for file in "${STORY_FILES[@]}"; do
      name=$(basename "$file")
      # Check for title and status in frontmatter
      if head -20 "$file" | grep -qE '^(title|# Story):' && head -20 "$file" | grep -qE '^Status:'; then
        VALID_STORIES=$((VALID_STORIES + 1))
      else
        warn "$name — missing title or status in frontmatter"
      fi
    done
    info "$VALID_STORIES / ${#STORY_FILES[@]} stories have valid frontmatter"
  fi
else
  info "docs/stories/ does not exist yet"
fi

# ── Legacy .pi/specs check ────────────────────────────────────────────────
heading "Legacy migration"

if [ -d ".pi/specs" ]; then
  LEGACY_COUNT=$(find .pi/specs -maxdepth 1 -mindepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
  if [ "$LEGACY_COUNT" -gt 0 ] && [ ! -f "docs/HARNESS.md" ]; then
    warn "$LEGACY_COUNT legacy spec(s) in .pi/specs/ without docs/HARNESS.md"
  else
    info "$LEGACY_COUNT legacy spec(s) in .pi/specs/"
  fi
else
  info "No legacy .pi/specs directory"
fi

# ── Results ────────────────────────────────────────────────────────────────
echo ""
if $HAS_CRITICAL; then
  echo -e "\033[31m✖ Harness lint FAILED — fix critical issues before committing\033[0m"
  EXIT_CODE=1
elif $HAS_WARNING; then
  echo -e "\033[33m⚠ Harness lint passed with warnings\033[0m"
  EXIT_CODE=0
else
  echo -e "\033[32m✔ Harness lint passed, everything looks good\033[0m"
  EXIT_CODE=0
fi

exit $EXIT_CODE
