# Roadmap

What's planned, in rough priority order. Open bugs and limits are described in [docs/known-issues.md](docs/known-issues.md). This file says what to do about them and what comes after.

Sizes are rough: S is under an hour, M is an afternoon, L is a full session or more.

## Now: fixes and housekeeping

| Item | Why | Size | Where |
|---|---|---|---|
| Release 3.15.0 | The code has moved past 3.14.0 (audit mode, item QR labels, several fixes) but the version number hasn't. | S | `scripts/bump-version.sh 3.15.0-beta`, then `scripts/deploy.sh` |
| Fix the "null" on the Duplicate Finder | Visible on every visit when nothing is hidden. | S | `web/js/duplicates.js` |
| Make the JSON backup complete | Restore currently loses import line details and doesn't bring back the activity log. | M | `web/api/backup.php`, smoke test |
| Re-check redirects in the scraper | A redirect can reach a home-network address. | S | `web/api/scrape.php` |
| Check the invoice name-spill report | Confirm whether two-line Bambu product names still leak into the next item, then close it or add a failing case to the harness. | S | `web/js/parsers.js`, `web/tests/parsers-harness.node.js` |
| Point the import error at GitHub issues | The message still mentions "the project doc". | S | `web/js/imports.js` |
| Re-import the two real invoices | Items imported before 3.8.0 still have parser mistakes and some `other` categories. SKU-first matching updates them in place. | S | On the live app |

## Next

| Item | Why | Size |
|---|---|---|
| Browser-level smoke test | The worst bugs so far (confirm dialogs, stale deploys, iOS layout) lived in the browser where the API smoke test can't see them. The screenshot tooling in `scripts/screenshots/` already seeds a demo instance and drives every screen with Playwright, so a test can build on it and run in CI. | M |
| Inventory pagination | The list stops at 1,000 items. Load pages as you scroll and keep search and filters on the server. | M |
| Lock down `data/` | The database, photos and attachments can be downloaded by URL. A Web Station access rule is the quick version; moving `data/` out of the web root is the thorough one. | S to M |
| Accessibility pass | Icon-only buttons need labels, emoji icons should be hidden from screen readers, and focus order and contrast need checking in both themes. | M |
| Precache heavy libraries in the background | So importing and scanning work offline even if they were never used online. Load them on idle after install. | S |
| Smart filters on custom fields, shared across devices | Filters are per device today and can't see custom fields. A small `settings` table would let them sync. | M |

## Later

| Item | Why | Size |
|---|---|---|
| User accounts with a PIN | Activity would say who changed what, and a login would allow exposing the app beyond the LAN. The `users` table and `user_id` columns already exist. Deliberately deferred in 3.13.0. | L |
| Faster duplicate finder | It compares every pair. Grouping by name tokens or SKU first would keep it fast past a few thousand items. | M |
| Smarter offline sync | Queue more kinds of writes (batch edits, printer slots) and detect conflicting edits instead of last-write-wins. | L |

## Shipped from earlier roadmaps

These were on past lists and are done: value and spending charts (3.9.0), custom fields and attachments (3.12.0), the API smoke test (3.12.0), pack pricing for inventory value (3.14.0), item QR codes, scanner audit mode, the label preset manager, location-tree QR printing, AMS unit management, the barcode generator, the item history link to the activity log, Git and CI, and scripted deploys.
