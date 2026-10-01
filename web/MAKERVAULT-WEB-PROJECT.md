# MakerVault Web — Project Baseline

**Read this before making changes.** This is the authoritative doc for the
web edition of MakerVault. It supersedes `MAKERVAULT_PROJECT.md` (the
SwiftUI/FastAPI native app doc in the repo root) for everything web; the old
doc remains the reference for features not yet ported.

- **Owner:** Bryan (maker / 3D printing, Jacksonville FL)
- **Version:** 3.14.0-beta (pack pricing fix, native app retired — 2026-07-20)
- **Hosted at:** Synology Web Station, `/volume1/web/MakerVault`
  (`/Volumes/web/MakerVault` over SMB from the Mac)
- **Dev copy:** `/Users/bryan/Developer/MakerVault/web/`
- **Dev server:** `php -S 127.0.0.1:8743 -t web` from the repo root
  (or `.claude/launch.json` → `makervault-web`)

---

---

## SESSION HANDOFF — 2026-07-18 (read this first in a new session)

Ten working sessions. **v3.8.0-beta** shipped both Phase 7 priorities
(product-URL import + invoice import accuracy) and was deployed to the
NAS mid-session. Bryan's phone feedback then drove **v3.9.0-beta** in the
same session: import category/naming fixes, two iOS layout bugs, a
serious confirm-dialog regression fix, the Reports view, and batch item
label printing (details in the feature-status sections below). Busters
and `MV_SW_VERSION` are at **16/v16**, `MV_VERSION` 3.9.0-beta.

### What 3.8.0-beta added (all verified locally end-to-end)

1. **Product-URL import** — `api/scrape.php` (GET `?url=` scrape JSON,
   GET `?image=` CORS image proxy with SSRF guard) + a fetch box at the
   top of the add/edit item form that pre-fills empty fields and attaches
   the product photo (client-side downscaled to ≤1200px JPEG before
   upload). Bambu store: Shopify `/products/X.js` (404s on their Next.js
   storefront, kept for other regions) → JSON-LD ProductGroup with
   variant match on `?id=` → OpenGraph. Amazon: best-effort (worked in
   testing! title/bullets/price/brand/image). Any other site: JSON-LD →
   OpenGraph.
2. **Invoice parser rewrite** — the Bambu digital parser now uses pdf.js
   GEOMETRY + FONTS (`InvoiceParsers.extractFromPdf` returns per-page
   `{str,x,y,font}` cells; product names are Times-Bold = deterministic
   item boundaries; amount columns classified by x-position). Fixes: the
   dropped item per invoice whose qty/price row sits ABOVE its "SKU:"
   cell (B-XC011, B-XC003), the "Protection" truncated-name bug,
   neighbor-total corruption, and captures per-line discount/tax/list
   price. `unit_price` is now the per-unit PAID price (subtotal/qty).
   Old heuristic parser kept as fallback when fonts are unavailable.
   Order-page parser hardened (qty lines, "$1.97$2.19" dual prices,
   "model ID:"/bulk-sale-discount lines).
3. **Parse validation** — invoices carry `items_subtotal`; a review-table
   warning banner appears when line items don't sum to it.
4. **Commit-path fixes** — `import_batch_items` now stores
   unit_price/list_price/line_total/discount/tax/quantity per line
   (ensure_column migrations + schema.sql); `update` strategy refreshes
   purchase_price/date/vendor and fills blank sku/subcategory/description
   instead of only bumping quantity.
5. **Photo upload limits** — scraped photos downscale client-side;
   `web/.user.ini` raises upload_max_filesize to 16M on Web Station
   (php -S ignores it); photo.php returns a clear 413 for oversized
   uploads (PHP default 2M rejected phone photos silently as 400).
6. **Regression harness** — `node web/tests/parsers-harness.node.js`
   runs the REAL pdf.js + parsers.js against `web/data/samples/*.pdf`
   with ground-truth assertions (39/30/5 items, sums reconcile). Run it
   after any parsers.js change. Ground truth for order
   us709058300259012609 is in `web/data/samples/us709058300259012609.docx`
   (39 items — the ZH077 "BT2 … Add All To Cart" line is a BUNDLE product
   that legitimately imports as one line item).

### Added in 3.9.0-beta (2026-07-18, same session — Bryan's phone feedback)

- **Import categories fixed** — the JS parsers emitted 'screw' but the
  category KEY is 'screws' (broken since the original port; the review
  select showed an arbitrary first option). Parsers now emit real DB keys
  (incl. Bryan's customs: makersupply for CyberBrick/kits, expanded
  electronic/printer_accessory keyword lists); review table + import.php
  pin unknown keys to 'other'; a `_bootstrap` migration heals existing
  'screw' items.
