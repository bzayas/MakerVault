# MakerVault documentation

Start with the page that matches what you're doing.

| If you want to | Read |
|---|---|
| Use the app | [user-guide.md](user-guide.md) |
| Understand how it works | [architecture.md](architecture.md), then [frontend.md](frontend.md), [api.md](api.md) and [database.md](database.md) |
| Change labels, imports, scanning or offline behavior | [subsystems/](subsystems/) |
| Set up a development copy, test and release | [development.md](development.md) |
| Install it on a Synology NAS | [deployment.md](deployment.md) |
| Know what's broken or limited | [known-issues.md](known-issues.md) |
| See what's planned | [../ROADMAP.md](../ROADMAP.md) |
| See what changed, and why | [../CHANGELOG.md](../CHANGELOG.md) and [history.md](history.md) |

## All pages

```
docs/
├── README.md                 this index
├── user-guide.md             every screen, with screenshots
├── architecture.md           the whole system on one page
├── frontend.md               every file in web/js/
├── api.md                    every endpoint in web/api/
├── database.md               tables, columns, migrations, backups
├── subsystems/
│   ├── labels.md             label engine, printing, Bambu Suite .lac export
│   ├── importing.md          invoice PDFs, product URLs, kits, BOM checker
│   ├── scanning.md           camera engines, code formats, audit mode
│   └── offline-and-updates.md service worker, offline edits, releases
├── development.md            local setup, conventions, tests, releases
├── deployment.md             Synology Web Station setup and operations
├── known-issues.md           open bugs, security gaps, limits
├── history.md                how the project got here, notable bugs
├── images/                   screenshots (regenerate with scripts/screenshots/)
└── archive/
    └── project-notes-2026-07.md  the original session handoff notes, unedited
```

## Keeping the docs current

Update the docs in the same commit as the code they describe. The usual places:

| Change | Update |
|---|---|
| New or changed endpoint | [api.md](api.md) |
| New column or table | [database.md](database.md), including the migrations table |
| Anything a user would notice | [user-guide.md](user-guide.md), plus a new screenshot if the screen looks different |
| Any release | [../CHANGELOG.md](../CHANGELOG.md) |
| A bug found but not fixed | [known-issues.md](known-issues.md) |

Writing guidelines and the docs check are in [development.md](development.md#writing-documentation).
