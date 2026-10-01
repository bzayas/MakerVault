# Changelog

All notable changes to MakerVault, newest first. Dates are when the work was done. The web edition started at version 3.0. Versions 1.x and 2.x were the native macOS/iOS app, summarized at the bottom.

The full original notes these entries came from are kept in [docs/archive/project-notes-2026-07.md](docs/archive/project-notes-2026-07.md). The stories behind the bigger fixes are in [docs/history.md](docs/history.md).

## Unreleased

Work in the code after 3.14.0. The service worker version has moved on (v23) but `MV_VERSION` still reads 3.14.0-beta, so the next release should bump it.

### Added

- Scanner audit mode. The camera stays on, each scan opens an in-place quantity counter, and a running list shows what was scanned this session.
- Item QR labels encoding `makervault://item/<id>`. Scanning one opens the item directly.
- Flashlight button on the Scan screen when the camera supports it.
- The photo button on the item form opens the rear camera directly on phones.
- Label size preset manager in the designer (add and delete presets).
- QR labels for a location and every location under it, from the location panel.
- Add an AMS unit or slot to an existing printer, and delete slots.
- Git repository on GitHub, with CI running the checks on every push (2026-10-01).
- `scripts/check.sh`, `scripts/bump-version.sh` and `scripts/deploy.sh` for one-command checks, releases and NAS deploys.
- This documentation set, with screenshots generated from demo data (`scripts/screenshots/`).

### Fixed

- Escape now cancels typing an exact quantity on the item sheet. Before, removing the input fired a blur that saved it anyway.
- Tab no longer moves focus out of an open dialog into the page behind it.
- Invoice purchase dates written as text ("March 14, 2026") are saved as `2026-03-14`, so the item form's date field shows them.
- `deploy.sh` no longer refuses to run because of untracked folders next to `web/`.

## 3.14.0-beta (2026-07-20)

### Fixed

- Inventory value was about five times too high. `purchase_price` held the price of a pack while `quantity` counted pieces, so a $11.49 bag of 2,000 cork pads counted as $22,980. New `items.pack_quantity` says how many units one price covers, and every value calculation divides by it. 27 live items were backfilled, removing $40,995 of value that didn't exist.
- The `makervault-web` dev server entry in `.claude/launch.json` had been overwritten by another project's entry.

### Added

- "Price covers (pack size)" field on the item form. The item sheet shows the per-unit cost and a stock value row. CSV export gains `pack_quantity` and `unit_cost`. Invoice import sets the pack size from "Pack of N".

### Removed

- The native SwiftUI app, the FastAPI server, the Xcode project and their build output, after a verified archive (`archive/legacy-native-app-2026-07-20.tar.gz` on the Mac). The project folder went from about 264 MB to 14 MB.

## 3.13.1-beta (2026-07-20)

### Changed

- 98 live item names normalized to one convention, for example screws as `<size> BHCS <type> Screw` and sizes without spaces (`0.4mm`). Part numbers moved into the SKU field and pack counts into descriptions. The import name cleanup now produces the same style, so new imports match.

### Fixed

- The duplicate finder could group items that differ only in size or speed, such as `0.4mm` and `0.6mm` nozzles or `300rpm` and `400rpm` motors. Numbers with units now count as dimensions.

## 3.13.0-beta (2026-07-19)

### Fixed

- The duplicate finder flagged filament spools of different colors as duplicates. Filament now only matches on the same SKU, or the same name, color and spool type.

### Added

- "Not duplicates" button on each duplicate group, stored in the new `duplicate_dismissals` table, with a link to restore hidden groups.

## 3.12.0-beta (2026-07-19)

### Added

- Custom fields on items, as any number of label and value pairs, shown on the item sheet and included in backups.
- Attachments on items (datasheets, manuals, STL, 3MF, STEP, G-code and more), stored under `data/attachments/<item-id>/`.
- API smoke test, `web/tests/smoke.sh`.

## 3.11.0-beta (2026-07-18)

### Fixed

- `.lac` exports with mixed label sizes were sparse and could run past the sheet. Labels are now shelf-packed onto A4 sheets, and overflow goes onto extra sheets that become separate plates in Bambu Suite.

### Added

- Import existing `.lac` projects to reprint or rebuild their labels.
- Starter Pack button that adds eight ready-made label templates.

## 3.10.0-beta (2026-07-18)

### Added

- Export Bambu Suite print-then-cut projects (`.lac`) from batch label printing.
- Drop zone on the Labels screen that turns existing label PNGs into a print job, a sheet or a `.lac`.

### Fixed

- In the label designer, binding an item by search didn't show the Clear button, so the binding couldn't be removed.

## 3.9.1-beta (2026-07-18)

