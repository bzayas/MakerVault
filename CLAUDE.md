# MakerVault: notes for coding sessions

Self-hosted workshop inventory. Vanilla JS single-page app (`web/js/`), PHP 8 API (`web/api/`), one SQLite database (`web/data/makervault.db`, gitignored). Runs on Synology Web Station. No build step, no framework, no npm dependencies.

Read before changing things: [docs/architecture.md](docs/architecture.md). Open problems: [docs/known-issues.md](docs/known-issues.md). Plan: [ROADMAP.md](ROADMAP.md).

## Commands

```sh
php -S 127.0.0.1:8743 -t web          # local server (fresh DB in web/data/ on first request)
scripts/check.sh                      # lint, version check, API smoke test, parser harness (CI runs this)
scripts/bump-version.sh 3.x.y-beta    # every release: SW version, ?v= busters, MV_VERSION together
scripts/deploy.sh --dry-run           # deploy to the NAS (Mac only)
python3 scripts/lint-docs.py          # docs style check
```

## Rules

- Never touch `data/` on the NAS. It is the live database. Never commit databases, backups or invoices: the repo is public.
- Never edit `MV_SW_VERSION`, the `?v=` busters or `MV_VERSION` by hand. Use `scripts/bump-version.sh`. Installed clients only update when the service worker version changes.
- Add every new JS file to `web/index.html` and to `SHELL_FILES` in `web/sw.js`.
- Add a new column to `schema.sql` and as an `ensure_column()` call in `_bootstrap.php`, then to `item_shape()` and `backup.php` if relevant. See [docs/database.md](docs/database.md#migrations).
- Build DOM with `UI.h()`, never `innerHTML` with data. Call the server through `API` in `js/api.js`.
- In PHP, wrap multi-row writes in a transaction, log item changes with `log_activity()`, return items via `item_shape()`, and declare top-level `const` above the dispatch `switch`.
- Stock value is always `purchase_price / MAX(1, pack_quantity) * quantity`. Don't add a second formula.
- After changing `web/js/parsers.js`, run `node web/tests/parsers-harness.node.js`.
- Check phone width (about 400 px) for any UI change.
- Update the docs in the same change (`docs/api.md`, `docs/database.md`, `docs/user-guide.md`, the Unreleased section of `CHANGELOG.md`, `docs/known-issues.md`), whichever apply.

## Where things are

| Need | File |
|---|---|
| Router, boot, shared caches | `web/js/app.js` |
| Fetch wrapper, offline outbox | `web/js/api.js` |
| DOM helper, modals, toasts | `web/js/ui.js` |
| PDO, migrations, item shape | `web/api/_bootstrap.php` |
| Label rendering | `web/js/labelgen.js` |
| Invoice parsing | `web/js/parsers.js` |
| Service worker | `web/sw.js` |
| Endpoint reference | `docs/api.md` |
| Module reference | `docs/frontend.md` |
