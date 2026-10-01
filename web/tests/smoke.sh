#!/bin/bash
# MakerVault web API smoke test.
#
# Boots php -S against a COPY of web/ with a fresh data/ (so the clean-install
# schema bootstrap is exercised and the real testbed DB is never touched),
# then round-trips the main endpoints. Exits non-zero on any failure.
#
# Usage: web/tests/smoke.sh        (from anywhere; SMOKE_PORT overrides 8799)

set -u
PORT="${SMOKE_PORT:-8799}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PHP_BIN="$(command -v php || echo /opt/homebrew/bin/php)"
TMP="$(mktemp -d)"
PID=""
trap '[ -n "$PID" ] && kill "$PID" 2>/dev/null; rm -rf "$TMP"' EXIT

rsync -a --exclude data/ --exclude tests/ "$ROOT/" "$TMP/web/"
"$PHP_BIN" -S "127.0.0.1:$PORT" -t "$TMP/web" >/dev/null 2>&1 &
PID=$!
disown

BASE="http://127.0.0.1:$PORT/api"
for i in $(seq 1 20); do
  curl -s -m 1 "$BASE/health.php" >/dev/null 2>&1 && break
  sleep 0.25
done

FAILS=0
pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1"; FAILS=$((FAILS + 1)); }
# assert "<description>" "<curl args...>" "<python expr over parsed json 'd'>"
assert_json() {
  local desc="$1"; shift
  local expr="$1"; shift
  if curl -s "$@" | python3 -c "
import json, sys
d = json.load(sys.stdin)
sys.exit(0 if ($expr) else 1)" 2>/dev/null; then pass "$desc"; else fail "$desc"; fi
}

echo "MakerVault smoke test @ $BASE"

# --- Health + seeds (fresh DB bootstrap) ---
assert_json "health is healthy on a fresh DB" \
  "d['status'] == 'healthy' and d['db_writable'] and d['items'] == 0" \
  "$BASE/health.php"
assert_json "categories seeded" "len(d) >= 10" "$BASE/categories.php"

# --- Item CRUD with tags + custom fields ---
ITEM_ID=$(curl -s -X POST "$BASE/items.php" -H 'Content-Type: application/json' -d '{
  "name": "Smoke Test Widget", "category": "hardware", "quantity": 5, "unit": "pcs",
  "brand": "SmokeCo", "sku": "SMK-001", "purchase_price": 4.2,
  "tags": ["smoke", "test"], "custom_fields": {"Torque spec": "2.5 Nm", "Kit": "A"}
}' | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])" 2>/dev/null)
[ -n "$ITEM_ID" ] && pass "item created ($ITEM_ID)" || fail "item created"

assert_json "item round-trips custom fields + tags" \
  "d['custom_fields']['Torque spec'] == '2.5 Nm' and d['tags'] == ['smoke', 'test']" \
  "$BASE/items.php?id=$ITEM_ID"
curl -s -X PUT "$BASE/items.php?id=$ITEM_ID" -H 'Content-Type: application/json' \
  -d '{"quantity": 7}' >/dev/null
assert_json "quantity update + list filter" \
  "d[0]['quantity'] == 7" "$BASE/items.php?query=Smoke+Test"
assert_json "activity logged the quantity change" \
  "any(a['action'] == 'quantityChanged' for a in d)" "$BASE/activity.php?item_id=$ITEM_ID"

# --- Attachments ---
echo "smoke attachment body" > "$TMP/spec sheet.txt"
assert_json "attachment upload" "d['name'] == 'spec sheet.txt'" \
  -X POST -F "file=@$TMP/spec sheet.txt" "$BASE/attachments.php?item_id=$ITEM_ID"
assert_json "attachment listed" "d[0]['name'] == 'spec sheet.txt' and d[0]['size'] > 0" \
  "$BASE/attachments.php?item_id=$ITEM_ID"
BODY=$(curl -s "$BASE/attachments.php?item_id=$ITEM_ID&file=spec%20sheet.txt")
[ "$BODY" = "smoke attachment body" ] && pass "attachment downloads intact" || fail "attachment downloads intact"
assert_json "attachment traversal rejected" "'detail' in d" \
  "$BASE/attachments.php?item_id=$ITEM_ID&file=..%2F..%2Fmakervault.db"
