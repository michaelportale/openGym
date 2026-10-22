# Personal Strength Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a reliable iPhone strength workflow with comparable history, fast logging, suitable substitutions, and coverage-aware adaptation.

**Architecture:** Extend existing exercise metadata, Zustand state, rotation/queue helpers, and workout views. Keep decision logic in pure helpers with colocated tests; reuse current storage, sync, backup and import paths. No new backend service, AI dependency, or native shell is required for the first milestone.

**Tech Stack:** JavaScript, React 19, Vite, Zustand, Vitest; Node 22 API and MCP tooling.

**Spec:** `docs/superpowers/specs/2026-10-21-personal-strength.md`

## Global Constraints

- Plan around 75 minutes, generally 60–90.
- Log load and reps per set, felt RIR on the last working set of each exercise. Never copy that RIR onto earlier sets.
- OpenGym owns structured training records.
- No log does not mean a missed session.
- Propose meaningful future-plan changes with an explanation; apply only after acceptance.
- Do not commit personal workout notes or real health-record fixtures to this source repository.
- Keep existing architecture and dependency footprint.
- Preserve existing policy behavior, historical snapshots, unknown values, equipment/load identity, locale conventions, and pending local edits.

## Review Focus

- Legacy profiles/records lack new fields: migration must preserve their behavior and history (Task 2).
- A swap happens after some sets were logged: completed sets retain original identity and effort (Tasks 3–4).
- Offline completion/retry or duplicate import must not double-count a session or advance rotation twice (Tasks 4 and 7).
- Local date boundaries and off-program sessions must not disappear from rolling coverage (Task 5).
- A proposed adaptation becomes stale after another workout or device edit: reject stale acceptance without losing work (Task 6).

## Delivery sequence

Deliver reviewable increments: research/policy → equipment and logging → coverage and adaptation → private history import and device acceptance. The tasks below are one strength milestone; nutrition and wearables need separate future plans. Record focused commits per completed task on an isolated development branch; do not commit or push this planning-only change unless requested.

### Task 1: Resolve evidence and Fitbod research gates

**Files:** create `docs/dev/PERSONAL_STRENGTH_POLICY.md` and `docs/dev/FITBOD_RESEARCH.md`.

**Interfaces:** produce a versioned policy definition with direct/indirect accounting, exposure criteria, effort-aware progression criteria, rest/duration assumptions, and source/limitation for each rule. Later helpers consume that policy rather than hidden constants.

- [ ] Review the primary research linked in the spec, including full methods where obtainable. Separate population-level findings from chosen application heuristics. Define exact numeric defaults before Tasks 4–6; do not invent a qualifying-exposure threshold merely to finish coding.
- [ ] Obtain the accessible Fitbod Mac installation/account session, then inspect the four requested flows with REA and UI tooling. Do not change subscriptions or account workout history. Capture version, evidence identifiers, verified behaviors and unknowns in the research note; keep raw personal captures outside Git.
- [ ] If Fitbod access remains unavailable, record this as an open investigation. Independent data/logging work can proceed; do not claim matching Fitbod behavior or automatic gym inventory.
- [ ] Review policy consistency against final-set-only RIR: unknown earlier effort cannot satisfy an all-sets-RIR condition. Missing evidence yields an explicitly limited suggestion, not fabricated effort.

### Task 2: Exercise roles and exact equipment identity

**Files:** create `frontend/src/lib/training-metadata.js` and `.test.js`; modify `frontend/src/lib/equipment.js`, `equipment.test.js`, `frontend/src/store/useStore.js`, and the existing equipment/custom-exercise editors in `frontend/src/sheets.jsx` and `views/Settings.jsx`.

**Interfaces:** `trainingMetadataOf(ex) -> { role, primary, secondary, status }`; `equipmentMatch(profile, ex, excludedStationIds=[]) -> { available, status, stationIds }`. Extend profiles additively with `stations: [{id, label, manufacturer?, model?, exerciseIds, loadConvention?}]`; save user metadata overrides in `trainingMetadata` keyed by exercise ID. Preserve the legacy category API.

- [ ] Add failing cases: a chest-press station does not enable a leg curl; rack/barbell without dumbbells excludes DB pressing; missing metadata stays unknown; old category profiles retain compatibility.
- [ ] Run `cd frontend && npx vitest run src/lib/training-metadata.test.js src/lib/equipment.test.js`; confirm failures for new behavior.
- [ ] Add curated roles for the initial PPL movement family and manual overrides. Do not bulk guess metadata for the entire catalog. Distinguish legacy broad availability from confirmed exact-station matches.
- [ ] Wire station selection and load-convention snapshots through routine/active/history entries. Audit restore, sync, export and reset handling for the added state fields using existing store patterns.
- [ ] Add store round-trip tests for legacy state, new fields and unknown custom exercises; run affected tests and commit.

