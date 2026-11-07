# Overnight PR audit — November 6–7, 2026

**Window:** November 6, 2026, 9:00 p.m. through November 7, 2026, 7:30 a.m., America/New_York (EST, UTC−05:00). Tonight only.
**Repository:** michaelportale/openGym, across every target branch.
**Cadence:** every half hour, with a final 7:30 a.m. reconciliation.
**Status:** in progress. This is a rolling handoff for the coding agents, not an assertion that all listed PRs are safe.
**Initial snapshot:** 22 merged PRs, through #63; GitHub enumeration at approximately 9:42 p.m. EST. This document will expand as more PRs merge.

## Agent action queue

1. **F001 — Must fix / P1: serialize session commands with finish.** A set write in progress can be omitted from the saved workout.
2. **F002 — Should fix / P2: exercise the entire session path without structuredClone.** The compatibility regression test added in #54 starts after the failing path.
3. Continue the queued per-PR reviews below. Do not interpret a passing aggregate test suite or an author's earlier review as independent review completion.

## What the initial change set does

The overnight PRs add native workout journals, SQLite adapters, finish/recovery behavior, science helpers and documentation, and the native tab/UI shell. The initial risk-focused pass traces the journal, controller, finish and recovery paths, including the hook that exposes their commands. Expected load is one user on one device; overlapping asynchronous actions are possible even at that scale.

### F001 — Must fix: finishing can overtake a pending set write

