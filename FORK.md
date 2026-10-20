# openGym: personal fork

This is Michael Portale's personal, self-hosted fork of
[DuarteSantos8/openGym](https://github.com/DuarteSantos8/openGym). I use it for my own
training and body-weight log. It isn't a product, and it isn't a contribution effort.

## License

openGym is licensed under AGPL-3.0. `LICENSE` and `NOTICE.md` stay intact. Running it
privately for myself is fine. If it ever serves other people, my modified source has to be
published.

## Running it

```sh
cp .env.example .env   # untracked; fill in real values locally
docker compose up -d
```

Set `WEB_PORT=127.0.0.1:8080` in `.env` so the app listens on localhost only, not on every
interface. Don't use a `docker-compose.override.yml` for this. Compose appends port lists,
so the base `0.0.0.0` binding would survive the override.

## Syncing from upstream

```sh
git fetch upstream
git switch -c sync/upstream-$(date +%Y%m%d) main
git merge upstream/main
```

Merge on a branch and never rebase pushed history.

## Never committed

The fork is public. These stay local only:

- `data/`: users, passkeys, workout and body-weight data, session secret, uploads
- `.env`: local config and secrets
- `coach-auth/`: AI Coach provider credential cache

Exports, database dumps, and Docker volumes are never committed either.
