# API reference

The API is a set of PHP scripts in `web/api/`, one per resource. All of them take and return JSON, except photo, attachment and backup downloads.

Base URL: `<site>/api/`. For example, `https://<nas>:8742/api/items.php`.

## Conventions

- Request bodies are JSON objects with `snake_case` keys. Send `Content-Type: application/json`.
- Errors come back as `{"detail": "message"}` with a 4xx or 5xx status. `API.request()` in `js/api.js` turns that into a thrown `Error`.
- IDs are lowercase UUID v4 strings, the same format the original FastAPI server used.
- Timestamps are UTC strings in SQLite format: `2026-09-28 14:03:11`.
- Responses send `Cache-Control: no-store`. Offline caching is handled by the service worker, not by HTTP caching. Photos are the exception (see below).
- There is no authentication. The app is meant for a home network. See [known-issues.md](known-issues.md#security-and-privacy).

## Endpoint index

| Endpoint | Methods | Purpose |
|---|---|---|
| [`items.php`](#itemsphp) | GET POST PUT DELETE | Items, search, batch edits, scan lookup, barcode generation |
| [`locations.php`](#locationsphp) | GET POST PUT DELETE | The storage tree |
| [`categories.php`](#categoriesphp) | GET POST PUT DELETE | Item categories |
| [`printers.php`](#printersphp) | GET POST PUT DELETE | Printers, AMS slots, loading and unloading spools |
| [`labels.php`](#labelsphp) | GET POST PUT DELETE | Label templates, size presets, label data |
| [`photo.php`](#photophp) | GET HEAD POST DELETE | One photo per item |
| [`attachments.php`](#attachmentsphp) | GET POST DELETE | Files attached to an item |
| [`import.php`](#importphp) | GET POST | Commit reviewed invoice lines |
| [`scrape.php`](#scrapephp) | GET | Read a product page, proxy its image |
| [`bom.php`](#bomphp) | POST | Match a bill of materials against inventory |
| [`duplicates.php`](#duplicatesphp) | GET POST | Find, merge and dismiss duplicates |
| [`dashboard.php`](#dashboardphp) | GET | Dashboard numbers |
| [`reports.php`](#reportsphp) | GET | Value and spending reports |
| [`activity.php`](#activityphp) | GET | The change log |
| [`backup.php`](#backupphp) | GET POST | JSON backup, CSV export, restore |
| [`health.php`](#healthphp) | GET | Version and server status |

## items.php

### Read

| Request | Returns |
|---|---|
| `GET items.php` | Array of items. Filters: `query` (name, brand, SKU, UPC, barcode, description, notes, tags), `category`, `brand`, `vendor`, `location_id`, `status` (`lowStock`, `outOfStock`, `inStock`), `sort_by`, `sort_order` (`asc`/`desc`), `limit` (default 500, max 1000), `offset`. |
| `GET items.php?id=<id>` | One item, or 404. |
| `GET items.php?count=1[&category=]` | `{"count": n}` |
| `GET items.php?low_stock=1` | Items at or below their `min_quantity`. |
| `GET items.php?lookup=<code>` | Exact match on barcode, SKU or UPC (up to 10). Used by the scanner. |

An item looks like this (shortened):

```json
{
  "id": "3c25572b-f9b3-4d1c-bfd2-d85487e59d98",
  "name": "M3x8 BHCS Machine Screw",
  "category": "screws",
  "quantity": 180,
  "unit": "pcs",
  "min_quantity": 50,
  "purchase_price": 8.99,
  "pack_quantity": 200,
  "unit_cost": 0.045,
  "location_id": "a0de5f74-...",
  "tags": ["stainless"],
  "custom_fields": {"Torque spec": "0.5 Nm"},
  "filament": null,
  "tool": null,
  "created_at": "2026-09-28 14:03:11",
  "updated_at": "2026-09-28 14:03:11"
}
```

`filament` is an object for items in the `filament` category (material, colors, color mode, diameter, spool and remaining weight, status, printer slot, spool type). `tool` is an object for the `tool` category (type, serial number, checked-out state). `unit_cost` is computed: `purchase_price / pack_quantity`.

### Write

| Request | Body | Notes |
|---|---|---|
| `POST items.php` | Item fields, optional `filament` / `tool` objects, optional `id` | Returns the new item with 201. A client-supplied `id` lets offline creates replay safely. A duplicate `id` gets 409. |
| `PUT items.php?id=<id>` | Any subset of fields | Partial update. Logs `quantityChanged`, `moved` or `edited`, whichever is most specific. |
| `DELETE items.php?id=<id>` | | Deletes the item and its photo. |
| `POST items.php?action=batch` | `{"ids": [...], "updates": {...}}` or `{"ids": [...], "delete": true}` | One transaction. Editable fields: `category`, `location_id`, `brand`, `vendor`, `subcategory`, `min_quantity`, `unit`, `tags`. One activity row per item. |
| `POST items.php?action=barcode` | `{"item_id": "..."}` or `{"category": "screws"}` | With `item_id`, assigns and saves the next barcode (no change if the item has one). With `category`, reserves a code for a new item. Format `MV-SCR-00001`. Prefixes per category are in `BARCODE_PREFIXES`. |

## locations.php

| Request | Returns or does |
|---|---|
| `GET locations.php` | The full tree. Each node has `children` and `item_count`. |
| `GET locations.php?flat=1` | Flat list. |
| `GET locations.php?id=<id>` | One location with its children. |
| `GET locations.php?id=<id>&items=1` | Items stored at that location. |
| `GET locations.php?qr=<value>` | `{location, items}` for a scanned QR value. |
| `POST locations.php` | Create `{name, type, parent_id?, qr_code_value?, notes?, capacity?}`. The QR value defaults to `makervault://location/<id>`. |
| `PUT locations.php?id=<id>` | Partial update. Refuses to make a location its own parent or move it under one of its descendants. |
| `DELETE locations.php?id=<id>[&recursive=1]` | Without `recursive`, children move up to the deleted location's parent. Items at the location lose their `location_id`. |

Valid `type` values: `closetRack`, `shelf`, `rollingCart`, `cartLayer`, `cabinet`, `drawer`, `gridfinityBin`, `wallStorage`, `wallBin`, `ikeaBin`, `stanleySortmaster`, `sortmasterCompartment`, `toolBox`, `amsUnit`, `amsSlot`, `externalSpool`, `dryBox`, `printer`, `inUse`, `custom`.

## categories.php

| Request | Does |
|---|---|
| `GET categories.php` | Ordered list with item counts. |
| `POST categories.php` | Create `{key, display_name, icon, color}`. |
| `POST categories.php?action=reorder` | `{"keys": [...]}` in the new order. |
| `PUT categories.php?key=<key>` | Update `display_name`, `icon`, `color`, or rename with `new_key` (items follow). |
| `DELETE categories.php?key=<key>` | Refused for built-in categories. Items move to `other`. |

## printers.php

| Request | Does |
|---|---|
| `GET printers.php` | Printers with nested `slots`. Each slot includes a summary of the loaded filament. |
| `POST printers.php` | Create `{name, model, notes?, slots?: [{ams_type, ams_unit_number, slot_number, name?}]}`. |
| `PUT printers.php?id=<id>` | Update name, model, notes. |
| `DELETE printers.php?id=<id>` | Unloads every slot first, then deletes. |
| `POST printers.php?id=<id>&action=add_slot` | Add a slot or AMS unit position. |
| `PUT printers.php?slot=<id>` | Rename a slot. |
| `DELETE printers.php?slot=<id>` | Delete a slot, unloading its filament. |
| `PUT printers.php?slot=<id>&action=load` | `{"filament_item_id": "..."}`. Remembers the spool's location and clears it. |
| `PUT printers.php?slot=<id>&action=unload` | `{"return_location_id"?: "..."}`. Without one, the spool goes back where it came from. |

`ams_type` is one of `amsLite`, `ams2Pro`, `amsHT`, `externalManual`.

## labels.php

Rendering happens in the browser. This endpoint stores templates and gives the browser the data to fill them in.

| Request | Does |
|---|---|
| `GET labels.php` | All templates, with `lines` decoded. |
| `GET labels.php?id=<id>` | One template. |
| `POST labels.php` / `PUT labels.php?id=` / `DELETE labels.php?id=` | Template create, update, delete. |
| `GET labels.php?data=item&id=<item_id>` | Values for every label token, including filament colors. |
| `GET labels.php?data=location&id=<loc_id>` | Values for location tokens. |
| `GET labels.php?presets=1` | Size presets. |
| `POST labels.php?presets=1` | Create preset `{name, width_mm, height_mm}`. |
| `DELETE labels.php?presets=1&id=` | Delete a preset. There is no update call; the preset manager adds and deletes. |

## photo.php

| Request | Does |
|---|---|
| `GET` or `HEAD photo.php?item_id=<id>` | Serves the JPEG with a one-week `immutable` cache header. The app adds `&v=<updated_at>` so a changed photo gets a new URL. |
| `POST photo.php?item_id=<id>` | Multipart upload, field `photo`. Rotated by EXIF, resized to 1200 px on the long edge, saved as JPEG quality 85. Returns 413 with a clear message when the file is over the PHP upload limit. |
| `DELETE photo.php?item_id=<id>` | Removes the photo. |

Needs the `gd` PHP extension, and `exif` for rotation. Don't use `IMG_BICUBIC` for resizing: some GD builds produce broken output with it.

## attachments.php

Files are stored in `data/attachments/<item-id>/`.

| Request | Does |
|---|---|
| `GET attachments.php?item_id=<id>` | `[{name, size, modified}]` |
| `GET attachments.php?item_id=<id>&file=<name>` | Downloads the file. PDFs and images open inline. |
| `POST attachments.php?item_id=<id>` | Multipart upload, field `file`. |
| `DELETE attachments.php?item_id=<id>&file=<name>` | Removes the file. |

Allowed extensions: `pdf txt md csv xlsx png jpg jpeg webp gif svg stl 3mf obj step stp dxf gcode bgcode zip json`. File names are cleaned and path traversal is rejected. Adds and removals are logged in the activity log.

## import.php

PDF parsing happens in the browser (see [subsystems/importing.md](subsystems/importing.md)). This endpoint receives the reviewed lines.

`POST import.php`:

```json
{
  "source": "bambulab",
  "vendor": "Bambu Lab",
  "order_number": "US709058300259012609",
  "order_date": "2026-03-14",
  "duplicate_strategy": "update",
  "default_location_id": null,
  "items": [
    {"name": "M3x8 BHCS Machine Screw", "category": "screws", "sku": "B-XC011",
     "quantity": 1, "unit": "packs", "unit_price": 1.97, "list_price": 2.19,
     "line_total": 1.97, "discount": 0.22, "tax": 0.14}
  ]
}
```

Returns `{"batch_id": "...", "stats": {"created": n, "updated": n, "skipped": n}}`.

`duplicate_strategy` decides what happens when an item already exists (matched by SKU first, then by name, brand and category):

| Strategy | Result |
|---|---|
| `create` | Always add a new item. |
| `update` | Add the quantity to the existing item, refresh its price, date and vendor, and fill in blank SKU, subcategory and description. |
| `skip` | Leave the existing item alone. |

`unit_price` is the price actually paid per unit and becomes the item's `purchase_price`. The full line detail is stored in `import_batch_items`. `GET import.php` lists recent import batches with item counts.

## scrape.php

| Request | Returns |
|---|---|
| `GET scrape.php?url=<product url>` | `{name, description, price, currency, image_url, product_url, vendor, sku, brand, error?}` |
| `GET scrape.php?image=<image url>` | The image bytes, so the browser can attach a store photo without CORS problems. |

Both refuse URLs that resolve to private, loopback or link-local addresses. For Bambu Lab store pages it tries the Shopify product JSON first (still used by some regional stores), then the page's JSON-LD data, matching the `?id=` variant. Amazon is best effort and often blocked. Other sites fall back to JSON-LD, then OpenGraph tags.

## bom.php

`POST bom.php` with `{project_name?, model_id?, items: [{product_id, name, quantity, note, is_filament}]}`. Each part is matched in three tiers: exact SKU, then exact name (also checking the name an item had when it was imported), then a fuzzy name match of 85% or better. Returns a status per part (`in_stock`, `partial`, `out_of_stock`, `not_found`) and a summary.

## duplicates.php

| Request | Does |
|---|---|
| `GET duplicates.php` | `{"groups": [...], "hidden_pairs": n}`. Each group has a `confidence` and `reasons`. |
| `POST duplicates.php` | Merge: `{keep_id, merge_ids, add_quantities}`. The other items are deleted and their quantities added to the kept one. |
| `POST duplicates.php` | `{"action": "dismiss", "item_ids": [...]}` marks every pair in the group as "not duplicates". |
| `POST duplicates.php` | `{"action": "restore_all"}` clears all dismissals. |

Filament is matched strictly: same SKU, or (without SKUs) the same name, color and spool type. Everything else uses the fuzzy rules ported from the native app, with a guard so that different sizes such as `0.4mm` and `0.6mm` are not grouped. The check compares every pair, so it slows down as the inventory grows (see [ROADMAP.md](../ROADMAP.md)).

## dashboard.php

`GET dashboard.php` returns `total_items`, `low_stock_count`, `out_of_stock_count`, `checked_out_tools`, `filaments_loaded`, `total_value`, `recent_activity`, `category_counts`, `filament_by_material` and `loaded_filaments`.

## reports.php

`GET reports.php` returns `total_value`, `total_items`, `priced_items`, `missing_price_count`, `by_category`, `by_vendor` (Amazon seller names folded into "Amazon"), `monthly` (last 12 calendar months, months with no spending included as zero) and `recent_purchases`.

Value is always `purchase_price / pack_quantity * quantity`, summed over items that have a price. Items whose purchase date isn't in `YYYY-MM-DD` form are left out of the monthly chart.

## activity.php

`GET activity.php?action=&item_id=&search=&limit=&offset=` returns entries newest first with `item_name` joined in. `limit` defaults to 50 and is capped at 200.

Action values: `added`, `edited`, `moved`, `quantityChanged`, `deleted`, `imported`, `merged`, `checkedOut`, `checkedIn`, plus `skipped`, `quantity_updated` and `updated` from older imports.

## backup.php

| Request | Does |
|---|---|
| `GET backup.php` | Downloads a full JSON backup of every table. |
| `GET backup.php?format=csv` | Downloads the items as CSV, including `pack_quantity` and `unit_cost`. |
| `POST backup.php?action=restore` | Body is a backup file. Replaces items, filament and tool rows, locations, categories, printers, slots, label templates and presets in one transaction. The activity log is kept, and an `imported` entry records the restore. |

## health.php

`GET health.php` returns `{app, status, version, php, items, locations, categories, database, db_writable}`. Use it to check a new install and to confirm a deploy (`scripts/deploy.sh` reads `version`).
