# web/

This folder is the whole deployed app: the files here are copied to `/volume1/web/MakerVault` on the NAS by `scripts/deploy.sh`. Everything except `data/` is under version control.

- Start with the [project README](../README.md).
- How the code is organized: [docs/architecture.md](../docs/architecture.md), [docs/frontend.md](../docs/frontend.md), [docs/api.md](../docs/api.md).
- Never copy `data/` between machines by hand. On the NAS it holds the live database.