- **Pretty import names** (shared `InvoiceParsers.classifyProduct`) —
  screws take the variant minus pack/code ("M3x8 BHCS Machine Screw" —
  Bryan's stated convention), variants that ARE the fuller name replace it
  ("N20 Reduction Gear Motor 400rpm", distinguishing rpm/length variants
  that previously collided), size-only variants prefix ("6704ZZ Steel Deep
  Groove Ball Bearings", "0.4x3x10 mm Extension Springs" — matches his
  existing hardware naming), compatibility lists ("X1 Series/P1 Series…")
  go to the description, packs become "Pack of 20". The product-URL import
  runs the same classifier: correct category, clean name, filament
  material/color/hex/spool-type auto-fill (form select now covers all real
  materials + prepends unknown values).
- **Import dup-matching is SKU-first** (names repeat: "ABS" ×8 filaments;
  name+brand+category is the fallback) — re-imports land on the right item.
- **iOS layout fixes** — `#main { margin-inline: auto }` on a flex item
  absorbed free space and shrank the app ~15% on phones (now scoped to
  ≥1430px); mobile modals used `align-items: stretch`, pinning the card's
  height to the viewport so taller item sheets overflowed their painted
  background and the list showed through (now flex-start + overscroll
  containment).
- **Confirm-dialog regression fix (serious)** — `confirmDialog` called
  `m.close()` before `resolve(true)`; close() fires onClose → resolve(false)
  synchronously, so EVERY confirm (item/location/template/printer/category
  deletes, merges, restore) silently no-oped. Also: backdrop clicks now
  require the press to START on the backdrop — a text-selection drag out
  of an input no longer discards the form (Bryan lost URL-import forms
  this way on desktop).
- **Reports view** (`#/reports`, sidebar + Dashboard button) —
  `api/reports.php` ports reports.py: value/priced/missing stat tiles,
  12-month spending column chart (inline SVG, zero-filled calendar axis,
  peak+latest labeled, per-bar tooltips), value by category (DB category
  colors) and by vendor ("Amazon (seller)" folded into base vendors),
  recent purchase days.
- **Batch item labels** — inventory select mode → 🏷️ Labels in the bulk
  bar → `Views.labels.quickPrintItemBatch(ids)`: template picker
  (last-used memory), barcode/QR toggles, copies, first-item preview, one
  print job with per-item data + bound locations. 3.9.1: PNG export too —
  "⬇ PNG sheet" (all labels × copies composited on one white sheet at
  300 dpi, near-A4 grid) and "⬇ PNGs" (one file per item, paced 350 ms so
  the browser keeps them; names from sanitized item names). Modal footers
  flex-wrap for the four-button row on phones.

### Added in 3.10.0-beta (2026-07-18, same session)

- **Bambu Suite `.lac` export** — the batch-label modal (and the PNG-drop
  tool) can export a ready-to-cut Bambu Suite print-then-cut project.
  Format reverse-engineered from Bryan's hand-built projects (`.lac` =
  OPC ZIP: `2D/2dmodel.json` with RasterImage + StickerGroup-with-cut-path
  objects in mm units inside an AttachedGroup; `Metadata2D/`
  project_settings assigns the material batch + per-object
  `KCPrintThenCut`) and **verified by opening generated files in Bambu
  Suite via computer use** — they land in Prepare with Plane Machining /
  Vinyl Sticker Paper A4 / 0.24 mm ready to Make. Builder lives in
  `js/labexport.js` (pure: store-only ZIP writer + .lac assembly); the
  H2S-10W machine/material/process configs ship verbatim in
  `web/assets/lac/` (fetched at export time — copy new configs there if
  Bryan changes machine or material). Grid layout uses his measured A4
  sheet geometry (0.534/0.963 mm gaps, 244 mm usable width).
- **PNG-drop export tool** (Labels view) — drop already-generated label
  PNGs → print at exact size, composite PNG sheet, or `.lac`; sizes
  assume 300 dpi (editable dpi field).
- **Designer fix** — binding an item via search now shows the Clear
  button (it only rendered if an item was bound before the panel built,
  so bindings couldn't be cleared).

### Added in 3.11.0-beta (2026-07-18, same session — Bryan's .lac feedback)

- **.lac layout fixed** — Bryan's real 48-label mixed-size export (30/48/72 mm
  wide) came out sparse (uniform grid sized by the LARGEST label) and 333 mm
  tall (no capacity limit). `LabelExport.packLabels` now shelf-packs (sorted
  by height/width, rows filled tightly, row height = tallest in row) within
  a 244×167 mm A4 usable area and splits overflow across sheets — each
  sheet becomes its own AttachedGroup AND its own making plate (Plate 1..N
  in Bambu Suite, each landing at the same bed spot). Verified in Bambu
  Suite: his 48 labels now fit ONE sheet (243×145 mm); a 144-label test
  split into 3 plates, all Print Then Cut. The PNG sheet export uses the
  same shelf packing.
- **.lac import** — the Labels drop zone accepts existing .lac projects;
  `LabelExport.readZip/readLac` (minimal ZIP reader, store+deflate via
  DecompressionStream) pulls each sticker's PNG + exact mm size back out
  for print/sheet/re-.lac. This is the legacy-project bridge: drop the old
  hand-built sheets, get all their labels back.
- **Starter template pack** — `assets/starter_templates.json` (8 maker
  templates in Bryan's black-band style: Cable Tag 60×12, Drawer Strip
  76×10, Storage Box 60×30, Filament Spool 50×25, Small Parts 25×12,
  Chemical/Resin 60×30, Location Tag 30×30, Wide Bin 72×20) + a
  "★ Starter Pack" gallery button that adds only the ones not already
  present (never overwrites).

