#!/usr/bin/env bash
# Run one end-to-end test against a local copy of the site.
#   bash tests/e2e/run.sh test_v2.py              # mocked feeds
#   MOCK_REAL=1 bash tests/e2e/run.sh test_v2.py  # recorded real snapshot (about 10,000 aircraft)
#   bash tests/e2e/run.sh overlap.py              # interface overlap check at six window sizes
# Needs: pip install playwright && python -m playwright install chromium
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"
python3 -m http.server 8765 --directory "$ROOT/site" >/dev/null 2>&1 </dev/null &
SERVER=$!; trap 'kill $SERVER 2>/dev/null' EXIT; sleep 1
cd "$HERE" && timeout 300 python3 -u "$1" "${@:2}" "$HERE"
