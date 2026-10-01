#!/bin/bash
# One-command deploy of MakerVault web to the Synology NAS (run on the Mac).
#
#   1. Pulls the latest main from GitHub (refuses on uncommitted changes)
#   2. Runs scripts/check.sh (lint, version lockstep, smoke test, parsers)
#   3. Mounts the NAS share if needed (and recovers a stale SMB handle)
#   4. Refuses to ship changed files under an unchanged SW version, which
#      would leave installed clients on the old precache
#   5. rsyncs web/ → NAS, never touching data/ (the live database)
#   6. Confirms health.php reports the new version, tags the release
#
# Usage: scripts/deploy.sh [--dry-run] [--skip-checks]
# Env overrides: MV_NAS_SHARE (smb://10.0.0.10/web), MV_NAS_PATH
#   (/Volumes/web/MakerVault), MV_HEALTH_URL (http://10.0.0.10:8742/api/health.php)
# Bash 3.2-compatible (stock macOS).

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB="$ROOT/web"
SHARE="${MV_NAS_SHARE:-smb://10.0.0.10/web}"
MOUNT="/Volumes/web"
TARGET="${MV_NAS_PATH:-$MOUNT/MakerVault}"
HEALTH_URL="${MV_HEALTH_URL:-http://10.0.0.10:8742/api/health.php}"
RSYNC_EXCLUDES=(--exclude '.DS_Store' --exclude 'data/' --exclude 'tests/')

DRY=0; SKIP_CHECKS=0
for a in "$@"; do
  case "$a" in
    --dry-run) DRY=1 ;;
    --skip-checks) SKIP_CHECKS=1 ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done

step() { printf '\n▶ %s\n' "$1"; }
die()  { printf '\n✗ %s\n' "$1" >&2; exit 1; }

cd "$ROOT"

step "Sync with GitHub"
# Edited tracked files anywhere, or new files under web/ (they would deploy
# without being in git). Unrelated untracked folders next to web/ are fine.
DIRTY="$(git status --porcelain --untracked-files=no; git status --porcelain -- web scripts | grep '^??' || true)"
[ -z "$DIRTY" ] || die "Uncommitted changes — commit or stash first:
$DIRTY"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "$BRANCH" = "main" ] || die "On branch '$BRANCH' — deploys go from main (git checkout main)"
git pull --ff-only origin main
echo "✓ at $(git log -1 --format='%h %s')"

if [ "$SKIP_CHECKS" = 0 ]; then
  step "Checks"
  "$ROOT/scripts/check.sh"
fi

LOCAL_SW="$(perl -ne "print \$1 if /MV_SW_VERSION = 'v(\\d+)'/" "$WEB/sw.js")"
LOCAL_APP="$(perl -ne "print \$1 if /define\\('MV_VERSION', '([^']+)'\\)/" "$WEB/api/_bootstrap.php")"

nas_ok() { [ -f "$TARGET/sw.js" ] && ls "$TARGET/api" >/dev/null 2>&1; }

mount_nas() {
  echo "Mounting $SHARE …"
  open "$SHARE"
  for _ in $(seq 1 30); do nas_ok && return 0; sleep 1; done
  return 1
}

step "NAS share"
if ! nas_ok; then
  if mount | grep -q " on $MOUNT "; then
    echo "Mount looks stale — force-unmounting"
    diskutil unmount force "$MOUNT" >/dev/null 2>&1 || true
  fi
  mount_nas || die "Could not reach $TARGET. Mount $SHARE in Finder (⌘K) and re-run."
fi
echo "✓ $TARGET"

step "Version guard"
LIVE_SW="$(perl -ne "print \$1 if /MV_SW_VERSION = 'v(\\d+)'/" "$TARGET/sw.js" 2>/dev/null || true)"
PLAN="$(rsync -a --dry-run --itemize-changes --checksum "${RSYNC_EXCLUDES[@]}" "$WEB/" "$TARGET/")" \
  || die "rsync dry run against $TARGET failed"
CHANGES="$(printf '%s\n' "$PLAN" | grep -c '^[<>]f' || true)"
echo "live v${LIVE_SW:-?} → local v$LOCAL_SW ($LOCAL_APP), $CHANGES file(s) differ"
[ "$CHANGES" -gt 0 ] || { echo "✓ NAS already matches — nothing to deploy"; exit 0; }
if [ -n "$LIVE_SW" ] && [ "$LIVE_SW" -ge "$LOCAL_SW" ]; then
  die "Files changed but the SW version did not go up (live v$LIVE_SW, local v$LOCAL_SW).
Installed clients would keep the old cache. Run scripts/bump-version.sh, commit, push, then deploy."
fi

step "rsync → NAS"
if [ "$DRY" = 1 ]; then
  printf '%s\n' "$PLAN" | grep '^[<>]f' || true
  echo "(dry run — nothing copied)"
  exit 0
fi
do_rsync() {
  local out
  out="$(rsync -a --checksum --itemize-changes "${RSYNC_EXCLUDES[@]}" "$WEB/" "$TARGET/")" || return 1
  printf '%s\n' "$out" | grep '^[<>]f' || true
}
if ! do_rsync; then
  echo "rsync failed — remounting the share and retrying once"
  diskutil unmount force "$MOUNT" >/dev/null 2>&1 || true
  mount_nas || die "Remount failed"
  do_rsync || die "rsync failed twice — see docs/SYNOLOGY-DEPLOYMENT.md"
fi

step "Live health check"
LIVE_APP=""
for _ in 1 2 3 4 5; do
  LIVE_APP="$(curl -fsS -m 5 "$HEALTH_URL" 2>/dev/null | perl -ne 'print $1 if /"version"\s*:\s*"([^"]+)"/' || true)"
  [ "$LIVE_APP" = "$LOCAL_APP" ] && break
  sleep 2
done
if [ "$LIVE_APP" = "$LOCAL_APP" ]; then
  echo "✓ $HEALTH_URL reports $LIVE_APP"
else
  echo "⚠ health.php reports '${LIVE_APP:-unreachable}', expected $LOCAL_APP (set MV_HEALTH_URL if the URL differs)"
fi

TAG="v$LOCAL_APP-sw$LOCAL_SW"
if ! git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  git tag -a "$TAG" -m "Deployed to NAS $(date '+%Y-%m-%d %H:%M')"
  git push -q origin "$TAG" && echo "✓ tagged $TAG"
fi

printf '\n✓ Deployed %s (SW v%s). Clients self-update on next launch.\n' "$LOCAL_APP" "$LOCAL_SW"
