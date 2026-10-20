# openGym (personal fork)

My personal, self-hosted fork of [DuarteSantos8/openGym](https://github.com/DuarteSantos8/openGym),
for my own training and body-weight log. I use it on my phone as an installed web app. It isn't a
product, and I don't send changes back upstream. I'm letting it drift from upstream on purpose.

## License

openGym is AGPL-3.0 (`LICENSE`). `LICENSE`, `NOTICE.md` and `catalogue/media/NOTICE.md` stay in
the repo. The exercise media in `catalogue/media/` is licensed separately by Gym visual, not
under the AGPL. Running it privately for myself is fine. If it ever serves other people, I have
to publish my modified source.

## Running it

```sh
cp .env.example .env          # local only, never committed
# in .env: WEB_PORT=127.0.0.1:8080   (localhost only, not every interface)
docker compose up -d --build
```

Then open http://localhost:8080.

Always pass `--build`. Without it, compose may pull upstream's prebuilt `ghcr.io` images and run
those instead of my code. Set `WEB_PORT` in `.env`, not in a `docker-compose.override.yml`:
compose appends port lists, so the base `0.0.0.0` binding would stay.

**AI Coach:** off by default. The default `API_TARGET` builds the image without any AI runtime,
and `COACH_DISABLED=1` in `.env` is the kill switch. See `docs/AI_COACH.md`.

**Phone and passkeys:** passkeys need HTTPS on a real hostname. To set that up on the LAN, see
[docs/SELF_HOSTING_HTTPS.md](docs/SELF_HOSTING_HTTPS.md).

**Install on the phone:** open the HTTPS address in Safari (iPhone) or Chrome (Android), then
Share → **Add to Home Screen** (Chrome: ⋮ → **Add to Home screen** / **Install app**). It then
runs full-screen like an app.

## Tests

Node 22.

```sh
cd api      && npm ci --omit=optional && npm test
cd frontend && npm ci && npm test && npm run build
cd mcp      && npm ci && npm test
```

## Syncing from upstream (occasionally)

```sh
git fetch upstream
git switch -c sync/upstream-$(date +%Y%m%d) main
git merge upstream/main
# files I deleted that upstream changed show up as conflicts; keep them deleted:
git status --porcelain | awk '$1=="DU"{print $2}' | xargs git rm
```

Merge on a branch, then merge that into `main`. Never rebase.

## Never committed

The repo is public. These stay local only:

- `data/`: users, passkeys, workout and body-weight data, session secret, uploads
- `.env`: local config and secrets
- `coach-auth/`: AI Coach provider credential cache
- exports, backups, database dumps, Docker volumes