### Added in 3.12.0-beta (2026-07-19)

- **Custom item fields** — `items.custom_fields` JSON object column
  (ensure_column + schema.sql; items.php `clean_custom_fields` keeps
  scalar values under non-empty labels). Item form gets a "Custom fields"
  editor (label/value rows, ＋ Add field, ✕ remove); the detail sheet
  renders each pair in the field grid; backup export/restore carries them.
- **Per-item attachments** — `api/attachments.php`
  (list/download/upload/delete under `data/attachments/<item-id>/`,
  filename sanitized + traversal-safe, extension allowlist incl. maker
  files stl/3mf/obj/step/gcode/dxf, PDFs/images serve inline and the rest
  download, clear 413 over the ini limit, adds/removals logged to the
  activity feed). Item sheet: Attachments section with ＋ Add
  (multi-file), size labels, per-file remove with confirm.
- **Smoke test** — `web/tests/smoke.sh`: copies web/ (minus data/) to a
  temp dir, boots php -S on :8799, and asserts 20 API round-trips —
  fresh-DB schema bootstrap, item CRUD with custom fields/tags, activity,
  attachments (incl. traversal rejection), labels, import commit +
  batches, reports, scrape SSRF guard, backup, delete. Run it plus
  `node web/tests/parsers-harness.node.js` before every deploy.

### Added in 3.13.0-beta (2026-07-19)

- **Duplicate finder: filament is exact-match only** — different-color
  spools were flagged (filament color was never consulted; matching ran on
  raw rows without the filament extension). check_pair now receives SHAPED
  items and filament pairs match only on same SKU, or — with no SKUs —
  same name + color + spool type; all fuzzy rules are skipped for
  filament. On Bryan's real data this cut filament groups to the 2 genuine
  duplicates.
- **"Not duplicates" dismissals** — 🙈 button per group persists every
  pair in `duplicate_dismissals` (item_a < item_b, pruned when items are
  deleted); GET returns `{groups, hidden_pairs}` and the view shows a
  hidden-count bar with a restore-all link. Smoke test covers the whole
  cycle (flag → dismiss → hidden → restore).
- Bryan's call: users/PIN is deliberately deferred.

### Added in 3.13.1-beta (2026-07-20)

