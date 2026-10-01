# Development

How to run MakerVault locally, how the code is organized, how to test it and how to release it.

## Setup

You need:

- PHP 8 with `pdo_sqlite`, `gd` and `exif` (on a Mac: `brew install php`, which includes them)
- Node 18 or newer, for the JavaScript syntax check and the parser tests
- Python 3, used by the smoke test to read JSON
- `rsync` and `curl`

```sh
git clone https://github.com/bzayas/MakerVault.git
cd MakerVault
php -S 127.0.0.1:8743 -t web
```

Open http://127.0.0.1:8743. The first API request creates `web/data/makervault.db` from `web/api/schema.sql`. That local database is yours to break. It is gitignored and never deployed.

On the Mac the same server is defined in `.claude/launch.json` as `makervault-web`.

For realistic data, seed an empty instance with the demo dataset:

```sh
python3 scripts/screenshots/seed_demo.py http://127.0.0.1:8743
```

## Repository layout

```
MakerVault/
├── web/                     everything that gets deployed
│   ├── index.html           app shell and script tags (with ?v= cache busters)
│   ├── sw.js                service worker
│   ├── manifest.json        PWA manifest
│   ├── .user.ini            PHP upload limits for Web Station
│   ├── css/app.css          all styles
│   ├── js/                  one file per view or helper (see docs/frontend.md)
│   │   └── vendor/          pdf.js, ZXing, SheetJS, qrcode-generator
│   ├── api/                 one PHP file per resource (see docs/api.md)
│   ├── assets/              starter label templates, CyberBrick kits, Bambu Suite configs
│   ├── icons/               app icons
│   ├── tests/               smoke.sh, parsers-harness.node.js
│   └── data/                runtime data, gitignored, never deployed
├── scripts/
│   ├── check.sh             all checks (CI runs this)
│   ├── bump-version.sh      version bump in lockstep
│   ├── deploy.sh            deploy to the NAS
│   └── screenshots/         demo seeding and screenshot capture
├── docs/                    this documentation
└── .github/                 CI workflow, issue and PR templates
```

## Conventions

### Frontend

- No build step and no modules. Every file is a classic script that wraps its code in an IIFE and exposes one global (`API`, `UI`, `LabelGen`...) or registers `Views.<name>`.
- Build DOM with `UI.h()`. Don't use `innerHTML` with data, since item names can contain anything.
- New screens are objects with `render(main, params)` and, if they hold resources like a camera, `cleanup()`. Register them on `window.Views` and add a nav link in `index.html`.
- Server calls go through `API` in `js/api.js`. Add a method there rather than calling `fetch()` from a view.
- Large libraries load on demand (see `loadPdfJs()` in `imports.js` for the pattern) and live in `js/vendor/`.
- After changing categories or locations, call `App.refreshCategories()` or `App.refreshLocations()` so other views see the change.
- Every new script file must be added to `index.html` and to `SHELL_FILES` in `sw.js`, or it won't load offline.

### API

- One file per resource. Start with `require __DIR__ . '/_bootstrap.php';` and dispatch on `method()`.
- Return with `respond()` and stop with `fail('message', code)`. Messages are shown to the user, so write them for a person.
- Wrap multi-row changes in a transaction, and roll back on error.
- Log every change to items with `log_activity()`. Pick the most specific action (`quantityChanged` over `edited`).
- Return items through `item_shape()` / `rows_to_items()` so every endpoint gives the same shape.
- JSON keys are `snake_case`. JavaScript variables are `camelCase`.
- Declare top-level `const` values above the dispatch `switch`. PHP runs top-level code in order, so a constant declared further down doesn't exist yet when a handler runs.

### Database changes

