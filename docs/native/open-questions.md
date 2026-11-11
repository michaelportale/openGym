# Open questions

Archived on 2026-11-11 as `archive/pr-106`. Unless explicitly updated below, this document describes the historical #105 snapshot `ed4fdc288`, not the current app or current work instructions. T2 and T3 subsequently merged in #107 (`11db2ec37`) and #108 (`e1c9a7bf2`), both present at `c5d6e8dbf`. No new implementation or device validation is authorized or claimed by this archive.

Do not decide these in a code PR. They need Michael, or a review that names the choice.

## Shared web code (#70)

#70 edited `frontend/src/lib/finish-workout.js` and the native finish and fold callers. `native/src/shared/training.js` re-exports that module. It is the only native file allowed to import `frontend/src/lib`. `native/scripts/check-shared-lib.mjs` fails the build otherwise.

The sprint PRD says native imports `frontend/src/lib` in place this sprint. Its Phase 10 moves shared logic to `packages/core`, because `mcp/` still imports it.

Should native keep importing the shared file, or fork or copy it into `native/src/shared`? That is Michael's call. Do not fork it while this is open.

`timing.js` already copies `REST_MAX_MS` instead of importing `frontend/src/lib/duration.js`. That copy is a local constant, not a decision to fork `finish-workout.js`.

## Who reviews, and main

Do not push to `main` and do not commit on it. `main` waits for Michael's phone check. Work lands on `native/phase-1` as draft PRs. Merge commits only. No rebase and no force-push.

`docs/sprints/2026-10-30-native-workout-prd.md` says the owner reviews and merges. `docs/science/decisions.md` uses the name Charlie for a later caller of the effort helpers and of `migrateLinearRoutines`. It does not say Charlie is the GitHub reviewer. This handoff was also told that Charlie reviews every PR, including security. Those sources do not name the same person. Agents do not merge while that is unresolved. The PRD states the same question.

## Completed journal tasks (T2 and T3)

At #105 (`ed4fdc288`), `#persistSeen` swallowed checkpoint failures and `putDraft` was outside the journal queue. #107 (`11db2ec37`) implemented checkpoint error reporting, and #108 (`e1c9a7bf2`) serialized draft writes and in-memory assignments with the journal. Both are present at `c5d6e8dbf`; do not assign them again.

The [archived #65 audit](https://github.com/michaelportale/openGym/blob/archive/pr-65/docs/reviews/2026-11-06-overnight-pr-audit.md) preserves F004's status and evidence within its fixed window through 2026-11-07 07:30 EST. This archival correction records the later implementation merges; it does not rerun their tests or change that historical audit disposition.

## expo-sqlite is not installed

`native/package.json` has no `expo-sqlite` dependency. `storage.js` says not to import it in this phase. `sqlite-storage.js` takes an injected handle. Who adds the real database, and on which sprint phase, is not decided in the session code. Do not add the dependency as a drive-by.

## Archived doc PRs

These historical handoffs are preserved under `archive/pr-65`, `archive/pr-67`, and `archive/pr-106` and closed without merging during the 2026-11-11 cleanup.

- #65 `docs: overnight PR audit for November 6–7`
- #67 `Overnight merge watch (running log, do not merge)`
- #106 this handoff (`docs: PRD for openGym native next`). Do not merge it.

## Science numbers that are still convention

`docs/science/sources-needed.md` says these stay as they are until a source is read: weekly set targets (the helper returns null), deload, estimated 1RM, rest defaults, and load increments. `docs/science/phase-4-status.md` says the audit of those four register rows is not started, and several populations are still empty.

That file also says some science behavior is blocked on another lane:

- Showing the warm-up prompt, mounting Why this, and the add-a-warm-up-set control are blocked on the shell.
- Putting a progression suggestion on a finished session, saving effort on a set, and saving warm-ups into history are blocked on the journal.

None of that is a task in the PRD's next-tasks list. Do not edit `frontend/src/lib/progression.js` or the shared store to "finish" it.

## finish() checks discarded before the duplicate id

Most commands check the event id first, then the model. `finish` checks `discarded`, then the duplicate id, then `finished`. #105, merged at `ed4fdc2`, keeps that order inside the queue. Leave it unless a review asks for a change.

## Phase 0 limits that were never closed

`docs/sprints/2026-11-native-phase-0-results.md` still lists items that were not tested or not settled: simulator behavior, the five `npm audit` advisories that come through Expo's tooling, interrupted Health exports, body-weight writes, and whether a saved Health workout's uuid matches the stored one after a no-op retry. Phase 6 carry-over in that file says `toRead` includes workouts even though the sprint PRD excludes reading workouts. Those are not session-lane tasks.