### Task 3: Explainable exercise swaps

**Files:** modify `frontend/src/lib/similar-exercises.js`, `frontend/src/lib/active-exercise-swap.js`, `frontend/src/sheets.jsx`; add colocated ranking and swap tests.

**Interfaces:** `rankReplacements({exercise, candidates, profile, excludedStationIds, workouts, metadata}) -> [{exercise, tier, reasons}]`, consuming Task 2. Rank lexicographically: same role and primary target, compatible related role, then same-muscle fallback; within equivalent suitability use completed-session usage frequency, then stable ID order. Unknown mappings carry a warning and cannot outrank verified matches.

- [ ] Test that a press outranks a fly for replacing a press, familiar equivalent alternatives rank first, occupied stations are excluded, and missing metadata does not produce false equivalence.
- [ ] Run `cd frontend && npx vitest run src/lib/similar-exercises.test.js src/lib/active-exercise-swap.test.js` and observe the new assertions fail before implementation.
- [ ] Implement ranking and reason labels in the existing picker, preserving unrestricted manual exercise search.
- [ ] Keep already logged sets attached to the old exercise/station. Default new selection to this workout; offer an explicit future-plan update with a preview.
- [ ] Test swap-after-logging, cancellation and plan-update boundaries; run existing Workout swap/removal tests and commit.

### Task 4: Fast final-set effort logging and progression suggestions

**Files:** modify `frontend/src/views/Workout.jsx`, `frontend/src/lib/effort.js`, `frontend/src/lib/finish-workout.js`; create `frontend/src/lib/progression-suggestion.js` and `.test.js`; extend existing Workout and store persistence tests.

**Interfaces:** `suggestProgression({exercise, history, prescription, policy}) -> {load, reps, action, reasons, limitations}`. Consume the Task 1 policy and Task 2 identity; return suggestions without mutating historical records or silently changing existing progression policies.

- [ ] Test weight/reps on all sets with RIR on final working set only; zero is valid, missing is null, adding another set preserves the previous rating without copying it, and skipping a rating does not block finish.
- [ ] Test progression boundaries specified in Task 1, incomparable machines, different DB/barbell conventions, unknown effort, form limitations, and warm-ups excluded from working-set evidence.
- [ ] Run the new tests and verify failures; implement the smallest helper and integrate suggestions with the existing policy interface so finish cannot apply two progression updates.
- [ ] Make final-set effort entry prominent in the existing workout UI, retain optional per-set editing, and show prior comparable performance next to the prescription.
- [ ] Verify refresh/reopen, interrupted sync, finish retry and cross-tab behavior with existing store tests plus new cases. Run `cd frontend && npx vitest run src/lib/progression-suggestion.test.js src/lib/effort.test.js src/views/Workout.test.jsx`; commit after affected suites pass.

### Task 5: Planned versus completed coverage

**Files:** create `frontend/src/lib/training-coverage.js` and `.test.js`, `frontend/src/components/TrainingCoverage.jsx`; modify `frontend/src/views/Plan.jsx`, `Home.jsx`, and locale packs through existing conventions.

**Interfaces:** `trainingCoverage({workouts, plannedSessions, metadata, policy, window}) -> {byMuscle, byRole, unknowns}`; `window={startDate,endDate}` uses explicit local date strings. Each muscle contains direct sets, secondary estimated credit, combined estimate, exposure dates, target and gap. Planned and actual results are separate.

- [ ] Pin synthetic assertions for Task 1 accounting (if adopted: four direct sets plus four indirect sets equals six estimated sets), zero/unknown metadata, warm-ups, same-day sessions, and partially completed plans.
- [ ] Add date-boundary, off-program, duplicate-ID and role-coverage tests; no missing RIR is interpreted as zero effort or automatic exclusion of a completed set.
- [ ] Run `cd frontend && npx vitest run src/lib/training-coverage.test.js`; implement aggregation against actual records and snapshots.
- [ ] Add an intuitive seven-day view with cycle context, separate planned/actual values, expandable direct/secondary breakdown, unknown mappings and editable targets. Do not replace legacy `muscles.js` 0.4 recovery/balance behavior globally.
- [ ] Verify UI labels and accessibility, run coverage/Plan/Home tests and locale checks, then commit.

