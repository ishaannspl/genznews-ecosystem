#!/bin/bash
# One refresh cycle: scrape + rewrite newest stories, then publish them to the site.
# Scheduled every 3 hours by scripts/com.genznews.cycle.plist. Safe to run by hand.
set -euo pipefail

cd "$(dirname "$0")/.."
PY="${PY:-../genznews/.venv/bin/python}"

# Export only the plain KEY=value lines the Python code needs (.env is not shell-safe).
if [ -f .env ]; then
  set -a
  eval "$(grep -E '^[A-Z_]+=[^ ()]*$' .env 2>/dev/null || true)"
  set +a
fi
# The old pipeline syncs to its own project; keep that off so it never touches the site database.
export SUPABASE_KEY="" NEXT_PUBLIC_SUPABASE_URL="" NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=""

echo "=== $(date '+%Y-%m-%d %H:%M:%S') cycle start ==="
"$PY" run_pipeline.py --per-niche "${PER_NICHE:-3}"
"$PY" run_framework_stage.py --limit "${RUN_LIMIT:-15}"
"$PY" -m framework_stage.publish
echo "=== $(date '+%Y-%m-%d %H:%M:%S') cycle done ==="
