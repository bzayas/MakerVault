# Known issues

Open bugs and known limits, as of October 2026. When one is fixed, move it to [CHANGELOG.md](../CHANGELOG.md) and delete it here. Bigger planned work lives in [ROADMAP.md](../ROADMAP.md).

## Bugs

### Duplicate Finder shows the word "null"

When no groups are hidden as "not duplicates", the Duplicate Finder prints `null` above the list (visible in the [screenshot](images/duplicates.png)).

Cause: `refresh()` in `web/js/duplicates.js` passes `hiddenBar` to `listEl.replaceChildren()`, and `hiddenBar` is `null` when there is nothing hidden. `UI.h()` skips null children, but the browser's own `replaceChildren()` turns `null` into the text "null".

Fix: drop the null before the call, for example `listEl.replaceChildren(...[hiddenBar].filter(Boolean), ...groups.map(groupCard))`, and the same in the empty-state branch.

### Backup and restore

The JSON backup is not a complete copy, and restoring one loses some data even on the same server.

| Data | In the backup? | After a restore |
|---|---|---|
| Items, filament and tool data, locations, categories, printers, slots, label templates, presets | Yes | Replaced from the file |
| Activity log | Yes | Not loaded. The server's current log is kept and the file's log is ignored. Restoring onto a new install starts with an empty history. |
| Import batches and their line details | No | `import_batch_items` is deleted. `import_batches` rows stay, with no lines attached. |
| Duplicate dismissals, barcode counters | No | Left as they were |
| Photos, attachments | No (they are files) | Left as they were |

Until this is fixed, treat a Hyper Backup of the whole `/volume1/web/MakerVault` folder as the real backup, and the JSON file as a convenience. Fixing it means exporting the missing tables in `web/api/backup.php`, restoring them in the same transaction, and adding a round-trip check to the smoke test.

### Invoice names spilling across items (needs checking)

Before the 3.8.0 parser rewrite, Bambu Lab products with two-line names could leak the second line into the next item. The rewrite anchors items on the bold product-name font and the notes record the fix, but an October 2026 handoff still listed it as open. Re-import a real invoice that has wrapped product names, compare against the order page, and either close this or add the invoice to the parser harness as a failing case.

### Version number behind the code

`MV_VERSION` still says 3.14.0-beta, although audit mode, item QR labels and several fixes were added since (see the Unreleased section of the changelog). The next release should run `scripts/bump-version.sh 3.15.0-beta`.

### Stale wording in the import error

When a PDF has no recognizable lines, the Import screen says to "open an issue in the project doc". It should point to GitHub issues now (`web/js/imports.js`).

## Security and privacy

MakerVault is built for a trusted home network, and these gaps were accepted on that basis. They matter if the portal is ever opened to the internet.

| Gap | Detail | Mitigation |
|---|---|---|
| No login | Anyone who can reach the site can view and change everything. The `users` table exists from the native app but isn't used. | Keep the portal LAN-only or behind the Synology firewall. User accounts are on the roadmap. |
| `data/` is inside the web root | `makervault.db`, photos and attachments can be downloaded directly by URL. Directory listing is blocked, file access is not. | Add a Web Station access control rule denying `/data/*` (PHP reads the files from disk, so nothing breaks), or move `data/` outside the web root. |
| Scraper follows redirects without re-checking | `scrape.php` checks that the first address isn't private, then follows up to five redirects. A public URL that redirects to a LAN address gets through. It also only checks IPv4. | Turn off automatic redirects and follow them in PHP, checking each target. |
| Public repository | The GitHub repo is public. `web/data/` is gitignored, but take care never to commit a database, invoice or backup file. | `.gitignore` covers `web/data/`. Check `git status` before committing. |

## Limits

| Area | Limit |
|---|---|
| Inventory list | The list requests 1,000 items and the server caps responses at 1,000. Past that, the extra items silently don't appear. Pagination is on the roadmap. |
| Duplicate finder | Compares every pair of items, so it slows down with the square of the inventory size. Fine at a few hundred items. |
| Offline edits | Only single-item edits are queued. No conflict detection: the last write to reach the server wins. |
| Offline viewing | Caches are cleared on every deploy, so after an update a screen has to be opened online once before it works offline. pdf.js, ZXing and SheetJS are only cached after first use, so importing or scanning on iOS offline fails if it was never done online. |
| Camera | Needs HTTPS. Over plain HTTP only typed codes work. Flashlight control depends on the device (mostly Android Chrome). |
| Smart filters | Saved per device in `localStorage`, not shared. They can't filter on custom fields. |
| Reports | Items whose purchase date isn't `YYYY-MM-DD` (some older imports) are left out of the monthly chart. |
| URL import | Amazon pages are often blocked. Bambu filament pages have no part-number SKU, so filament imported by URL has a blank SKU. |
| Activity log | Doesn't record who made a change. `user_id` is always empty. |
| Photos | One photo per item. Use attachments for more. |

## Development and deploy quirks

- The service worker can serve old files during local testing. See [subsystems/offline-and-updates.md](subsystems/offline-and-updates.md#testing-changes-without-fighting-the-cache).
- If `rsync` fails with `io_read_flush` while `/Volumes/web` looks mounted, the SMB connection is stale. `scripts/deploy.sh` force-unmounts and remounts once on its own. If it still fails, run `diskutil unmount force /Volumes/web` and reconnect in Finder.
- On the Mac, processes other than Finder (including AI assistants run from Terminal) may be blocked from writing to the SMB share by macOS privacy settings. Mounting the share from Finder first avoids it.
- Don't use `IMG_BICUBIC` when resizing photos in PHP. Some GD builds produce broken output with it.
- Top-level `const` declarations in a PHP endpoint must come before the request dispatch `switch`, or the handlers can't see them.
- There are no browser-level tests. `scripts/check.sh` covers PHP lint, JavaScript syntax, the API smoke test and the parser harness. The parser harness needs real invoices in `web/data/samples/`, which are not in git, so in CI those cases are skipped.
- The macOS-specific parts of `scripts/deploy.sh` (mounting the share, `diskutil`) can only run on the Mac. CI and the Linux test of the script covered everything else.
