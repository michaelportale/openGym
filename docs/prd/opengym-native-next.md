# openGym native next

Draft handoff for Codex. Do not merge this PR.

Branch to continue: `native/phase-1`. The sprint PRD (`docs/sprints/2026-10-30-native-workout-prd.md`) uses different phase numbers. On that PRD, Phase 1 is the shell. This branch also holds the journal, finish, and science work. The shell and the Workout screens are Gus's lane. Do not mount the journal on a screen.

## 1. Current state

`native/phase-1` head: `ccf975cae4b268e08c04d19bbf3a4aa5f85cdda7` (merge of #104).

`native/src/session/` is the logging core. The Workout tab is still the preview in `native/src/app/(tabs)/workout.js`. It uses sample rows and `preview-actions.js`. A press records nothing. `docs/sprints/2026-11-native-phase-1-decisions.md` says those controls stay `unavailable` until a later phase connects them.

### Journal

- Events append. A correction is a new event. Each event has an id.
- `openSession` loads the base, the event list, drafts, the time zone, the last-seen stamp, and the seen trail.
- `foldJournal` replays events onto the base. `workoutFold` is the structural snapshot used to decide whether a save changed the workout. It keeps entries, set ids, rows, rest, notes, and finished. It leaves stamps out.
- `resume` is the one saved event that may leave `workoutFold` unchanged. It only moves the activity stamp so the timer can cross midnight. `journal-effect.test.js` lists it in `STAMP_ONLY`.
- A command that would not change `workoutFold` returns `{ ok: true, saved: false, unchanged: true }` and does not append. That check lives in `#appendNow` (#101).
- `#fold` is cached on open and after a successful append, and cleared on discard.

### Save queue

- `#enqueue` is one promise chain. `#append` and `discard` share it (#101, #104).
- An append waits for the append already in flight. A discard waits for that append, then clears. An append queued after discard returns `failure('discarded')` and writes nothing.
- A rejection does not drop the rest of the chain.
- On this head, model preconditions (unknown set, no rest, known set, and the rest) still run **before** the task is queued. That is the open draft #105, below.
- `putDraft` is not on this chain.
- `#seenChain` is a separate chain for `putLastSeen`. `#persistSeen` catches a rejected write, clears its private marker, and does not report an error. That is finding F004, below.

### Base row

- One `session_base` row. `writeBase` is an upsert: `INSERT ... ON CONFLICT DO UPDATE` with `json_patch`.
- The patch copies `_sessionLastSeen`, `_sessionSeenTrail`, and `_sessionTimeZone` off the current row inside the same statement.
- Zone is first-write-wins: a stored non-empty zone beats the zone on the incoming body (#90).
- Stamp and trail prefer the current row, then the incoming body.
- `json_patch` drops a null member, so a key neither row has is omitted rather than stored as JSON null (#93).
- The trail copy is wrapped in `json()`. The comment in `sqlite-storage.js` says SQLite 3.53.4 keeps a `json_extract` array as an array inside `json_set`, and the `json()` wrap stays so the copy does not depend on that.
- `putLastSeen` is one `UPDATE` with `json_set`. It does not read the body and write it back.

### Storage doubles

- `storage.js` is the in-memory store and the schema. Its header says not to import `expo-sqlite` in this phase.
- `sqlite-storage.js` takes an injected handle (`exec`, `run`, `getAll`). `native/package.json` does not depend on `expo-sqlite`.
- `fake-sqlite.js` is the test double. It must keep a copied seen trail as an array, matching `node:sqlite` (#102).
- `storage-contract.test.js` runs the same cases on the fake and on `node:sqlite`, including the in-flight `writeBase` / `putLastSeen` / zone races.

### Ids and time

- `plannedSetId(exerciseId, index)` is `plan:<exerciseId>:<index>`.
- `createEventId` prefers `crypto.randomUUID`, then `evt-<time>-<random>`.
- `timing.js` states the rules: rest remaining is deadline minus now; a pause freezes remaining; elapsed does not rewind; a gap longer than `DURATION_GAP_MS` (4 hours) is not added; an overnight gap longer than `REST_MAX_MS` (15 minutes) is not session time; a short overnight rest still counts (#79, #80).
- Overnight is a local-date change in the session zone, and only when now is later than the last activity. Finish then needs an explicit end. Resume, finish, and discard are the three choices (#77).
- `REST_MAX_MS` matches `frontend/src/lib/duration.js` and is copied, not imported. The comment says only `native/src/shared/training.js` may import `frontend/`.

### Per-side sets

- `syncSideDone` sets `row.done` only when both `sides.L.done` and `sides.R.done` are true.
- A `set.commit` that names no `sides` marks both L and R done. A commit that names `sides` keeps those ticks (#92, #95).

## 2. What's done

Titles are the GitHub PR titles on `native/phase-1`. #65 and #67 are open docs. They are not in this list. Nothing after #104 is merged. #105 is the open draft in section 3.

Already on the branch before #62, from the same PR list: the journal (#42), the five-tab shell and Workout preview (#44), the science register (#43), warm-ups and double progression (#46), the sqlite adapter and active-session hook (#48), effort and the Why-this sheet (#47), finish into a stored workout (#54), finished workouts by id and date (#57), and the hook wire-up (#60).

### Recovery

- #62 native: replay an open journal and skip a finished one
- #63 native: restore an unfinished journal ahead of a finished base
- #82 Keep the last counted instant so a kill cannot rewind the timer
- #85 Guard elapsed so a fixed session cannot rewind
- #86 Keep a last seen saved while the base is replaced

### Finish, clear, notes

- #69 native: serialize session commands ahead of finish
- #72 native: keep a failed discard from throwing the session away
- #73 native: clear the session journal in one SQLite transaction
- #74 native: record a session note in the journal
- #75 native: keep a clear failure and cap a session note
- #76 native: record an exercise note in the journal

### Sets and exercises

- #64 native: edit and delete a committed set
- #66 native: add and remove an exercise mid-session
- #71 native: keep at least one exercise in a live session
- #97 Refuse an added set whose id is missing or taken
- #98 Refuse a copied exercise that reuses a set id
- #100 Do not record a move with a non-integer index
- #103 native: drop a replayed add that reuses a set id

### Rest, midnight, zone

- #77 Keep the session time zone so a killed overnight journal refuses a silent finish
- #78 Keep the stored session time zone when the base is rewritten
- #79 Leave a short overnight gap out of session elapsed
- #80 Keep the session timer counting through a rest that crosses midnight
- #81 Treat a replayed pause, cancel, or resume as a duplicate
- #84 Replay a set event as a duplicate after the set is gone
- #87 Replay an extend as a duplicate after the rest is gone
- #88 Replay an added set as a duplicate after the exercise is gone
- #89 Replay every eventId command as a duplicate
- #90 Keep a time zone saved while the base is replaced
- #99 Do not record an extend a full rest cannot apply

### Fold, queue, SQLite shape

- #70 native: copy session documents without structuredClone
- #83 Fold the JSON document so a restart shows the same row
- #93 Omit null stamp, trail, and zone keys from the base
- #101 native: refuse a journal event the fold does not change
- #102 native: keep a copied seen trail as an array
- #104 native: queue discard with in-flight journal appends

### Per-side done

- #91 Clear both sides when a copied set is added
- #92 Mark both sides done when a per-side set is committed
- #94 Follow the side ticks when a per-side set is edited
- #95 Derive per-side done in one place
- #96 Keep per-side done aligned on the base and every event

### Docs in this range

- #68 native: correct the standup warm-up bar example

## 3. Remaining work

Do these one at a time. One small draft PR into `native/phase-1`. Do not start the next until the previous has been reviewed. Do not redo a branch that already exists.

The shell, Workout screens, mounting `useActiveSession`, and mounting `WhyThisSheet` are Gus's. `docs/science/phase-4-status.md` says the warm-up prompt and the Why-this sheet are blocked on the shell.

The sprint PRD's later phases are not tasks here: rest notifications and motion (its Phase 3), pairing and backup (Phase 5), Health sync beyond the Phase 0 gates (Phase 6), Plan / Progress / Exercises / Nutrition (Phase 7), WHOOP (Phase 8), device acceptance (Phase 9), web retirement (Phase 10). `storage.js` says not to import `expo-sqlite` in this phase.

### Task 1. Land the precondition queue (#105)

Open draft: https://github.com/michaelportale/openGym/pull/105

Branch `cursor/phase-2-queued-checks-ac15`, head `5de1543db5026b76119e759aad4c10c6bc84a284`. Not merged. Do not open a second implementation.

On `ccf975c`, `commitSet`, `extendRest`, and the other commands still read the model before `#enqueue`. Two calls fired together can both pass, and the second then saves an event the fold ignores (`unchanged`) .

The branch moves those checks into the queued task, after the earlier command has landed. Argument checks stay argument checks, in the same order: a duplicate id, then a non-integer index or a zero extend, then the model. Empty set ids stay behind the active-session guard.

Acceptance:

- `removeSet(bench1)` and `commitSet(bench1)`, fired in that order without awaiting the remove first: the commit returns `unknown-set`, not `unchanged`, and the journal has only the remove.
- `cancelRest` and `extendRest`, fired in that order: the extend returns `no-rest`, and the journal has the start and the cancel only.
- `journal-effect.test.js` stays green.
- `cd native && npm run verify` passes. The verify on that head, before this handoff, was 43 files, 348 tests, `check:shared` clean.

Files: `native/src/session/session.js`, `native/src/session/journal-effect.test.js`.

### Task 2. F004, failed timer checkpoints

Source: `docs/reviews/2026-11-06-overnight-pr-audit.md` on open PR #65 (`codex/overnight-pr-audit-2026-11-06`). That audit's discovery snapshot stops at #103. It was not re-run for this handoff. The same swallow is still in `#persistSeen` at `ccf975c`.

`noteSeen` and `flushSeen` call `#persistSeen`. The `putLastSeen` rejection is caught, the private marker is cleared, and the caller sees success. The controller can keep `state.error === null`. The audit's injected case: a draft save returns `{ ok: true, saved: true }` while the checkpoint `UPDATE` fails; elapsed shows 900000 ms and no error; reopen shows elapsed 0 and no error. The draft itself was saved.

Acceptance, from that finding:

- Inject one rejected checkpoint `UPDATE` after a successful command. The checkpoint error is visible. The journal and the draft stay. The set or draft result stays saved.
- Restore writes and retry. The error clears. A reopen keeps the displayed 15 minutes.
- Cover `noteSeen` and forced `flushSeen`, and a retry after rejection.
- A permanent storage failure stays visible. A kill before storage accepts the write cannot be papered over.

Files the audit names: `native/src/session/session.js`, `native/src/session/session-controller.js`, `native/src/session/use-active-session.js`, plus a test. The preview does not mount the hook. This is a session defect, not a device incident the audit observed.

## 4. Tests every change must keep passing

From `native/`: `npm run verify`, which is `npm test` and `npm run check:shared`.

`check:shared` (`native/scripts/check-shared-lib.mjs`) loads `native/src/shared/training.js` under plain node, scans that import graph for browser-only code, and fails if any other native file imports `frontend/` directly.

Guard tests:

- `journal-effect.test.js`. A saved command appends one event and the reopened `workoutFold` differs. A result with `ok: false` or `saved: false` leaves the journal byte-identical. `unchanged` is benign (`ok: true`, `saved: false`, no error). `STAMP_ONLY` is only `resume`, and the reason is in the file. Also: a long journal, overlapping appends, and the discard interleaves (in-flight commit then discard; append queued behind discard).
- `side-done.test.js`. Seeded walk: `row.done` follows both ticks on the base and after every seeded command.
- `storage-contract.test.js`. Memory and SQLite contracts, the clear transaction, and the `node:sqlite` races: `putLastSeen` must not clobber an in-flight `writeBase`, `writeBase` must keep a last seen saved during the replace, and `writeBase` must keep the first zone when another lands during the replace. The trail test checks that `node:sqlite` and the fake agree, with and without the `json()` wrap.
- `fold-add.test.js`. A replayed `set.add` or `exercise.add` that reuses a set id, or repeats one inside the copied entry, is dropped. Fresh ids are kept.
- `replay.test.js`. Every `eventId` command replays as a duplicate after its precondition is gone.
- After #105 merges, its two interleaves (commit behind remove, extend behind cancel) join this list.

Report the file count, the test count, and `check:shared` on the PR.

## 5. On-device checklist

Not run for this handoff. The audit says device rendering and real Expo SQLite are unverified. `expo-sqlite` is not installed. The Workout screen does not mount the session hook, so these need a build that actually opens a session. Gus owns that screen.

When that build exists:

- Kill and reopen mid-set. The committed sets and the open draft come back. A partial draft is not a completed set.
- Kill and reopen mid-rest. Remaining time matches the stored deadline or the paused remaining. No negative countdown.
- Cross local midnight in the session zone. A short gap, within `REST_MAX_MS`, still counts. A longer overnight gap does not. The app offers resume, finish with an explicit end, or discard. It does not finish silently.
- Resume after that overnight gap. The stamp moves. Sets, rest, notes, and finish stay as they were.
- A short rest and a gap longer than `DURATION_GAP_MS`. The long gap is not added to elapsed. Elapsed does not shrink.
- JSON1 on the device database: `json_patch`, `json_object`, `json_extract`, `json_set`, and the `json()` wrap around the trail. A reopen must still see the trail as an array, the first zone unchanged, and null stamp or trail or zone keys absent.
- Compare `sqlite_version()` from the device `expo-sqlite` with `node:sqlite` in the verify environment. The repo comment names SQLite 3.53.4 for the array-inside-`json_set` behavior. The audit names a Node SQLite 3.50.0 probe for clear and rollback. Those are different notes. Do not treat them as the phone's version.
- Per-side set. `row.done` is true only when both L and R are done. A commit that does not send `sides` ticks both. A commit that sends `sides` keeps those ticks. Adding a copy clears both ticks.

## 6. Bug classes and the guard for each

| Class | How it showed up | Guard that must stay |
| --- | --- | --- |
| Per-side done drift | #91, #92, #94, then the single derivation in #95 and #96 | `side-done.test.js` seeded walk. `syncSideDone` is the one place `row.done` is derived for a side row. |
| A saved event the fold ignores | #97, #98, #99, #100, then the invariant in #101 | `journal-effect.test.js`. `saved: true` changes the reopened fold, except `resume`. `unchanged` writes nothing. |
| Replay of a duplicate set id | #103. Live commands already refused it. | `fold-add.test.js` feeds a hand-built journal to `foldJournal`. |
| Fake SQLite does not match real SQLite | #102, audit N001. The fake quoted a JSON array; SQLite 3.53.4 kept it an array. | `storage-contract.test.js`: fake and `node:sqlite` agree on the trail shape. Production keeps the `json()` wrap. |
| Read-modify-write of the base zone | #90. A zone read, then a later replace, could move midnight. | `writeBase` copies zone, stamp, and trail inside one upsert. The zone race test in `storage-contract.test.js`. |
| Read-modify-write of the fold cache | #101. Two appends could each fold a stale `#fold`. | `#enqueue` around `#appendNow`. The overlapping-append test in `journal-effect.test.js`. |
| Discard against an in-flight append | #104. Discard could clear, then the append pushed the event back. | Discard on the same chain. The two discard interleave tests. |

Review lessons from this run:

- One invariant that discovers every command beats another one-off case. `journal-effect.test.js` and `replay.test.js` find commands by reading `eventId` on the prototype.
- A read-modify-write that awaits in the middle needs one queue. Errors must not break the chain.
- Folding and projection stay pure. `view` does not write the journal.
- The duplicate-id check stays before the model preconditions, in the same order as today. On #105 that whole sequence runs inside the queue, so it sees the journal after the earlier command. `finish` still checks `discarded` before the duplicate id. Leave that order unless a review says otherwise.
- Merge parallel PRs one at a time. After each merge, run `npm run verify` on the new `native/phase-1` head before branching again.

## 7. Rules

- Never push to `main` and never commit on it. `main` waits for Michael's phone check.
- PRs target `native/phase-1`. Draft until Charlie has reviewed. Charlie reviews every PR, including security.
- Merge commits only. No rebase. No force-push.
- Nothing is deleted. Move a file to `~/ToBeDeleted/`. Tag `archive/<branch>` before deleting a branch.
- No secrets in the repo, the PR, or the logs.
- No personal workout or health data. The repo is public. Tests use fixed fake sessions.
- Never open, read, or generate from `catalogue/media/`. The licence bars feeding that media to an AI system.
- Keep the AGPL `LICENSE` and `NOTICE` intact.
- Small PRs. One behavior each. No new npm dependencies for this lane.
- `native/src/shared/training.js` is the only native file that may import `frontend/src/lib`.

## 8. Open question

#70 changed shared web code: `frontend/src/lib/finish-workout.js`, plus the native finish and fold callers. `training.js` re-exports that module. The sprint PRD says native imports `frontend/src/lib` in place this sprint, and Phase 10 moves shared logic to `packages/core`.

Should native keep importing that shared file, or fork or copy it into `native/src/shared`? That needs Michael's call. Do not fork it while this question is open.

Other questions, not tasks:

- The #65 audit was not refreshed after #104. F004 is still in the code at `ccf975c`. Whether anything else in that audit moved after #103 was not re-checked here.
- `expo-sqlite` is intentionally not a dependency yet. Who adds it, and on which PRD phase, is not decided in the session code.
- #65 (`docs: overnight PR audit for November 6–7`) and #67 (`Overnight merge watch (running log, do not merge)`) are open docs. Do not merge them as part of this lane.
