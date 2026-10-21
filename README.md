# openGym

A self-hosted gym and body-weight tracker, forked from
[DuarteSantos8/openGym](https://github.com/DuarteSantos8/openGym).

## Running it

```sh
cp .env.example .env
docker compose up -d --build
```

Then open http://localhost:8080. Settings such as the port, `RP_ID` and `ORIGIN` live in `.env`;
see `.env.example` for the full list.

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

## License

openGym is licensed under AGPL-3.0; see [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md). The exercise
media in `catalogue/media/` is licensed separately; see
[catalogue/media/NOTICE.md](catalogue/media/NOTICE.md).
