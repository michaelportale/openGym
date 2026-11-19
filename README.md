# openGym

A self-hosted gym and body-weight tracker, forked from
[DuarteSantos8/openGym](https://github.com/DuarteSantos8/openGym).

## What I built

openGym is [Duarte Santos's project](https://github.com/DuarteSantos8/openGym), and this repository
is a fork of it. The parts below are mine and do not exist upstream:

- [`native/`](native): an iPhone app built with Expo and React Native.
  - Apple Health sync ([`native/src/health`](native/src/health)): writes finished workouts and
    weigh-ins to Apple Health and imports body-weight readings.
  - WHOOP ([`native/src/whoop`](native/src/whoop)): a card showing recovery, strain and recent cardio.
  - Training rules ([`native/src/science`](native/src/science)): warm-ups, rep ranges, effort and
    progression. Each rule has a matching entry in [`docs/science`](docs/science/README.md), and a
    test fails if the two differ.
- `api/whoop-client.js`, `api/whoop-vault.js`, `api/whoop-view.js` and the `/api/whoop` routes:
  WHOOP OAuth with rotating-token refresh, and each user's tokens kept in their own AES-256-GCM
  encrypted file.

`native/` has 2,596 tests: `cd api && npm ci --omit=optional`, then `cd native && npm ci && npm test`.

## Running it

```sh
cp .env.example .env
docker compose up -d --build
```

Then open http://localhost:8080. By default the app only listens on localhost
(`WEB_PORT=127.0.0.1:8080`); keep that unless you mean to expose it on your network. Settings
such as the port, `RP_ID` and `ORIGIN` live in `.env`; see `.env.example` for the full list.

Use `--build` so Compose builds the images from this repo instead of pulling the upstream ones.

The AI Coach is off by default. See [docs/AI_COACH.md](docs/AI_COACH.md) to turn it on.

## Using it on a phone

Passkey sign-in needs HTTPS on a real hostname, so set `RP_ID` and `ORIGIN` in `.env` to that
hostname (see [docs/SELF_HOSTING_HTTPS.md](docs/SELF_HOSTING_HTTPS.md)). Then open the address in
Safari or Chrome and choose **Add to Home Screen** to run it as an app.

## Tests

Requires Node 22.

```sh
cd api      && npm ci --omit=optional && npm test
cd frontend && npm ci && npm test && npm run build
cd mcp      && npm ci && npm test
```

## Documentation

See the [documentation index](docs/README.md) for user and hosting guides, and the
[engineering guide](docs/ENGINEERING.md) for architecture and development details.

## License

openGym is licensed under AGPL-3.0; see [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md). The exercise
media in `catalogue/media/` is licensed separately; see
[catalogue/media/NOTICE.md](catalogue/media/NOTICE.md).
