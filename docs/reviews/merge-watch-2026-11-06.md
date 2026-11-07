# Overnight merge watch

Running log of pulls merged into `native/phase-1` on the night of 6 November 2026. This pull request is a log only. Do not merge it.

- Last checked: 2026-11-06 23:42 EST (~11:42 PM ET)
- `native/phase-1` head: `5fb455fc2d8f3acd86ee536c1dec892c855b01c5`
- Native `npm test` at `f66609519231c03800aaec05faee11bc738f2fcf`: 37 files, 281 passed, no failures. This check did not re-run the suite.
- Window: merges after `aac6bcc` (the #48 session-adapter merge), from #49 through the head above
- Lanes: session = Charlie, shell/screens = Gus, science = Bob
- Independent review below is this log's reading of the diff. `NOT YET REVIEWED` means that diff was not read. `Self-authored, not independent` means this lane wrote the pull request, so the reading is not a review. Charlie's review line is his comment, not this reading.

## Open findings

The first pass of this log said the #59 Node-import gap and the #62 journal gap were closed on the head at that time. Both of those are still closed. F001 and F002, from Codex's audit [#65](https://github.com/michaelportale/openGym/pull/65), were open in Charlie's session lane. Both were checked again on `f66609519231c03800aaec05faee11bc738f2fcf` and are closed. On that head, `open`, `call`, and `finishSession` still return `enqueue(...)`, and `native/src/session` still has no `structuredClone(` call. This pass did not re-read the controller.

Codex updated [#65](https://github.com/michaelportale/openGym/pull/65) twice after the previous line of this log. `2e25de35` at 23:10 EST audits through merge #88 and adds N001. `9048c1b1` at 23:38 EST audits through merge #97, marks F003 fixed by [#91](https://github.com/michaelportale/openGym/pull/91), and leaves N001 open. No new audit file is on `native/phase-1`. The new Codex comment is on [#86](https://github.com/michaelportale/openGym/pull/86) at 23:11 EST and is N001. Comments on #89 through #98 are Charlie's, plus an overnight review on #98 that names no finding id. The 23:38 pass adds no new finding id. #98 merged at 23:40 EST, after that pass.

### F001 — finish can save without a set write that is still in flight

- Status: CLOSED
- Severity: P1
- Lane: session (Charlie)
- Traces to: [#48](https://github.com/michaelportale/openGym/pull/48) (the public command wrapper) and [#54](https://github.com/michaelportale/openGym/pull/54) (finish)
- What Codex reproduced at `018621ed`: hold a set append, start `finishSession`, let the sender confirm, then release the append. Finish returns saved with that set missing, the journal is cleared, and the pending command then fails because the session is already null. The event is left behind.
- Checked on `f66609519231c03800aaec05faee11bc738f2fcf`. `open`, `call`, and `finishSession` all return `enqueue(...)`. The tail is one promise chain, and a rejection does not drop the later commands. The test `finish waits for a pending set commit before it saves and clears the journal` holds the append, starts finish, then releases it. It expects the commit to save, one sender call, volume 300, and one saved set.
- Fix: [#69](https://github.com/michaelportale/openGym/pull/69)

### F002 — opening a session without `structuredClone` still fails

- Status: CLOSED
- Severity: P2
- Lane: session (Charlie)
- Traces to: [#42](https://github.com/michaelportale/openGym/pull/42) (the journal fold) and [#54](https://github.com/michaelportale/openGym/pull/54) (the payload-only test)
- What Codex reproduced at `018621ed`: delete `globalThis.structuredClone` before opening a populated session. Open returns an error. `fold.js` cloned with `structuredClone`. The #54 test removed the global only after the session was already opened, committed, and finished, then checked `toWorkoutPayload`.
- Checked on `f66609519231c03800aaec05faee11bc738f2fcf`. `native/src/session` has no `structuredClone(` call. `fold.js` copies with `JSON.parse(JSON.stringify(...))`, and so do the session draft get/put, the memory storage, and `buildCompletedWorkout` in `frontend/src/lib/finish-workout.js`. The test `the session opens, drafts, commits, finishes, and reopens when structuredClone is missing` deletes the global before `open` and leaves it absent through draft, commit, finish, and reopen.
- Fix: [#70](https://github.com/michaelportale/openGym/pull/70)

### F003 — copied per-side sets arrive already completed

- Status: CLOSED
- Severity: P2
- Lane: session (Charlie)
- Traces to: [#42](https://github.com/michaelportale/openGym/pull/42) (`set.add`) and [#66](https://github.com/michaelportale/openGym/pull/66) (`exercise.add`)
- What Codex reported: both add paths set only `row.done = false`. A copied per-side row can keep `sides.L.done` or `sides.R.done`. `hasCompletedWork` reads those limb flags, so the new row counts before any `set.commit`. Codex reproduced 1 completed set, 10 reps, and 200 load-reps at merge #72 and again at merge #79 (`8bfbf93e`). Finishing then keeps that exercise because the finished document keeps an entry whose sets have completed work.
- Checked on `1521ab7b70390100012b428eba2a03c880c66522`. Confirmed, at that head. `set.add` builds the row with `mergeFields` and then sets `row.done = false`. `exercise.add` clones each incoming set, deletes `id`, and sets `row.done = false`. Neither path calls `clearDone`. `clearDone` already sets both limb flags false, and `set.undo` uses it. `hasCompletedWork` is true for a side set when either limb is done. `projectSession` adds that row to the totals. `buildCompletedWorkout` keeps an entry when `sets.some(hasCompletedWork)`. #80 through #88 do not edit those add cases.
- Checked again on `5fb455fc2d8f3acd86ee536c1dec892c855b01c5`. Closed. `set.add` and `exercise.add` both pass the new row through `clearDone`, which sets `row.done` false and both limb flags false. A side set counts only when a limb flag is still true, so the copied row no longer counts. #92, #94, #95, and #96 still call `clearDone` on both add paths. `syncSideDone` derives `row.done` from the limb flags and does not turn those flags back on. Codex's 23:38 pass (`9048c1b1`) also marks this fixed, with a six-case probe at #91, #95, and #97. This reading agrees. This pass did not re-run that probe.
- Fix: [#91](https://github.com/michaelportale/openGym/pull/91)

### V001 — historical clean install failed on the React peer lock

- Status: CLOSED
- Severity: not a current defect
- Lane: native lockfile
- Traces to: [#43](https://github.com/michaelportale/openGym/pull/43) and the same lock at [#42](https://github.com/michaelportale/openGym/pull/42), [#46](https://github.com/michaelportale/openGym/pull/46), and [#47](https://github.com/michaelportale/openGym/pull/47)
- What Codex reported: `npm ci` at #43 head `80d9eca` fails with ERESOLVE because the lock selects `react-dom@19.3.1` while the manifest pins `react@19.3.0`. [#52](https://github.com/michaelportale/openGym/pull/52) is the later repair. Codex says a clean install at merge #77 succeeds.
- Checked from the #52 entry already in this log. That diff is only `native/package-lock.json`, and `react-dom` moves from 19.3.1 to 19.3.0. This pass did not re-run `npm ci` at the old head. The finding is the historical install, and #52 is already merged.
- Fix: [#52](https://github.com/michaelportale/openGym/pull/52)

### N001 — the SQLite fake treats a JSON array extract as text

- Status: OPEN, partly addressed
- Severity: P3
- Lane: session (Charlie), test double
- Traces to: [#86](https://github.com/michaelportale/openGym/pull/86)
- What Codex reported: the fake and the comments say a bare `json_extract` is text and `json_set` stores it as a quoted string, so only an extra `json()` wrap keeps the trail an array. Codex ran the pre-wrapper upsert at `1a3a0ed7` on SQLite 3.50.0 and the trail stayed an array. The comment on [#86](https://github.com/michaelportale/openGym/pull/86) at 23:11 EST is this finding. The 23:38 pass says real SQLite contract tests now pass, and the fake and the comments are still wrong. It also says this log repeated the quoting claim.
- Checked on `5fb455fc2d8f3acd86ee536c1dec892c855b01c5`. Confirmed. `fake-sqlite.js` still stringifies an array trail unless the SQL text matches a `json()` wrap. The comments in that file and in `sqlite-storage.js` still say a bare extract is text. Node's SQLite 3.53.4 on this machine evaluates `json_set('{}', '$.trail', json_extract('{"trail":[10,20]}', '$.trail'))` to `{"trail":[10,20]}` with JSON type array. The same call with bound text `'[10,20]'` stores a JSON string. [#90](https://github.com/michaelportale/openGym/pull/90) and [#93](https://github.com/michaelportale/openGym/pull/93) keep the `json()` wrap and the comment. Neither changes the fake's unwrapped case. The #86 entry below used to state the quoting claim as fact. That sentence now points here. The wrapped production statement is not a demonstrated failure. N001 stays open.
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
- Review status: Reviewed by Charlie at `a83bf3df57ade15298cd54de6f025c7000b7b42f` (an earlier review at `cc7f8dd9469ac51d3f8dcf2a6d2ecb97259a62f6` had asked for the JSON copy). Independent findings: scope is `native/src/session` only. No lockfile change, no secrets, no `node:` import. The JSON copy is only in `toWorkoutPayload`. The test deletes `structuredClone` after the session is already sealed, so it does not cover open. See F002, closed by [#70](https://github.com/michaelportale/openGym/pull/70). `finishSession` does not wait for an in-flight `call`, so a set append still in flight can be left out of the save. See F001, closed by [#69](https://github.com/michaelportale/openGym/pull/69). If `storage.clear()` throws after the sender confirms, the session stays open and a later finish calls the sender again. The workout id is the same.

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
- Review status: Reviewed by Charlie at `e8db45ab978d3840299f9b815b7c1e43b07db4cd`. Self-authored, not independent. The brief said 80 lb on a 5 lb step is 30 and 60. The case tested in #55, with a 45 lb bar, is 45 and 60. [#68](https://github.com/michaelportale/openGym/pull/68) corrected that sentence. On this head it reads 45 and 60.

### #57 — [native: store each finished workout by id and date](https://github.com/michaelportale/openGym/pull/57)

- Merged commit: `4564a9a884a5de12ee61885dc2ed2d1a6f080ed9`
- Resulting `native/phase-1` head: `007604ae8141e131051bb7d1b021f0ffae4fc08c`
- Lane: session (Charlie)
- Summary: Finished workouts are one SQLite row per id, upserted on conflict, with an index on the date.
- Tests claimed at merge: `npm run verify`, 33 files, 250 tests passed.
- Review status: Reviewed by Charlie at `4564a9a884a5de12ee61885dc2ed2d1a6f080ed9`. Independent findings: scope is `native/src/session` only. Statements are parameterized. The same id upserts. No `expo-sqlite` import, no lockfile change, no secrets. A crash after `put` and before `storage.clear()` leaves the journal in place. [#62](https://github.com/michaelportale/openGym/pull/62) later drops that journal when the finished row exists. Writing the row does not serialize finish with an in-flight set command. F001 stayed open until [#69](https://github.com/michaelportale/openGym/pull/69).

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
- Review status: Reviewed by Charlie at `2d62bdc6e936c843fe982e0cc4219a0b3dc9c206`. Independent findings: the diff is `fold.js`, `session.js`, `use-active-session.js`, and a new test. No lockfile change, no secrets, no `node:` import, no files outside `native/src/session`. A duplicate id is refused, and a crafted `done: true` on the incoming sets is cleared by the fold. Removing the last exercise is allowed, and finish then saves an empty entry list. The test covers that. Charlie noted it as a follow-up. [#71](https://github.com/michaelportale/openGym/pull/71) refuses that removal. This pull request does not close F001 or F002. Those are closed later by [#69](https://github.com/michaelportale/openGym/pull/69) and [#70](https://github.com/michaelportale/openGym/pull/70).

### #68 — [native: correct the standup warm-up bar example](https://github.com/michaelportale/openGym/pull/68)

- Merged commit: `bb2486889304d6e835b9a96028b41b9ab1022dbc`
- Resulting `native/phase-1` head: `d053d46a271e0dcca9dde578dc233a78b0ae9662`
- Lane: science (Bob)
- Summary: The standup brief now says 80 lb on a 5 lb step with a 45 lb bar is 45 and 60.
- Tests claimed at merge: none. The change is one sentence in `docs/science/overnight-2026-11-06.md`.
- Review status: Reviewed by Charlie at `bb2486889304d6e835b9a96028b41b9ab1022dbc`. Self-authored, not independent

### #69 — [native: serialize session commands ahead of finish](https://github.com/michaelportale/openGym/pull/69)

- Merged commit: `549db024a8c1ece2376dee13be9e06bf84ca9a17`
- Resulting `native/phase-1` head: `3c4e769f2fc711848d8da72e4d4f3193ca8f1434`
- Lane: session (Charlie)
- Summary: `open`, `call`, and `finishSession` share one promise queue, so finish waits for a set write that has already started.
- Tests claimed at merge: `npm run verify`, 37 files, 280 tests passed.
- Review status: Reviewed by Charlie at `549db024a8c1ece2376dee13be9e06bf84ca9a17`. Independent findings: the diff is `session-controller.js` and its test. No lockfile change, no secrets, no `node:` import, no files outside `native/src/session`. `enqueue` runs the next task from the same tail whether the previous one fulfilled or rejected. The pending-append test holds `storage.append`, starts finish, then releases, and expects volume 300 and one saved set. A second finish during a held sender is covered and calls the sender once. This is the F001 fix. Checked again on the current head.

### #70 — [native: copy session documents without structuredClone](https://github.com/michaelportale/openGym/pull/70)

- Merged commit: `dbd045e60aea1e6aa732ef0e8294cb031ad4771c`
- Resulting `native/phase-1` head: `ba2da913b9d64f62bc85842b569d983a0a9f3311`
- Lane: session (Charlie)
- Summary: Session copies, including the fold, use a JSON round-trip so a missing `structuredClone` does not fail open.
- Tests claimed at merge: `npm run verify`, 37 files, 277 tests passed. Frontend `finish-workout.test.js`: 1 file, 28 tests passed.
- Review status: Reviewed by Charlie at `dbd045e60aea1e6aa732ef0e8294cb031ad4771c`. Independent findings: `fold.js`, `session.js`, `storage.js`, and the compatibility test stay in `native/src/session`. The same replacement also edits `frontend/src/lib/finish-workout.js`, which is outside the session directory and on the path `fold.js` calls for the finished document. No lockfile change and no secrets. On `f666095` there is no `structuredClone(` call under `native/src/session` or in that shared helper. The test deletes the global before `open`. A JSON copy drops values that are not JSON. The new test uses plain objects. This is the F002 fix.

### #71 — [native: keep at least one exercise in a live session](https://github.com/michaelportale/openGym/pull/71)

- Merged commit: `c00a9a07a8423f17f8fe077267ff1596b1c343ec`
- Resulting `native/phase-1` head: `f66609519231c03800aaec05faee11bc738f2fcf`
- Lane: session (Charlie)
- Summary: Removing the last exercise is refused, including when the journal is replayed. A workout with no completed sets can still finish.
- Tests claimed at merge: `npm run verify`, 37 files, 278 tests passed.
- Review status: Reviewed by Charlie at `c00a9a07a8423f17f8fe077267ff1596b1c343ec`. Independent findings: the diff is `session.js`, `fold.js`, and `exercise.test.js`. No lockfile change, no secrets, no `node:` import, no files outside `native/src/session`. `removeExercise` returns `last-exercise` before appending, and the fold ignores an `exercise.remove` that would leave no entries. The test checks that the refused event is not stored, and a smuggled event leaves the last exercise in place. Finishing with zero completed sets stays allowed.

### #72 — [native: keep a failed discard from throwing the session away](https://github.com/michaelportale/openGym/pull/72)

- Merged commit: `304b8fde1a31237e0a35ebe9916346dd618bbaad`
- Resulting `native/phase-1` head: `bf57f13e9e8f750fe76e33f020bdc41d52e128af`
- Lane: session (Charlie)
- Summary: A discard whose `clear()` throws returns a storage failure and leaves the journal in place. Finishing a discarded session does not call the sender.
- Tests claimed at merge: `npm run verify`, 37 files, 283 tests passed.
- Review status: Reviewed by Charlie at `304b8fde1a31237e0a35ebe9916346dd618bbaad`. Independent findings: the diff is `session.js`, `session-controller.js`, and their tests. No lockfile change, no secrets, no `node:` import, no files outside `native/src/session`. In-memory events, drafts, and the base are cleared only after `clear()` resolves. The controller returns `discarded` before it builds a payload. A separate SQLite `clear()` could still delete one table and then throw. [#73](https://github.com/michaelportale/openGym/pull/73) puts those deletes in one transaction.

### #73 — [native: clear the session journal in one SQLite transaction](https://github.com/michaelportale/openGym/pull/73)

- Merged commit: `dc5e109bc140888daf41095d16e4333d33722310`
- Resulting `native/phase-1` head: `f363420b7c2d032021827eff6dd179c2276df84c`
- Lane: session (Charlie)
- Summary: SQLite `clear()` runs `BEGIN`, the three deletes, and `COMMIT` as one script, and rolls back if that script throws.
- Tests claimed at merge: `npm run verify`, 37 files, 284 tests passed.
- Review status: Reviewed by Charlie at `dc5e109bc140888daf41095d16e4333d33722310`. Independent findings: the diff is `sqlite-storage.js` and `storage-contract.test.js` only. No lockfile change, no secrets, no `node:` import. The new test fails the drafts delete and checks that the event, the draft, and the base all remain, then a later append still works. The `catch` always runs `ROLLBACK` and then rethrows. If the script throws before a transaction exists, that `ROLLBACK` can itself throw and hide the original error. The in-memory driver does not throw on a bare `ROLLBACK`, so this suite does not show that case. Charlie left it as a follow-up. [#75](https://github.com/michaelportale/openGym/pull/75) guards that `ROLLBACK` and rethrows the original error.

### #74 — [native: record a session note in the journal](https://github.com/michaelportale/openGym/pull/74)

- Merged commit: `72810bca064ee6757858216bd85e7661f2081aa0`
- Resulting `native/phase-1` head: `8a71a1affebe78588e319d5ea0cf01673e68ed60`
- Lane: session (Charlie)
- Summary: A session note is a journal event. The last note wins, a blank note clears it, and finish copies the note onto the workout.
- Tests claimed at merge: `npm run verify`, 38 files, 287 tests passed.
- Review status: Reviewed by Charlie at `72810bca064ee6757858216bd85e7661f2081aa0`. Independent findings: the diff is `fold.js`, `session.js`, `use-active-session.js`, and a new test. No lockfile change, no secrets, no `node:` import, no files outside `native/src/session`. A non-string note is refused with `bad-note` before append. `#append` still refuses a discarded or finished session. The fold ignores a non-string note and deletes `base.note` when the text is blank after trim. Tests cover a duplicate event id, SQLite replay, and the controller. The fixture notes are short phrases, not personal training data.

### #75 — [native: keep a clear failure and cap a session note](https://github.com/michaelportale/openGym/pull/75)

- Merged commit: `e8644e5c3e10f5884e856d53043da83002267bfa`
- Resulting `native/phase-1` head: `3e7198db5b4c724d9b1b6eba7bb674aa09c8a54b`
- Lane: session (Charlie)
- Summary: A failed journal clear still rejects with the original error when `ROLLBACK` also throws. A session note longer than 2000 characters is refused.
- Tests claimed at merge: `npm run verify`, 38 files, 291 tests passed.
- Review status: Reviewed by Charlie at `e8644e5c3e10f5884e856d53043da83002267bfa`. Independent findings: the diff stays in `native/src/session`. No lockfile change, no secrets, no `node:` import. `clear()` catches a throwing `ROLLBACK` and rethrows the original error. One test makes `ROLLBACK` throw `no transaction`, and another makes it throw `rollback failed`. Both expect the rejection to be `locked`. `setNote` refuses `note.length > 2000` before append, and the test checks the long event is not stored. This closes the #73 rollback follow-up.

### #76 — [native: record an exercise note in the journal](https://github.com/michaelportale/openGym/pull/76)

- Merged commit: `817e22a759b42e1192761632279e7e76ee7f5dcf`
- Resulting `native/phase-1` head: `f9d7bc96fa6a54fa69ab00f91d92695a87f6643a`
- Lane: session (Charlie)
- Summary: An exercise note is a journal event. A later note keeps a pin unless the note is blank, which drops both.
- Tests claimed at merge: `npm run verify`, 38 files, 294 tests passed.
- Review status: Reviewed by Charlie at `817e22a759b42e1192761632279e7e76ee7f5dcf`. Independent findings: the diff is `fold.js`, `session.js`, `use-active-session.js`, and `note.test.js`. No lockfile change, no secrets, no `node:` import. A non-string note, a note over 2000 characters, an unknown exercise, and a non-boolean pin are refused before append. A finished or discarded session falls through to `#append`, which refuses it. The fold leaves an omitted pin alone, clears a pin set to false, and deletes the note and the pin when the text is blank. Tests cover a duplicate event id, finish, and SQLite replay. The fixture text is a short phrase.

### #77 — [Keep the session time zone so a killed overnight journal refuses a silent finish](https://github.com/michaelportale/openGym/pull/77)

- Merged commit: `bbcbf31526b87f533604e3f098128fab3f4dfd99`
- Resulting `native/phase-1` head: `8fb678a4d07eb245583cfb64eb3e0ef0517588db`
- Lane: session (Charlie)
- Summary: The zone the session started in is stored with the journal, so a later boot that passes UTC still treats a killed overnight session as overnight.
- Tests claimed at merge: `npm run verify`, 38 files, 297 tests passed.
- Review status: Reviewed by Charlie at `bbcbf31526b87f533604e3f098128fab3f4dfd99`. Independent findings: the diff stays in `native/src/session`. No lockfile change, no secrets, no `node:` import. The zone is stored as `_sessionTimeZone` and stripped by `readBase` and `toActive`. The test opens the next morning with UTC, expects the New York zone and `overnight`, refuses a finish with no end, and checks the saved workout has neither `_sessionTimeZone` nor `timeZone`. A journal stored before this field adopts the zone of the first boot that finds it. In this pull request, rewriting the base without a zone drops the stored zone. [#78](https://github.com/michaelportale/openGym/pull/78) keeps it.

### #78 — [Keep the stored session time zone when the base is rewritten](https://github.com/michaelportale/openGym/pull/78)

- Merged commit: `14af0bb48420c78b7d022771739b50a7e0cfa1d6`
- Resulting `native/phase-1` head: `cd4388378be7f6772589888e2f4a4bd35cee3d65`
- Lane: session (Charlie)
- Summary: Rewriting the journal base without a time zone keeps the zone already stored. An explicit string replaces it, and an empty string clears it.
- Tests claimed at merge: `npm run verify`, 38 files, 299 tests passed.
- Review status: Reviewed by Charlie at `14af0bb48420c78b7d022771739b50a7e0cfa1d6`. Independent findings: the diff is `storage.js`, `sqlite-storage.js`, and the storage contract test. No lockfile change, no secrets, no `node:` import. Memory and SQLite both use `timeZoneForWrite`. The contract test rewrites the base with no options and still reads `America/New_York`. SQLite reads the old body and then writes the new one without a transaction. Charlie notes the controller queue serializes that access. This closes the #77 rewrite gap.

### #79 — [Leave a short overnight gap out of session elapsed](https://github.com/michaelportale/openGym/pull/79)

- Merged commit: `83b26f7a0797fd46c551bf7f851680b7bd1d67cf`
- Resulting `native/phase-1` head: `8bfbf93e7ae36e7ea3817228d05773c9cae423a5`
- Lane: session (Charlie)
- Summary: A short return across local midnight no longer adds those idle hours to elapsed, including after a kill and after resume. A set logged across midnight still counts.
- Tests claimed at merge: `npm run verify`, 38 files, 298 tests passed. That count is this branch's suite, not the combined head.
- Review status: Reviewed by Charlie at `83b26f7a0797fd46c551bf7f851680b7bd1d67cf`. Independent findings: the diff is `timing.js`, `fold.js`, and `session.test.js`. No lockfile change, no secrets, no `node:` import. A resume stamp moves the high-water mark and adds nothing for the gap before it. Samples and the open tail drop a span that changes local date. A journal stamp that is not a resume still adds a gap of at most four hours, so the test's 23:40 to 00:10 set adds 30 minutes. The idle case, 23:10 to 01:10, stays at the elapsed time from before the gap, through a reopen and a resume. Ten minutes after resume are counted.

### #80 — [Keep the session timer counting through a rest that crosses midnight](https://github.com/michaelportale/openGym/pull/80)

- Merged commit: `c12bce2b78de05cbb785abc455f9c9f3c228a9d0`
- Resulting `native/phase-1` head: `7bf4b352115d9728e8ae0175b9a8cf02b46564af`
- Lane: session (Charlie)
- Summary: A cross-midnight rest, sample, or resume counts when the gap is within `REST_MAX_MS`. A longer overnight return still adds nothing.
- Tests claimed at merge: `npm run verify`, 38 files, 301 tests, `check:shared` clean.
- Review status: Reviewed by Charlie at `c12bce2b78de05cbb785abc455f9c9f3c228a9d0`. Independent findings: the diff is `timing.js` and one test in `session.test.js`. No lockfile change, no secrets, no `node:` import. A sample or open tail is dropped only when the gap is longer than `REST_MAX_MS` and the local date changes. A resume gap longer than `REST_MAX_MS` adds nothing, and a shorter one counts. The test expects 23:50 to 00:05 to add the rest maximum, a later idle look at 00:30 to keep the 23:59 sample, and 23:50 to 00:06 to add nothing. Samples in this pull request still live only in the open process. [#82](https://github.com/michaelportale/openGym/pull/82) stores the last counted instant.

### #81 — [Treat a replayed pause, cancel, or resume as a duplicate](https://github.com/michaelportale/openGym/pull/81)

- Merged commit: `0eae2259173762ed7dca325ee58b3ac20ea690c4`
- Resulting `native/phase-1` head: `02cef12aafa041e2b9d1f85d89e46fa6afddc068`
- Lane: session (Charlie)
- Summary: A repeated pause, cancel, or resume id is a duplicate even after the rest is gone or the session is no longer overnight.
- Tests claimed at merge: `npm run verify`, 38 files, 301 tests, `check:shared` clean.
- Review status: Reviewed by Charlie at `0eae2259173762ed7dca325ee58b3ac20ea690c4`. Independent findings: the diff is `session.js` and one test. No lockfile change, no secrets, no `node:` import. `pauseRest` and `cancelRest` return duplicate before the rest check. `resume` still returns `discarded` and `finished` before the duplicate check, then `not-overnight`. The test pauses twice, reopens and pauses again, cancels twice, and resumes twice. The journal keeps one `session.resume`. The rest stays paused across the replayed pause and stays null after the replayed cancel.

### #83 — [Fold the JSON document so a restart shows the same row](https://github.com/michaelportale/openGym/pull/83)

- Merged commit: `81a97565dce8a77de1465dde3217c47702cd26b5`
- Resulting `native/phase-1` head: `ad1bb3471318216a177031aa57e8cb75f4fc1c7b`
- Lane: session (Charlie)
- Summary: `#append` stores the JSON document it writes, so `NaN` and `undefined` cannot make the live row differ from the replayed row.
- Tests claimed at merge: `npm run verify`, 38 files, 303 tests, `check:shared` clean.
- Review status: Reviewed by Charlie at `81a97565dce8a77de1465dde3217c47702cd26b5`. Independent findings: the diff is `session.js` and one test. No lockfile change, no secrets, no `node:` import. The seen check still runs first. The JSON copy is inside the `try`, and that object is what `storage.append` and the in-memory event list receive. A value JSON cannot copy fails as `storage` and is not pushed. The test commits `{ w: NaN, r: 5, bar: undefined }` and expects the reopened weight, bar, and load-reps to match the live view. It does not assert that the stored weight is null.

### #82 — [Keep the last counted instant so a kill cannot rewind the timer](https://github.com/michaelportale/openGym/pull/82)

- Merged commit: `83f612ecd0b64b3bd3a5c800a39ac3e48cd097be`
- Resulting `native/phase-1` head: `d688cd77eed450333944dd4a2b7857f9969ad18a`
- Lane: session (Charlie)
- Summary: The latest instant the timer counted is stored on the base. The next open seeds it as a sample, so a kill during a short midnight rest does not drop that rest.
- Tests claimed at merge: `npm run verify` on `83f612ec`, 38 files, 307 tests, `check:shared` clean.
- Review status: Reviewed by Charlie at `83f612ecd0b64b3bd3a5c800a39ac3e48cd097be`. Independent findings: the diff stays in `native/src/session`. No lockfile change, no secrets, no `node:` import. `putLastSeen` on SQLite is one `UPDATE ... json_set`. `view()` does not write. `noteSeen()` skips a write inside 15 seconds, and `flushSeen()` forces one. Finish and discard flush before clear. `readBase` and `toActive` strip `_sessionLastSeen`, and the kill test expects the reopened base to omit that key. The 00:05 stamp plus a 00:30 reopen counts the 25 minutes. A reopen that never flushed the short rest stays at the logged elapsed. In this pull request, `writeBase` still reads the body and writes it back, so a stamp saved during that replace can be lost. [#86](https://github.com/michaelportale/openGym/pull/86) copies the stamp inside the statement. A failed `putLastSeen` is swallowed, and the queued instant is cleared so a later note can try again.

### #84 — [Replay a set event as a duplicate after the set is gone](https://github.com/michaelportale/openGym/pull/84)

- Merged commit: `e17b91bf4bedb37b7fe510f4f38599aabbb93c8d`
- Resulting `native/phase-1` head: `fdb229b25e885133d5276c20b5e75641126891ec`
- Lane: session (Charlie)
- Summary: `commitSet`, `editSet`, and `undoSet` treat a seen id as a duplicate before they check that the set still exists.
- Tests claimed at merge: `npm run verify`, 38 files, 304 tests, `check:shared` clean.
- Review status: Reviewed by Charlie at `e17b91bf4bedb37b7fe510f4f38599aabbb93c8d`. Independent findings: the diff is `session.js` and one test. No lockfile change, no secrets, no `node:` import. Each of the three methods returns duplicate before `slotExists`. The test commits, edits, undoes, removes the set, and replays all three ids. Each replay is `duplicate: true`, and the stored ids do not change. The test stays in one process. `#seen` reads the in-memory event list, which `open` fills from storage.

### #85 — [Guard elapsed so a fixed session cannot rewind](https://github.com/michaelportale/openGym/pull/85)

- Merged commit: `37e5a95a0a568c1e7e416bf367af88d84615f99e`
- Resulting `native/phase-1` head: `2e2fafd4efb34b94ff60da7a520e5fb2ad94f25a`
- Lane: session (Charlie)
- Summary: A reopen seeds the trail of counted instants, and stamps are walked in time order, so a fixed session does not lose elapsed except on discard.
- Tests claimed at merge: `npm run verify` on `37e5a95a`, 39 files, 309 tests, `check:shared` clean.
- Review status: Reviewed by Charlie at `37e5a95a0a568c1e7e416bf367af88d84615f99e`. Independent findings: the diff stays in `native/src/session`, including a new `rewind.test.js`. No lockfile change, no secrets, no `node:` import. `elapsedStamps` skips a sample earlier than the start and sorts every stamp by time, so a later resume cannot hide an earlier sample. `compactSeen` drops a middle instant only when the hop across it still counts, which keeps a midnight point whose bridge is longer than a rest. The scripted session runs on memory and on the fake SQLite driver, flushes before each kill, and allows elapsed to fall only on discard. `toActive` strips `_sessionSeenTrail`. `writeBase` in this pull request still copies the trail from the body it read before the replace. [#86](https://github.com/michaelportale/openGym/pull/86) copies that trail inside the upsert. This pull request does not change `set.add` or `exercise.add`. F003 stays open until [#91](https://github.com/michaelportale/openGym/pull/91).

### #87 — [Replay an extend as a duplicate after the rest is gone](https://github.com/michaelportale/openGym/pull/87)

- Merged commit: `5d91e0d17371753b4ec9b94d7f409194daa81bad`
- Resulting `native/phase-1` head: `e0c0bdd6758c5a4f0fcb5ba580c73bd46aab543a`
- Lane: session (Charlie)
- Summary: `extendRest` treats a seen id as a duplicate before it checks that a rest is still running.
- Tests claimed at merge: `npm run verify`, 39 files, 310 tests, `check:shared` clean.
- Review status: Reviewed by Charlie at `5d91e0d17371753b4ec9b94d7f409194daa81bad`. Independent findings: the diff is `session.js` and one test. No lockfile change, no secrets, no `node:` import. The seen check is before the `no-rest` check. A bad `byMs` is still checked after the seen id, so a replay with a finite `byMs` does not hit `bad-extend`. The test extends, cancels, and replays the same id. The rest stays null, and the journal keeps one `rest.extend`.

### #86 — [Keep a last seen saved while the base is replaced](https://github.com/michaelportale/openGym/pull/86)

- Merged commit: `fef5f1f5f0303548dc1ddb8c13e726bdf12008ad`
- Resulting `native/phase-1` head: `164aeb4ceb60b5586f4ebf2f5cf7ae308dd2892e`
- Lane: session (Charlie)
- Summary: Replacing the journal base copies the current last-seen stamp and trail inside the write, and the trail stays a JSON array.
- Tests claimed at merge: `npm run verify` on `fef5f1f5`, 39 files, 311 tests, `check:shared` clean.
- Review status: Reviewed by Charlie at `fef5f1f5f0303548dc1ddb8c13e726bdf12008ad`. Independent findings: the diff is `sqlite-storage.js`, `storage.js`, `fake-sqlite.js`, and the storage contract test. No lockfile change, no secrets, no `node:` import. The SQLite upsert copies each key only when that key is present on the current row. The trail copy is `json(json_extract(...))`. The fake stores a bare extract as a string unless the SQL has the `json()` wrap. The comment in that pull request says a bare extract is text and `json_set` would quote it. That claim is N001, and it does not hold on SQLite 3.53.4. See N001. The interleave test holds the replace, saves a later stamp and a longer trail, then releases. The new title remains, and `readSeenTrail` is that array. Memory reads the live row immediately before the assign, with no await between those lines. This closes the replace race left by [#82](https://github.com/michaelportale/openGym/pull/82) and [#85](https://github.com/michaelportale/openGym/pull/85). It does not change the add paths. F003 stays open until [#91](https://github.com/michaelportale/openGym/pull/91).

### #88 — [Replay an added set as a duplicate after the exercise is gone](https://github.com/michaelportale/openGym/pull/88)

- Merged commit: `9e4694339b81cab159c4cb3ede6e9aaf0973cb20`
- Resulting `native/phase-1` head: `1521ab7b70390100012b428eba2a03c880c66522`
- Lane: session (Charlie)
- Summary: `addSet` treats a seen id as a duplicate before it checks that the exercise still exists.
- Tests claimed at merge: `npm run verify`, 39 files, 311 tests, `check:shared` clean. That count is this branch's suite, not a new run on the combined head.
- Review status: Reviewed by Charlie at `9e4694339b81cab159c4cb3ede6e9aaf0973cb20`. Independent findings: the diff is `session.js` and one test. No lockfile change, no secrets, no `node:` import. The seen check is before `unknown-exercise`. The test adds a set, removes the exercise, and replays the same id. The replay is a duplicate, the entries stay `bench`, and the journal keeps one `set.add`. `moveExercise` still checks that the exercise exists before `#append`, so a replay after that exercise is gone returns `unknown-exercise`. `startRest` checks the deadline before `#append`. A replay that still carries a deadline reaches the seen check there. This pull request does not clear limb done flags. F003 stays open until [#91](https://github.com/michaelportale/openGym/pull/91).

### #91 — [Clear both sides when a copied set is added](https://github.com/michaelportale/openGym/pull/91)

- Merged commit: `7ffaaa308c73d9e17c6d540bb2f085f9329f6427`
- Resulting `native/phase-1` head: `5c4cb9c3c2b5e3430ab5193df3722372abf3a700`
- Lane: session (Charlie)
- Summary: `set.add` and `exercise.add` clear the row flag and both limb flags. Weight and reps stay. This is the F003 fix.
- Tests claimed at merge: `npm run verify`, 39 files, 313 tests, `check:shared` clean.
- Review status: Reviewed by Charlie at `7ffaaa308c73d9e17c6d540bb2f085f9329f6427`. Independent findings: the diff is `fold.js` and `exercise.test.js`. No lockfile change, no secrets, no `node:` import, no files outside `native/src/session`. Both add cases call `clearDone` instead of setting only `row.done`. The test copies a row with both limbs done, through `addSet` and `addExercise`, and expects the live view and a reopen to show the row and both limbs undone, with completed sets at 0. `hasCompletedWork` reads the limb flags, so clearing them is what stops the count. `set.undo` already used `clearDone`.

### #89 — [Replay every eventId command as a duplicate](https://github.com/michaelportale/openGym/pull/89)

- Merged commit: `f6ba6d36538baf6a04964535119756f0b08b88d3`
- Resulting `native/phase-1` head: `84ad33c6f68881bebb71f63289e2b31eee2801e2`
- Lane: session (Charlie)
- Summary: `moveExercise`, `startRest`, and `resume` treat a seen id as a duplicate before the check that used to fail once the precondition was gone.
- Tests claimed at merge: `npm run verify` on this head, 40 files, 313 tests, `check:shared` clean. The body says the combined head before this change was 39 files and 312 tests.
- Review status: Reviewed by Charlie at `f6ba6d36538baf6a04964535119756f0b08b88d3`. Independent findings: the diff is `session.js` and a new `replay.test.js`. No lockfile change, no secrets, no `node:` import. The test lists public methods whose parameters include `eventId`, so a new command without a case fails. Each replay expects exactly `{ ok: true, saved: false, duplicate: true }` and one journal row. `moveExercise` now returns duplicate before `unknown-exercise`. `startRest` returns duplicate before `bad-deadline`, so a replay with no deadline does not hit that error. `resume` now checks the seen id before `discarded` and `finished`. That reverses the order [#81](https://github.com/michaelportale/openGym/pull/81) kept. A replay after finish is a duplicate. A new resume on a finished session still returns `finished`. `finish` itself still checks `discarded` before the seen id. The sweep's finish case does not discard, so that order is not what the test covers.

### #90 — [Keep a time zone saved while the base is replaced](https://github.com/michaelportale/openGym/pull/90)

- Merged commit: `4862c5e599049b72c70299a498e14efc45acc372`
- Resulting `native/phase-1` head: `a65d878fe0077578becbccdc76bbfc1d4d70bbac`
- Lane: session (Charlie)
- Summary: The first stored time zone stays. A later explicit zone does not replace it. Stamp, trail, and zone are copied inside one statement, and the current row wins when that value is present.
- Tests claimed at merge: `npm run verify` on this head, 40 files, 328 tests, `check:shared` clean. The body says the combined head before this change was 40 files and 314 tests.
- Review status: Reviewed by Charlie at `4862c5e599049b72c70299a498e14efc45acc372`. An earlier review at `8cfe871` held the branch because an explicit zone could overwrite the stored one. Independent findings: the diff is `storage.js`, `sqlite-storage.js`, `fake-sqlite.js`, and the storage contract test. No lockfile change and no secrets. `node:sqlite` is imported in the contract test, not in app code. `timeZoneForWrite` returns the stored zone when it is a non-empty string. An empty string no longer clears a zone that is already stored. Memory applies that helper. SQLite no longer reads the body in JavaScript before the write. The upsert uses `COALESCE` and `NULLIF` so the current zone wins, and the trail value is inside `json()`. The fake still stringifies an array trail unless the SQL matches that wrap. See N001. This pull request does not touch the add paths.

### #92 — [Mark both sides done when a per-side set is committed](https://github.com/michaelportale/openGym/pull/92)

- Merged commit: `46eec5f569b81fe422d9bd5f597ac26d8434f580`
- Resulting `native/phase-1` head: `5046c2cd5ae8d8fca59ccf959475da7751745e60`
- Lane: session (Charlie)
- Summary: A commit that does not name `sides` ticks both limbs. A commit that names them keeps those ticks, and `row.done` is true only when both are.
- Tests claimed at merge: `npm run verify`, 40 files, 315 tests, `check:shared` clean.
- Review status: Reviewed by Charlie at `46eec5f569b81fe422d9bd5f597ac26d8434f580`. Independent findings: the diff is `fold.js` and `exercise.test.js`. No lockfile change, no secrets, no `node:` import. `mergeFields` still skips `done`. For a side set with no `sides` field on the event, both limb flags become true and `row.done` follows them. For a plain row, `row.done` is set true. The add paths still go through `clearDone`. F003 stays closed. [#95](https://github.com/michaelportale/openGym/pull/95) later moves the `row.done` assignment into `syncSideDone` and leaves the both-limbs tick here.

### #93 — [Omit null stamp, trail, and zone keys from the base](https://github.com/michaelportale/openGym/pull/93)

- Merged commit: `75d96c689564d1b9b3123d14663120bac5dd8eb8`
- Resulting `native/phase-1` head: `8b6a1eae42ac732b51ed8389cdcc53d9e633355a`
- Lane: session (Charlie)
- Summary: `writeBase` copies stamp, trail, and zone with `json_patch`. A null member is removed, so a key neither row has is left out.
- Tests claimed at merge: `npm run verify`, 40 files, 330 tests, `check:shared` clean.
- Review status: Reviewed by Charlie at `75d96c689564d1b9b3123d14663120bac5dd8eb8`. Independent findings: the diff is `sqlite-storage.js` and one test. No lockfile change, no secrets, no `node:` import in app code. The statement is still one upsert. The trail value stays inside `json()`. The new test writes the base twice with none of the three keys and reads the raw body through `node:sqlite`. It expects exactly `{ id, title }` and no null keys. The fake already deletes those keys in JavaScript, so it would not have shown the old `json_set` null write. The regression test does not run on the fake. The comment above the statement still says a bare extract is text. See N001.

### #94 — [Follow the side ticks when a per-side set is edited](https://github.com/michaelportale/openGym/pull/94)

- Merged commit: `f3df98d07620ae6e4f1b4246658a941d5dc9ca14`
- Resulting `native/phase-1` head: `01d819f69809da7b7ad48a7094d25829fae3c43b`
- Lane: session (Charlie)
- Summary: An edit of a per-side set sets `row.done` from the two limb ticks. Clearing one side clears the row flag. The other side stays done.
- Tests claimed at merge: `npm run verify`, 40 files, 330 tests, `check:shared` clean. That count matches the #93 claim. The body does not give a separate before-count.
- Review status: Reviewed by Charlie at `f3df98d07620ae6e4f1b4246658a941d5dc9ca14`. Independent findings: the diff is `fold.js` and `exercise.test.js`. No lockfile change, no secrets, no `node:` import. `set.edit` merges fields, then sets `row.done` when the row is a side set. `hasCompletedWork` is still true when one limb stays done, which is what the pull request describes. The test commits both sides, edits the right side to not done, and checks the live view and a reopen. [#95](https://github.com/michaelportale/openGym/pull/95) removes this per-case assignment and derives the same flag in `syncSideDone`. The add paths are unchanged. F003 stays closed.

### #95 — [Derive per-side done in one place](https://github.com/michaelportale/openGym/pull/95)

- Merged commit: `222415e59c7f2f2c46d4a7ea4aebf502523120b7`
- Resulting `native/phase-1` head: `9496137d8126618b84a02c9b6ed45f46ecd50c14`
- Lane: session (Charlie)
- Summary: `syncSideDone` is the only place a per-side `row.done` is derived. The fold runs it after every `set.*` event.
- Tests claimed at merge: `npm run verify`, 41 files, 332 tests, `check:shared` clean.
- Review status: Reviewed by Charlie at `222415e59c7f2f2c46d4a7ea4aebf502523120b7`. Independent findings: the diff is `fold.js` and a new `side-done.test.js`. No lockfile change, no secrets, no `node:` import. Commit still ticks both limbs when the event does not name `sides`, and still sets `done` on a plain row. Edit only merges fields. Undo and add still use `clearDone`. The helper then sets `row.done` to both limb flags. It runs only when `event.type` starts with `set.`. An `exercise.add` does not call it. `clearDone` on that path still clears the flags. The helper does not run on the base in this pull request. [#96](https://github.com/michaelportale/openGym/pull/96) does. The test walks add, commit, edit, undo, copy, and move, and checks the live view and a reopen.

### #96 — [Keep per-side done aligned on the base and every event](https://github.com/michaelportale/openGym/pull/96)

- Merged commit: `6900eefa7e81593ce6fdf06053e606a2026a32d5`
- Resulting `native/phase-1` head: `7bbc932ae2c2f746a3c6bba39e5e14318598382d`
- Lane: session (Charlie)
- Summary: `syncSideDone` runs on the folded base and after every event, not only after `set.*`.
- Tests claimed at merge: `npm run verify`, 41 files, 332 tests, `check:shared` clean. That count matches the #95 claim.
- Review status: Reviewed by Charlie at `6900eefa7e81593ce6fdf06053e606a2026a32d5`. Independent findings: the diff is `fold.js` and `side-done.test.js`. No lockfile change, no secrets, no `node:` import. `blankModel` clones the base before the helper runs, so the caller's object is not mutated. The stored base is not rewritten. A base that already has a limb done still counts, because `hasCompletedWork` reads that flag. The helper only aligns `row.done`. The test is a seeded walk, seeds 1, 7, 19, 42, and 99, sixteen steps each, and checks the live view and a reopen after every step, including the untouched base. `clearDone` remains on both add paths. F003 stays closed.

### #97 — [Refuse an added set whose id is missing or taken](https://github.com/michaelportale/openGym/pull/97)

- Merged commit: `a4aed3d909fbeb14a8d8709ff54940f7dbc3bbe2`
- Resulting `native/phase-1` head: `fa524ef18f35063e8f548d27f85df6f8360ccd02`
- Lane: session (Charlie)
- Summary: `addSet` refuses a missing or blank id, and an id already used on any exercise, before it appends.
- Tests claimed at merge: `npm run verify`, 41 files, 333 tests, `check:shared` clean.
- Review status: Reviewed by Charlie at `a4aed3d909fbeb14a8d8709ff54940f7dbc3bbe2`. Independent findings: the diff is `session.js` and `session.test.js`. No lockfile change, no secrets, no `node:` import. The seen-id check stays first. A missing id and `''` return `unknown-set`. An id already on any exercise returns `known-set`. The test checks that those events are not stored, that an id freed by `removeSet` can be added, and that a replay of a stored add is a duplicate. A set id of a single space is still a non-empty string, so this check allows it. The comment says the fold would drop a taken id. The fold drops a duplicate only on the same exercise. A taken id on a different exercise would still apply if the event were already stored. `addExercise` does not use this check. [#98](https://github.com/michaelportale/openGym/pull/98) adds that check. Draft writes stay keyed by set id.

### #98 — [Refuse a copied exercise that reuses a set id](https://github.com/michaelportale/openGym/pull/98)

- Merged commit: `a5a44caca2844a05de67230f139a559b32b6d6fd`
- Resulting `native/phase-1` head: `5fb455fc2d8f3acd86ee536c1dec892c855b01c5`
- Lane: session (Charlie)
- Summary: `addExercise` refuses a copied set id that the session already has, or that the new entry repeats. The id list is the one the fold stores.
- Tests claimed at merge: `npm run verify`, 41 files, 334 tests, `check:shared` clean.
- Review status: Reviewed by Charlie at `a5a44caca2844a05de67230f139a559b32b6d6fd`. An overnight review at the same commit names no finding id. Independent findings: the diff is `fold.js`, `session.js`, `session.test.js`, and `side-done.test.js`. No lockfile change, no secrets, no `node:` import. `exerciseSetIds` is shared. A missing id becomes `plan:<exercise>:<index>`. A numeric id is stored with `String`, so `0` and `"0"` are one id. The seen-event check stays first. A known exercise still returns `known-exercise`. A taken id or a repeated id inside the copy returns `known-set` and does not append. `exercise.add` still runs `clearDone`, so F003 stays closed. The fold itself does not refuse a smuggled event that reuses an id. The command is what stops it. This pull request does not change `extendRest`. The full-rest extend in [#99](https://github.com/michaelportale/openGym/pull/99) is still open.

## Open pulls into `native/phase-1`

- [#65](https://github.com/michaelportale/openGym/pull/65) — draft, `docs: overnight PR audit for November 6–7`. Not merged. Updated at 23:38 EST (`9048c1b1`) through merge #97. F003 is marked fixed by [#91](https://github.com/michaelportale/openGym/pull/91). N001 stays open. The ledger lists #89 through #97. #91 and #95 are marked reviewed there. #89, #90, #92, #93, #94, #96, and #97 are queued. #98 merged after that snapshot. No new audit file is on `native/phase-1`.
- [#67](https://github.com/michaelportale/openGym/pull/67) — draft, this log. Not merged. Do not merge it.
- [#99](https://github.com/michaelportale/openGym/pull/99) — draft, `Do not record an extend a full rest cannot apply`. Not merged. Opened after the 23:38 audit snapshot. No review comment yet. On this head, `extendRest` appends any finite non-zero `byMs`. `applyExtend` then returns without a change when the rest is already at `REST_MAX_MS`, so the journal keeps an extend the timer does not apply.
