# Overnight PR audit — November 6–7, 2026

**Window:** November 6, 2026, 8:30 p.m. through November 7, 2026, 7:30 a.m., America/New_York (EST, UTC−05:00). Tonight only.
**Scope correction:** Start moved back from 9:00 p.m. to 8:30 p.m. EST. A complete GitHub closed-PR enumeration found no additional merges between 8:30 and 9:00 p.m.; all 23 in-window merges through #64 remain in the ledger. Subsequent runs must use the expanded start (UTC 2026-11-07T01:30:00Z).
**Repository:** michaelportale/openGym, across every target branch.
**Cadence:** every half hour, with a final 7:30 a.m. reconciliation.
**Status:** in progress. This is a rolling handoff for the coding agents, not an assertion that all listed PRs are safe.
**Latest discovery:** 45 merged PRs through #88 (merged 11:05:34 p.m. EST), from an exhausted 89-PR inventory. The 11:00 p.m. pass completed source reviews of #44, #48, #49, #51, #53 and #50, plus focused storage review of #86 as it moved from draft to merged. F003 remains open; N001 corrects inaccurate SQLite test behavior. New merges remain queued.
**Audit PR:** [#65](https://github.com/michaelportale/openGym/pull/65), kept draft for rolling documentation updates.

## Agent action queue

1. **F003 — Must fix / P2: copied per-side sets arrive already completed.** Clear both limb completion flags when adding a set or exercise; reuse `clearDone`.
2. **F001 is fixed by #69; F002 is fixed by #70.** Both were independently checked at their fixing head commits and again in the merged integration state. Historical reproduction evidence is retained below.
3. Continue queued per-PR reviews, beginning with the remaining #54 finish/persistence paths and #55. Integrated test success does not turn queued code reviews into approvals.
4. **N001 — Optional / P3:** correct #86’s SQLite test double and explanation; direct JSON-function results retain their JSON array type in the tested engine. Keep the working atomic stamp/trail race fix.

## What the initial change set does

The overnight PRs add native workout journals, SQLite adapters, finish/recovery behavior, science helpers and documentation, and the native tab/UI shell. The initial risk-focused pass traces the journal, controller, finish and recovery paths, including the hook that exposes their commands. Expected load is one user on one device; overlapping asynchronous actions are possible even at that scale.

### F001 — Must fix: finishing can overtake a pending set write

**Status:** **fixed by [#69](https://github.com/michaelportale/openGym/pull/69)**. Six controller tests pass at fixing head `549db024a8c1ece2376dee13be9e06bf84ca9a17`; the original held-append case and concurrent finish case also pass independently at merge #72. The changed controller files match the #69 merge result. Historical failure was reproduced at integration commit [`018621ed6905d36e52baccfb18353bb813d88272`](https://github.com/michaelportale/openGym/commit/018621ed6905d36e52baccfb18353bb813d88272). The unsafe finish path was added in [#54](https://github.com/michaelportale/openGym/pull/54), with the public command wrapper from [#48](https://github.com/michaelportale/openGym/pull/48). At that historical commit, finished-workout persistence and recovery did not serialize it; #69 now puts open, call and finish on one controller queue.

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

**Status:** **fixed by [#70](https://github.com/michaelportale/openGym/pull/70)**. Eight finish tests pass at fixing head `dbd045e60aea1e6aa732ef0e8294cb031ad4771c`; independent open/draft/commit/finish/reopen with snapshots and no global clone passes at merge #72. The relevant changed files match the #70 merge result. Historical failure was reproduced at the initial integration commit with the SQLite session adapter and its injected database double. Original calls are in [#42](https://github.com/michaelportale/openGym/pull/42); [#54](https://github.com/michaelportale/openGym/pull/54) deliberately added no-`structuredClone` compatibility to the final payload path.

**What this is:** #54's regression test deletes `globalThis.structuredClone` only after it has already opened, committed and finished the session.

**Problem:** Delete the global before opening a populated session through `createSessionController` and `createSqliteSessionStorage`. Open returns `status:error`, `view:null`, and `structuredClone is not defined`. The adapter/database double does not need that global; the session fold does. Draft operations also call it directly.

**Locations:** [fold clone, lines 8–9](https://github.com/michaelportale/openGym/blob/018621ed6905d36e52baccfb18353bb813d88272/native/src/session/fold.js#L8-L9), [session draft operations](https://github.com/michaelportale/openGym/blob/018621ed6905d36e52baccfb18353bb813d88272/native/src/session/session.js#L68-L82), [test deletes the global after sealing](https://github.com/michaelportale/openGym/blob/018621ed6905d36e52baccfb18353bb813d88272/native/src/session/finish.test.js#L154-L174). Shared finish helpers also have snapshot clone calls and need inclusion in the end-to-end test.

**Smallest fix:** Extend the existing compatibility test to remove the global before opening the controller and keep it absent through drafting, committing, finish and reopen; use the existing JSON-compatible copying approach or an intentional supported fallback throughout the exercised path. Do not declare the compatibility issue fixed by testing only `toWorkoutPayload`.

**Acceptance test:** Exercise the complete SQLite-adapter controller lifecycle with the global absent and with representative training/equipment snapshots, then restore the global in finally.

**If skipped:** The compatibility case explicitly addressed by #54 still fails before its payload fix can run. Actual on-device availability in this Expo/Hermes build has **not** been measured; this finding proves the unsupported fallback path, not that every current iPhone runtime lacks the API.

### F003 — Must fix / P2: copied per-side sets are logged before any commit

**Status:** open; independently reproduced again at merge #79, `8bfbf93e7ae36e7ea3817228d05773c9cae423a5`, through both add paths. Original reproduction at [`bf57f13e9e8f750fe76e33f020bdc41d52e128af`](https://github.com/michaelportale/openGym/commit/bf57f13e9e8f750fe76e33f020bdc41d52e128af). Affects [#66](https://github.com/michaelportale/openGym/pull/66)'s `exercise.add` and the existing `set.add` path from #42.

**What this is:** Adding an exercise or set is supposed to create unlogged rows, even when the input is copied from a completed workout. Per-side sets keep a separate done flag on each limb.

**Problem:** Both add paths set only `row.done = false`. If `sides.L.done` or `sides.R.done` is still true, shared `hasCompletedWork` reads that limb flag and treats the new set as completed. Adding a curl with both limbs at 20 × 5 immediately reports **1 completed set, 10 reps and 200 load-reps**, without any `set.commit` event. Finishing persists the curl in history. The same input reproduces through `addSet`.

**Locations:** [set.add, fold lines 159–164](https://github.com/michaelportale/openGym/blob/bf57f13e9e8f750fe76e33f020bdc41d52e128af/native/src/session/fold.js#L159-L164), [exercise.add, lines 176–183](https://github.com/michaelportale/openGym/blob/bf57f13e9e8f750fe76e33f020bdc41d52e128af/native/src/session/fold.js#L176-L183). [The existing clearDone helper, lines 64–72](https://github.com/michaelportale/openGym/blob/bf57f13e9e8f750fe76e33f020bdc41d52e128af/native/src/session/fold.js#L64-L72) already resets both limb flags correctly for undo.

**Smallest fix:** Reuse `clearDone` when creating rows in both add paths. Do not change shared `hasCompletedWork`, which correctly counts actual one-limb work elsewhere.

**Acceptance test:** Supply a copied per-side row with both flags true, then another with only one limb true. For both `addExercise` and `addSet`, assert zero completed sets/reps/load-reps before a commit and after journal replay. Finishing before a commit must not add that exercise to completed history. Then commit actual limb work and verify it counts.

**If skipped:** Copying a previous exercise can fabricate completed workout history. This is a confirmed session-library defect; the current workout preview has not yet been wired to this hook.

Minimal reproduction after opening a session with an ordinary uncompleted bench set:

```js
await session.addExercise({
  eventId: 'add-curl', exerciseId: 'curl',
  entry: { id: 'curl', sets: [{
    done: true,
    sides: {
      L: { w: 20, r: 5, done: true },
      R: { w: 20, r: 5, done: true },
    },
  }] },
})
console.log(session.view().totals)
// Actual: completedSets: 1, reps: 10, loadReps: 200.
// Expected: all zero; no set.commit has happened.
await session.finish({ eventId: 'finish' })
// Actual: finished.entries contains curl.
```

### Previously reported recovery issue

[#62](https://github.com/michaelportale/openGym/pull/62)'s review noted that an unfinished stored journal could be hidden by a different, already-finished incoming base. [#63](https://github.com/michaelportale/openGym/pull/63) changes that branch so the unfinished journal wins and adds a regression test. The diff and connected recovery/controller path were inspected; the aggregate tests below include the new test. This specific issue is fixed in #63. F001 and F002 were separately fixed later by #69 and #70.

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

## 10:00 p.m. independent follow-up

What these changes do: #69 serializes controller operations so finish waits for earlier commands; #70 removes the unavailable-clone dependency through the entire session lifecycle, including shared snapshot copying. #64/#66 add set/exercise editing, #71 guards the last exercise, and #72 preserves the session when discard fails.

**Exact integration tested:** [`bf57f13e9e8f750fe76e33f020bdc41d52e128af`](https://github.com/michaelportale/openGym/commit/bf57f13e9e8f750fe76e33f020bdc41d52e128af) (merge #72), Node 22.17.0, clean isolated worktree. All four package suites and their applicable source checks passed. Historical PR heads were not each given all four suites; the two fixing heads received the separate focused runs listed below.

| Check | Independent result |
| --- | --- |
| Native `npm run verify` | 37 files / 283 tests pass; shared bare-Node load and boundary scan pass (34 shared / 67 native files) |
| Frontend `npm ci`, tests and production build | 462 files / 5,768 tests pass; production build passes |
| Locales and source-string check | 18 locales × 2,586 keys in sync; all 2,050 detected source strings present |
| Fatigue probes | 108,000 monotonic comparisons pass, largest increase 0; 1,800 history-edit comparisons pass |
| API `npm ci --omit=optional`, tests, generated assets, core loadability | 628 tests pass; generated catalogue/prompts in sync; bare-Node core loads |
| MCP `npm ci`, tests and Node-loadability | 95 tests pass; full MCP import graph loads under bare Node |
| #69 exact head `549db024a8c1ece2376dee13be9e06bf84ca9a17` | Controller regression file: 6 tests pass |
| #70 exact head `dbd045e60aea1e6aa732ef0e8294cb031ad4771c` | Finish regression file: 8 tests pass |
| Independent F001 and F002 probes at merge #72 | Both pass; one saved set/volume 300/one send/no orphan; complete lifecycle without global clone |
| Independent F003 probes at merge #72 | Both add paths reproduce fabricated completed work |
| CI at merge #72 | Zero check runs and zero statuses; pending aggregate is not passing CI |
| Docker and device checks | Not run: no image/runtime packaging changes in reviewed fixes; actual device/Expo SQLite remain unverified |

The connector cannot read the Actions permissions endpoint, so its enabled/disabled setting was not independently re-confirmed; current `CLAUDE.md` says disabled and the tested commit has no CI results. Build/module-format warnings were left visible. Only documentation was pushed by this audit.

Reviewed full diffs and connected paths this pass: **#45, #64, #66, #69, #70, #71, #72**. Existing review comments and inline thread states were checked (no unresolved inline threads on these PRs). F003 blocks #66's added-row behavior. #71 fixes #66's earlier last-exercise-removal issue. PRs #65 and #67 are draft running-document PRs; #73 was still draft at the last inventory, so no PR was eligible for an automatic merge.

Verdict: F001 and F002 resolved; fix F003 before treating copied-set initialization as correct. Remaining queued reviews are not approvals.


## 10:30 p.m. backlog review and validation

What these changes do: #43 establishes the science registry and its audit; #42 supplies the journal, replay and timer layer; #46 adds native warm-up and progression helpers; #47 adds effort display, the Why-this presentation model and explicit routine migration. #52 repairs the native React peer dependency lock.

Full submitted changes and historical merge results were read for **#43, #42, #46 and #47**, with connected callers, shared helpers, tests, PR discussions and inline thread state. Their changed code matches their submitted heads in the merge result. Source review of #52’s complete lockfile-only diff and discussion independently confirms the repair. No unresolved inline threads were returned for these five PRs. F003 remains the actionable blocker for #42; no additional blocking finding was established in the four other reviewed changes.

### V001 — historical clean-install obstacle, fixed later by #52

An actual Node 22 `npm ci --no-audit --no-fund` at #43 head `80d9eca91cbc08a3e69c01facd9aad905c743f35` fails with **ERESOLVE**: the lock selects `react-dom@19.3.1`, requiring `react ^19.3.1`, while the manifest pins `react@19.3.0`. No force or legacy-peer-deps bypass was used. The manifest and lock blobs are identical at #42, #43, #46 and #47 (lock `dc23fad6df2426ec8dc347211746535d0d768097`); the failure was executed at #43, not falsely attributed as four separate install runs.

[#52](https://github.com/michaelportale/openGym/pull/52) changes the locked React DOM version/peer to 19.3.0. The fixed lock blob `d90344cc9340cfa8468e0f459b9795d61b9d6a80` is still present at merges #77 and #79. A normal clean install at exact merge #77 independently succeeds.

To obtain useful historical source evidence, a separate detached checkout used the dependency installation from #77 through an untracked `node_modules` symlink. **These are exact-source tests with newer dependencies, not clean historical build passes.** No tracked source or lockfile was changed.

| Exact source/test target | Independent result |
| --- | --- |
| #43 head `80d9eca91cbc08a3e69c01facd9aad905c743f35` | Registry, warm-up exclusion and audit: 3 files / 16 tests pass with #77 dependencies |
| #42 head `e1d93df0a4de3b4cf0018e0370d6b2669978ac10` | Journal session tests: 1 file / 15 tests pass with #77 dependencies |
| #46 head `4067e1963669738061baefb2d7e190b2e8f29372` | Native progression, prompt, ramp and registry: 4 files / 25 tests pass with #77 dependencies |
| #47 head `5c786a36e00d5185a62929ff18b5749ed88fec88` | Effort, migration, ramp, Why-this model and registry: 5 files / 25 tests pass with #77 dependencies |
| Merge #77 `8fb678a4d07eb245583cfb64eb3e0ef0517588db` | Native clean install and verification pass: 38 files / 297 tests, bare-Node shared load and boundaries |
| Merge #79 `8bfbf93e7ae36e7ea3817228d05773c9cae423a5` | Native verification passes: 38 files / 300 tests, bare-Node shared load and boundaries; reuses unchanged manifest/lock installation from #77 |
| F003 at exact merge #79 | Both add paths still count 1 set / 10 reps / 200 load-reps before commit and include the exercise in finished history |
| GitHub configuration / checks | Authenticated CLI confirms Actions `enabled:false`; no classic protection on `native/phase-1`; rulesets list empty. Merge #79 has zero check runs. Missing CI remains missing evidence. |

Frontend, API, MCP and workflow sources have no changes between tested merge #72 and merge #77; their previous results remain attributed to **#72**, not to historical PR heads. The later #78/#79 changes are native only. No Docker/image changes are involved in this review tranche. Real-device rendering, real Expo SQLite execution and independent reading of the science papers were not performed; science review here checked code behavior, declared evidence boundaries and registry/document consistency.

The final inventory was paged to exhaustion: 81 total records on a 100-record page, with 36 actual merge timestamps in the fixed window, across all bases. #65 and #67 are draft documentation PRs. #80 and #81 are draft code PRs; their diffs/discussions/thread states were read for triage, but they have not received exact-head validation or approval. #78 merged externally during this run and is now in the queued ledger. No PR was merged by this audit.

The ledger now records both the PR’s recorded base SHA and the **actual historical first merge parent**; they differ when other PRs merged in between. Every listed merge’s second parent was checked against its recorded PR head. This records commit identity, not a passing review.

Verdict: fix F003. Historical clean-install validation remains blocked for the old dependency snapshot, despite the later repair. Remaining queued entries are unfinished. Next oldest review targets are #44 and #48.

## 11:00 p.m. backlog review and validation

**Scope and verdict.** Full submitted changes, historical merge results, connected callers/tests, discussions and inline thread states were read for #44, #48, #49, #51, #53 and #50. No new blocking finding was established in these six changes. F003 still requires a fix. #86 was also inspected when it was an open draft; another actor merged it during this run. Its atomic stamp/trail update passes the real-SQLite interleave probe, but its test double now encodes an incorrect JSON behavior (N001). No PR was merged by this audit.

- #44: tab destinations, accessibility flags, focus treatment and preview controls; inspected their screen/control callers and installed router prop definitions. #50 supplies the subsequent non-iOS glyph fallback. Actual device accessibility and drawing remain unverified.
- #48: SQLite journal/base/draft adapter, controller and hook. Bound values, duplicate events, restoration and error paths were traced. The later finish race is preserved as F001, fixed by #69. A real SQLite trigger probe passes at the original #48 head as well as the current tested integration commit.
- #49/#51/#53: missing/TODO population handling, stored rep-range preservation, status evidence and an intentionally absent weekly numerical target. No new scientific claims were validated from papers; these reviews check implementation and declared evidence boundaries.
- #50: fallback map, platform dispatch and button/workout callers. The later #59 iOS-name relaxation remains a separate queued review.
- Changed source at these six heads matches their actual merge result. The only changed-path difference is #53’s status document, where the merge preserves #51’s PR citations; that difference was read. All 45 recorded merge commits have the recorded PR head as their second parent; their actual first parents are in the ledger.

**Exact historical source tests.** A separate detached checkout used the clean dependency installation from merge #85 through an untracked symlink. All six old heads have the same manifest and old lock blobs as V001. These passes do **not** claim clean installation at the old heads, and the blocked historical install remains visible.

| Exact source/test target | Independent result |
| --- | --- |
| #44 head `c4ad23fa4dc8993998b90d3fb9c8635ff0932997` | Shell, accessibility/focus, preview actions and theme: 6 files / 52 tests pass |
| #48 head `050e40eb132d122117872a025d87f74f0a4abd1f` | Storage contract, controller and hook: 3 files / 19 tests pass; dependency-free real SQLite probe also passes |
| #49 head `ff5314246abd96d03a256faa082be36f8682dc95` | Rules, rep-range and Why-this model: 3 files / 15 tests pass |
| #51 head `936450a6625779cb414e3e54bcfa91a355675cbd` | Rules: 1 file / 9 tests pass |
| #53 head `91d34abdbd511413f1512df551702679b820a586` | Rules and weekly volume: 2 files / 10 tests pass |
| #50 head `a89cbb6a749d7834e49143e32132316008dab7bb` | Symbol fallback: 1 file / 4 tests pass |
| #86 final head `fef5f1f5f0303548dc1ddb8c13e726bdf12008ad` | Storage contract: 1 file / 22 tests pass; real SQLite interleave passes. Reuses unchanged manifest/fixed lock installation from #85. Full suites were not rerun at #86. Its four changed files match merge `164aeb4ceb60b5586f4ebf2f5cf7ae308dd2892e`. |

**Full integration validation ran at exactly [merge #85 `2e2fafd4efb34b94ff60da7a520e5fb2ad94f25a`](https://github.com/michaelportale/openGym/commit/2e2fafd4efb34b94ff60da7a520e5fb2ad94f25a), on Node 22.17.0:**

| Check | Independent result at merge #85 |
| --- | --- |
| Frontend | Normal `npm ci`; 462 files / 5,768 tests pass; production build passes; 18 locales / 2,586 keys in sync; 2,050 source strings present; fatigue probes pass 108,000 monotonic and 1,800 deletion comparisons |
| API | Normal `npm ci --omit=optional`; 628 tests pass; coach assets check and bare-Node core load pass |
| MCP | Normal `npm ci`; 3 files / 95 tests pass; complete plain-Node import graph check passes |
| Native | Normal `npm ci`; `npm run verify`: 39 files / 309 tests pass; shared-load and boundary checks pass (34 shared / 67 native files) |
| iOS JavaScript bundle | `CI=1 npm exec -- expo export --platform ios` succeeds, producing the Hermes bundle. This is not a device/simulator/native build or a HealthKit runtime check |
| Real SQLite journal | Node 22’s SQLite 3.50.0, in-memory injected adapter: injection-shaped event id stays a bound value, duplicate append is suppressed, drafts/base round-trip, a trigger aborting draft deletion rolls back every table, and a later clear succeeds |
| F003 | Both add paths still produce 1 completed set / 10 reps / 200 load-reps before a commit, survive replay, and enter finished history. The affected fold source is unchanged through snapshot merge #88 `1521ab7b70390100012b428eba2a03c880c66522` |
| CI and protections | Actions disabled; merge #85 has zero check runs; no classic protection on `native/phase-1`; rulesets empty. These facts do not replace required validation |

Frontend build warnings about chunk size and ineffective dynamic imports remain warnings; source-string checking retains its report-only policy. No image/runtime packaging changed in this tranche, so Docker image/boot checks were not applicable to these reviews. Real Expo SQLite and device rendering were not run. The real-SQLite probes use temporary in-memory data, no production data or credentials.

The real SQLite rollback probe at **#48’s original head** independently verifies that its explicit BEGIN/run/COMMIT sequence preserves event, draft and base rows after a trigger abort; this is not a result borrowed from the later #73 implementation. The later #73/#75 changes still need their own complete review.

**Closing inventory:** one 100-record page returned 89 PRs, exhausting the API; 45 actual merge timestamps fall in the fixed window across all bases. Nine merges were added since the prior report: #80, #81, #83, #82, #84, #85, #87, #86 and #88, in actual merge order. Full-suite results above stop at #85. They are not results for later merges or each historical head.

The closing 11:10 p.m. snapshot has #65 and #67 as draft documentation PRs, plus new draft code PR #89. #65 is excluded from recursive audit. #67 head `a2deecab9370b4aede135528ffff52ffa5ab9763`, recorded PR base `8bfbf93e7ae36e7ea3817228d05773c9cae423a5`, is mergeable with no check runs, reviews or inline threads; its full running-log diff was read. Its author test claims are not independent evidence and it stays draft. The live integration branch was separately fetched at merge #88. #89 head `f6ba6d36538baf6a04964535119756f0b08b88d3`, base `1521ab7b70390100012b428eba2a03c880c66522`, is draft and mergeable. Its full two-file diff, test cases, discussion and thread state were read for triage; no reviews or inline threads were returned. Exact-head validation is queued, and author test claims do not satisfy it. No code PR qualifies for an audit merge at this snapshot.

### N001 — Optional / P3: the SQLite fake invents array quoting

**Status: open; test-fidelity feedback, not a demonstrated production failure.** Introduced in #86 final head [`fef5f1f5f0303548dc1ddb8c13e726bdf12008ad`](https://github.com/michaelportale/openGym/commit/fef5f1f5f0303548dc1ddb8c13e726bdf12008ad), and unchanged in merge #88.

**Where:** [fake-sqlite.js lines 127–131](https://github.com/michaelportale/openGym/blob/fef5f1f5f0303548dc1ddb8c13e726bdf12008ad/native/src/session/fake-sqlite.js#L127) turns an array into a string unless its SQL text contains the extra `json()` wrapper. [sqlite-storage.js lines 113–116](https://github.com/michaelportale/openGym/blob/fef5f1f5f0303548dc1ddb8c13e726bdf12008ad/native/src/session/sqlite-storage.js#L113) repeats that claim.

**Concrete reproduction:** SQLite 3.50.0 evaluates `json_set('{}', '$.trail', json_extract('{"trail":[10,20]}', '$.trail'))` to `{"trail":[10,20]}`, with JSON type `array`. More strongly, the complete pre-wrapper UPSERT at #86 revision `1a3a0ed7d31914978b239d056a2ecf8ce95f94fa` was executed through the actual adapter using real SQLite. No-metadata, stamp-only, trail-only and both-metadata rows retained the intended shapes. Holding the base read while saving a newer stamp/trail retained `30` and `[10,20,30]`. The final wrapped revision also passes that interleave.

**Why:** SQLite preserves JSON interpretation when a value comes directly from another JSON function; ordinary bound TEXT differs. This matches [SQLite’s VALUE-argument documentation](https://www.sqlite.org/json1.html#value_arguments). The test double currently makes a correct direct JSON-function expression fail, so its claimed red/green cycle cannot establish the reported production quoting bug.

**Smallest useful fix:** correct the fake’s direct-`json_extract` semantics and the explanatory comments, and keep a real SQLite adapter contract case for stamp/trail preservation. The existing atomic race fix and harmless explicit `json()` wrapper can remain.

**Acceptance:** original direct-expression and wrapped-expression variants both retain an array; ordinary bound `'[10,20]'` remains a JSON string unless wrapped; concurrent last-seen/base writes retain the latest stamp and trail. Verify on the eventual Expo SQLite runtime too. Until then, runtime equivalence is limited to the independently tested SQLite engine.


## Coverage ledger

Every discovered merged PR in the time window appears here, including PRs merged before #62. A queued or partial entry is **not reviewed/approved**. Listed head/merge IDs identify the review target, not a claim that both have been independently tested.

| PR and title | Merged EST, Nov 6 | Base branch and commits | Head / merge commit | Review status and evidence |
| --- | --- | --- | --- | --- |
| [#43](https://github.com/michaelportale/openGym/pull/43) native: science register, Why this, and warm-up exclusion | 21:00:44 | `native/phase-1`<br>PR base [`79576ed`](https://github.com/michaelportale/openGym/commit/79576ed29a3cf80bd15fe274f4dcccadb08372c2); merge parent [`79576ed`](https://github.com/michaelportale/openGym/commit/79576ed29a3cf80bd15fe274f4dcccadb08372c2) | [`80d9eca`](https://github.com/michaelportale/openGym/commit/80d9eca91cbc08a3e69c01facd9aad905c743f35) / [`db01387`](https://github.com/michaelportale/openGym/commit/db013879bb60224fec70439bc817a8ff5db67c5d) | Reviewed — registry/audit/warm-up flow; 16 exact-head source tests; historical install blocked (V001, fixed later by #52) |
| [#42](https://github.com/michaelportale/openGym/pull/42) native: durable workout journal (phase 2) | 21:00:52 | `native/phase-1`<br>PR base [`79576ed`](https://github.com/michaelportale/openGym/commit/79576ed29a3cf80bd15fe274f4dcccadb08372c2); merge parent [`db01387`](https://github.com/michaelportale/openGym/commit/db013879bb60224fec70439bc817a8ff5db67c5d) | [`e1d93df`](https://github.com/michaelportale/openGym/commit/e1d93df0a4de3b4cf0018e0370d6b2669978ac10) / [`9545119`](https://github.com/michaelportale/openGym/commit/95451197b11ca6df1d15f15d9f668e68982d66fd) | Blocked — F003 remains open; full journal source review and 15 exact-head source tests; F002 fixed by #70; V001 |
| [#45](https://github.com/michaelportale/openGym/pull/45) native: phase 2 follow-up on merged phase-1 | 21:05:07 | `native/phase-1`<br>PR base [`9545119`](https://github.com/michaelportale/openGym/commit/95451197b11ca6df1d15f15d9f668e68982d66fd); merge parent [`9545119`](https://github.com/michaelportale/openGym/commit/95451197b11ca6df1d15f15d9f668e68982d66fd) | [`9e9fc5c`](https://github.com/michaelportale/openGym/commit/9e9fc5c0fd5649f845c3d72f98e325a979dd18f7) / [`5803e7a`](https://github.com/michaelportale/openGym/commit/5803e7acd57470d19174589fbef338abfdac13ce) | Reviewed — UUID/fallback and callers; integrated tests at bf57f13 |
| [#46](https://github.com/michaelportale/openGym/pull/46) native: 40/80 warm-ups and double progression | 21:07:15 | `native/phase-1`<br>PR base [`9545119`](https://github.com/michaelportale/openGym/commit/95451197b11ca6df1d15f15d9f668e68982d66fd); merge parent [`5803e7a`](https://github.com/michaelportale/openGym/commit/5803e7acd57470d19174589fbef338abfdac13ce) | [`4067e19`](https://github.com/michaelportale/openGym/commit/4067e1963669738061baefb2d7e190b2e8f29372) / [`d650088`](https://github.com/michaelportale/openGym/commit/d6500889e46b87d629e4da8ab537dfeed674146e) | Reviewed — ramp/prompt/prescription and connected helpers; 25 exact-head source tests; V001 |
| [#47](https://github.com/michaelportale/openGym/pull/47) native: effort, Why-this sheet, and opt-in linear migration | 21:12:31 | `native/phase-1`<br>PR base [`d650088`](https://github.com/michaelportale/openGym/commit/d6500889e46b87d629e4da8ab537dfeed674146e); merge parent [`d650088`](https://github.com/michaelportale/openGym/commit/d6500889e46b87d629e4da8ab537dfeed674146e) | [`5c786a3`](https://github.com/michaelportale/openGym/commit/5c786a36e00d5185a62929ff18b5749ed88fec88) / [`0048ee5`](https://github.com/michaelportale/openGym/commit/0048ee54cfb48a5f5eb6f39f3a374db4af1cb023) | Reviewed — effort/opt-in migration/Why-this model; 25 exact-head source tests; V001; no device rendering |
| [#44](https://github.com/michaelportale/openGym/pull/44) native: lock the five-tab shell and Workout preview | 21:13:35 | `native/phase-1`<br>PR base [`d650088`](https://github.com/michaelportale/openGym/commit/d6500889e46b87d629e4da8ab537dfeed674146e); merge parent [`0048ee5`](https://github.com/michaelportale/openGym/commit/0048ee54cfb48a5f5eb6f39f3a374db4af1cb023) | [`c4ad23f`](https://github.com/michaelportale/openGym/commit/c4ad23fa4dc8993998b90d3fb9c8635ff0932997) / [`bd904da`](https://github.com/michaelportale/openGym/commit/bd904da7fd6ec698d94978fc61e7643744c7621b) | Reviewed — shell/accessibility/preview flow; 52 exact-source tests; historical install blocked V001; device rendering unverified |
| [#48](https://github.com/michaelportale/openGym/pull/48) native: sqlite session adapter and active-session hook | 21:15:17 | `native/phase-1`<br>PR base [`d650088`](https://github.com/michaelportale/openGym/commit/d6500889e46b87d629e4da8ab537dfeed674146e); merge parent [`bd904da`](https://github.com/michaelportale/openGym/commit/bd904da7fd6ec698d94978fc61e7643744c7621b) | [`050e40e`](https://github.com/michaelportale/openGym/commit/050e40eb132d122117872a025d87f74f0a4abd1f) / [`aac6bcc`](https://github.com/michaelportale/openGym/commit/aac6bcc9a96b7282aaab34324e902d991ace9cd4) | Reviewed — SQLite/controller/hook; 19 exact-source tests and real SQLite rollback/binding probe; historical install blocked V001; later F001 fixed by #69 |
| [#49](https://github.com/michaelportale/openGym/pull/49) native: hide TODO populations on Why this | 21:17:57 | `native/phase-1`<br>PR base [`aac6bcc`](https://github.com/michaelportale/openGym/commit/aac6bcc9a96b7282aaab34324e902d991ace9cd4); merge parent [`aac6bcc`](https://github.com/michaelportale/openGym/commit/aac6bcc9a96b7282aaab34324e902d991ace9cd4) | [`ff53142`](https://github.com/michaelportale/openGym/commit/ff5314246abd96d03a256faa082be36f8682dc95) / [`e28c151`](https://github.com/michaelportale/openGym/commit/e28c151057ed162f74a24fe84bcf46534353e385) | Reviewed — population/rep-range flow; 15 exact-source tests; historical install blocked V001 |
| [#51](https://github.com/michaelportale/openGym/pull/51) native: cite a PR on every Phase 4 status row | 21:21:35 | `native/phase-1`<br>PR base [`e28c151`](https://github.com/michaelportale/openGym/commit/e28c151057ed162f74a24fe84bcf46534353e385); merge parent [`e28c151`](https://github.com/michaelportale/openGym/commit/e28c151057ed162f74a24fe84bcf46534353e385) | [`936450a`](https://github.com/michaelportale/openGym/commit/936450a6625779cb414e3e54bcfa91a355675cbd) / [`ab318c8`](https://github.com/michaelportale/openGym/commit/ab318c8302ec2202c85da6287f74a14403b3bdf0) | Reviewed — status citations and rule tests; 9 exact-source tests; historical install blocked V001 |
| [#53](https://github.com/michaelportale/openGym/pull/53) native: ship no weekly set target | 21:21:42 | `native/phase-1`<br>PR base [`e28c151`](https://github.com/michaelportale/openGym/commit/e28c151057ed162f74a24fe84bcf46534353e385); merge parent [`ab318c8`](https://github.com/michaelportale/openGym/commit/ab318c8302ec2202c85da6287f74a14403b3bdf0) | [`91d34ab`](https://github.com/michaelportale/openGym/commit/91d34abdbd511413f1512df551702679b820a586) / [`798e337`](https://github.com/michaelportale/openGym/commit/798e33731d2ac721a35b73cd4020449220d9332d) | Reviewed — absent weekly target and merge-preserved citations; 10 exact-source tests; historical install blocked V001 |
| [#50](https://github.com/michaelportale/openGym/pull/50) native: show a glyph when SF Symbols are not drawn | 21:23:35 | `native/phase-1`<br>PR base [`e28c151`](https://github.com/michaelportale/openGym/commit/e28c151057ed162f74a24fe84bcf46534353e385); merge parent [`798e337`](https://github.com/michaelportale/openGym/commit/798e33731d2ac721a35b73cd4020449220d9332d) | [`a89cbb6`](https://github.com/michaelportale/openGym/commit/a89cbb6a749d7834e49143e32132316008dab7bb) / [`3ce543c`](https://github.com/michaelportale/openGym/commit/3ce543c29789a1357395d8710bad5757398f9791) | Reviewed — platform glyph dispatch/callers; 4 exact-source tests; historical install blocked V001; device drawing unverified |
| [#52](https://github.com/michaelportale/openGym/pull/52) native: lock react-dom to 19.3.0 | 21:23:37 | `native/phase-1`<br>PR base [`e28c151`](https://github.com/michaelportale/openGym/commit/e28c151057ed162f74a24fe84bcf46534353e385); merge parent [`3ce543c`](https://github.com/michaelportale/openGym/commit/3ce543c29789a1357395d8710bad5757398f9791) | [`7fe4405`](https://github.com/michaelportale/openGym/commit/7fe440582187a5715751a6dce5724c0b35d22e82) / [`6d53231`](https://github.com/michaelportale/openGym/commit/6d53231c943ec63bea07f4ea69a42603fbe7cb10) | Reviewed — lockfile-only React peer fix; submitted/merged lock identical; clean install independently passes at merge #77 |
| [#54](https://github.com/michaelportale/openGym/pull/54) native: finish a session into the stored workout | 21:24:28 | `native/phase-1`<br>PR base [`798e337`](https://github.com/michaelportale/openGym/commit/798e33731d2ac721a35b73cd4020449220d9332d); merge parent [`6d53231`](https://github.com/michaelportale/openGym/commit/6d53231c943ec63bea07f4ea69a42603fbe7cb10) | [`a83bf3d`](https://github.com/michaelportale/openGym/commit/a83bf3df57ade15298cd54de6f025c7000b7b42f) / [`89896e2`](https://github.com/michaelportale/openGym/commit/89896e2f7cbd5947c67a9332979a16a26197a7da) | F001/F002 fixed by #69/#70; broader review queued |
| [#55](https://github.com/michaelportale/openGym/pull/55) native: cover rounding, bar edges, RIR bounds, and migration idempotence | 21:25:10 | `native/phase-1`<br>PR base [`798e337`](https://github.com/michaelportale/openGym/commit/798e33731d2ac721a35b73cd4020449220d9332d); merge parent [`89896e2`](https://github.com/michaelportale/openGym/commit/89896e2f7cbd5947c67a9332979a16a26197a7da) | [`ee0ac21`](https://github.com/michaelportale/openGym/commit/ee0ac2191630d1182ccc5fa5f2d827fb1b6c48f7) / [`bc048de`](https://github.com/michaelportale/openGym/commit/bc048de7f6d13b592ddfc6fb043fa5f6c932ca4f) | Queued — not independently reviewed |
| [#56](https://github.com/michaelportale/openGym/pull/56) native: list science defaults that still need a source | 21:27:04 | `native/phase-1`<br>PR base [`bc048de`](https://github.com/michaelportale/openGym/commit/bc048de7f6d13b592ddfc6fb043fa5f6c932ca4f); merge parent [`bc048de`](https://github.com/michaelportale/openGym/commit/bc048de7f6d13b592ddfc6fb043fa5f6c932ca4f) | [`a60b614`](https://github.com/michaelportale/openGym/commit/a60b614f615ebfc2fddd2cede1f4c114dff2cb81) / [`cedf787`](https://github.com/michaelportale/openGym/commit/cedf78762265239573a70af344c3b946f81bdfcc) | Queued — not independently reviewed |
| [#58](https://github.com/michaelportale/openGym/pull/58) native: science standup brief for 6 November | 21:29:10 | `native/phase-1`<br>PR base [`cedf787`](https://github.com/michaelportale/openGym/commit/cedf78762265239573a70af344c3b946f81bdfcc); merge parent [`cedf787`](https://github.com/michaelportale/openGym/commit/cedf78762265239573a70af344c3b946f81bdfcc) | [`e8db45a`](https://github.com/michaelportale/openGym/commit/e8db45ab978d3840299f9b815b7c1e43b07db4cd) / [`f1ce4da`](https://github.com/michaelportale/openGym/commit/f1ce4da256de41574759f9530f414ff434be9923) | Queued — not independently reviewed |
| [#57](https://github.com/michaelportale/openGym/pull/57) native: store each finished workout by id and date | 21:29:19 | `native/phase-1`<br>PR base [`cedf787`](https://github.com/michaelportale/openGym/commit/cedf78762265239573a70af344c3b946f81bdfcc); merge parent [`f1ce4da`](https://github.com/michaelportale/openGym/commit/f1ce4da256de41574759f9530f414ff434be9923) | [`4564a9a`](https://github.com/michaelportale/openGym/commit/4564a9a884a5de12ee61885dc2ed2d1a6f080ed9) / [`007604a`](https://github.com/michaelportale/openGym/commit/007604ae8141e131051bb7d1b021f0ffae4fc08c) | Queued — not independently reviewed |
| [#59](https://github.com/michaelportale/openGym/pull/59) native: let iOS draw a symbol that has no text glyph | 21:29:54 | `native/phase-1`<br>PR base [`cedf787`](https://github.com/michaelportale/openGym/commit/cedf78762265239573a70af344c3b946f81bdfcc); merge parent [`007604a`](https://github.com/michaelportale/openGym/commit/007604ae8141e131051bb7d1b021f0ffae4fc08c) | [`417dd1a`](https://github.com/michaelportale/openGym/commit/417dd1a01141b09bb7b237fe4e232c210dd9bf84) / [`ec479cb`](https://github.com/michaelportale/openGym/commit/ec479cb5c3f9fa4d0e2f9b346bedc86b55c0f1bd) | Queued — not independently reviewed |
| [#60](https://github.com/michaelportale/openGym/pull/60) native: wire finished workouts through the session hook | 21:33:56 | `native/phase-1`<br>PR base [`ec479cb`](https://github.com/michaelportale/openGym/commit/ec479cb5c3f9fa4d0e2f9b346bedc86b55c0f1bd); merge parent [`ec479cb`](https://github.com/michaelportale/openGym/commit/ec479cb5c3f9fa4d0e2f9b346bedc86b55c0f1bd) | [`52b745a`](https://github.com/michaelportale/openGym/commit/52b745a1ad3f8004dc5755de0d05298c4368ee13) / [`9588390`](https://github.com/michaelportale/openGym/commit/9588390959770fed53b05e3248a3e989f3a650e1) | Queued — not independently reviewed |
| [#61](https://github.com/michaelportale/openGym/pull/61) native: keep the symbol scanner out of the app tree | 21:34:21 | `native/phase-1`<br>PR base [`ec479cb`](https://github.com/michaelportale/openGym/commit/ec479cb5c3f9fa4d0e2f9b346bedc86b55c0f1bd); merge parent [`9588390`](https://github.com/michaelportale/openGym/commit/9588390959770fed53b05e3248a3e989f3a650e1) | [`4884129`](https://github.com/michaelportale/openGym/commit/488412950a387c33b094115c990b1af0c0e1973b) / [`5b658da`](https://github.com/michaelportale/openGym/commit/5b658dab174248f942233718021b245946fd7b32) | Queued — not independently reviewed |
| [#62](https://github.com/michaelportale/openGym/pull/62) native: replay an open journal and skip a finished one | 21:37:43 | `native/phase-1`<br>PR base [`5b658da`](https://github.com/michaelportale/openGym/commit/5b658dab174248f942233718021b245946fd7b32); merge parent [`5b658da`](https://github.com/michaelportale/openGym/commit/5b658dab174248f942233718021b245946fd7b32) | [`7a7bd37`](https://github.com/michaelportale/openGym/commit/7a7bd371e8f0217396e0290f9a70d2d2b9828242) / [`b7d2d24`](https://github.com/michaelportale/openGym/commit/b7d2d249645787d27b620a2bf96711aa892b7069) | Recovery follow-up fixed by #63; broader review queued |
| [#63](https://github.com/michaelportale/openGym/pull/63) native: restore an unfinished journal ahead of a finished base | 21:41:19 | `native/phase-1`<br>PR base [`b7d2d24`](https://github.com/michaelportale/openGym/commit/b7d2d249645787d27b620a2bf96711aa892b7069); merge parent [`b7d2d24`](https://github.com/michaelportale/openGym/commit/b7d2d249645787d27b620a2bf96711aa892b7069) | [`259de62`](https://github.com/michaelportale/openGym/commit/259de62280a20ad5323e84d5caa42281a0ce85df) / [`018621e`](https://github.com/michaelportale/openGym/commit/018621ed6905d36e52baccfb18353bb813d88272) | Focused recovery review; broader review queued |
| [#64](https://github.com/michaelportale/openGym/pull/64) native: edit and delete a committed set | 21:43:59 | `native/phase-1`<br>PR base [`018621e`](https://github.com/michaelportale/openGym/commit/018621ed6905d36e52baccfb18353bb813d88272); merge parent [`018621e`](https://github.com/michaelportale/openGym/commit/018621ed6905d36e52baccfb18353bb813d88272) | [`f36421b`](https://github.com/michaelportale/openGym/commit/f36421bfe361da786aefd9a9cbe71ed7890994c1) / [`946f9f4`](https://github.com/michaelportale/openGym/commit/946f9f4b43357d049727874725aa297a9fe6c066) | Reviewed — edit/delete/replay guards; integrated tests at bf57f13 |
| [#66](https://github.com/michaelportale/openGym/pull/66) native: add and remove an exercise mid-session | 21:48:12 | `native/phase-1`<br>PR base [`946f9f4`](https://github.com/michaelportale/openGym/commit/946f9f4b43357d049727874725aa297a9fe6c066); merge parent [`946f9f4`](https://github.com/michaelportale/openGym/commit/946f9f4b43357d049727874725aa297a9fe6c066) | [`2d62bdc`](https://github.com/michaelportale/openGym/commit/2d62bdc6e936c843fe982e0cc4219a0b3dc9c206) / [`b973478`](https://github.com/michaelportale/openGym/commit/b973478fe795507e65f90dd5cfaaba39f215681f) | Blocked: F003; last-exercise issue fixed by #71 |
| [#68](https://github.com/michaelportale/openGym/pull/68) native: correct the standup warm-up bar example | 21:53:14 | `native/phase-1`<br>PR base [`b973478`](https://github.com/michaelportale/openGym/commit/b973478fe795507e65f90dd5cfaaba39f215681f); merge parent [`b973478`](https://github.com/michaelportale/openGym/commit/b973478fe795507e65f90dd5cfaaba39f215681f) | [`bb24868`](https://github.com/michaelportale/openGym/commit/bb2486889304d6e835b9a96028b41b9ab1022dbc) / [`d053d46`](https://github.com/michaelportale/openGym/commit/d053d46a271e0dcca9dde578dc233a78b0ae9662) | Queued — not independently reviewed |
| [#69](https://github.com/michaelportale/openGym/pull/69) native: serialize session commands ahead of finish | 21:56:24 | `native/phase-1`<br>PR base [`b973478`](https://github.com/michaelportale/openGym/commit/b973478fe795507e65f90dd5cfaaba39f215681f); merge parent [`d053d46`](https://github.com/michaelportale/openGym/commit/d053d46a271e0dcca9dde578dc233a78b0ae9662) | [`549db02`](https://github.com/michaelportale/openGym/commit/549db024a8c1ece2376dee13be9e06bf84ca9a17) / [`3c4e769`](https://github.com/michaelportale/openGym/commit/3c4e769f2fc711848d8da72e4d4f3193ca8f1434) | Reviewed — F001 fixed; exact-head controller tests pass (6) |
| [#70](https://github.com/michaelportale/openGym/pull/70) native: copy session documents without structuredClone | 21:56:31 | `native/phase-1`<br>PR base [`d053d46`](https://github.com/michaelportale/openGym/commit/d053d46a271e0dcca9dde578dc233a78b0ae9662); merge parent [`3c4e769`](https://github.com/michaelportale/openGym/commit/3c4e769f2fc711848d8da72e4d4f3193ca8f1434) | [`dbd045e`](https://github.com/michaelportale/openGym/commit/dbd045e60aea1e6aa732ef0e8294cb031ad4771c) / [`ba2da91`](https://github.com/michaelportale/openGym/commit/ba2da913b9d64f62bc85842b569d983a0a9f3311) | Reviewed — F002 fixed; exact-head finish tests pass (8) |
| [#71](https://github.com/michaelportale/openGym/pull/71) native: keep at least one exercise in a live session | 21:56:39 | `native/phase-1`<br>PR base [`d053d46`](https://github.com/michaelportale/openGym/commit/d053d46a271e0dcca9dde578dc233a78b0ae9662); merge parent [`ba2da91`](https://github.com/michaelportale/openGym/commit/ba2da913b9d64f62bc85842b569d983a0a9f3311) | [`c00a9a0`](https://github.com/michaelportale/openGym/commit/c00a9a07a8423f17f8fe077267ff1596b1c343ec) / [`f666095`](https://github.com/michaelportale/openGym/commit/f66609519231c03800aaec05faee11bc738f2fcf) | Reviewed — last-exercise guard/replay; integrated tests at bf57f13 |
| [#72](https://github.com/michaelportale/openGym/pull/72) native: keep a failed discard from throwing the session away | 21:59:44 | `native/phase-1`<br>PR base [`f666095`](https://github.com/michaelportale/openGym/commit/f66609519231c03800aaec05faee11bc738f2fcf); merge parent [`f666095`](https://github.com/michaelportale/openGym/commit/f66609519231c03800aaec05faee11bc738f2fcf) | [`304b8fd`](https://github.com/michaelportale/openGym/commit/304b8fde1a31237e0a35ebe9916346dd618bbaad) / [`bf57f13`](https://github.com/michaelportale/openGym/commit/bf57f13e9e8f750fe76e33f020bdc41d52e128af) | Reviewed — failed discard preserves data; integrated tests at bf57f13 |
| [#73](https://github.com/michaelportale/openGym/pull/73) native: clear the session journal in one SQLite transaction | 22:05:25 | `native/phase-1`<br>PR base [`bf57f13`](https://github.com/michaelportale/openGym/commit/bf57f13e9e8f750fe76e33f020bdc41d52e128af); merge parent [`bf57f13`](https://github.com/michaelportale/openGym/commit/bf57f13e9e8f750fe76e33f020bdc41d52e128af) | [`dc5e109`](https://github.com/michaelportale/openGym/commit/dc5e109bc140888daf41095d16e4333d33722310) / [`f363420`](https://github.com/michaelportale/openGym/commit/f363420b7c2d032021827eff6dd179c2276df84c) | Queued — not independently reviewed; integration tests at merge #79 do not constitute review |
| [#74](https://github.com/michaelportale/openGym/pull/74) native: record a session note in the journal | 22:05:34 | `native/phase-1`<br>PR base [`bf57f13`](https://github.com/michaelportale/openGym/commit/bf57f13e9e8f750fe76e33f020bdc41d52e128af); merge parent [`f363420`](https://github.com/michaelportale/openGym/commit/f363420b7c2d032021827eff6dd179c2276df84c) | [`72810bc`](https://github.com/michaelportale/openGym/commit/72810bca064ee6757858216bd85e7661f2081aa0) / [`8a71a1a`](https://github.com/michaelportale/openGym/commit/8a71a1affebe78588e319d5ea0cf01673e68ed60) | Queued — not independently reviewed; integration tests at merge #79 do not constitute review |
| [#75](https://github.com/michaelportale/openGym/pull/75) native: keep a clear failure and cap a session note | 22:11:15 | `native/phase-1`<br>PR base [`8a71a1a`](https://github.com/michaelportale/openGym/commit/8a71a1affebe78588e319d5ea0cf01673e68ed60); merge parent [`8a71a1a`](https://github.com/michaelportale/openGym/commit/8a71a1affebe78588e319d5ea0cf01673e68ed60) | [`e8644e5`](https://github.com/michaelportale/openGym/commit/e8644e5c3e10f5884e856d53043da83002267bfa) / [`3e7198d`](https://github.com/michaelportale/openGym/commit/3e7198db5b4c724d9b1b6eba7bb674aa09c8a54b) | Queued — not independently reviewed; integration tests at merge #79 do not constitute review |
| [#76](https://github.com/michaelportale/openGym/pull/76) native: record an exercise note in the journal | 22:13:27 | `native/phase-1`<br>PR base [`3e7198d`](https://github.com/michaelportale/openGym/commit/3e7198db5b4c724d9b1b6eba7bb674aa09c8a54b); merge parent [`3e7198d`](https://github.com/michaelportale/openGym/commit/3e7198db5b4c724d9b1b6eba7bb674aa09c8a54b) | [`817e22a`](https://github.com/michaelportale/openGym/commit/817e22a759b42e1192761632279e7e76ee7f5dcf) / [`f9d7bc9`](https://github.com/michaelportale/openGym/commit/f9d7bc96fa6a54fa69ab00f91d92695a87f6643a) | Queued — not independently reviewed; integration tests at merge #79 do not constitute review |
| [#77](https://github.com/michaelportale/openGym/pull/77) Keep the session time zone so a killed overnight journal refuses a silent finish | 22:23:16 | `native/phase-1`<br>PR base [`f9d7bc9`](https://github.com/michaelportale/openGym/commit/f9d7bc96fa6a54fa69ab00f91d92695a87f6643a); merge parent [`f9d7bc9`](https://github.com/michaelportale/openGym/commit/f9d7bc96fa6a54fa69ab00f91d92695a87f6643a) | [`bbcbf31`](https://github.com/michaelportale/openGym/commit/bbcbf31526b87f533604e3f098128fab3f4dfd99) / [`8fb678a`](https://github.com/michaelportale/openGym/commit/8fb678a4d07eb245583cfb64eb3e0ef0517588db) | Queued — not independently reviewed; integration tests at merge #79 do not constitute review |
| [#78](https://github.com/michaelportale/openGym/pull/78) Keep the stored session time zone when the base is rewritten | 22:29:49 | `native/phase-1`<br>PR base [`8fb678a`](https://github.com/michaelportale/openGym/commit/8fb678a4d07eb245583cfb64eb3e0ef0517588db); merge parent [`8fb678a`](https://github.com/michaelportale/openGym/commit/8fb678a4d07eb245583cfb64eb3e0ef0517588db) | [`14af0bb`](https://github.com/michaelportale/openGym/commit/14af0bb48420c78b7d022771739b50a7e0cfa1d6) / [`cd43883`](https://github.com/michaelportale/openGym/commit/cd4388378be7f6772589888e2f4a4bd35cee3d65) | Queued — not independently reviewed; integration tests at merge #79 do not constitute review |
| [#79](https://github.com/michaelportale/openGym/pull/79) Leave a short overnight gap out of session elapsed | 22:29:56 | `native/phase-1`<br>PR base [`8fb678a`](https://github.com/michaelportale/openGym/commit/8fb678a4d07eb245583cfb64eb3e0ef0517588db); merge parent [`cd43883`](https://github.com/michaelportale/openGym/commit/cd4388378be7f6772589888e2f4a4bd35cee3d65) | [`83b26f7`](https://github.com/michaelportale/openGym/commit/83b26f7a0797fd46c551bf7f851680b7bd1d67cf) / [`8bfbf93`](https://github.com/michaelportale/openGym/commit/8bfbf93e7ae36e7ea3817228d05773c9cae423a5) | Queued — not independently reviewed; integration tests at merge #79 do not constitute review |

| [#80](https://github.com/michaelportale/openGym/pull/80) Keep the session timer counting through a rest that crosses midnight | 22:34:56 | `native/phase-1`<br>PR base [`8bfbf93`](https://github.com/michaelportale/openGym/commit/8bfbf93e7ae36e7ea3817228d05773c9cae423a5); merge parent [`8bfbf93`](https://github.com/michaelportale/openGym/commit/8bfbf93e7ae36e7ea3817228d05773c9cae423a5) | [`c12bce2`](https://github.com/michaelportale/openGym/commit/c12bce2b78de05cbb785abc455f9c9f3c228a9d0) / [`7bf4b35`](https://github.com/michaelportale/openGym/commit/7bf4b352115d9728e8ae0175b9a8cf02b46564af) | Queued — not independently reviewed; full integration checks pass at merge #85, not this PR head |
| [#81](https://github.com/michaelportale/openGym/pull/81) Treat a replayed pause, cancel, or resume as a duplicate | 22:35:04 | `native/phase-1`<br>PR base [`8bfbf93`](https://github.com/michaelportale/openGym/commit/8bfbf93e7ae36e7ea3817228d05773c9cae423a5); merge parent [`7bf4b35`](https://github.com/michaelportale/openGym/commit/7bf4b352115d9728e8ae0175b9a8cf02b46564af) | [`0eae225`](https://github.com/michaelportale/openGym/commit/0eae2259173762ed7dca325ee58b3ac20ea690c4) / [`02cef12`](https://github.com/michaelportale/openGym/commit/02cef12aafa041e2b9d1f85d89e46fa6afddc068) | Queued — not independently reviewed; full integration checks pass at merge #85, not this PR head |
| [#83](https://github.com/michaelportale/openGym/pull/83) Fold the JSON document so a restart shows the same row | 22:43:13 | `native/phase-1`<br>PR base [`02cef12`](https://github.com/michaelportale/openGym/commit/02cef12aafa041e2b9d1f85d89e46fa6afddc068); merge parent [`02cef12`](https://github.com/michaelportale/openGym/commit/02cef12aafa041e2b9d1f85d89e46fa6afddc068) | [`81a9756`](https://github.com/michaelportale/openGym/commit/81a97565dce8a77de1465dde3217c47702cd26b5) / [`ad1bb34`](https://github.com/michaelportale/openGym/commit/ad1bb3471318216a177031aa57e8cb75f4fc1c7b) | Queued — not independently reviewed; full integration checks pass at merge #85, not this PR head |
| [#82](https://github.com/michaelportale/openGym/pull/82) Keep the last counted instant so a kill cannot rewind the timer | 22:49:18 | `native/phase-1`<br>PR base [`ad1bb34`](https://github.com/michaelportale/openGym/commit/ad1bb3471318216a177031aa57e8cb75f4fc1c7b); merge parent [`ad1bb34`](https://github.com/michaelportale/openGym/commit/ad1bb3471318216a177031aa57e8cb75f4fc1c7b) | [`83f612e`](https://github.com/michaelportale/openGym/commit/83f612ecd0b64b3bd3a5c800a39ac3e48cd097be) / [`d688cd7`](https://github.com/michaelportale/openGym/commit/d688cd77eed450333944dd4a2b7857f9969ad18a) | Queued — not independently reviewed; full integration checks pass at merge #85, not this PR head |
| [#84](https://github.com/michaelportale/openGym/pull/84) Replay a set event as a duplicate after the set is gone | 22:49:25 | `native/phase-1`<br>PR base [`ad1bb34`](https://github.com/michaelportale/openGym/commit/ad1bb3471318216a177031aa57e8cb75f4fc1c7b); merge parent [`d688cd7`](https://github.com/michaelportale/openGym/commit/d688cd77eed450333944dd4a2b7857f9969ad18a) | [`e17b91b`](https://github.com/michaelportale/openGym/commit/e17b91bf4bedb37b7fe510f4f38599aabbb93c8d) / [`fdb229b`](https://github.com/michaelportale/openGym/commit/fdb229b25e885133d5276c20b5e75641126891ec) | Queued — not independently reviewed; full integration checks pass at merge #85, not this PR head |
| [#85](https://github.com/michaelportale/openGym/pull/85) Guard elapsed so a fixed session cannot rewind | 22:57:40 | `native/phase-1`<br>PR base [`fdb229b`](https://github.com/michaelportale/openGym/commit/fdb229b25e885133d5276c20b5e75641126891ec); merge parent [`fdb229b`](https://github.com/michaelportale/openGym/commit/fdb229b25e885133d5276c20b5e75641126891ec) | [`37e5a95`](https://github.com/michaelportale/openGym/commit/37e5a95a0a568c1e7e416bf367af88d84615f99e) / [`2e2fafd`](https://github.com/michaelportale/openGym/commit/2e2fafd4efb34b94ff60da7a520e5fb2ad94f25a) | Queued — not independently reviewed; full integration checks pass at merge #85, not this PR head |
| [#87](https://github.com/michaelportale/openGym/pull/87) Replay an extend as a duplicate after the rest is gone | 23:01:39 | `native/phase-1`<br>PR base [`2e2fafd`](https://github.com/michaelportale/openGym/commit/2e2fafd4efb34b94ff60da7a520e5fb2ad94f25a); merge parent [`2e2fafd`](https://github.com/michaelportale/openGym/commit/2e2fafd4efb34b94ff60da7a520e5fb2ad94f25a) | [`5d91e0d`](https://github.com/michaelportale/openGym/commit/5d91e0d17371753b4ec9b94d7f409194daa81bad) / [`e0c0bdd`](https://github.com/michaelportale/openGym/commit/e0c0bdd6758c5a4f0fcb5ba580c73bd46aab543a) | Queued — not independently reviewed; not included in the full integration run at #85 |
| [#86](https://github.com/michaelportale/openGym/pull/86) Keep a last seen saved while the base is replaced | 23:05:27 | `native/phase-1`<br>PR base [`e0c0bdd`](https://github.com/michaelportale/openGym/commit/e0c0bdd6758c5a4f0fcb5ba580c73bd46aab543a); merge parent [`e0c0bdd`](https://github.com/michaelportale/openGym/commit/e0c0bdd6758c5a4f0fcb5ba580c73bd46aab543a) | [`fef5f1f`](https://github.com/michaelportale/openGym/commit/fef5f1f5f0303548dc1ddb8c13e726bdf12008ad) / [`164aeb4`](https://github.com/michaelportale/openGym/commit/164aeb4ceb60b5586f4ebf2f5cf7ae308dd2892e) | Reviewed — atomic storage update; optional N001 open; 22 exact-source tests and real SQLite interleave pass; full suites last at #85 |
| [#88](https://github.com/michaelportale/openGym/pull/88) Replay an added set as a duplicate after the exercise is gone | 23:05:34 | `native/phase-1`<br>PR base [`e0c0bdd`](https://github.com/michaelportale/openGym/commit/e0c0bdd6758c5a4f0fcb5ba580c73bd46aab543a); merge parent [`164aeb4`](https://github.com/michaelportale/openGym/commit/164aeb4ceb60b5586f4ebf2f5cf7ae308dd2892e) | [`9e46943`](https://github.com/michaelportale/openGym/commit/9e4694339b81cab159c4cb3ede6e9aaf0973cb20) / [`1521ab7`](https://github.com/michaelportale/openGym/commit/1521ab7b70390100012b428eba2a03c880c66522) | Queued — not independently reviewed; not included in the full integration run at #85 |

## Operating rules for subsequent runs

- Re-enumerate all merged PRs by actual merge timestamp in the fixed window, across all base branches; page fully, deduplicate by PR plus head/merge SHA, and append new ledger entries.
- Re-review fixes and mark a finding resolved only after checking the fixing commit and relevant tests. Preserve the original evidence and link the repair.
- Read full diffs, connected code/tests, existing discussions and unresolved threads. Record check outcomes at exact commits. Current evidence takes precedence over author summaries.
- Continue the existing review/merge gate for eligible open PRs during the window. Already-merged defects receive corrective documentation/comments; do not automatically revert or edit application code.
- Update this file on its dedicated docs branch, preserving other edits, and keep its documentation PR discoverable. Do not recursively audit this report PR. Do not merge this rolling docs PR as part of the automatic queue.
- At 7:30 a.m. EST, reconcile the complete fixed window, publish remaining queued/blocked items honestly, and pause the automation. No repeat tomorrow night.
