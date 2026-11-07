# Overnight merge watch

Running log of pulls merged into `native/phase-1` on the night of 6 November 2026. This pull request is a log only. Do not merge it.

- Last checked: 2026-11-06 21:52 EST
- `native/phase-1` head: `b973478fe795507e65f90dd5cfaaba39f215681f`
- Window: merges after `aac6bcc` (the #48 session-adapter merge), from #49 through the head above
- Lanes: session = Charlie, shell/screens = Gus, science = Bob
- Independent review below is this log's reading of the diff. `NOT YET REVIEWED` means that diff was not read. `Self-authored, not independent` means this lane wrote the pull request, so the reading is not a review. Charlie's review line is his comment, not this reading.

## Open findings

The first pass of this log said the #59 Node-import gap and the #62 journal gap were closed on the head at that time. Both of those are still closed. That is not a claim that nothing is open in Charlie's session lane. Two findings from Codex's audit [#65](https://github.com/michaelportale/openGym/pull/65) are open. Each stays `OPEN` until a fix pull request merges. When one does, link it here.

### F001 — finish can save without a set write that is still in flight

- Status: OPEN
- Severity: P1
- Lane: session (Charlie)
- Traces to: [#48](https://github.com/michaelportale/openGym/pull/48) (the public command wrapper) and [#54](https://github.com/michaelportale/openGym/pull/54) (finish)
- What Codex reproduced at `018621ed`: hold a set append, start `finishSession`, let the sender confirm, then release the append. Finish returns saved with that set missing, the journal is cleared, and the pending command then fails because the session is already null. The event is left behind.
- Still true on `b973478fe795507e65f90dd5cfaaba39f215681f`. `finishSession` does not share a queue with `call`. [#57](https://github.com/michaelportale/openGym/pull/57), [#62](https://github.com/michaelportale/openGym/pull/62), [#63](https://github.com/michaelportale/openGym/pull/63), [#64](https://github.com/michaelportale/openGym/pull/64), and [#66](https://github.com/michaelportale/openGym/pull/66) do not add one.
- Fix: none yet

### F002 — opening a session without `structuredClone` still fails

- Status: OPEN
- Severity: P2
- Lane: session (Charlie)
- Traces to: [#42](https://github.com/michaelportale/openGym/pull/42) (the journal fold) and [#54](https://github.com/michaelportale/openGym/pull/54) (the payload-only test)
- What Codex reproduced at `018621ed`: delete `globalThis.structuredClone` before opening a populated session. Open returns an error. `fold.js` clones with `structuredClone`. The #54 test removes the global only after the session is already opened, committed, and finished, then checks `toWorkoutPayload`.
- Still true on `b973478fe795507e65f90dd5cfaaba39f215681f`. `native/src/session/fold.js` still calls `structuredClone`. [#66](https://github.com/michaelportale/openGym/pull/66) uses that clone when an exercise is added.
- Fix: none yet

## Merges

### #49 — [native: hide TODO populations on Why this](https://github.com/michaelportale/openGym/pull/49)

- Merged commit: `ff5314246abd96d03a256faa082be36f8682dc95`
- Resulting `native/phase-1` head: `e28c151057ed162f74a24fe84bcf46534353e385`
- Lane: science (Bob)
- Summary: A TODO or blank population is left off the Why-this payload and sheet, and `programRepRange` keeps the stored range instead of filling 8-12.
- Tests claimed at merge: native `npm test`, 20 files, 178 passed (body predates the rep-range commit).
- Review status: Reviewed by Charlie at `ff5314246abd96d03a256faa082be36f8682dc95`. Self-authored, not independent

### #51 — [native: cite a PR on every Phase 4 status row](https://github.com/michaelportale/openGym/pull/51)

- Merged commit: `936450a6625779cb414e3e54bcfa91a355675cbd`
- Resulting `native/phase-1` head: `ab318c8302ec2202c85da6287f74a14403b3bdf0`
- Lane: science (Bob)
- Summary: The Phase 4 status checklist names a PR on every done-when row.
- Tests claimed at merge: native `npm test`, 29 files, 228 passed.
- Review status: Reviewed by Charlie at `936450a6625779cb414e3e54bcfa91a355675cbd`. Self-authored, not independent

### #53 — [native: ship no weekly set target](https://github.com/michaelportale/openGym/pull/53)

- Merged commit: `91d34abdbd511413f1512df551702679b820a586`
- Resulting `native/phase-1` head: `798e33731d2ac721a35b73cd4020449220d9332d`
- Lane: science (Bob)
- Summary: `weeklyVolumeTarget` returns null, so no weekly set count ships.
- Tests claimed at merge: native `npm test`, 30 files, 229 passed.
- Review status: Reviewed by Charlie at `91d34abdbd511413f1512df551702679b820a586`. Self-authored, not independent

### #50 — [native: show a glyph when SF Symbols are not drawn](https://github.com/michaelportale/openGym/pull/50)

- Merged commit: `a89cbb6a749d7834e49143e32132316008dab7bb`
- Resulting `native/phase-1` head: `3ce543c29789a1357395d8710bad5757398f9791`
- Lane: shell/screens (Gus)
- Summary: Off iOS, symbol buttons draw a text glyph instead of an empty SF Symbol.
- Tests claimed at merge: native `npm test` on `a89cbb6a`, 30 files, 231 tests, exit 0.
- Review status: Reviewed by Charlie at `a89cbb6a749d7834e49143e32132316008dab7bb`. Independent findings: the diff stays in `native/src/ui`, two workout rows, and the phase-1 decisions note. No lockfile change, no secrets, no `node:` import in app code (`node:fs` is only in the test). Unknown names throw on every platform, including iOS. [#59](https://github.com/michaelportale/openGym/pull/59) later lets iOS accept an unmapped name.

### #52 — [native: lock react-dom to 19.3.0](https://github.com/michaelportale/openGym/pull/52)

- Merged commit: `7fe440582187a5715751a6dce5724c0b35d22e82`
- Resulting `native/phase-1` head: `6d53231c943ec63bea07f4ea69a42603fbe7cb10`
- Lane: native lockfile (not session, shell, or science)
- Summary: `react-dom` in `native/package-lock.json` moves from 19.3.1 to 19.3.0 so it matches the pinned `react`.
- Tests claimed at merge: native `npm test`, 29 files, 227 tests, exit 0.
- Review status: Reviewed by Charlie at `7fe440582187a5715751a6dce5724c0b35d22e82`. Independent findings: the only file is `native/package-lock.json`. `react-dom` moves from 19.3.1 to 19.3.0, the tarball is `registry.npmjs.org`, the integrity hash changes, and the peer range becomes `^19.3.0`. `package.json` is not in the diff. No secrets and no app source.

### #54 — [native: finish a session into the stored workout](https://github.com/michaelportale/openGym/pull/54)

- Merged commit: `a83bf3df57ade15298cd54de6f025c7000b7b42f`
- Resulting `native/phase-1` head: `89896e2f7cbd5947c67a9332979a16a26197a7da`
- Lane: session (Charlie)
- Summary: Finishing a session writes the workout through an injected sender and copies the payload with JSON so Hermes can run it.
- Tests claimed at merge: `npm run verify`, 31 files, 238 tests passed.
- Review status: Reviewed by Charlie at `a83bf3df57ade15298cd54de6f025c7000b7b42f` (an earlier review at `cc7f8dd9469ac51d3f8dcf2a6d2ecb97259a62f6` had asked for the JSON copy). Independent findings: scope is `native/src/session` only. No lockfile change, no secrets, no `node:` import. The JSON copy is only in `toWorkoutPayload`. The test deletes `structuredClone` after the session is already sealed, so it does not cover open. See F002. `finishSession` does not wait for an in-flight `call`, so a set append still in flight can be left out of the save. See F001. If `storage.clear()` throws after the sender confirms, the session stays open and a later finish calls the sender again. The workout id is the same.

### #55 — [native: cover rounding, bar edges, RIR bounds, and migration idempotence](https://github.com/michaelportale/openGym/pull/55)

- Merged commit: `ee0ac2191630d1182ccc5fa5f2d827fb1b6c48f7`
- Resulting `native/phase-1` head: `bc048de7f6d13b592ddfc6fb043fa5f6c932ca4f`
- Lane: science (Bob)
- Summary: Tests lock kilogram versus pound warm-up rounding, the bar boundary, RIR 0 through 10, and a second migration call.
- Tests claimed at merge: native `npm test`, 30 files, 233 passed.
- Review status: Reviewed by Charlie at `ee0ac2191630d1182ccc5fa5f2d827fb1b6c48f7`. Self-authored, not independent

### #56 — [native: list science defaults that still need a source](https://github.com/michaelportale/openGym/pull/56)

- Merged commit: `a60b614f615ebfc2fddd2cede1f4c114dff2cb81`
- Resulting `native/phase-1` head: `cedf78762265239573a70af344c3b946f81bdfcc`
- Lane: science (Bob)
- Summary: `docs/science/sources-needed.md` lists weekly sets, deload, Epley, rest, and increments without citing a study.
- Tests claimed at merge: native `npm test`, 32 files, 247 passed.
- Review status: Reviewed by Charlie at `a60b614f615ebfc2fddd2cede1f4c114dff2cb81`. Self-authored, not independent

### #58 — [native: science standup brief for 6 November](https://github.com/michaelportale/openGym/pull/58)

- Merged commit: `e8db45ab978d3840299f9b815b7c1e43b07db4cd`
- Resulting `native/phase-1` head: `f1ce4da256de41574759f9530f414ff434be9923`
- Lane: science (Bob)
- Summary: One-page standup brief of the science lane, including #56 as merged.
- Tests claimed at merge: native `npm test`, 32 files, 247 passed.
- Review status: Reviewed by Charlie at `e8db45ab978d3840299f9b815b7c1e43b07db4cd`. Self-authored, not independent. The brief says 80 lb on a 5 lb step is 30 and 60. The case tested in #55, with a 45 lb bar, is 45 and 60. 30 is under that bar. That sentence is still in `docs/science/overnight-2026-11-06.md` on this head.

### #57 — [native: store each finished workout by id and date](https://github.com/michaelportale/openGym/pull/57)

- Merged commit: `4564a9a884a5de12ee61885dc2ed2d1a6f080ed9`
- Resulting `native/phase-1` head: `007604ae8141e131051bb7d1b021f0ffae4fc08c`
- Lane: session (Charlie)
- Summary: Finished workouts are one SQLite row per id, upserted on conflict, with an index on the date.
- Tests claimed at merge: `npm run verify`, 33 files, 250 tests passed.
- Review status: Reviewed by Charlie at `4564a9a884a5de12ee61885dc2ed2d1a6f080ed9`. Independent findings: scope is `native/src/session` only. Statements are parameterized. The same id upserts. No `expo-sqlite` import, no lockfile change, no secrets. A crash after `put` and before `storage.clear()` leaves the journal in place. [#62](https://github.com/michaelportale/openGym/pull/62) later drops that journal when the finished row exists. Writing the row does not serialize finish with an in-flight set command. F001 stays open.

### #59 — [native: let iOS draw a symbol that has no text glyph](https://github.com/michaelportale/openGym/pull/59)

- Merged commit: `417dd1a01141b09bb7b237fe4e232c210dd9bf84`
- Resulting `native/phase-1` head: `ec479cb5c3f9fa4d0e2f9b346bedc86b55c0f1bd`
- Lane: shell/screens (Gus)
- Summary: iOS accepts any non-empty SF Symbol name. Other platforms still throw when the text map has no glyph.
- Tests claimed at merge: native `npm test`, 33 files, 252 tests, exit 0.
- Review status: Reviewed by Charlie at `417dd1a01141b09bb7b237fe4e232c210dd9bf84`. Independent findings: `native/src/ui/symbol-names.js` imports `node:fs`, `node:module`, and `node:path` and loads Babel, inside the app tree Metro bundles. No lockfile or dependency change, no secrets, and the other edits stay in `native/src/ui` plus the phase-1 decisions note. A whitespace-only name passes the length check on iOS. #61 later moves this scanner out of the app tree.

### #60 — [native: wire finished workouts through the session hook](https://github.com/michaelportale/openGym/pull/60)

- Merged commit: `52b745a1ad3f8004dc5755de0d05298c4368ee13`
- Resulting `native/phase-1` head: `9588390959770fed53b05e3248a3e989f3a650e1`
- Lane: session (Charlie)
- Summary: A `db` passed to the session hook becomes the SQLite journal and the finished-workout store, unless the caller already passed those.
- Tests claimed at merge: `npm run verify`, 34 files, 262 tests passed.
- Review status: Reviewed by Charlie at `52b745a1ad3f8004dc5755de0d05298c4368ee13`. Independent findings: the diff is only `use-active-session.js` and its test. No Node imports, no lockfile change, no secrets. The new behavior is tested through `sessionOptionsFrom` and a fake SQLite database. The React hook itself is checked by reading its source string, not by rendering it. Options are still taken from the first render, which the file already stated.

### #61 — [native: keep the symbol scanner out of the app tree](https://github.com/michaelportale/openGym/pull/61)

- Merged commit: `488412950a387c33b094115c990b1af0c0e1973b`
- Resulting `native/phase-1` head: `5b658dab174248f942233718021b245946fd7b32`
- Lane: shell/screens (Gus)
- Summary: The symbol-name scanner moves from `native/src/ui` to `native/scripts`, and a test rejects `node:` imports in app source.
- Tests claimed at merge: native `npm test`, 34 files, 261 tests, exit 0.
- Review status: Reviewed by Charlie at `488412950a387c33b094115c990b1af0c0e1973b`. Independent findings: this is a git rename plus a scan-root check that the root directory is named `src`. The new test walks bundleable app files and fails if one imports `symbol-names` or a `node:` module. No lockfile change, no secrets, no session or science edits. On the current head, `node:` does not appear under `native/src`.

### #62 — [native: replay an open journal and skip a finished one](https://github.com/michaelportale/openGym/pull/62)

- Merged commit: `7a7bd371e8f0217396e0290f9a70d2d2b9828242`
- Resulting `native/phase-1` head: `b7d2d249645787d27b620a2bf96711aa892b7069`
- Lane: session (Charlie)
- Summary: Opening a session drops a journal whose id is already in finished workouts, and replays one that is not.
- Tests claimed at merge: `npm run verify`, 35 files, 267 tests passed.
- Review status: Reviewed by Charlie at `7a7bd371e8f0217396e0290f9a70d2d2b9828242`. Independent findings: scope is `native/src/session` only. No Node imports, no lockfile change, no secrets. Tests cover a partial draft, a duplicate event id, a different finished id, and a repeat open of a finished id. An unfinished stored journal was still ignored when the incoming base id was already finished. #63 changes that.

### #63 — [native: restore an unfinished journal ahead of a finished base](https://github.com/michaelportale/openGym/pull/63)

- Merged commit: `259de62280a20ad5323e84d5caa42281a0ce85df`
- Resulting `native/phase-1` head: `018621ed6905d36e52baccfb18353bb813d88272`
- Lane: session (Charlie)
- Summary: An unfinished stored journal is restored even when the incoming base is a different finished workout.
- Tests claimed at merge: `npm run verify`, 35 files, 270 tests passed.
- Review status: Reviewed by Charlie at `259de62280a20ad5323e84d5caa42281a0ce85df`. Independent findings: the diff is `recovery.js` and its test. A stored journal that is not finished is opened before the incoming base can close the screen. The new tests also replay a running rest, an expired rest that does not complete a set, and a paused rest that stays frozen. No Node imports, no lockfile change, no secrets, no files outside `native/src/session`.

### #64 — [native: edit and delete a committed set](https://github.com/michaelportale/openGym/pull/64)

- Merged commit: `f36421bfe361da786aefd9a9cbe71ed7890994c1`
- Resulting `native/phase-1` head: `946f9f4b43357d049727874725aa297a9fe6c066`
- Lane: session (Charlie)
- Summary: A committed set can be edited or removed. The last set in an exercise cannot be removed, including when the journal is replayed.
- Tests claimed at merge: `npm run verify`, 36 files, 274 tests passed.
- Review status: Reviewed by Charlie at `f36421bfe361da786aefd9a9cbe71ed7890994c1`. Independent findings: edits stay in `native/src/session` (`fold.js`, `session.js`, `use-active-session.js`, and a new test). No Node imports, no lockfile change, no secrets. `removeSet` refuses an unknown id and the last set before appending. After finish, `#append` returns `finished`, and the test checks that refusal. A replay test keeps a removed set gone. The fold also ignores a remove that would empty an exercise.

### #66 — [native: add and remove an exercise mid-session](https://github.com/michaelportale/openGym/pull/66)

- Merged commit: `2d62bdc6e936c843fe982e0cc4219a0b3dc9c206`
- Resulting `native/phase-1` head: `b973478fe795507e65f90dd5cfaaba39f215681f`
- Lane: session (Charlie)
- Summary: An exercise can be added or removed during the session. An added exercise starts with its sets unticked. Replay keeps both the add and the remove.
- Tests claimed at merge: `npm run verify`, 37 files, 277 tests passed.
- Review status: Reviewed by Charlie at `2d62bdc6e936c843fe982e0cc4219a0b3dc9c206`. Independent findings: the diff is `fold.js`, `session.js`, `use-active-session.js`, and a new test. No lockfile change, no secrets, no `node:` import, no files outside `native/src/session`. A duplicate id is refused, and a crafted `done: true` on the incoming sets is cleared by the fold. Removing the last exercise is allowed, and finish then saves an empty entry list. The test covers that. Charlie noted it as a follow-up. This pull request does not close F001 or F002.

## Open pulls into `native/phase-1`

- [#65](https://github.com/michaelportale/openGym/pull/65) — draft, `docs: overnight PR audit for November 6–7`. Not merged. The F001 and F002 entries above are taken from that audit. The rest of its ledger is not this log's review.
- [#67](https://github.com/michaelportale/openGym/pull/67) — draft, this log. Not merged. Do not merge it.
- [#68](https://github.com/michaelportale/openGym/pull/68) — draft, `native: correct the standup warm-up bar example`. Docs only. Changes the 80 lb example so a 5 lb step with a 45 lb bar is 45 and 60. Not merged. Self-authored, not independent.
