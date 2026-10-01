# MakerVault — Web Edition

Self-hosted inventory management for makers: filament, screws, hardware,
electronics, tools, and craft supplies across hierarchical physical storage
locations. This is the web port of the original SwiftUI macOS/iOS app,
rebuilt to run on Synology Web Station (same hosting pattern as the Topps
Binder project).

## Live site

Hosted on the Synology NAS via Web Station (see deployment doc for setup):

```
http://<nas-ip>:8742/        (or the portal you configured)
```

## Where the code lives

**Canonical hosted location:** `/Volumes/web/MakerVault/` (NAS via SMB —
`/volume1/web/MakerVault` on the NAS itself). Changes there are live on the
next page load.

**Local mirror / dev copy:** `/Users/bryan/Developer/MakerVault/web/`.
Develop and test here (`php -S 127.0.0.1:8743 -t web` from the repo root, or
the `makervault-web` entry in `.claude/launch.json`), then rsync to the NAS:

```bash
cd /Users/bryan/Developer/MakerVault/web
rsync -av --exclude '.DS_Store' \
  --exclude 'data/' \
  ./ /Volumes/web/MakerVault/
```

**Careful with `data/`** — once the NAS copy is live, the NAS database is the
source of truth. The rsync above excludes it. Only copy `data/` on first
deploy or when intentionally restoring.

## Architecture

- **Frontend** — static single-page app: `index.html`, `css/app.css`,
  vanilla JS in `js/` (no build step, no frameworks). Hash-based routing.
- **API** — PHP 8.x scripts in `api/`, one file per resource
  (`items.php`, `locations.php`, `categories.php`, `dashboard.php`,
  `activity.php`, `photo.php`, `backup.php`, `health.php`), sharing
  `_bootstrap.php` (PDO/SQLite, schema init, item serialization, activity
  log).
- **Database** — SQLite at `data/makervault.db`. Same schema as the original
  FastAPI server, so the database migrated from
  `~/Library/Application Support/MakerVault/` unchanged. Created from
  `api/schema.sql` automatically if missing.
- **Photos** — JPEG files at `data/photos/<item-id>.jpg`, resized server-side
  to max 1200px via PHP GD.

## Project docs

- [MAKERVAULT-WEB-PROJECT.md](MAKERVAULT-WEB-PROJECT.md) — authoritative
  project baseline: architecture, API reference, feature status, roadmap.
  **Read it before making changes.**
- [docs/SYNOLOGY-DEPLOYMENT.md](docs/SYNOLOGY-DEPLOYMENT.md) — Web Station +
  PHP setup, permissions, HTTPS, backups, troubleshooting.
- The original native-app project doc lives in the repo root as
  `MAKERVAULT_PROJECT.md` (SwiftUI + FastAPI — superseded for the web
  edition but still the reference for un-ported features).
