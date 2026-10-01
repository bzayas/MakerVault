# Hosting MakerVault on a Synology NAS via Web Station

This mirrors the Topps Binder deployment (`/Volumes/web/binder`), with one
important difference: **MakerVault's data lives server-side in SQLite**, not
in the browser. There is no IndexedDB and no sync layer — every device talks
to the same database on the NAS, so multi-device consistency is automatic.

---

## What you need on the NAS

Already installed for the binder project, listed for completeness:

1. **Web Station**
2. **Nginx or Apache** back-end
3. **PHP 8.x** — the API needs these extensions enabled in the PHP profile:
   - `pdo_sqlite` (database — REQUIRED)
   - `gd` (photo resize — required for photo uploads)
   - `exif` (photo auto-rotation — optional but recommended)

Check them in **DSM → Web Station → Script Language Settings → PHP →
(your profile) → Extensions**. `pdo_sqlite` and `gd` are usually available
but not always ticked by default.

## File layout on the NAS

```
/volume1/web/MakerVault/
├── index.html
├── css/app.css
├── js/                    ← SPA views (vanilla JS, no build step)
├── api/                   ← PHP endpoints
│   ├── _bootstrap.php     ← shared: PDO, schema init, helpers
│   ├── schema.sql         ← used only to create a fresh empty DB
│   ├── items.php  locations.php  categories.php
│   ├── dashboard.php  activity.php  photo.php
│   └── backup.php  health.php
├── data/
│   ├── makervault.db      ← THE database (383 items migrated from the Mac app)
│   └── photos/            ← item photos as <item-id>.jpg
└── docs/
```

`data/` is the only directory that changes at runtime. Everything else is
code you rsync from the dev copy.

## Web Station configuration

1. **Web Service**: DSM → Web Station → Web Service → **Create** → *PHP*
   (NOT static — the API is PHP).
   - Document root: `/volume1/web/MakerVault`
   - Back-end: Nginx
   - PHP profile: your PHP 8.x profile (with `pdo_sqlite` + `gd` enabled)
2. **Web Portal**: → Web Portal → **Create** → port-based, e.g. port
   **8742** (the port the old FastAPI server used — muscle memory friendly),
   or name-based if you have local DNS.
3. Apply, then hit `http://<nas-ip>:8742/api/health.php`. You want:
   ```json
   {"app":"MakerVault","status":"healthy", ..., "db_writable":true}
   ```

### HTTPS

As of Phase 5 MakerVault ships a service worker for offline support, and
service workers (plus camera scanning) only register on secure origins —
so **HTTPS is now the recommended way to use the app** (already configured
via the QuickConnect portal). Plain HTTP still works, just without offline
mode and the camera scanner.

After each deploy, bump BOTH the `?v=` cache busters in `index.html` AND
`MV_SW_VERSION` in `sw.js` — the service worker's cache name is how
installed apps learn a new version exists.

## Permissions

The API must be able to **write** `data/makervault.db` (and create
`-wal`/`-shm` journal files next to it) and `data/photos/`. If
`db_writable` is false in the health check, or writes fail with 500s, fix
ownership over SSH:

```bash
sudo chown -R bryan:http /volume1/web/MakerVault
sudo find /volume1/web/MakerVault -type d -exec chmod 775 {} \;
sudo find /volume1/web/MakerVault -type f -exec chmod 664 {} \;
```

(Directories need group-write for SQLite journal files, hence 775/664 here
versus the binder's read-only 755/644.)

## Updating the site

From the dev copy on the Mac:

```bash
cd /Users/bryan/Developer/MakerVault/web
rsync -av --exclude '.DS_Store' --exclude 'data/' ./ /Volumes/web/MakerVault/
```

**Always exclude `data/`** — the NAS database is live and authoritative once
deployed. Overwriting it with the dev copy loses real edits.

After JS/CSS changes, bump the `?v=` cache-buster query strings in
`index.html` so browsers pick up the new files.

## Data directory exposure (worth knowing)

Like the binder's `data/` files, `data/makervault.db` sits inside the web
root, so anyone on the LAN who knows the URL can download the database
directly (`http://<nas>:8742/data/makervault.db`). The photos are equally
reachable. `index.html` guard files prevent directory listing, but not
direct file access.

For a LAN-only beta this matches the binder's posture. If you expose the
portal to the internet or want to lock it down:

1. **DSM → Web Station → Web Portal → your portal → Access Control
   Profile** — create a profile that denies `/data/*` (except the API needs
   no exceptions; PHP reads the DB from the filesystem, not over HTTP), or
2. Restrict the whole portal by source IP to your LAN range.

## Backups

Three layers:

1. **Hyper Backup** the whole `/volume1/web/MakerVault` folder — that
   includes the SQLite DB and photos. This is the primary backup.
2. **Settings → Download JSON backup** in the app — full-fidelity export of
   every table; keep dated copies somewhere Hyper Backup covers.
3. **Settings → Download CSV** — spreadsheet-friendly items list.

SQLite runs in WAL mode; a file-level backup taken mid-write is *usually*
fine, but the JSON export is the guaranteed-consistent snapshot.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `api/health.php` returns raw PHP source | Service created as *Static site* | Recreate the Web Service as PHP |
| `could not find driver` in errors | `pdo_sqlite` not enabled | Tick it in the PHP profile's Extensions |
| Health says `"db_writable": false` | Ownership/permissions | Run the chown/chmod block above |
| Photo upload returns 500 | `gd` extension missing | Enable `gd` in the PHP profile |
| Site loads, "Cannot reach the MakerVault API" | PHP not bound, or data/ missing | Check health.php directly; check permissions |
| Sideways photos from phone | `exif` extension missing | Enable `exif`; re-upload |
| Stale UI after deploy | Old service worker still controlling | Since 3.5.2 the app self-updates: it re-checks sw.js on every launch/foreground and auto-reloads when a new version claims. Clients older than 3.5.2 need ONE manual hard-refresh (browser: Cmd/Ctrl+Shift+R; installed iOS app: swipe it away in the app switcher, reopen, wait a few seconds, reopen again) |

## Migrating data from the Mac app (already done 2026-07-07)

The web app uses the same SQLite schema as the FastAPI server. Migration was
a checkpoint-copy, not an export/import:

```bash
sqlite3 ~/Library/Application\ Support/MakerVault/makervault.db \
  ".backup '/Volumes/web/MakerVault/data/makervault.db'"
cp ~/Library/Application\ Support/MakerVault/photos/*.jpg \
  /Volumes/web/MakerVault/data/photos/
```

If you use the Mac app again afterwards, its database and the NAS database
will diverge — pick one as the source of truth (the NAS, going forward).