**Status:** open; reproduced at integration commit [`018621ed6905d36e52baccfb18353bb813d88272`](https://github.com/michaelportale/openGym/commit/018621ed6905d36e52baccfb18353bb813d88272). The unsafe finish path was added in [#54](https://github.com/michaelportale/openGym/pull/54), with the public command wrapper from [#48](https://github.com/michaelportale/openGym/pull/48). Later finished-workout persistence and recovery do not serialize it.

**What this is:** The controller exposes asynchronous set commands and a separate finish-and-save command. The React hook forwards both without an in-flight guard.

**Problem:** Hold the storage append for a set, start `finishSession`, let its sender confirm, then release the set append. Finish returns `{ok:true,saved:true}` with **zero completed sets**, removes the base/journal, and sets its session to null. The pending set action then rejects with `Cannot read properties of null (reading 'view')`; its event remains orphaned with no base. One user's quick set-confirm followed by finish is enough; no multi-user load is required.

**Locations:** [finish and clear, controller lines 67–127](https://github.com/michaelportale/openGym/blob/018621ed6905d36e52baccfb18353bb813d88272/native/src/session/session-controller.js#L67-L127), [call resumes after await, lines 140–141](https://github.com/michaelportale/openGym/blob/018621ed6905d36e52baccfb18353bb813d88272/native/src/session/session-controller.js#L140-L141), [hook command wrappers](https://github.com/michaelportale/openGym/blob/018621ed6905d36e52baccfb18353bb813d88272/native/src/session/use-active-session.js#L45-L55).

**Smallest fix:** Serialize state-changing commands and finish through the same controller-level queue/guard. An accepted set write must settle before finish builds the payload and clears the journal. Prevent a concurrent second finish from invoking the sender twice. A null check after the await alone hides the crash but does not repair the lost set.

**Acceptance test:** Use a deferred append, invoke set commit first and finish second without awaiting the commit, then release the append. Assert one saved set, volume 300 for 60 × 5, no rejected promise, no orphan events, and one sender invocation. Also cover two concurrent finish calls and failed append behavior.

**If skipped:** Once these commands are wired into the workout screen, a user can save incomplete history while being told the workout was saved. The current preview screens do not yet call this hook, so this is a reproducible library defect, not a claim of an observed production incident.

Reproduction (run with Node 22 from the repository root at the tested commit; creates only in-memory fixture data):

```js
import { createSessionController } from './native/src/session/session-controller.js'
import { createMemoryStorage } from './native/src/session/storage.js'
import { plannedSetId } from './native/src/session/ids.js'
const t = Date.parse('2026-11-06T22:00:00Z')
const base = {
  id: 'audit-session', d: '2026-11-06', start: t, name: 'Push',
  routineIds: ['r1'],
  entries: [{ id: 'bench', target: { sets: 1, reps: 5 },
    sets: [{ w: 60, r: 5, done: false }] }],
}
const storage = createMemoryStorage()
const append = storage.append.bind(storage)
let release, reached
const entered = new Promise(r => { reached = r })
const held = new Promise(r => { release = r })
storage.append = async event => {
  if (event.id === 'set-1') { reached(); await held }
  return append(event)
}
const c = createSessionController({ base, storage, now: () => t + 60000, timeZone: 'UTC' })
await c.open()
const pending = c.call('commitSet', {
  eventId: 'set-1', exerciseId: 'bench',
  setId: plannedSetId('bench', 0), fields: { w: 60, r: 5 },
}).catch(error => ({ error: error.message }))
await entered
let sent
const finished = await c.finishSession({
  sender: async payload => { sent = payload; return { saved: true } },
})
release()
console.log(finished.ok, await pending,
  sent.workout.entries.flatMap(e => e.sets).length,
  await storage.readBase(), await storage.readAll())
```

Observed: finish true; pending action errors; saved set count 0; base null; orphan `set-1` event.

### F002 — Should fix: the no-structuredClone regression test skips session initialization

**Status:** open; reproduced at the same integration commit with the SQLite session adapter and its injected database double. Original calls are in [#42](https://github.com/michaelportale/openGym/pull/42); [#54](https://github.com/michaelportale/openGym/pull/54) deliberately added no-`structuredClone` compatibility to the final payload path.

**What this is:** #54's regression test deletes `globalThis.structuredClone` only after it has already opened, committed and finished the session.

**Problem:** Delete the global before opening a populated session through `createSessionController` and `createSqliteSessionStorage`. Open returns `status:error`, `view:null`, and `structuredClone is not defined`. The adapter/database double does not need that global; the session fold does. Draft operations also call it directly.

**Locations:** [fold clone, lines 8–9](https://github.com/michaelportale/openGym/blob/018621ed6905d36e52baccfb18353bb813d88272/native/src/session/fold.js#L8-L9), [session draft operations](https://github.com/michaelportale/openGym/blob/018621ed6905d36e52baccfb18353bb813d88272/native/src/session/session.js#L68-L82), [test deletes the global after sealing](https://github.com/michaelportale/openGym/blob/018621ed6905d36e52baccfb18353bb813d88272/native/src/session/finish.test.js#L154-L174). Shared finish helpers also have snapshot clone calls and need inclusion in the end-to-end test.

**Smallest fix:** Extend the existing compatibility test to remove the global before opening the controller and keep it absent through drafting, committing, finish and reopen; use the existing JSON-compatible copying approach or an intentional supported fallback throughout the exercised path. Do not declare the compatibility issue fixed by testing only `toWorkoutPayload`.

**Acceptance test:** Exercise the complete SQLite-adapter controller lifecycle with the global absent and with representative training/equipment snapshots, then restore the global in finally.

**If skipped:** The compatibility case explicitly addressed by #54 still fails before its payload fix can run. Actual on-device availability in this Expo/Hermes build has **not** been measured; this finding proves the unsupported fallback path, not that every current iPhone runtime lacks the API.

### Previously reported recovery issue

[#62](https://github.com/michaelportale/openGym/pull/62)'s review noted that an unfinished stored journal could be hidden by a different, already-finished incoming base. [#63](https://github.com/michaelportale/openGym/pull/63) changes that branch so the unfinished journal wins and adds a regression test. The diff and connected recovery/controller path were inspected; the aggregate tests below include the new test. This specific issue is fixed in #63. It does not clear F001 or F002.

## Independent validation so far

Tested exact integration/merge commit: `018621ed6905d36e52baccfb18353bb813d88272` (merge of #63), in a separate managed worktree. Node 22.17.0.

| Check | Result |
| --- | --- |
| Native `npm ci --no-audit --no-fund` | Passed, 562 packages; no legacy-peer-deps bypass |
| Native `npm run verify` | Passed: 35 files, 270 tests; shared library loads under bare Node; scan 34 shared files / 67 native files |
| F001 deferred-append reproduction | Reproduced incomplete save and null-session error |
| F002 whole-controller no-clone reproduction | Reproduced open failure |
| GitHub checks at tested merge commit | 0 check runs, 0 commit statuses; aggregate state pending, **not** passing CI |
| Tests at each historical PR head/merge | Not yet run; the integration result above is not attributed to earlier commits |
| Native on-device execution / real Expo SQLite | Not run; the adapter currently receives an injected handle |
| Frontend/API/MCP/Docker suites | Not run in this initial native-focused pass; assess applicability during each full review |

Existing native verification emits module-format warnings. They were not suppressed. No application source changes or PR merges were performed by this audit.

## Coverage ledger

Every discovered merged PR in the time window appears here, including PRs merged before #62. A queued or partial entry is **not reviewed/approved**. Listed head/merge IDs identify the review target, not a claim that both have been independently tested.

| PR and title | Merged EST, Nov 6 | Base | Head / merge commit | Review status |
| --- | --- | --- | --- | --- |
| [#43](https://github.com/michaelportale/openGym/pull/43) native: science register, Why this, and warm-up exclusion | 21:00:44 | `native/phase-1` | [`80d9eca`](https://github.com/michaelportale/openGym/commit/80d9eca91cbc08a3e69c01facd9aad905c743f35) / [`db01387`](https://github.com/michaelportale/openGym/commit/db013879bb60224fec70439bc817a8ff5db67c5d) | Queued — not independently reviewed |
| [#42](https://github.com/michaelportale/openGym/pull/42) native: durable workout journal (phase 2) | 21:00:52 | `native/phase-1` | [`e1d93df`](https://github.com/michaelportale/openGym/commit/e1d93df0a4de3b4cf0018e0370d6b2669978ac10) / [`9545119`](https://github.com/michaelportale/openGym/commit/95451197b11ca6df1d15f15d9f668e68982d66fd) | Blocked: F002; broader review queued |
| [#45](https://github.com/michaelportale/openGym/pull/45) native: phase 2 follow-up on merged phase-1 | 21:05:07 | `native/phase-1` | [`9e9fc5c`](https://github.com/michaelportale/openGym/commit/9e9fc5c0fd5649f845c3d72f98e325a979dd18f7) / [`5803e7a`](https://github.com/michaelportale/openGym/commit/5803e7acd57470d19174589fbef338abfdac13ce) | Queued — not independently reviewed |
| [#46](https://github.com/michaelportale/openGym/pull/46) native: 40/80 warm-ups and double progression | 21:07:15 | `native/phase-1` | [`4067e19`](https://github.com/michaelportale/openGym/commit/4067e1963669738061baefb2d7e190b2e8f29372) / [`d650088`](https://github.com/michaelportale/openGym/commit/d6500889e46b87d629e4da8ab537dfeed674146e) | Queued — not independently reviewed |
| [#47](https://github.com/michaelportale/openGym/pull/47) native: effort, Why-this sheet, and opt-in linear migration | 21:12:31 | `native/phase-1` | [`5c786a3`](https://github.com/michaelportale/openGym/commit/5c786a36e00d5185a62929ff18b5749ed88fec88) / [`0048ee5`](https://github.com/michaelportale/openGym/commit/0048ee54cfb48a5f5eb6f39f3a374db4af1cb023) | Queued — not independently reviewed |
| [#44](https://github.com/michaelportale/openGym/pull/44) native: lock the five-tab shell and Workout preview | 21:13:35 | `native/phase-1` | [`c4ad23f`](https://github.com/michaelportale/openGym/commit/c4ad23fa4dc8993998b90d3fb9c8635ff0932997) / [`bd904da`](https://github.com/michaelportale/openGym/commit/bd904da7fd6ec698d94978fc61e7643744c7621b) | Queued — not independently reviewed |
| [#48](https://github.com/michaelportale/openGym/pull/48) native: sqlite session adapter and active-session hook | 21:15:17 | `native/phase-1` | [`050e40e`](https://github.com/michaelportale/openGym/commit/050e40eb132d122117872a025d87f74f0a4abd1f) / [`aac6bcc`](https://github.com/michaelportale/openGym/commit/aac6bcc9a96b7282aaab34324e902d991ace9cd4) | Queued — not independently reviewed |
| [#49](https://github.com/michaelportale/openGym/pull/49) native: hide TODO populations on Why this | 21:17:57 | `native/phase-1` | [`ff53142`](https://github.com/michaelportale/openGym/commit/ff5314246abd96d03a256faa082be36f8682dc95) / [`e28c151`](https://github.com/michaelportale/openGym/commit/e28c151057ed162f74a24fe84bcf46534353e385) | Queued — not independently reviewed |
| [#51](https://github.com/michaelportale/openGym/pull/51) native: cite a PR on every Phase 4 status row | 21:21:35 | `native/phase-1` | [`936450a`](https://github.com/michaelportale/openGym/commit/936450a6625779cb414e3e54bcfa91a355675cbd) / [`ab318c8`](https://github.com/michaelportale/openGym/commit/ab318c8302ec2202c85da6287f74a14403b3bdf0) | Queued — not independently reviewed |
| [#53](https://github.com/michaelportale/openGym/pull/53) native: ship no weekly set target | 21:21:42 | `native/phase-1` | [`91d34ab`](https://github.com/michaelportale/openGym/commit/91d34abdbd511413f1512df551702679b820a586) / [`798e337`](https://github.com/michaelportale/openGym/commit/798e33731d2ac721a35b73cd4020449220d9332d) | Queued — not independently reviewed |
| [#50](https://github.com/michaelportale/openGym/pull/50) native: show a glyph when SF Symbols are not drawn | 21:23:35 | `native/phase-1` | [`a89cbb6`](https://github.com/michaelportale/openGym/commit/a89cbb6a749d7834e49143e32132316008dab7bb) / [`3ce543c`](https://github.com/michaelportale/openGym/commit/3ce543c29789a1357395d8710bad5757398f9791) | Queued — not independently reviewed |
| [#52](https://github.com/michaelportale/openGym/pull/52) native: lock react-dom to 19.3.0 | 21:23:37 | `native/phase-1` | [`7fe4405`](https://github.com/michaelportale/openGym/commit/7fe440582187a5715751a6dce5724c0b35d22e82) / [`6d53231`](https://github.com/michaelportale/openGym/commit/6d53231c943ec63bea07f4ea69a42603fbe7cb10) | Queued — not independently reviewed |
| [#54](https://github.com/michaelportale/openGym/pull/54) native: finish a session into the stored workout | 21:24:28 | `native/phase-1` | [`a83bf3d`](https://github.com/michaelportale/openGym/commit/a83bf3df57ade15298cd54de6f025c7000b7b42f) / [`89896e2`](https://github.com/michaelportale/openGym/commit/89896e2f7cbd5947c67a9332979a16a26197a7da) | Blocked: F001, F002 |
| [#55](https://github.com/michaelportale/openGym/pull/55) native: cover rounding, bar edges, RIR bounds, and migration idempotence | 21:25:10 | `native/phase-1` | [`ee0ac21`](https://github.com/michaelportale/openGym/commit/ee0ac2191630d1182ccc5fa5f2d827fb1b6c48f7) / [`bc048de`](https://github.com/michaelportale/openGym/commit/bc048de7f6d13b592ddfc6fb043fa5f6c932ca4f) | Queued — not independently reviewed |
| [#56](https://github.com/michaelportale/openGym/pull/56) native: list science defaults that still need a source | 21:27:04 | `native/phase-1` | [`a60b614`](https://github.com/michaelportale/openGym/commit/a60b614f615ebfc2fddd2cede1f4c114dff2cb81) / [`cedf787`](https://github.com/michaelportale/openGym/commit/cedf78762265239573a70af344c3b946f81bdfcc) | Queued — not independently reviewed |
| [#58](https://github.com/michaelportale/openGym/pull/58) native: science standup brief for 6 November | 21:29:10 | `native/phase-1` | [`e8db45a`](https://github.com/michaelportale/openGym/commit/e8db45ab978d3840299f9b815b7c1e43b07db4cd) / [`f1ce4da`](https://github.com/michaelportale/openGym/commit/f1ce4da256de41574759f9530f414ff434be9923) | Queued — not independently reviewed |
| [#57](https://github.com/michaelportale/openGym/pull/57) native: store each finished workout by id and date | 21:29:19 | `native/phase-1` | [`4564a9a`](https://github.com/michaelportale/openGym/commit/4564a9a884a5de12ee61885dc2ed2d1a6f080ed9) / [`007604a`](https://github.com/michaelportale/openGym/commit/007604ae8141e131051bb7d1b021f0ffae4fc08c) | Queued — not independently reviewed |
| [#59](https://github.com/michaelportale/openGym/pull/59) native: let iOS draw a symbol that has no text glyph | 21:29:54 | `native/phase-1` | [`417dd1a`](https://github.com/michaelportale/openGym/commit/417dd1a01141b09bb7b237fe4e232c210dd9bf84) / [`ec479cb`](https://github.com/michaelportale/openGym/commit/ec479cb5c3f9fa4d0e2f9b346bedc86b55c0f1bd) | Queued — not independently reviewed |
| [#60](https://github.com/michaelportale/openGym/pull/60) native: wire finished workouts through the session hook | 21:33:56 | `native/phase-1` | [`52b745a`](https://github.com/michaelportale/openGym/commit/52b745a1ad3f8004dc5755de0d05298c4368ee13) / [`9588390`](https://github.com/michaelportale/openGym/commit/9588390959770fed53b05e3248a3e989f3a650e1) | Queued — not independently reviewed |
| [#61](https://github.com/michaelportale/openGym/pull/61) native: keep the symbol scanner out of the app tree | 21:34:21 | `native/phase-1` | [`4884129`](https://github.com/michaelportale/openGym/commit/488412950a387c33b094115c990b1af0c0e1973b) / [`5b658da`](https://github.com/michaelportale/openGym/commit/5b658dab174248f942233718021b245946fd7b32) | Queued — not independently reviewed |
| [#62](https://github.com/michaelportale/openGym/pull/62) native: replay an open journal and skip a finished one | 21:37:43 | `native/phase-1` | [`7a7bd37`](https://github.com/michaelportale/openGym/commit/7a7bd371e8f0217396e0290f9a70d2d2b9828242) / [`b7d2d24`](https://github.com/michaelportale/openGym/commit/b7d2d249645787d27b620a2bf96711aa892b7069) | Recovery follow-up fixed by #63; broader review queued |
| [#63](https://github.com/michaelportale/openGym/pull/63) native: restore an unfinished journal ahead of a finished base | 21:41:19 | `native/phase-1` | [`259de62`](https://github.com/michaelportale/openGym/commit/259de62280a20ad5323e84d5caa42281a0ce85df) / [`018621e`](https://github.com/michaelportale/openGym/commit/018621ed6905d36e52baccfb18353bb813d88272) | Focused recovery review; broader review queued |

## Operating rules for subsequent runs

- Re-enumerate all merged PRs by actual merge timestamp in the fixed window, across all base branches; page fully, deduplicate by PR plus head/merge SHA, and append new ledger entries.
- Re-review fixes and mark a finding resolved only after checking the fixing commit and relevant tests. Preserve the original evidence and link the repair.
- Read full diffs, connected code/tests, existing discussions and unresolved threads. Record check outcomes at exact commits. Current evidence takes precedence over author summaries.
- Continue the existing review/merge gate for eligible open PRs during the window. Already-merged defects receive corrective documentation/comments; do not automatically revert or edit application code.
- Update this file on its dedicated docs branch, preserving other edits, and keep its documentation PR discoverable. Do not recursively audit this report PR. Do not merge this rolling docs PR as part of the automatic queue.
- At 7:30 a.m. EST, reconcile the complete fixed window, publish remaining queued/blocked items honestly, and pause the automation. No repeat tomorrow night.
