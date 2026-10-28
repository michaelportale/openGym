# openGym documentation

Pick the part that matches what you're doing. If you just have a question, try the
[FAQ](FAQ.md) first.

## Using the app

| Guide | Read it when |
|---|---|
| [FAQ](FAQ.md) | You have a quick question: iPhone, cost, where your data goes, AI, the exercise media |
| [Importing data](DATA_IMPORTS.md) | You're importing CSV, structured Markdown notes or Apple Health, or sharing a plan |
| [AI coach](AI_COACH.md) | Your instance has the coach switched on and you want to know what it sees and can change |

The [live demo](https://opengym.ch/demo/) is the real app with example data, nothing
to install.

## Hosting it

| Guide | Read it when |
|---|---|
| [Self-hosting](SELF_HOSTING.md) | You're setting up an instance. Start here: running it, passkeys and HTTPS, users, backups, updates, troubleshooting |
| [HTTPS at home](SELF_HOSTING_HTTPS.md) | You want valid certificates on your LAN without exposing the server to the internet |
| [AI coach](AI_COACH.md) | You're deciding whether to turn the coach on, and with which provider |
| [MCP server](../mcp/README.md) | You want Claude Desktop, Cursor or another AI client to read your training history |

All settings live in `.env`; [`.env.example`](../.env.example) explains each one, and the
[self-hosting guide](SELF_HOSTING.md) covers them in detail.

## Working on the code

| Guide | Covers |
|---|---|
| [Engineering guide](ENGINEERING.md) | Architecture, local development, workout data, training calculations and verification |
| [HTTP API](API.md) | Routes and the OpenAPI contract |
| [Data imports](DATA_IMPORTS.md) | Supported formats and import behavior |

## Still stuck?

Ask on the [Discord](https://discord.gg/e62jY6fwVb) or in
[Discussions](https://github.com/DuarteSantos8/openGym/discussions). If something in these docs was
wrong or missing, that's worth an issue too.