assert_json "attachment delete" "d.get('deleted') == True" \
  -X DELETE "$BASE/attachments.php?item_id=$ITEM_ID&file=spec%20sheet.txt"

# --- Labels ---
TPL_ID=$(curl -s -X POST "$BASE/labels.php" -H 'Content-Type: application/json' -d '{
  "name": "Smoke Template", "width_mm": 30, "height_mm": 20,
  "lines": [{"text": "{name}", "font_family": "Inter", "font_size": 10,
             "font_weight": "bold", "font_color": "#000000", "alignment": "left"}]
}' | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])" 2>/dev/null)
[ -n "$TPL_ID" ] && pass "label template created" || fail "label template created"
assert_json "label item data binds tokens" "d['name'] == 'Smoke Test Widget'" \
  "$BASE/labels.php?data=item&id=$ITEM_ID"
assert_json "label template delete" "d.get('deleted') == True" \
  -X DELETE "$BASE/labels.php?id=$TPL_ID"

# --- Import commit ---
assert_json "import commit creates an item" "d['stats']['created'] == 1" \
  -X POST -H 'Content-Type: application/json' "$BASE/import.php" -d '{
    "source": "bambulab", "vendor": "Bambu Lab", "duplicate_strategy": "create",
    "items": [{"name": "Smoke Import Screw", "category": "screws", "quantity": 1,
               "unit": "packs", "unit_price": 1.06, "list_price": 1.06,
               "line_total": 1.06, "sku": "B-SMK01"}]}'
assert_json "import batch recorded" "d[0]['item_count'] == 1" "$BASE/import.php"

# --- Reports + scrape guard + backup ---
assert_json "reports aggregate" "d['total_items'] == 2 and d['total_value'] > 0" "$BASE/reports.php"
assert_json "scrape refuses private addresses" "'private' in d['detail']" \
  "$BASE/scrape.php?url=http%3A%2F%2F127.0.0.1%2F"
assert_json "backup exports both items" "len(d['items']) == 2" "$BASE/backup.php"

# --- Duplicate finder: exact filament match + dismissals ---
mkdup() {
  curl -s -X POST "$BASE/items.php" -H 'Content-Type: application/json' -d "$1" \
    | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])" 2>/dev/null
}
DUP_A=$(mkdup '{"name":"Dup Widget","category":"hardware","brand":"X","quantity":1,"unit":"pcs"}')
DUP_B=$(mkdup '{"name":"Dup Widget","category":"hardware","brand":"X","quantity":2,"unit":"pcs"}')
mkdup '{"name":"PLA Basic","category":"filament","quantity":1,"unit":"spools","filament":{"material":"PLA","color":"Red"}}' >/dev/null
mkdup '{"name":"PLA Basic","category":"filament","quantity":1,"unit":"spools","filament":{"material":"PLA","color":"Blue"}}' >/dev/null
assert_json "duplicates: same-name pair flagged, different-color filament NOT" \
  "len(d['groups']) == 1 and d['groups'][0]['name'] == 'Dup Widget' and d['hidden_pairs'] == 0" \
  "$BASE/duplicates.php"
assert_json "duplicates: dismiss pair" "d['dismissed_pairs'] == 1" \
  -X POST -H 'Content-Type: application/json' "$BASE/duplicates.php" \
  -d "{\"action\":\"dismiss\",\"item_ids\":[\"$DUP_A\",\"$DUP_B\"]}"
assert_json "duplicates: dismissed group hidden" \
  "len(d['groups']) == 0 and d['hidden_pairs'] == 1" "$BASE/duplicates.php"
assert_json "duplicates: restore hidden" "d.get('restored') == True" \
  -X POST -H 'Content-Type: application/json' "$BASE/duplicates.php" -d '{"action":"restore_all"}'
assert_json "duplicates: group returns after restore" "len(d['groups']) == 1" "$BASE/duplicates.php"

# --- Delete ---
curl -s -X DELETE "$BASE/items.php?id=$ITEM_ID" >/dev/null
assert_json "item delete is effective" "'detail' in d" "$BASE/items.php?id=$ITEM_ID"

echo
if [ "$FAILS" -eq 0 ]; then
  echo "SMOKE: ALL CHECKS PASSED"
else
  echo "SMOKE: $FAILS FAILURE(S)"
  exit 1
fi