Follow the four steps in [database.md](database.md#migrations): `schema.sql`, `ensure_column()`, the item shape and backup, and the docs.

### Versions

Three version markers must move together on every release: `MV_SW_VERSION` in `web/sw.js`, the `?v=N` busters in `web/index.html` and `MV_VERSION` in `web/api/_bootstrap.php`. Never edit them by hand:

```sh
scripts/bump-version.sh 3.15.0-beta   # busters and SW +1, MV_VERSION set
scripts/bump-version.sh               # busters and SW +1, MV_VERSION unchanged
scripts/bump-version.sh --check       # verify they agree
```

Why this matters is explained in [subsystems/offline-and-updates.md](subsystems/offline-and-updates.md#how-updates-reach-installed-copies).

## Testing

`scripts/check.sh` runs everything, in this order, and stops at the first failure:

| Step | What it checks |
|---|---|
| PHP lint | `php -l` on every file in `web/api/` |
| JavaScript syntax | `node --check` on every file in `web/js/` and `web/sw.js` |
| Version lockstep | `bump-version.sh --check` |
| API smoke test | `web/tests/smoke.sh`: copies `web/` to a temp folder, starts `php -S` on port 8799 with a fresh database and runs about 25 checks across items, custom fields, attachments (including path traversal), labels, import, reports, the scraper guard, backup and the duplicate finder |
| Parser harness | `web/tests/parsers-harness.node.js`: runs the real pdf.js and parsers against invoices in `web/data/samples/`. Those files are real invoices and not in git, so outside the Mac those cases are skipped. |

GitHub Actions runs the same script on every push to `main` and every pull request.

There are no automated browser tests yet. Before a release, click through the screens you changed, at desktop width and at phone width (about 400 × 875, an iPhone in Safari's responsive mode). Check the browser console for errors.

### Regenerating screenshots

```sh
# 1. a clean demo instance
rm -rf /tmp/mv-demo && mkdir /tmp/mv-demo && rsync -a --exclude data/ web/ /tmp/mv-demo/
php -S 127.0.0.1:8790 -t /tmp/mv-demo &
python3 scripts/screenshots/seed_demo.py http://127.0.0.1:8790

# 2. capture (needs Playwright: npm i -g playwright && npx playwright install chromium)
node scripts/screenshots/capture.mjs http://127.0.0.1:8790 docs/images
```

The demo data is made up. Never run the seed script against the live NAS.

## Release and deploy

```sh
git checkout -b my-change
# ...edit, then:
scripts/check.sh
scripts/bump-version.sh 3.15.0-beta
git commit -am "Describe the change"
git push -u origin my-change          # open a pull request; CI runs
# after merging:
git checkout main && git pull
scripts/deploy.sh --dry-run           # see what would change
scripts/deploy.sh
```

Add a section to [CHANGELOG.md](../CHANGELOG.md) for each release. `deploy.sh` tags the commit it deployed (`v3.15.0-beta-sw24`), so the tags show exactly what is live. Setup of the NAS itself is in [deployment.md](deployment.md).

## Working with AI assistants

Most of this code was written in sessions with Claude Code. [`CLAUDE.md`](../CLAUDE.md) at the repository root holds the short version of this page for those sessions. Keep it in sync when conventions change. Handoff notes between sessions belong in the changelog, known issues and roadmap, not in a separate notes file, so that there is one place to look.

## Writing documentation

The docs are written to be read quickly by someone who doesn't know the project yet. A few rules keep them that way:

- Say what something is or does, plainly. Prefer "is" and "has" over `serves as` or `features`.
- Be specific. Give the file name, the number, the exact behavior. Avoid claims about importance.
- Use sentence case for headings, straight quotes, and commas or parentheses instead of em dashes.
- Use bold rarely, and don't start list items with a bold label followed by a colon. Use a table when items share the same fields.
- Use tables for reference material and Mermaid diagrams for flows. GitHub renders both.
- Link to the code (`web/js/scanner.js`) and to other pages instead of repeating them.

`scripts/lint-docs.py` flags common filler words and patterns in the Markdown files (based on Wikipedia's "Signs of AI writing" guide). CI runs it as a warning that doesn't block merges. Run it after editing docs:

```sh
python3 scripts/lint-docs.py
```
