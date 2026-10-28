# FAQ

Short answers, with a link to the long one.

### What does it cost?

Nothing. openGym is open source under the AGPL: no subscription, no paid tier, no ads. If you'd like
to support it anyway, there's [Buy Me a Coffee](https://buymeacoffee.com/duartesantos).

### Do I need my own server?

A self-hosted instance provides profiles and synchronization between devices. Follow the
[self-hosting guide](SELF_HOSTING.md) to build and run this repository with Docker Compose.
The [upstream demo](https://opengym.ch/demo/) can be used to try the application with example data.

### Can I use it on a phone?

Yes. Open your instance over HTTPS in Safari or Chrome and use **Add to Home Screen**.
This repository targets the web/PWA installation and does not include native Android or iOS
project directories. See [HTTPS setup](SELF_HOSTING_HTTPS.md).

### Where is my data?

On a self-hosted instance, in the `./data` folder next to `docker-compose.yml`: one JSON file per
profile plus the account list. Back up that folder and you've backed up everything. In guest mode it's only in that browser. You can export
everything as one file at any time under **Settings → Data & backup**.

### Does the app send anything anywhere?

Your instance has no telemetry and phones home to nobody. The exercise pictures and animations ship
inside the web image, so not even those are downloaded. The AI coach, if an admin turns it on, sends
the training data it needs to the provider you configured; [AI_COACH.md](AI_COACH.md) lists exactly
what. Push notifications go through your browser's push service, as all web push does.

### Does the app itself use AI?

Only if you turn it on. The default install calls no AI service. Two optional pieces exist: the
[AI coach](AI_COACH.md) (off until an admin enables it, runs with your own provider key, every
change needs your approval) and the [MCP server](../mcp/README.md), which lets an AI client on your
computer read your history. Neither is needed for anything else in the app.

### My passkey sign-in doesn't work.

Almost always one of two things:

1. You're opening it over plain `http://` on a LAN address. Passkeys only work over HTTPS (or on
   `localhost`). Use guest mode, turn on password sign-in, or put it behind HTTPS.
2. `RP_ID` and `ORIGIN` in `.env` don't match the address in your browser exactly.

[SELF_HOSTING.md](SELF_HOSTING.md#2-understand-the-passkey-requirement-important) explains both, and
its troubleshooting section covers the rarer cases.

### Can I use a password instead of a passkey?

Yes, if the instance allows it: set `PASSWORD_LOGIN=1`. It's off by default. See
[password sign-in](SELF_HOSTING.md#password-sign-in-optional).

### Can several people use one instance?

Yes. Everyone creates their own profile and sees only their own data. You can make signup
invite-only and give yourself an admin dashboard; see
[multiple users](SELF_HOSTING.md#4-multiple-users).

### How do I update?

`git pull --ff-only && docker compose up -d --build`. Your data is untouched. See
[updating](SELF_HOSTING.md#8-updating).

Then update the app on every device that syncs. A phone still on v1.3.9 or older keeps syncing,
and the server looks after what that phone doesn't know about, but it can't always tell what the
phone has seen. One case it gets wrong on purpose: if the old phone sets something back to exactly
what it was before, after another device changed it, the other device's change wins. Once every
device is updated, nobody has to guess.

### I'm moving from another app. Can I bring my history?

FitNotes, Strong and Hevy work out of the box, Apple Health for body weight, and any CSV with a date,
an exercise and something measured. See [DATA_IMPORTS.md](DATA_IMPORTS.md).

### Can I reuse the exercise images in my own project?

No. They are © Aliaksandr Makatserchyk, Gym visual, licensed for use in openGym only and not covered
by openGym's license. Anything outside openGym needs your own licence from
[gymvisual.com](https://gymvisual.com/). Details in [NOTICE.md](../NOTICE.md). The exercise text in
[catalogue/](../catalogue/README.md) is a different story: that's openGym's, and fixes are welcome.

### Where do I ask something that isn't here?

The [Discord](https://discord.gg/e62jY6fwVb) for a quick answer,
[Discussions](https://github.com/DuarteSantos8/openGym/discussions) if the next person should be
able to find it, [Issues](https://github.com/DuarteSantos8/openGym/issues) for a bug.