### Task 6: Missed-day adaptation with acceptance

**Files:** create `frontend/src/lib/training-adaptation.js` and `.test.js`; modify `frontend/src/lib/rotation.js`, `queue.js`, `frontend/src/views/Plan.jsx`, `Home.jsx`, and store actions.

**Interfaces:** `proposeAdaptation({state, availability, coverage, policy, today}) -> {baseFingerprint, remainingSessions, reasons, shortfalls, estimatedMinutes}`; `applyAdaptation(state, proposal) -> {state, error}`. Fingerprint only the relevant queue, routine and completed-workout inputs; reject stale proposals. Add explicit day dispositions: rest, missed, trained-unlogged; absence is unknown.

- [ ] Test missed-day marking creates a proposal without mutation; accepted PPL-to-UL revision preserves completed sessions and rotation provenance; undo restores future planning only.
- [ ] Test no-log is unknown, off-program volume counts without implicit cursor advancement, and insufficient time returns a shortfall instead of an oversized catch-up session.
- [ ] Test stale acceptance after another workout/device edit, duplicate acceptance, and a later sixth day becoming available.
- [ ] Run `cd frontend && npx vitest run src/lib/training-adaptation.test.js src/lib/rotation.test.js src/lib/queue.test.js`; implement deterministic selection from baseline templates using Task 1 duration assumptions and Task 5 gaps.
- [ ] Show proposed exercise/set changes, estimated duration and reasons for accept/edit/cancel. Reuse existing queue/rotation state; do not create a second competing cursor. Verify Plan/store sync tests and commit.

### Task 7: Import private historical context safely

**Files:** create `frontend/src/lib/import-fitness-notes.js` and `.test.js`; integrate with existing `frontend/src/lib/import-csv.js` merge conventions and the existing import sheet in `frontend/src/sheets.jsx`.

**Interfaces:** `parseFitnessNotes([{name,text}]) -> {workouts, proposedRoutines, warnings, sourceKeys}`. Parse only the documented vault workout-table format, with actual warm-up/working-set sections and stable source keys. Unknown formats are rejected with a useful warning rather than broadly interpreted by AI.

- [ ] Test synthetic tables: plans are not results; missing reps/RIR remain unknown; source-key repeat is idempotent; load basis, substitutions and form notes survive; completed records may have partial data.
- [ ] Run `cd frontend && npx vitest run src/lib/import-fitness-notes.test.js src/lib/import-reimport.test.js`; implement preview and explicit commit through existing merge/backup flows.
- [ ] Preview the real vault records locally, including separately labeled baseline routine proposals; do not write personal data into tracked fixtures or modify the vault. Resolve exercise mapping ambiguities in the preview.
- [ ] Verify import/restore/export round trips and double-import behavior; commit source changes only.

### Task 8: Integrated acceptance and release readiness

**Files:** update `docs/DATA_IMPORTS.md`, `docs/README.md`, and add `docs/dev/PERSONAL_STRENGTH_ACCEPTANCE.md` with verification results and open limitations.

- [ ] Execute the spec's end-to-end scenario using synthetic data on the local PWA. Test touch input, keyboard visibility, scrolling, swaps, final-set effort, finish, coverage and adaptation acceptance.
- [ ] Run frontend `npm test`, `npm run build`, `node scripts/check-locales.mjs`, `node scripts/check-source-strings.mjs`, and `npm run test:fatigue-probe`; run API `npm test`; run MCP `npm test` and `npm run check:node-loadable`.
- [ ] Run the Docker image build/boot checks specified in `.github/workflows/test.yml` before merge. Report environmental blockers explicitly rather than treating checks as passed.
- [ ] Verify an installed iPhone PWA on the user's supported HTTPS origin: screen lock/reopen, airplane mode logging, reconnection, no double completion, backup/restore. Desktop emulation does not satisfy this gate.
- [ ] Review the whole diff for data compatibility, accidental personal records, unsupported science claims and unrelated changes. Document Fitbod research status honestly.
- [ ] Open the agreed reviewable PR when implementation is ready; attach it to this chat. Keep deployment and historical import review distinct from source-code completion.

## Plan status and self-review

All accepted requirements map to tasks; later nutrition/wearable work is intentionally excluded. Core interfaces use existing state rather than a new storage layer. Evidence-policy values and Fitbod runtime findings remain named research gates, not completed findings. No application tests were run for this documentation-only planning change. Implementation execution method remains to be selected.
