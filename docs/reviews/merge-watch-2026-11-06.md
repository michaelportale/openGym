# Overnight merge watch

Running log of pulls merged into `native/phase-1` on the night of 6 November 2026. This pull request is a log only. Do not merge it.

- Last checked: 2026-11-06 22:06 EST
- `native/phase-1` head: `8a71a1affebe78588e319d5ea0cf01673e68ed60`
- Native `npm test` at `f66609519231c03800aaec05faee11bc738f2fcf`: 37 files, 281 passed, no failures. This check did not re-run the suite.
- Window: merges after `aac6bcc` (the #48 session-adapter merge), from #49 through the head above
- Lanes: session = Charlie, shell/screens = Gus, science = Bob
- Independent review below is this log's reading of the diff. `NOT YET REVIEWED` means that diff was not read. `Self-authored, not independent` means this lane wrote the pull request, so the reading is not a review. Charlie's review line is his comment, not this reading.

## Open findings

The first pass of this log said the #59 Node-import gap and the #62 journal gap were closed on the head at that time. Both of those are still closed. F001 and F002, from Codex's audit [#65](https://github.com/michaelportale/openGym/pull/65), were open in Charlie's session lane. Both were checked again on `f66609519231c03800aaec05faee11bc738f2fcf` and are closed.

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
- Review status: Reviewed by Charlie at `dc5e109bc140888daf41095d16e4333d33722310`. Independent findings: the diff is `sqlite-storage.js` and `storage-contract.test.js` only. No lockfile change, no secrets, no `node:` import. The new test fails the drafts delete and checks that the event, the draft, and the base all remain, then a later append still works. The `catch` always runs `ROLLBACK` and then rethrows. If the script throws before a transaction exists, that `ROLLBACK` can itself throw and hide the original error. The in-memory driver does not throw on a bare `ROLLBACK`, so this suite does not show that case. Charlie left it as a follow-up. It is still in the code on this head.

### #74 — [native: record a session note in the journal](https://github.com/michaelportale/openGym/pull/74)

- Merged commit: `72810bca064ee6757858216bd85e7661f2081aa0`
- Resulting `native/phase-1` head: `8a71a1affebe78588e319d5ea0cf01673e68ed60`
- Lane: session (Charlie)
- Summary: A session note is a journal event. The last note wins, a blank note clears it, and finish copies the note onto the workout.
- Tests claimed at merge: `npm run verify`, 38 files, 287 tests passed.
- Review status: Reviewed by Charlie at `72810bca064ee6757858216bd85e7661f2081aa0`. Independent findings: the diff is `fold.js`, `session.js`, `use-active-session.js`, and a new test. No lockfile change, no secrets, no `node:` import, no files outside `native/src/session`. A non-string note is refused with `bad-note` before append. `#append` still refuses a discarded or finished session. The fold ignores a non-string note and deletes `base.note` when the text is blank after trim. Tests cover a duplicate event id, SQLite replay, and the controller. The fixture notes are short phrases, not personal training data.

## Open pulls into `native/phase-1`

- [#65](https://github.com/michaelportale/openGym/pull/65) — draft, `docs: overnight PR audit for November 6–7`. Not merged. The F001 and F002 entries above started in that audit. The rest of its ledger is not this log's review.
- [#67](https://github.com/michaelportale/openGym/pull/67) — draft, this log. Not merged. Do not merge it.
