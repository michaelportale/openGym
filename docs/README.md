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

| Guide | Read it when |
|---|---|
| [CLAUDE.md](../CLAUDE.md) | You want the architecture in one page (written for Claude Code, useful for people too) |
| [HTTP API](API.md) | You're touching routes; the OpenAPI spec is the source of truth |

Design notes for specific features, kept next to the code they describe:

| Note | Covers |
|---|---|
| [Set types](dev/SET_TYPES.md) | Drop sets and rest-pause: the set-row model and how totals are counted |
| [Workout views](dev/LIST_VIEW.md) | The cards, list and compact layouts of the workout screen |
| [Combine routines](dev/COMBINE_ROUTINES.md) | Spec for running more than one routine in a session |
| [Personal strength policy](dev/PERSONAL_STRENGTH_POLICY.md) | Coverage accounting, effort suggestions, duration assumptions and evidence limits |
| [Personal strength acceptance](dev/PERSONAL_STRENGTH_ACCEPTANCE.md) | Verified local behavior, release checks and the open installed-iPhone gate |
| [Fitbod research](dev/FITBOD_RESEARCH.md) | Installed-artifact findings and unverified runtime behavior |

## Still stuck?

Ask on the [Discord](https://discord.gg/e62jY6fwVb) or in
[Discussions](https://github.com/DuarteSantos8/openGym/discussions). If something in these docs was
wrong or missing, that's worth an issue too.