- **Inventory name normalization (one-time, on the LIVE DB via the HTTP
  API)** — 98 items updated to consistent conventions: screws all read
  "<SIZE> BHCS <Type> Screw" (BT3 series matched to BT2, "Button Head Cap
  (BHCS)" style retired), hardware sizes use no-space mm + singular
  Spring/Pin, hotends read "<Product> <nozzle>mm - <Series> Series"
  (nozzle sizes recovered from descriptions), part numbers moved into
  SKU (31531, AXA463, THA-188-2), pack counts into descriptions, plus a
  global hygiene pass (trailing spaces — 7 filaments had them — unicode
  hyphens, ×→x, casing, "Rotery"→"Rotary"). Deliberate name convergences
  surfaced 5 real duplicate groups (servo, hotends, magnets, A1 sock/
  heating assembly) for merging. Script: scratchpad normalize_names.py;
  pre-change backup taken. `classifyProduct` now emits the same
  conventions (no-space mm, singular Spring/Pin, part codes suffix like
  "…Ball Bearings 6704ZZ", cables classify electronic before motor) so
  future imports stay consistent.
- **Duplicate finder dimension guard** — "0.4mm"/"400rpm"-style numbers
  now count as dimensional, so fuzzy matching can't group different
  nozzle sizes/speeds; exact-name matches still group.
- **Full-feature sweep (2026-07-20)** — all 13 routes render with zero
  console errors on real data; verified: restore round-trip (368 items),
  scanner manual lookup, locations panel, activity filters, custom
  fields + attachments in the item sheet, designer binding + Clear,
  printer slot dialogs, kit review, BOM matching API, CSV export, smart
  filter chips, batch move. No new bugs found.
- **Deploy note:** SMB writes from the assistant's process are blocked by
  macOS quarantine/TCC since the forced remount — mount the share from
  Finder (⌘K smb://10.0.0.10/web) before the next rsync deploy.

### Added in 3.14.0-beta (2026-07-20)

- **Inventory value was ~5x inflated — fixed.** `purchase_price` held the
  PACK price while `quantity` held the PIECE count, so value = price x qty
  counted a 2000-pack of cork pads bought for $11.49 as **$22,980**. New
  `items.pack_quantity` records how many units one purchase_price covers;
  every value query divides by it
  (`SUM(purchase_price / MAX(1, COALESCE(pack_quantity,1)) * quantity)` in
  dashboard.php + reports.php x5). `purchase_price` still means exactly
  what the receipt said. item_shape exposes a computed `unit_cost`; the
  form has a "Price covers (pack size)" field; the item sheet shows
  "$11.49 per 2000 pcs ($0.0057 each)" plus a Stock value row; CSV export
  gains `pack_quantity` + `unit_cost`; backup round-trips it; the invoice
  importer sets it from "Pack of N". **Backfilled 27 live items, removing
  $40,995 of phantom value** (script: scratchpad/backfill_packs.py, backup
  taken first). This was blocked for months as "inherited from reports.py"
  — retiring the native app removed the parity constraint.
- **Native app retired.** `MakerVault/` (SwiftUI), `Server/` (FastAPI),
  the Xcode project, `SampleData/`, `build/`, and `.venv/` are gone from
  the tree. Verified byte-identical archive at
  `archive/legacy-native-app-2026-07-20.tar.gz` (see `archive/README.md`)
  — **this repo was not under version control at the time, so nothing was hard-deleted
  without an archive.** Nothing in `web/` referenced them except three
  provenance comments. Repo went from ~264 MB to ~14 MB.
- **`.graphifyignore` added** so the knowledge graph reflects our code:
  vendored minified bundles (pdf.js/ZXing) were ~4,000 of 7,032 nodes and
  made the top "god nodes" `c` and `f` — minifier variable names. Rebuilt
  graph is 350 nodes / 777 edges / 33 communities, and graph health went
  from 83 dangling + 1,368 collapsed edges to 2 + 7. Real god nodes now
  read correctly: `UI` (57), `API` (50), `fail()` (28), `respond()` (21).
- **launch.json regression fixed** — the `makervault-web` dev-server entry
  had been overwritten by an stl-stack-builder entry; both are present now.
- Audit found **zero dead functions** in web/js and web/api, no SW/index
  version drift, no orphaned endpoints, no JS calls to missing endpoints.

### Next-session candidates

- Re-import both real invoices on the NAS with the fixed parser
  (SKU-first matching updates the existing items instead of duplicating).
  Items from the 3.8.0-window imports keep 'other' where better
  categories now exist — batch-edit or re-import fixes them.
- Roadmap (post-Phase-7) list below — custom item fields and per-item
  attachments are the biggest remaining asks now that charts shipped.

### Known issues (current)

- `total_value` overcounts pack-priced items counted in pieces (inherited
  from the original app's reports.py).
- Offline outbox covers `items.php` writes only, last-write-wins.
- Heavy vendor libs (pdf.js/zxing/xlsx) are runtime-cached — first
  offline use fails if never loaded online.
- Bambu filament product pages expose no part-number SKU (only numeric
  variant ids), so URL-import of filament leaves SKU blank — matches the
  old app's behavior.
- SMB deploy quirk: if rsync throws `io_read_flush` while `/Volumes/web`
  appears mounted, the handle is stale — `diskutil unmount force
  /Volumes/web` then `open "smb://10.0.0.10/web"`.
- Verifying same-version JS edits in the Browser pane requires bypassing
  the SW precache (fetch fresh + eval, unregister SW + clear caches, or
  bump versions first).

### Remaining roadmap (post-Phase-7)

Users/PIN with activity attribution · list pagination (~1500 items) ·
accessibility pass · move `data/` out of the web root (or Web Station
access control on `/data/*` — attachments live there too now) · precache
heavy vendor libs on idle · duplicates O(n²) revisit at scale · smart
filters over custom fields · `total_value` pack-price overcounting.
(Shipped: value/spending charts 3.9.0; custom fields, attachments, smoke
test 3.12.0.)

### Dev workflow crib (full details further down + docs/)

- Edit `~/Developer/MakerVault/web/`, test with launch.json entry
  `makervault-web` (php -S on :8743, uses the LOCAL data/ testbed)
- `php -l` + `node --check` after edits
- **Git + GitHub since 2026-10-01** (`bzayas/MakerVault`, public — `web/data/`
  is gitignored). CI runs `scripts/check.sh` on every push/PR.
- **Release:** `scripts/bump-version.sh 3.x.y-beta` (busters + `MV_SW_VERSION`
  + `MV_VERSION` in lockstep), commit, push
- **Deploy:** `scripts/deploy.sh` — pulls main, runs checks, mounts the NAS
  share (recovers stale SMB handles), refuses changed files under an
  unchanged SW version, rsyncs excluding `data/`, verifies health.php,
  tags the release. `--dry-run` previews.
- Never touch `data/` on the NAS — it's the live database
- Clients self-update (SW auto-reload on new version)
- Mobile checks: resize Browser pane to 402×874 (iPhone 17 Pro); the
  width-containment rules (`contain: inline-size`) guard against nowrap
  text re-expanding the viewport

### Suggested opening message for the next chat

> Continuing MakerVault web development (v3.9.0-beta). Read
> `web/MAKERVAULT-WEB-PROJECT.md` — start with the SESSION HANDOFF
> section. Next: <feature — e.g. custom item fields / per-item
> attachments>.

---

## Why the web port

The original MakerVault (v2.0.0, "Phase 4 complete") was a ~22k-line SwiftUI
universal app + Python FastAPI server on port 8742. It worked, but required
the Mac to be awake and the app built via Xcode. The web edition trades the
native UI for deploy-anywhere flexibility, following the proven Topps Binder
pattern (`/Volumes/web/binder`): static frontend + small PHP API on Web
Station, reachable from every device on the LAN with zero installs.

Key difference from the binder: **the binder is browser-first (IndexedDB +
PHP sync); MakerVault is server-first (SQLite on the NAS is the single
source of truth)**. No sync layer needed — a page load always shows current
data.

## Architecture

```
Browser (vanilla JS SPA, hash routing)
   │  fetch JSON
   ▼
api/*.php  (PHP 8.x, one file per resource, shared _bootstrap.php)
   │  PDO
   ▼
data/makervault.db  (SQLite, WAL — SAME schema as the FastAPI server)
data/photos/<item-id>.jpg
```

### Frontend files

| File | Purpose |
|---|---|
| `index.html` | Shell: sidebar/bottom-tab nav, modal + toast roots, script tags with `?v=` cache busters |
| `css/app.css` | All styling. Dark theme default, light via `prefers-color-scheme`. Sidebar ≥761px, bottom tabs ≤760px |
| `js/api.js` | `API` — fetch wrapper for every endpoint |
| `js/ui.js` | `UI` — `h()` DOM builder (skips null children), modal, toast, confirm, filament swatch renderer (solid/gradient/split/sparkle/silk as CSS gradients), SF-symbol→emoji map, relative timestamps, action metadata |
| `js/app.js` | `App` — boot, hash router, shared caches (`state.categories`, `state.locationTree`, `locationById` with computed `fullPath`) |
| `js/dashboard.js` | Stats cards, category breakdown, loaded filament, recent activity, Reports link |
| `js/reports.js` | Reports view: stat tiles, monthly-spending SVG column chart (dependency-free, theme-aware via CSS vars), category/vendor value bars, recent purchase days |
| `js/inventory.js` | List (search/category/status/sort filters, qty steppers), item detail modal, add/edit form (filament section toggles with category), photo upload |
| `js/locations.js` | Tree browser (expand state in localStorage), items-at-location panel, location CRUD |
| `js/activity.js` | Full log: action filter chips, search, load-more pagination |
| `js/categories.js` | Category table: add/edit/delete/reorder (up/down), key rename |
| `js/settings.js` | Backup downloads, server health panel, links to Categories + Duplicate Finder |
| `js/labelgen.js` | `LabelGen` — canvas label engine: token substitution, proportional line heights, auto-fit/wrap/split, color-circle overlays (gradient/split/sparkle/silk/marble), **Code 128 encoder validated bit-for-bit against python-barcode**, QR via vendored `js/vendor/qrcode.js` (MIT), composer layouts |
| `js/labels.js` | Labels view, two modes: **gallery** (landing — preview cards rendered with sample data, Edit/Duplicate/Export/Delete per card, Import / Export All as JSON files compatible with the old FastAPI export; router visits always land here) and **designer** (line editor, live preview, item/location binding, PNG export, print, batch print). Also exports `quickPrint({itemId\|locationId})` used by the item sheet and location panel |
| `js/scanner.js` | Camera scanning via BarcodeDetector (HTTPS), manual code entry fallback, item/location resolution, add-item-with-barcode shortcut. `cleanup()` releases the camera on nav |
| `js/duplicates.js` | Duplicate groups with confidence badges, keep-item radio, merge |
| `js/printers.js` | Printer cards with AMS unit slot grids, loaded-spool swatches + remaining meters, load/swap/unload dialogs, printer CRUD |
| `js/parsers.js` | `InvoiceParsers` — Bambu Lab + Amazon PDF parsers + `extractFromPdf(pdf)` (shared pdf.js extraction: lines, cells, positioned pages). Bambu digital invoices use the geometry parser (bold font = product name, columns by x); heuristic cell parser kept as fallback; Amazon + Bambu order pages parse from joined lines. Invoices self-validate against their Items Subtotal |
| `js/imports.js` | Import view: drag-drop PDF, pdf.js extraction (lazy-loads `js/vendor/pdf.min.js` + worker), editable review table with include checkboxes, duplicate strategy, recent batches. Also lists hardware kits (`assets/cyberbrick_kits.json`) which reuse the same review flow (strategy defaults to update) |
| `js/bom.js` | BOM Checker: drag-drop Makerworld .xlsx, SheetJS parse (lazy-loads `js/vendor/xlsx.min.js`), readiness meter + filter chips, per-part match badges, add-missing shortcut |

Views register on `window.Views.<name> = { render(main, params) }`; the
router maps `#/inventory?category=filament` → `Views.inventory.render(main,
{category: 'filament'})`.

### API endpoints (all under `/api/`)

| Endpoint | Methods | Notes |
|---|---|---|
| `items.php` | GET/POST/PUT/DELETE | POST `?action=batch` {ids, updates|delete:true} — one transaction, per-item activity log. Also `?lookup=<code>` exact barcode/SKU/UPC match (scanner). List filters: `query, category, brand, vendor, location_id, status(lowStock\|outOfStock\|inStock), sort_by, sort_order, limit, offset`. Also `?id=`, `?count=1`, `?low_stock=1`. JSON bodies are snake_case, filament/tool nested (same shapes the FastAPI server returned). Quantity changes log `quantityChanged`; location changes log `moved` |
| `locations.php` | GET/POST/PUT/DELETE | Tree by default (`item_count` per node), `?flat=1`, `?id=&items=1`, `?qr=` lookup. Delete re-parents children unless `&recursive=1` |
| `categories.php` | GET/POST/PUT/DELETE | `?action=reorder` POST `{keys:[...]}`; PUT supports `new_key` rename (updates items too); DELETE moves items to `other`, refuses builtins |
| `labels.php` | GET/POST/PUT/DELETE | Template CRUD (`lines` decoded), `?presets=1` preset CRUD, `?data=item&id=` / `?data=location&id=` — token-substitution data with filament colors merged. Rendering is client-side |
| `printers.php` | GET/POST/PUT/DELETE | Printers with nested slots (loaded filament summary included); `?slot=<id>&action=load/unload` — load clears location + remembers home, unload returns to home or chosen location; slot rename/delete |
| `import.php` | GET/POST | POST commits reviewed line items: create/update/skip duplicate strategies, import_batches + import_batch_items (with per-line unit/list/total/discount/tax since 3.8.0) + activity log; `update` refreshes purchase info and fills blank sku/subcategory/description; GET recent batches |
| `scrape.php` | GET | `?url=` product-page scrape → {name, description, price, currency, image_url, sku, brand, vendor, error} (Bambu store: Shopify JSON → JSON-LD variant-matched on `?id=` → OG; Amazon best-effort; generic JSON-LD/OG otherwise). `?image=` proxies a product image (browser can't cross-origin). Both refuse private/loopback targets |
| `bom.php` | POST | Receives client-parsed BOM rows, 3-tier match: exact SKU → exact name/original_import_name → fuzzy ≥85% (`similar_text`); returns per-part status (in_stock/partial/out_of_stock/not_found) + summary |
| `duplicates.php` | GET/POST | GET → `{groups, hidden_pairs}` (fuzzy `_check_duplicate_pair` port; filament pairs are exact-match only — SKU or name+color+spool type; dismissed pairs excluded); POST → merge `{keep_id, merge_ids, add_quantities}`, or `{action: "dismiss", item_ids}` / `{action: "restore_all"}` |
| `dashboard.php` | GET | Ports FastAPI `/api/dashboard` + `total_value` (Σ price×qty, matching reports.py) + `filament_by_material` + `loaded_filaments` |
| `activity.php` | GET | `action, item_id, search, limit, offset`; joins `item_name` |
| `photo.php` | GET/POST/DELETE | `?item_id=`; POST multipart field `photo`; EXIF orient, ≤1200px, JPEG q85 (GD). Do NOT use `IMG_BICUBIC` — broken in some GD builds |
| `attachments.php` | GET/POST/DELETE | Per-item files under `data/attachments/<item-id>/`; `?item_id=` lists, `&file=` downloads (inline for pdf/images), POST multipart field `file`, DELETE removes. Extension allowlist incl. stl/3mf/step/gcode |
| `backup.php` | GET/POST | Full JSON backup; `?format=csv` items CSV; POST `?action=restore` — transactional full replace from a backup JSON (FK order: items → printer_slots → filament/tool extensions; activity log preserved). Verified lossless on a 383-item round trip |
| `reports.php` | GET | Analytics (ports reports.py): total/priced/missing value stats, by_category, by_vendor (base-vendor folded), monthly (12 months, zero-filled), recent_purchases |
| `health.php` | GET | Status, counts, PHP version, `db_writable` |

### `_bootstrap.php` provides

`db()` (PDO, WAL, foreign keys, busy_timeout, schema bootstrap from
`schema.sql` on fresh install, `ensure_column` micro-migrations),
`respond()/fail()`, `input_json()`, `uid()` (UUIDv4), `now()` (UTC
`Y-m-d H:i:s`, same as SQLite `datetime('now')`), `log_activity()`,
`item_shape()/rows_to_items()/fetch_item()` (bulk-fetch filament/tool
extensions — the N+1 fix from Phase 4 carried over).

**PHP gotcha encountered:** top-level `const` executes in file order — keep
const declarations ABOVE the method-dispatch `switch` or handlers won't see
them.

### Database

Identical schema to the native app (see `api/schema.sql`): `items` +
`filaments`/`tools` extension tables, hierarchical `locations`, dynamic
`categories`, `printers`/`printer_slots`, `label_templates`/`label_presets`,
`activity_log`, `import_batches`, `barcode_sequences`. The live DB was
checkpoint-copied from the Mac app on 2026-07-07: 383 items, 111 filaments,
276 locations, 14 categories, 2 printers, 12 label templates, full activity
history. `original_import_name` column is present (migration 12);
`ensure_column()` adds it to older DBs.

Category `icon` values are SF Symbols names from the SwiftUI app
(`wrench.and.screwdriver` etc.) — the web maps them to emoji in
`js/ui.js` `SF_ICON_MAP`. Keep storing SF names so the native app remains
compatible with the same DB.

---

## Feature status

### Ported and working (beta 1)

- Dashboard: totals, low/out-of-stock, filaments loaded, inventory value,
  category breakdown, loaded-filament list with swatches, recent activity
- Inventory: search + category/status filters + sorting, quantity steppers
  (list + detail), item detail, add/edit with full field set including
  filament data (color modes render as swatches), delete, tags, reorder
  URLs with low-stock warning links
- Photos: upload (resized server-side), display in list/detail, remove
- Locations: full tree with item counts, expand/collapse (persisted),
  items-at-location panel, add/edit/delete (re-parent or recursive),
  add-item-here and add-sub-location shortcuts
- Categories: add/edit/delete/reorder, key rename, item counts
- Activity log: filters, search, pagination; all mutations logged
  server-side (added/edited/moved/quantityChanged/deleted)
- Backup: full JSON download, items CSV download
- Responsive layout (desktop sidebar / mobile bottom tabs), dark + light

### Added in Phase 2 (3.1.0-beta.1, 2026-07-09)

- **Label designer** — full canvas pipeline (see `js/labelgen.js`), template
  CRUD against the 12 carried-over templates, live preview, item/location
  token binding, Code 128 + QR, PNG export, exact-size print, batch print
- **Scanner** — BarcodeDetector camera scanning (needs the HTTPS portal),
  manual entry fallback, resolves items by barcode/SKU/UPC and locations by
  `makervault://` QR values, offers add-item for unknown codes
- **Duplicate finder + merge** — full port of the fuzzy rules incl. the
  filament SKU/description guards and dimensional-name thresholds

### Added in Phase 3 (3.2.0-beta.1, 2026-07-09)

- **iOS scanner fix** — iOS browsers (all WebKit) lack `BarcodeDetector`;
  scanner now lazy-loads a vendored ZXing-JS decoder (`js/vendor/zxing.min.js`,
  336KB, loaded only when needed) and decodes downscaled video frames via
  canvas. Native API still used where available. Decode path verified against
  LabelGen-generated Code 128 + QR canvases
- **Printers/AMS view** — the 2 printers + 13 slots from the DB, load/unload
  with home-location return (ports printers.py semantics exactly)
- **PDF invoice import** — client-side pdf.js text extraction; Bambu Lab
  digital invoices (SKU cells, two-column tax layout), Bambu order pages, and
  Amazon order summaries. Review table before commit; create/update/skip
  duplicate strategies. Tested against both SampleData PDFs: Bambu 38/38
  line items with SKUs/prices/filament colors, Amazon 5/5

### Added in Phase 4 (3.3.0-beta, 2026-07-13)

- **BOM checker** (`#/bom`) — Makerworld .xlsx vs inventory, all three match
  tiers verified against real data (fuzzy caught one-character typos at 98–99%)
- **Hardware kit import** — CyberBrick kit definitions on the Import view,
  committed through the same review table + import.php (update strategy default)
- **Smart filters** — built-ins (Low Stock, Checked Out, No Location) +
  custom saved filters with a condition builder (11 fields, text/number/bool
  ops, live match count), localStorage-persisted, client-side evaluation
- **Batch edit / multi-select** — Select mode with checkbox rows, sticky bulk
  bar (Edit 7 toggle-gated fields / Move / Delete), single-transaction API
- **Backup restore** — Settings → Restore… with double confirmation

### Added in Phase 5 (3.4.0-beta, 2026-07-13)

- **Offline support (installed PWA)** — `sw.js` service worker: versioned
  app-shell precache (cache name `mv-shell-v6` moves in lockstep with the
  `?v=` busters — bump BOTH on deploy), network-first API GET caching so
  every view renders last-seen data offline, cache-first photos, lazy
  runtime caching for the heavy vendor bundles. Old caches purged on
  activate; `skipWaiting` + update toast.
- **Offline write outbox** (`js/api.js`) — item edits made offline queue in
  localStorage and replay in order on reconnect (verified: two queued edits
  landed server-side). Item creates carry client-generated UUIDs
  (`items.php` accepts an optional `id`, rejects collisions with 409) so a
  queued create replays with the same identity. Only plain `items.php`
  writes queue — photos/imports/restores require the connection.
- **Navigation consistency** — modals close on hash navigation; Settings
  stays highlighted for its child views (categories, duplicates); every
  page has a subtitle; modals autofocus their first control.
- **Look & feel** — view fade-in, micro-interactions (press scale, row
  nudge), `:focus-visible` outlines, larger touch targets on coarse
  pointers, iOS standalone safe-area insets, light/dark `theme-color`
  metas, sidebar footer shows offline state + pending sync count.

### Added in Phase 5b (3.5.0-beta, 2026-07-13)

Patterned on Sortly/Homebox item-page conventions:

- **Item sheet overhaul** — action row (🏷️ print label, 📄 duplicate,
  📍 jump to location, 📋 copy barcode/SKU, 🔧 check out/in for tools,
  🛒 reorder), per-item history timeline (activity.php?item_id), tap the
  quantity number to type an exact count, clickable full location path,
  filament remaining-weight meter, checked-out badge
- **Quick label printing** — `Views.labels.quickPrint({itemId|locationId})`:
  compact modal with template picker (remembers last-used per kind,
  built-in fallback templates), barcode/QR toggles, live preview, copies,
  PNG/print. Hooked from the item sheet and the location panel ("QR label")
- **Location panel** — clickable breadcrumb path, item count in the header
- **Scroll/nav fixes** — page scroll locks under modals, `#main` centers on
  ultra-wide screens, duplicate excludes barcode/photo (unique per physical
  item)

### 3.5.2-beta (2026-07-14) — self-applying updates

Deploys were reaching the NAS but clients kept running the old cached
shell: the SW only checked for updates on registration, the update toast
had a race, and installed iOS apps resume from memory for days without a
fresh navigation. Now `app.js`: (1) `reg.update()` runs on launch, on every
visibilitychange→visible, and hourly; (2) on `controllerchange` (a new SW
claiming an existing page) the page reloads itself once — unless a modal is
open or offline edits are unsynced, in which case it falls back to the
toast. First-install claims are excluded. Verified end-to-end locally:
bumped SW version, triggered the resume-style update check, watched the
page self-reload onto the new cache. `?v=` busters and `MV_SW_VERSION` must
still move together (now both "11").

### Added in Phase 7 (3.8.0-beta, 2026-07-18)

- **Product-URL import** — `api/scrape.php` + fetch box in the add/edit
  item form: paste a Bambu store / Amazon / any-JSON-LD product URL →
  pre-fills name/brand/vendor/SKU/price/description/reorder-URL and
  attaches the product photo (proxied + client-downscaled). Verified live
  against us.store.bambulab.com (incl. `?id=` variant match and hardware
  part-code SKUs) and amazon.com
- **Invoice parser rewrite (geometry + fonts)** — recovers the
  one-item-per-invoice loss (qty row above "SKU:" cell), fixes truncated
  bold names and neighbor-total corruption, captures per-line
  discount/tax/list price, stores paid (not list) unit price, validates
  the parse against the invoice's Items Subtotal with a review-table
  warning banner. Regression harness: `node web/tests/parsers-harness.node.js`
  (39/39 + 30/30 items on Bryan's two real invoices, sums exact)
- **Import commit audit** — line details persist to `import_batch_items`;
  `update` strategy enriches existing items instead of only adding qty
- **Upload limits** — `web/.user.ini` (16M) + clear 413 from photo.php;
  scraped photos always fit

### Review pass (3.2.1-beta, 2026-07-13)

Full-codebase review; fixed and verified:

- **Location parent cycles** — `locations.php` PUT now rejects self-parenting
  and moves under a location's own descendant (previously corrupted the tree
  and made recursive delete infinitely recurse)
- **Escape closed every stacked modal** — now closes only the topmost
- **Locations selection highlight** never applied on click — fixed
- **Photo caching** — `photoURL()` was cache-busted with `Date.now()` on
  every render (full refetch of all photos each list refresh). URLs now
  carry the item's `updated_at` as a version; `photo.php` serves
  `max-age=604800, immutable` and accepts HEAD
- **Activity double-logging** — a pure location move logged "edited"+"moved";
  now the most specific single action is logged
- **Detail modal** no longer refreshes a detached inventory list when opened
  from the scanner or locations views
- **PWA-lite** — GD-generated app icons (`icons/`), `manifest.json`,
  apple-touch-icon: Add to Home Screen now installs with a proper icon.
  Still no service worker by design (cache pain > offline gain in beta)
- **data/ exposure documented** — `index.html` guards against listing;
  Web Station Access Control noted in docs for locking down `/data/*`

### Not yet ported (Phase 4 candidates, in rough priority order)

1. **BOM checker** (Makerworld xlsx) — SheetJS client-side + a match
   endpoint, port 3-tier matching from `routes/imports.py`
2. **Kit import** (CyberBrick) — `Server/data/cyberbrick_kits.json`
3. **Smart filters / saved views** — was UserDefaults-persisted in Swift;
   web equivalent: localStorage or a new `settings` table
6. **Batch edit / multi-select**
7. **Backup restore endpoint** (JSON import; export exists)
8. **PWA packaging** (manifest + service worker) once features settle —
   deliberately skipped in beta to avoid cache-invalidation pain
9. **Users/PIN + per-user activity attribution** (activity `user_id` is
   NULL for web edits today)
10. **Label template import/export as files** (server had JSON I/O routes)

### Known quirks

- Inventory list loads up to 1000 items in one request (fine at 383; add
  paging before the collection gets huge)
- `total_value` = Σ(price × quantity) matches the native app's reports.py,
  which overcounts pack-priced items counted in pieces — inherited behavior,
  revisit in Phase 2
- Icon set is emoji, approximating SF Symbols
- Native Mac app and web app share schema but NOT the same DB file anymore;
  the NAS copy is authoritative as of 2026-07-07

---

## Development workflow

1. Edit in `/Users/bryan/Developer/MakerVault/web/`
2. Test locally: `php -S 127.0.0.1:8743 -t web` (repo root) — uses the LOCAL
   `web/data/makervault.db`, so tests never touch live NAS data
3. `scripts/check.sh` — lint, version lockstep, smoke test, parser harness
4. `scripts/bump-version.sh <version>`, commit, push to GitHub
5. `scripts/deploy.sh` — checks, rsync to the NAS (never `data/`), health check, tag
6. Click through the UI

See `docs/SYNOLOGY-DEPLOYMENT.md` for Web Station setup, permissions,
HTTPS, backups, and troubleshooting.
