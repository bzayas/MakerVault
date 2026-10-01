#!/bin/bash
# Bump MakerVault's release version in lockstep across the three places
# that must agree for clients to self-update:
#   web/index.html          ?v=N cache busters
#   web/sw.js               MV_SW_VERSION = 'vN'
#   web/api/_bootstrap.php  MV_VERSION (shown in health.php / Settings)
#
# Usage:
#   scripts/bump-version.sh 3.15.0-beta   busters +1, MV_VERSION set
#   scripts/bump-version.sh               busters +1, MV_VERSION unchanged
#   scripts/bump-version.sh --check       verify they agree; no changes

set -euo pipefail
WEB="$(cd "$(dirname "$0")/.." && pwd)/web"
INDEX="$WEB/index.html"; SW="$WEB/sw.js"; BOOT="$WEB/api/_bootstrap.php"

sw_ver()   { perl -ne "print \$1 if /MV_SW_VERSION = 'v(\\d+)'/" "$SW"; }
app_ver()  { perl -ne "print \$1 if /define\\('MV_VERSION', '([^']+)'\\)/" "$BOOT"; }
# Every distinct ?v= value in index.html, space-separated
busters()  { perl -ne 'print "$1\n" while /\?v=(\d+)/g' "$INDEX" | sort -u | tr '\n' ' ' | sed 's/ $//'; }

SW_V="$(sw_ver)"; IDX_V="$(busters)"; APP_V="$(app_ver)"
[ -n "$SW_V" ] && [ -n "$IDX_V" ] && [ -n "$APP_V" ] || { echo "✗ could not read versions" >&2; exit 1; }

if [ "$IDX_V" != "$SW_V" ]; then
  echo "✗ version drift: index.html ?v=$IDX_V but sw.js MV_SW_VERSION=v$SW_V" >&2
  exit 1
fi

if [ "${1:-}" = "--check" ]; then
  echo "✓ busters/SW v$SW_V, MV_VERSION $APP_V"
  exit 0
fi

NEW_V=$((SW_V + 1))
NEW_APP="${1:-$APP_V}"
case "$NEW_APP" in *"'"*|*\\*) echo "✗ bad version string" >&2; exit 1;; esac

perl -pi -e "s/\\?v=$SW_V\\b/?v=$NEW_V/g" "$INDEX"
perl -pi -e "s/MV_SW_VERSION = 'v$SW_V'/MV_SW_VERSION = 'v$NEW_V'/" "$SW"
perl -pi -e "s/define\\('MV_VERSION', '[^']+'\\)/define('MV_VERSION', '$NEW_APP')/" "$BOOT"

"$0" --check >/dev/null
echo "✓ busters/SW v$SW_V → v$NEW_V, MV_VERSION $APP_V → $NEW_APP"
