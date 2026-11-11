# Session architecture

Archived on 2026-11-11 as `archive/pr-106`. Unless explicitly updated below, this document describes the historical #105 snapshot `ed4fdc288`, not the current app or current work instructions. T2 and T3 subsequently merged in #107 (`11db2ec37`) and #108 (`e1c9a7bf2`), both present at `c5d6e8dbf`. No new implementation or device validation is authorized or claimed by this archive.

Head this describes: `native/phase-1` at `ed4fdc288601dde5504246eeb2131a53b19b69d7` (merge of #105).

Code lives in `native/src/session/`. The Workout tab does not call it yet. See [ui-handoff.md](ui-handoff.md).

## Append-only journal

A session is a base document plus an ordered event list. A correction is a new event. Each event has an id. `openSession` reads the base, the events, the drafts, the time zone, the last-seen stamp, and the seen trail.

`foldJournal` replays the events onto the base. `workoutFold` is the structural snapshot: entries (id, note, note pin, and each set's id and row), rest, the base note, and finished. Stamps stay out, so a timing-only event is not mistaken for a workout change.

`#fold` is that snapshot, cached on open and after each successful append, and cleared on discard (#101). A candidate event is folded once against the cache.

`resume` is the one saved event that may leave `workoutFold` unchanged. It only moves the activity stamp so the timer can cross midnight. `journal-effect.test.js` names it in `STAMP_ONLY`.

## Unchanged is benign

If a command's event would not change `workoutFold`, `#appendNow` does not write it. The result is `{ ok: true, saved: false, unchanged: true }` (#101). It is shaped like the duplicate result. It is not `ok: false`, so the screen controller does not treat it as an error.

`saved: true` still means one new event and a different reopened fold, except `resume`.

## One save queue

`#enqueue` is one promise chain. Commands enter it and invoke `#appendNow`; `discard` uses the same queue (#104, #105).

- An append waits until the append already in flight has finished its fold check, its storage write, and its cache update.
- A discard waits for that append, then clears the journal, the in-memory events, the drafts, the base, and `#fold`.
- An append queued after the discard sees `discarded` and returns `failure('discarded')` without writing.
- A rejection is caught on the chain so the next task still runs.

Model checks such as unknown set, unknown exercise, no rest, and known set run inside the queued task (#105). Argument checks stay argument checks, in the same order.

At the #105 snapshot, `putDraft` was not on this chain. An earlier draft write can finish after a later `commitSet` or `removeSet` clears that draft and put it back. The PRD task T3 queues that write with the clear, preserving invocation order. A draft accepted after a commit is newer input and remains saved. `#seenChain` is a separate chain for the last-seen stamp. A failed stamp write is still swallowed there. That was F004 in [open-questions.md](open-questions.md). #107 subsequently made checkpoint failures visible, and #108 put draft writes and in-memory assignments on the same queue. These are completed tasks.

## First-write-wins zone

The time zone is part of the base row, not a separate table. `writeBase` is one upsert:

`INSERT INTO session_base ... ON CONFLICT(id) DO UPDATE SET body = json_patch(...)`.

The patch copies `_sessionLastSeen`, `_sessionSeenTrail`, and `_sessionTimeZone` from the current row inside that statement. A stored non-empty zone wins over the zone on the incoming body (#90). A later boot that passes UTC cannot move midnight.

Stamp and trail prefer the current row, then the incoming body. `putLastSeen` is its own `UPDATE` with `json_set`. It does not read the whole body and write it back, so it does not wipe a `writeBase` that committed while it was in flight (#86).

## json_patch and the json() wrap

`json_patch` drops a null member. A stamp, trail, or zone key that neither row has is left out, not stored as JSON null (#93).

The trail copy in the upsert is wrapped in `json()`. The comment in `sqlite-storage.js` says SQLite 3.53.4 keeps a `json_extract` array as an array inside `json_set`. The wrap stays anyway, so the stored trail does not depend on that version's behavior. `fake-sqlite.js` must keep the same array shape as `node:sqlite` (#102). Tests cover the production statement and a copy of it without the wrap.

## Ids and timing

`plannedSetId(exerciseId, index)` is `plan:<exerciseId>:<index>` (`native/src/session/ids.js`). `createEventId` uses `crypto.randomUUID` when it exists, otherwise `evt-<time>-<random>`.

`timing.js` is the clock policy:

- Rest remaining while running is deadline minus now, clamped to the total. Zero means the rest is over. Nothing there starts the next set.
- Pause stores the remaining time. While paused, remaining does not read `now`.
- Elapsed walks stamps sorted by time and keeps a high-water mark. A backward step adds nothing.
- A forward gap longer than `DURATION_GAP_MS` (4 hours) adds nothing.
- An idle overnight return longer than `REST_MAX_MS` (15 minutes) is excluded. A shorter overnight rest still counts (#79, #80). Committed work across midnight can count longer intervals; `session.test.js` counts 30 minutes between sets at 23:40 and 00:10.
- Overnight is a local-date change in the session zone, and only when now is later than the last activity. Finish then needs an explicit end. Resume, finish, and discard are the three choices (#77).

`REST_MAX_MS` matches `frontend/src/lib/duration.js` and is copied here. The file says only `native/src/shared/training.js` may import `frontend/`.

## Fold guards share the live helpers

`exerciseSetIds` is how a copied exercise names the set ids the fold would store. The live `addExercise` command refuses a repeated id or one already on the session. `foldJournal` uses the same helper and drops a replayed `exercise.add` that would collide (#98, #103). A replayed `set.add` whose id is already on any exercise is dropped the same way.

`extendBy` is how many milliseconds an extend actually applies. A full rest grows by nothing. The live `extendRest` command refuses that before the write (#99). The fold's `applyExtend` uses the same helper and ignores an extend that applies zero.

## Side-done rule

A per-side row is done only when both sides are. `syncSideDone` in `fold.js` sets `row.done` from `sides.L.done` and `sides.R.done`. That is the one derivation (#95, #96).

A `set.commit` that does not name `sides` marks both L and R done (#92). A commit that names `sides` keeps those ticks. Adding a copied set clears both ticks (#91). An edit follows the side ticks (#94).

`side-done.test.js` walks seeded commands and checks the base and the replay.

## Storage doubles

| Piece | Role |
| --- | --- |
| `storage.js` | In-memory store and the schema. Header says not to import `expo-sqlite` in this phase. |
| `sqlite-storage.js` | Adapter. The handle is injected: `exec`, `run`, `getAll`. `native/package.json` does not depend on `expo-sqlite`. |
| `fake-sqlite.js` | Test double. Trail arrays stay arrays. |
| `node:sqlite` | The real SQLite in `storage-contract.test.js`, including the in-flight base races. |

Finished workouts are a separate table in `finished-workouts.js`. The handle is injected there too. On finish, the journal folds into one web-format document keyed by id and date (#54, #57).
