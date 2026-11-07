# Bug classes

Each class below showed up more than once on `native/phase-1`. The guard test is what the next change has to keep passing. The suite is `cd native && npm run verify` (`npm test` and `npm run check:shared`).

## Per-side done drift

#91 cleared both ticks when a copied set was added. #92 marked both sides done on a commit that sent no `sides`. #94 made an edit follow the side ticks. The flags still disagreed until #95 derived `row.done` in one place and #96 checked the base and every seeded event.

Guard: `native/src/session/side-done.test.js`. A per-side row is done only when both L and R are done. `syncSideDone` in `fold.js` is that derivation.

## A saved event the fold ignores

#97 refused a new set whose id was missing or already taken. #98 refused a copied exercise that reused a set id. #99 refused an extend a full rest cannot apply. #100 refused a move whose index is not an integer. Each of those used to return `saved: true` for an event `foldJournal` then dropped.

#101 is the invariant. `journal-effect.test.js` discovers every command that takes `eventId`. For a saved command, the journal grows by one event and the reopened `workoutFold` changes. `resume` is the only listed exception: it only leaves a stamp so the timer can cross midnight (`STAMP_ONLY`). A result with `ok: false` or `saved: false` leaves the journal byte-identical.

An unchanged command is benign: `{ ok: true, saved: false, unchanged: true }`. It does not set an error on the controller.

## Replay of a duplicate set id

The live add commands already refused a reused set id. A hand-built journal could still replay `set.add` or `exercise.add` and put the same id on two exercises, or twice inside one copied entry.

#103 drops that replay in the fold. The live guard stays. Both sides use `exerciseSetIds` for a copied exercise.

Guard: `native/src/session/fold-add.test.js`. It feeds the journal to `foldJournal` directly. Fresh ids are kept.

## Fake SQLite versus real SQLite

Audit N001: `fake-sqlite.js` turned a `json_extract` array into text that was then quoted. SQLite 3.53.4 keeps that array as an array inside `json_set`. The fake's comments said the wrong thing.

#102 makes the fake keep the array, fixes the comments in `fake-sqlite.js` and `sqlite-storage.js`, and leaves the production `json()` wrap in place.

Guard: `native/src/session/storage-contract.test.js`, test `node sqlite and the fake keep the seen trail as an array`. It compares the bare copy and the wrapped production write.

## Read-modify-write of the base zone

A zone read, then a later replace of the whole base, could store a different zone and move midnight. The same shape could drop a last-seen stamp written while the replace was in flight.

#78 and #86 kept the stored zone and the last seen across a rewrite. #90 makes the first zone win inside the `json_patch` upsert, in the same statement as the stamp and the trail.

Guard: the `node:sqlite` race tests in `storage-contract.test.js`.

- `putLastSeen` does not clobber a `writeBase` that lands while it is in flight.
- `writeBase` keeps a last seen saved while the replace is in flight.
- `writeBase` keeps the first time zone when another lands during the replace.

The same cases run on the fake.

## Read-modify-write of the fold cache

#101 caches `workoutFold` so each append folds the candidate once. Two overlapping appends could each read `this.events` and `#fold`, await storage, and write a stale cache back. A later same-value edit then looked like a real save.

The fix is `#enqueue`: the fold check, the storage append, the events push, and the `#fold` update run one at a time. A rejection does not drop the rest of the queue.

Guard: `overlapping appends both save, and a later same-value edit stays unchanged` in `journal-effect.test.js`.

## Discard against an in-flight append

`discard` clears storage and then replaces `this.events`. An append that had already passed its checks could finish after that clear and push the event back onto the empty list.

#104 puts `discard` on the same `#enqueue` chain. The discard waits for the in-flight append, then clears. An append queued behind the discard returns `failure('discarded')`.

Guard: the two discard tests in `journal-effect.test.js`.

- Start `commitSet` without awaiting it, call `discard`, await both. The journal is empty, `session.events` is empty, and `view()` is discarded.
- Call `discard`, then `commitSet`, without awaiting the discard first. The commit returns `discarded` and writes nothing.

## Preconditions that read a stale model

#105, merged at `ed4fdc2`. Model checks run inside `#enqueue`. `removeSet` then `commitSet` on the same set returns `unknown-set`. `cancelRest` then `extendRest` returns `no-rest`.

Guard: `a commit queued behind removeSet reports unknown-set` and `an extend queued behind cancelRest reports no-rest` in `journal-effect.test.js`. Do not open a second implementation.

## Review lessons

- Prefer an invariant that discovers every command over another one-off case. `journal-effect.test.js` and `replay.test.js` find commands by reading `eventId` on the prototype.
- A read-modify-write that awaits in the middle needs one serialized queue. Catch errors so the chain stays alive.
- Keep fold and `view` pure. `view` does not write the journal.
- Check a duplicate event id before the model preconditions, and keep that order. #105 runs that sequence inside the queue so it sees the journal after the earlier command. `finish` still checks `discarded` before the duplicate id. Leave that unless a review says otherwise.
- Merge parallel PRs one at a time. After each merge, run `npm run verify` on the new `native/phase-1` head before branching again.
