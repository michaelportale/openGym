# openGym native next

Archived on 2026-11-11 as `archive/pr-106`. Unless explicitly updated below, this document describes the historical #105 snapshot `ed4fdc288`, not the current app or current work instructions. T2 and T3 subsequently merged in #107 (`11db2ec37`) and #108 (`e1c9a7bf2`), both present at `c5d6e8dbf`. No new implementation or device validation is authorized or claimed by this archive.

Historical handoff for Codex, retained as evidence. Its implementation tasks are complete. Do not merge this pull request.

Deeper notes, if you need them after this file: [architecture](../native/architecture.md), [device checklist](../native/device-checklist.md), [bug classes](../native/bug-classes.md), [open questions](../native/open-questions.md), [UI handoff](../native/ui-handoff.md). Use the current sprint documents for new work; this handoff is closed.

## Start here

Repo: `michaelportale/openGym`. Clone you are in.

Base branch: `native/phase-1`.

Head of `native/phase-1` when this handoff was written: `ed4fdc288601dde5504246eeb2131a53b19b69d7` (merge of #105). This SHA identifies the original snapshot, not a remaining task base.

There is no `package.json` at the repo root. Every command below says its working directory. Run them from there.

Node: the repo README and `docs/ENGINEERING.md` say Node 22. `native/package-lock.json` is the lockfile. `docs/ENGINEERING.md` says to install with `npm ci` against the committed lockfile. `native/package.json` has no install script.

```sh
cd native
npm ci
```

Scripts copied from `native/package.json`:

```json
"start": "expo start",
"ios": "expo run:ios",
"test": "vitest run",
"check:shared": "node scripts/check-shared-lib.mjs",
"verify": "npm test && npm run check:shared"
```

Verify, from `native/`:

```sh
cd native
npm run verify
```

That runs `npm test` (`vitest run`) and then `npm run check:shared`.

Shared-lib check alone, from `native/`:

```sh
cd native
npm run check:shared
```

That runs `node scripts/check-shared-lib.mjs`. It loads `native/src/shared/training.js` under plain node, scans that import graph, and fails if any other file under `native/` imports `frontend/` directly. Only `native/src/shared/training.js` may import `frontend/src/lib`.

One test file, still from `native/`. This is the `test` script's binary plus a path. It is not a separate npm script:

```sh
cd native
npx vitest run src/session/journal-effect.test.js
```

Metro start, the only Metro script in `native/package.json`:

```sh
cd native
npm start
```

That runs `expo start`. `docs/sprints/2026-11-native-phase-0-results.md` records that port 8081 was sometimes taken and Metro was started with:

```sh
npx expo start --dev-client --port 8082
```

The phase 0 note does not name a working directory. The Expo app is `native/`.

Metro export: a clean install and a Metro export passed earlier, and that export needed `EXPO_NO_TYPESCRIPT_SETUP=1`. `native/package.json` has no export script. No script under `native/scripts/` is an export. Do not invent `expo export` or its flags. If you must repeat the export, stop. The environment variable is recorded. The argv is not in this repo.

`npm run ios` runs `expo run:ios`. It is not part of the verify gate. Do not run it unless a task says so.

`docs/sprints/2026-10-30-native-workout-prd.md` says GitHub Actions is disabled on this fork. The suite you run locally is the one that counts. Report the vitest file count, the test count, and the `check:shared` lines on every PR.

Historical baseline verification, from a clean isolated checkout:

```sh
git fetch origin
git switch --detach ed4fdc288601dde5504246eeb2131a53b19b69d7
git rev-parse HEAD
cd native
npm ci
npm run verify
```

## What this branch is

The sprint PRD (`docs/sprints/2026-10-30-native-workout-prd.md`) calls Phase 1 the five-tab shell. `native/phase-1` also holds the workout journal, finish, and the science register. You are on the journal. Do not mount it on a screen. The shell and the Workout screens are Gus's. See the UI section below.

`native/src/app/(tabs)/workout.js` is still a preview. Presses go through `native/src/workout/preview-actions.js` and record nothing. `docs/sprints/2026-11-native-phase-1-decisions.md` says those controls stay unavailable until a later phase connects them.

### Journal, in short

Code: `native/src/session/`.

- Events append. A correction is a new event with its own id.
- `openSession` loads the base, events, drafts, time zone, last-seen stamp, and seen trail.
- `foldJournal` replays events onto the base. `workoutFold` is the structural snapshot (entries, set ids, rows, rest, notes, finished). Stamps are left out.
- `#fold` is cached on open and after a successful append, and cleared on discard.
- `resume` is the only saved event that may leave `workoutFold` unchanged. It only moves the activity stamp across midnight. `native/src/session/journal-effect.test.js` lists it in `STAMP_ONLY`.
- A command that would not change `workoutFold` returns `{ ok: true, saved: false, unchanged: true }` and does not append (#101). That shape matches the duplicate result. `ok` stays true so the controller does not show an error.
- `#enqueue` is one promise chain. Commands enter it and call `#appendNow`; `discard` uses the same queue (#104, #105). An append waits for the append already in flight. A discard waits for that append, then clears. An append queued after discard returns `failure('discarded')` and writes nothing. A rejection must not drop the rest of the chain.
- Model preconditions (unknown set, no rest, known set, and the rest) run inside `#enqueue`, after any earlier command has landed (#105). A duplicate event id is still checked before those preconditions. `finish` still checks `discarded` before the duplicate id.
- `putDraft` is not on `#enqueue`. Its write to `this.drafts` can land after `commitSet` or `removeSet` has cleared that draft and put the draft back. That is T3. `#seenChain` is a separate chain for `putLastSeen`. `#persistSeen` catches a rejected write, clears a private marker, and does not report an error. Those were the T2/T3 gaps at #105; #107 and #108 subsequently implemented the fixes.
- `writeBase` is one upsert. `json_patch` copies `_sessionLastSeen`, `_sessionSeenTrail`, and `_sessionTimeZone` from the current row inside the statement. The first non-empty zone wins (#90). `json_patch` drops a null member, so a key neither row has is omitted (#93). The trail copy is wrapped in `json()`. The comment in `native/src/session/sqlite-storage.js` says SQLite 3.53.4 keeps a `json_extract` array as an array inside `json_set`. The `json()` wrap stays so the copy does not depend on that. `putLastSeen` is one `UPDATE ... json_set`, not a read-modify-write of the whole body.
- `native/package.json` does not depend on `expo-sqlite`. `native/src/session/storage.js` says not to import it in this phase. `sqlite-storage.js` takes an injected handle (`exec`, `run`, `getAll`). Tests use `fake-sqlite.js` and `node:sqlite`.
- `plannedSetId(exerciseId, index)` is `plan:<exerciseId>:<index>`. `createEventId` prefers `crypto.randomUUID`.
- `timing.js`: rest remaining is deadline minus now; pause freezes remaining; elapsed does not rewind; a gap longer than `DURATION_GAP_MS` (4 hours) is not added; an idle overnight return longer than `REST_MAX_MS` (15 minutes) is excluded; a shorter overnight rest still counts. Work logged on both sides of midnight can count a longer interval: the regression test counts 30 minutes between sets at 23:40 and 00:10. Overnight is a local-date change in the session zone. Finish then needs an explicit end. Resume, finish, and discard are the three choices. `REST_MAX_MS` is copied from the idea in `frontend/src/lib/duration.js` and is not imported.
- `exerciseSetIds` is shared by the live add-exercise guard and by `foldJournal`. A replayed add that reuses a set id is dropped (#103). `extendBy` is shared by `extendRest` and the fold. A full rest that would grow by nothing is refused (#99).
- A per-side row is done only when both `sides.L.done` and `sides.R.done` are true. `syncSideDone` is that derivation. A commit that does not name `sides` ticks both.

Already merged on this branch before #62, by PR title: the journal (#42), the five-tab shell and Workout preview (#44), the science register (#43), warm-ups and double progression (#46), the sqlite adapter and hook (#48), effort and Why this (#47), finish into a stored workout (#54), finished workouts by id and date (#57), the hook wire-up (#60), glyphs when SF Symbols are not drawn (#50), iOS symbols with no text glyph (#59), symbol scanner kept out of the app tree (#61).

#62 through #105 are on `native/phase-1`: 42 merged pull requests. #65 and #67 are not in that count. They were open doc drafts at that snapshot and are now archived without merging. Do not merge #65, #67, or this handoff. Do not redo the merged PRs. The bug-class table below is the part you must not regress.

## Ordered tasks

T1, T2 and T3 are complete. Their original requirements and acceptance cases below are retained for reference, not assigned as new work.

### T0. Confirm the base

Goal: know which commit you are on, and that verify passes, before any edit.

Acceptance: the tested checkout is the intended commit, and you quote its `git rev-parse HEAD` with the vitest counts from `npm run verify`. Printing a remote ref alone does not identify the code tested.

Files: none.

Tests to add: none.

Commands, in order:

```sh
git fetch origin
git switch --detach ed4fdc288601dde5504246eeb2131a53b19b69d7
git rev-parse HEAD
cd native
npm ci
npm run verify
```

No pull request.

### T1. Preconditions on the append queue

Done. Merged.

- PR: https://github.com/michaelportale/openGym/pull/105
- Merge commit on `native/phase-1`: `ed4fdc288601dde5504246eeb2131a53b19b69d7`
- Branch: `cursor/phase-2-queued-checks-ac15`
- Implementation head: `5de1543db5026b76119e759aad4c10c6bc84a284`

Do not reimplement it. Model checks run inside `#enqueue`. A commit fired right after `removeSet` on the same set returns `unknown-set`. An extend fired right after `cancelRest` returns `no-rest`. The interleaves are in `native/src/session/journal-effect.test.js`. Leave them.

### T2. F004, a failed timer checkpoint must be visible

Implemented by #107 at `11db2ec371889edada849c59248ae7564c8f0577`. Do not reimplement. The following is the original requirement; this archival correction does not rerun tests or retroactively close F004 in #65's fixed audit window.

Goal: a failed `putLastSeen` is visible. A set or draft that already saved stays saved.

Source: F004 in the [archived #65 audit](https://github.com/michaelportale/openGym/blob/archive/pr-65/docs/reviews/2026-11-06-overnight-pr-audit.md). Its initial discovery stopped at #103; the final report also reproduced F004 at actual #105 integration `ed4fdc288`. #107 merged after that audit window.

What the code did at #105: `noteSeen` and `flushSeen` call `#persistSeen`. The `putLastSeen` rejection is caught, the private marker is cleared, and the promise resolves. The controller can keep `state.error === null`. The audit's injected case: a draft save returns `{ ok: true, saved: true }` while the checkpoint `UPDATE` fails; elapsed on screen is 900000 ms and `error` is null; reopen shows elapsed 0 and `error` null. The draft itself was saved.

Acceptance, from that finding:

- Inject one rejected checkpoint `UPDATE` after a successful command. A checkpoint or storage error is visible. The journal and the draft are still there. The set or draft result stays `saved: true`.
- Restore writes and retry the checkpoint. The error clears. A reopen keeps the displayed 15 minutes.
- Cover `noteSeen` and forced `flushSeen`, and a retry after rejection.
- A permanent storage failure stays visible. Do not pretend a kill is safe when storage never accepted the write.
- Do not mark the saved set or draft as unsaved.

Files: `native/src/session/session.js` (`#persistSeen`, `noteSeen`, `flushSeen`). `native/src/session/session-controller.js` if the controller must copy the checkpoint error into `state.error`. `native/src/session/use-active-session.js` only if the hook drops that error. The audit says the hook forwards controller state.

Implemented regression coverage: `native/src/session/checkpoint-error.test.js` contains the checkpoint failure cases. Keep `session-controller.test.js` green, including `a call notes the timer once it has moved 15 seconds` and `an unchanged edit leaves the screen without an error`.

Implementation and regression coverage are preserved at #107 (`11db2ec37`), including `checkpoint-error.test.js`. The originally proposed `seen-checkpoint.test.js` filename never landed. Historical test commands are not a new validation claim.

Do not add `expo-sqlite`. Do not edit screens.

### T3. Queue draft saves with the journal

Implemented by #108 at `e1c9a7bf2b6715b371169c3811258b71352160a9`. Do not reimplement. The original goal and acceptance cases follow.

Goal: `putDraft`, and the writes to the in-memory drafts map, run on the same `#enqueue` chain as `commitSet` and `removeSet`. An earlier draft save must finish before a later commit or removal clears it. A later accepted draft save remains a new edit and must be preserved.

At #105, `putDraft` checked `discarded` and `finished`, awaited `storage.putDraft`, then assigned `this.drafts`. `commitSet`, `removeSet`, and `removeExercise` clear that draft inside their queued task (`#clearDraft` deletes the storage row and then `this.drafts[setId]`). At that snapshot, `putDraft` was not on the chain, so its assignment could run after that delete and put the draft back. #108 now queues the draft write and assignment together.

Acceptance:

- `putDraft` joins `#enqueue`. The storage write and the `this.drafts` assignment both happen inside that task. A rejection still must not drop the rest of the chain.
- `#clearDraft` stays on that same chain, which it already does when called from `commitSet`, `removeSet`, and `removeExercise`.
- Interleave: start `putDraft` for a set and hold its storage write in flight. Then call `commitSet` or `removeSet` for that set without awaiting the draft. Release the held draft write and await both commands. Both saved, and the later commit or remove cleared the earlier draft: `getDraft(setId)` is null and draft storage for that id is empty. For commit, verify that the committed row includes the draft fields.
- Reverse order: seed a draft, call `commitSet`, then call `putDraft` with newer fields for the same existing set. Await both. The commit saved the earlier fields, and the later accepted draft remains in both `getDraft(setId)` and storage. FIFO does not make newer input stale; this task adds no stale-input rejection policy.
- A `putDraft` on a discarded or finished session still returns `discarded` or `finished` and writes nothing. Those checks run inside the queued task, after any earlier command.
- `journal-effect.test.js` stays green. A draft is still not a journal event.

Files: `native/src/session/session.js`. Test: add the interleave in `native/src/session/session.test.js` or `native/src/session/journal-effect.test.js`. `session.test.js` already has `a draft is visible but never counts until it is committed`.

Implementation and FIFO regression coverage are preserved at #108 (`e1c9a7bf2`). No new PR or test run is assigned by this archive.

Original ordering was T2 before T3 because both edit `session.js`. Both have since merged; neither remains assigned.

Do not start rest notifications, pairing, Health sync, other tabs, WHOOP, web retirement, science number changes, or a fork of `frontend/src/lib`. Those are named in the sprint PRD and in [open questions](../native/open-questions.md). They are not your tasks.

## Historical branch and merge rules (retired)

The workflow below records the original journal lane. Its branch references are retired by the archival cleanup; use current project instructions for new work.

Each code task gets its own branch cut from the current `origin/native/phase-1`. Recent branches look like `cursor/<short-name>-ac15`, all lowercase. Use a new name. Do not reuse `cursor/phase-2-queued-checks-ac15`.

```sh
git fetch origin native/phase-1
git checkout -b <your-branch> origin/native/phase-1
```

A small draft pull request into `native/phase-1`. One behavior. Do not merge it. Do not enable auto-merge.

- Merge commits only, when a human merges. No rebase. No force-push. Do not rewrite pushed history.
- Never commit on `main` and never push to `main`. `main` waits for Michael's phone check.
- Follow current project and personal working agreements for authorized file deletion. Preserve unique branch work under an archive tag before deleting its branch.
- No secrets. No personal workout data. No health data. The repo is public. Tests use fixed fake sessions.
- Never open, read, or generate from `catalogue/media/`.
- Keep `LICENSE` and `NOTICE` intact. Native's package license field is `AGPL-3.0-or-later`.
- No new npm dependencies.

Who reviews and who merges: `docs/sprints/2026-10-30-native-workout-prd.md` says the owner reviews and merges. `docs/science/decisions.md` uses the name Charlie for a later caller of effort helpers and `migrateLinearRoutines`. It does not say Charlie is the GitHub reviewer. This handoff was also told that Charlie reviews every PR, including security, and that agents do not merge. Those two writings do not name the same person. See the open question below. Until a human says otherwise: open the PR as a draft, do not merge it, and do not push to `main`.

## Invariant tests that must stay green

Run from `native/` via `npm run verify`. What each file guarantees:

| File | Guarantee |
| --- | --- |
| `native/src/session/journal-effect.test.js` | Discovers every command whose signature takes `eventId`. `saved: true` appends one event and the reopened `workoutFold` differs, except `resume` in `STAMP_ONLY`. `ok: false` or `saved: false` leaves the journal byte-identical. `unchanged` is `ok: true`, `saved: false`, and no error. A long journal still saves a real commit and reports a same-value edit as unchanged. Two overlapping appends both save, and a later same-value edit stays unchanged. A discard waits for an in-flight commit and leaves the journal empty. An append queued behind a discard is `discarded` and writes nothing. |
| `native/src/session/replay.test.js` | `every eventId command replays as a duplicate after its precondition is gone`. |
| `native/src/session/side-done.test.js` | `per-side row.done follows both ticks on the base and after every seeded command`. |
| `native/src/session/fold-add.test.js` | A replayed `set.add` or `exercise.add` that reuses a set id is dropped. Fresh ids are kept. The test builds the journal by hand and calls `foldJournal`. |
| `native/src/session/storage-contract.test.js` | The in-memory store and the SQLite adapter agree. Clear is one transaction. `node:sqlite` and `fake-sqlite.js` keep the seen trail as an array, with and without the `json()` wrap. `putLastSeen` does not clobber an in-flight `writeBase`. `writeBase` keeps a last seen saved during the replace, and keeps the first time zone when another zone lands during the replace. A stamp, trail, or zone key neither row has is absent, not JSON null. |
| `native/src/session/session-controller.test.js` | Finish waits for a pending commit. A second finish does not send while the first is saving. An unchanged edit leaves the screen without an error. A storage failure is surfaced and the set is not saved. |
| `native/src/session/rewind.test.js` | Displayed elapsed never rewinds across a fixed session. |
| `native/src/session/recovery.test.js` | A kill restores the open journal, recomputes rest from the deadline, and keeps the session time zone. A finished workout does not block a different open journal, and does not resurrect a session whose workout is already finished. |

`check:shared` must still print that `training.js` loads, then the scanned-file line and the checked-file line, and exit 0.

T1 is merged. Its two interleaves in `journal-effect.test.js` (`a commit queued behind removeSet reports unknown-set`, `an extend queued behind cancelRest reports no-rest`) stay in this list. Do not delete them.

## Bug classes to guard against

| Class | Where it showed up | Guard |
| --- | --- | --- |
| Per-side done drift | #91, #92, #94, then one derivation in #95 and #96 | `native/src/session/side-done.test.js` |
| A saved event the fold ignores | #97, #98, #99, #100, then the invariant in #101 | `native/src/session/journal-effect.test.js` |
| Replay of a duplicate set id | #103. Live commands already refused it. | `native/src/session/fold-add.test.js` |
| Fake SQLite does not match real SQLite | #102, audit N001. The fake quoted an array. SQLite 3.53.4 kept it an array. | `storage-contract.test.js`: `node sqlite and the fake keep the seen trail as an array`. Keep the production `json()` wrap. |
| Read-modify-write of the base zone | #90. A later replace could move midnight. | The zone race in `storage-contract.test.js`, and the `json_patch` upsert in `sqlite-storage.js` |
| Read-modify-write of the fold cache | #101. Two appends could each write a stale `#fold`. | `#enqueue`, and `overlapping appends both save, and a later same-value edit stays unchanged` |
| Discard against an in-flight append | #104. The append could push the event back after the clear. | The two discard tests in `journal-effect.test.js` |
| Stale model checks | #105, merged at `ed4fdc2`. | `a commit queued behind removeSet reports unknown-set` and `an extend queued behind cancelRest reports no-rest` in `journal-effect.test.js` |
| An earlier draft write completes after a later clear | Implemented by #108 (`e1c9a7bf2`). | Hold `putDraft` first, then queue `commitSet` or `removeSet`; the later clear wins. In reverse order, preserve the later accepted draft. |

Review lessons, from this run of the journal:

- An invariant that discovers every command beats another one-off case.
- A read-modify-write that awaits in the middle needs one queue. A rejection must not drop the rest of the queue.
- `foldJournal` and `workoutFold` stay pure. `view` samples the clock in memory for elapsed time and checkpoint trails; it performs no storage I/O. Preserve that sampling.
- Check a duplicate event id before the model preconditions. Keep that order. `finish` checks `discarded` before the duplicate id. Leave that order.
- Merge parallel PRs one at a time. After each merge, run `npm run verify` on the new `native/phase-1` head before you branch again.

## Gus's UI checklist

Word for word:

> the shell and symbol fixes are merged, but NO iPhone validation is claimed. Still to check on the iPhone: SF Symbols, Liquid Glass labels, focus, the native tab bar vs the dock, Dynamic Type, reduced motion, and haptics. A clean install and the Metro export passed earlier, but the export still needed `EXPO_NO_TYPESCRIPT_SETUP=1`.

Limits, plainly:

- No iPhone validation is claimed. Do not write that SF Symbols, Liquid Glass, focus, the tab bar, the dock, Dynamic Type, reduced motion, or haptics passed on a phone.
- Do not edit `native/src/app/`, `native/src/shell/`, `native/src/workout/`, or `native/src/ui/` for T2 or T3.
- Do not mount `useActiveSession` or `WhyThisSheet` on a screen. `docs/science/decisions.md` says Gus mounts the Why-this sheet. `docs/science/phase-4-status.md` says the warm-up prompt and that sheet are blocked on the shell.
- The clean install and the Metro export are earlier results. They are not a device pass. The export needed `EXPO_NO_TYPESCRIPT_SETUP=1`. The export argv is not in `native/package.json`.

Merged shell and symbol PRs, by title, so you do not redo them: #44 lock the five-tab shell and Workout preview, #50 show a glyph when SF Symbols are not drawn, #59 let iOS draw a symbol that has no text glyph, #61 keep the symbol scanner out of the app tree.

## On-device session checks

Not run for this handoff. Do not claim them. They need a build that opens a real session. The preview does not. `expo-sqlite` is not installed. When that build exists, the checks are: kill and reopen mid-set and mid-rest; cross midnight and resume; a short rest and a gap longer than four hours; JSON1 `json_patch` and the `json()` trail wrap on the device database; compare `sqlite_version()` from device `expo-sqlite` with `node:sqlite` (the repo comment names 3.53.4 for the array behavior; the audit names a Node 3.50.0 probe for clear and rollback; neither note is the phone); per-side `row.done` only when both sides are done, and a commit with no `sides` ticks both. Full wording: [device-checklist.md](../native/device-checklist.md).

## Open questions

Do not decide these in a code change.

1. Shared web code. #70 edited `frontend/src/lib/finish-workout.js`. `native/src/shared/training.js` re-exports it. The sprint PRD says native imports `frontend/src/lib` in place this sprint, and Phase 10 moves shared logic to `packages/core`. Should native keep importing that file, or fork or copy it into `native/src/shared`? Michael's call. Do not fork it.
2. Who merges. The sprint PRD says the owner reviews and merges. The science notes use the name Charlie for a later caller, not for GitHub. This handoff was also told Charlie reviews every PR, including security. Do not merge your own PR while this is unresolved.
3. `main`. It waits for Michael's phone check. Do not push to it.
4. F004's initial discovery stopped at #103; the final archived #65 audit also reproduced it at #105 (`ed4fdc288`). #107 later implemented checkpoint error reporting. This archive does not rerun that validation or change #65's historical finding status.
5. `expo-sqlite` is intentionally absent. Do not add it.
6. Science numbers in `docs/science/sources-needed.md` (weekly volume, deload, e1RM, rest defaults, increments) stay until a source is read. Do not edit `frontend/src/lib/progression.js` or the shared store.
7. #65, #67, and this handoff (#106) are docs. Do not merge them as part of T2 or T3.
