#!/usr/bin/env bash
set -euo pipefail

export PATH="$HOME/.opencode/bin:$HOME/.local/bin:$PATH"

ANDROID_SDK="${ANDROID_HOME:-/usr/local/lib/android/sdk}"
ADB="$ANDROID_SDK/platform-tools/adb"

FORCE_FLAG=""
if [ "${FORCE_REBUILD:-false}" = "true" ]; then
  FORCE_FLAG="--force"
fi

PROMPT=$(cat <<'EOF'
You are the non-interactive Relevance pipeline agent on GitHub Actions. Budget: 15 minutes. Execute ONLY the following steps and nothing else — do not read files, do not explore, do not fix code, do not run any extra commands.

STEP 1 (always): run `python3 -m src.main check-updates --config apps.yaml FORCE_PLACEHOLDER`

STEP 2 (exactly one of these):
- If every app reports "needs_update": false AND fdroid/repo/index-v1.jar exists, run: `python3 -m src.main test-emulator --repo-dir fdroid/repo`
- Otherwise run: `python3 -m src.main run --config apps.yaml FORCE_PLACEHOLDER --test-emulator`

STEP 3: If the STEP 2 command succeeded, reply with a 4-line summary (patched versions, emulator coexistence result, F-Droid repo status, any failures) and END YOUR RESPONSE IMMEDIATELY. If it failed, reply with the error and END.
EOF
)
PROMPT="${PROMPT//FORCE_PLACEHOLDER/$FORCE_FLAG}"

echo "Waiting for emulator to be fully booted..."
"$ADB" wait-for-device
for _ in $(seq 1 90); do
  BOOT_STATE=$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)
  if [ "$BOOT_STATE" = "1" ]; then
    break
  fi
  sleep 5
done
echo "Emulator boot state: ${BOOT_STATE:-unknown}"

# The OpenCode agent is the primary driver: it reads apps.yaml, checks Morphe
# patch compatibility vs apkeep availability, then fetches/patches/releases.
# It is best-effort: the deterministic pipeline below is the source of truth.
set +e
timeout --preserve-status 1500s opencode run --variant minimal --model opencode-go/deepseek-v4.1-flash "$PROMPT"
AGENT_EXIT=$?
set -e
echo "OpenCode agent exit code: $AGENT_EXIT"

echo "Running deterministic idempotent pipeline (fetch, Morphe patch if needed, emulator test, F-Droid index)..."
python3 -m src.main run --config apps.yaml $FORCE_FLAG --test-emulator

echo "Asserting F-Droid index contains all 4 variant packages..."
python3 - <<'PY'
import json
from pathlib import Path

idx = json.loads(Path("fdroid/repo/index-v1.json").read_text())
pkgs = {a["packageName"] for a in idx.get("apps", [])}
expected = {
    "app.morphe.android.youtube",
    "app.morphe.android.youtube.am",
    "app.morphe.android.youtube.ru",
    "app.morphe.android.youtube.de",
}
missing = expected - pkgs
assert not missing, f"Missing expected packages in F-Droid index: {missing}"
print("F-Droid index contains all 4 expected packages:", sorted(expected))
PY

echo "All 4 YouTube variants verified in F-Droid index and on Android Emulator!"