### Added

- Batch label export as one PNG sheet at 300 DPI or as separate PNG files.

## 3.9.0-beta (2026-07-18)

### Fixed

- Every confirmation dialog silently did nothing: deleting items, locations, templates, printers or categories, merging duplicates and restoring backups. See [history.md](docs/history.md#the-confirm-dialog-that-always-said-no).
- Dialogs closed when a text selection drag ended outside them, losing form contents.
- Imported screws were saved under a category key (`screw`) that doesn't exist. A migration moved them to `screws`.
- On iPhones the whole app rendered about 15% narrower than the screen, and tall item sheets let the list show through below them.

### Added

- Reports screen with value tiles, a 12-month spending chart, and value by category and by vendor.
- Labels for many items at once from Inventory select mode.
- Import names cleaned into the inventory's naming style, and filament color details filled in from the product variant.

### Changed

- Import matches existing items by SKU first, then by name, brand and category.

## 3.8.0-beta (2026-07-18)

### Added

- Product URL import on the item form, through the new `scrape.php`.
- Invoice totals are checked against the invoice's own subtotal, with a warning in the review table when they differ.
- `web/tests/parsers-harness.node.js`, a regression test for the invoice parsers.
- `web/.user.ini` raising the upload limit to 16 MB on Web Station.

### Fixed

- The Bambu Lab invoice parser was rewritten to read text positions and fonts. It no longer drops one item per invoice, cuts long names short or attaches a total to the wrong line. It also records discount, tax and list price per line.
- The `update` import strategy refreshes price, date and vendor instead of only adding quantity.
- Phone photos over 2 MB failed with an unclear error. Uploads now show a clear message when too large, and scraped photos are shrunk before upload.

## 3.5.2-beta (2026-07-14)

### Fixed

- Installed apps kept running old versions for days after a deploy. The app now checks for updates on launch, on return to the foreground and hourly, and reloads itself once when a new version takes over. See [history.md](docs/history.md#deploys-that-never-arrived).

## 3.5.0-beta (2026-07-13)

### Added

- Action buttons on the item sheet to print a label, duplicate the item, go to its location, copy its barcode, check tools out and in, and reorder.
- Item history on the sheet, tap-to-type quantity, clickable location path, filament remaining meter.
- Quick label printing from the item sheet and location panel.

### Fixed

- The page behind an open dialog could scroll.

## 3.4.0-beta (2026-07-13)

### Added

- Offline support through a service worker that caches the app shell and API responses.
- Offline outbox. Item edits made without a connection are queued and sent when it returns.
- Sidebar footer showing version, offline state and edits waiting to sync.

### Changed

- Dialogs close on navigation, every screen has a subtitle, and touch targets are bigger on phones.

## 3.3.0-beta (2026-07-13)

### Added

- BOM checker for Makerworld `.xlsx` parts lists.
- CyberBrick hardware kit import.
- Smart filters, with three built in and saved custom filters.
- Select mode with batch edit, move and delete.
- Restore from a JSON backup.

## 3.2.1-beta (2026-07-13)

A review pass over the whole codebase.

### Fixed

- A location could be moved under its own sub-location, corrupting the tree and making recursive delete loop forever.
- Escape closed every open dialog instead of the top one.
- Every photo was downloaded again on every list refresh. Photo URLs now change only when the item changes.
- Moving an item logged two activity entries.

### Added

- App icons and a web app manifest, so Add to Home Screen installs properly.

## 3.2.0-beta.1 (2026-07-09)

### Added

- Barcode scanning on iPhone and iPad through ZXing, since WebKit has no `BarcodeDetector`.
- Printers screen with AMS slots, loading and unloading.
- PDF invoice import for Bambu Lab and Amazon.

## 3.1.0-beta.1 (2026-07-09)

### Added

- Label designer with Code 128 and QR codes, PNG export and printing.
- Scanner with the browser's `BarcodeDetector` and manual entry.
- Duplicate finder and merge.

## 3.0.0-beta (July 2026)

The first web release, a port of the native app to PHP and vanilla JavaScript on Synology Web Station. The live database (383 items, 111 filaments, 276 locations) was copied from the Mac app on 2026-07-07.

- Dashboard, inventory list with search and filters, item details, add, edit and delete.
- Photos, locations tree, categories, activity log.
- JSON backup and CSV export.
- Desktop sidebar and phone bottom tabs, dark and light themes.

Versions 3.6 and 3.7 are not recorded in the project notes.

## Native app (2.0.0 and earlier)

A SwiftUI app for macOS and iOS with a Python FastAPI server on port 8742, about 22,000 lines. It needed the Mac awake and an Xcode build to run. The web edition replaced it and it was retired in 3.14.0.
