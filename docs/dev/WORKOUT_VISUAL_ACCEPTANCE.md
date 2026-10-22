# Workout visual slice — combined merge review

> Publication update — 2026-10-22: the user subsequently authorized push and PR review. The verified source has been split into focused review branches without changing application code. See [review order, validation and screenshots](WORKOUT_REVIEW_STACK.md). The original implementation checkpoint and its no-push boundary below are historical. No merge or deployment is authorized.

Verified locally on 2026-10-22. This slice continues all 20 commits of the completed strength baseline, rather than recreating or replacing its data paths.

## Branch and review boundary

- Worktree: `/Users/michaelportale/Documents/Codex/2026-10-22/task/openGym-workout`
- Branch: `codex/workout-visual-slice`
- Exact base: `f1aabdb74903ba4ed37fbe26d12ef17ed9532155` (`codex/personal-strength`, PR #4).
- Main/base of the combined change: `b34297f299051677b96f732b1b6ed82c401ffc2e`; it is an ancestor of this branch.
- GitHub PR #4 was rechecked: draft, open, mergeable, unmerged, still at the exact strength head above. GitHub's mergeable flag concerns that PR, not these unpublished changes.
- Original strength worktree remains clean. Original main remains at its existing head with its pre-existing untracked `docs/superpowers/`; neither was rewritten.
- No push, merge, deployment, public tunnel, paid service, personal-history import, or source-vault edit occurred. All browser records are synthetic.

The independent combined source review closed every actionable finding it raised. The local combined candidate is ready for human merge review after the verification below. Real iPhone acceptance remains a device rollout gate; this document does not turn desktop emulation into device evidence. The unpublished candidate contains repairs that are absent from PR #4 alone, so the old PR's stale review/advisory wording is not a current description of this candidate.

## Implemented slice

- Focus and List now share a charcoal/chalk session treatment, system fonts, tabular numbers, explicit saved equipment station/load labels, and clear separation between prescribed and actual values.
- Focus presents the current set and neutral high-contrast Complete button. Logging remains one tap. Final-set RIR remains optional and uses the existing effort write path.
- List gives numeric fields deliberate space on phones; narrow screens and enlarged text keep long values readable without shrinking the 44px adjustment controls.
- The rest dock reserves its measured height, supports existing pause/adjust/skip/ready behavior, and carries final effort for the exercise just completed when Focus moves on. Arrival motion is restrained and disabled with reduced motion.
- A workout replacement sheet reuses ranked substitutions and exact station identity, exposes temporary occupied-station exclusions, and reviews the actual starting loads. Explicit edits override the initial history suggestion. Logged rows, future-plan choices, stale callbacks and repeated confirmations retain their existing guarded paths.
- Finish shows actual session/set context and a separate discard action. Completion summary retains the existing history/progression logic.
- Modal entry, keyboard trapping, stacked-sheet isolation and focus return are explicit. Closed disclosures cannot trap reverse-Tab on hidden checkboxes. Text zoom is allowed by the viewport metadata.
- Home, Plan and History were not redesigned. Shared modal accessibility necessarily applies to their existing sheets too.

## Readiness repairs included

The review traced uncertainty beyond the visible Complete button. Copied unknown loads now remain pending through added sets, warm-up generation/conversion, partial Finish/reopen, bulk backfill, and restored hold timers. A reviewed unilateral side can complete while the other remains pending. Restored timers retain actual elapsed time and the original target without asserting an unknown zero load. Starting an unreviewed hold cannot interrupt rest. Ordinary known zero loads still work.

The replacement review's Edit settings path now honors explicit load/reps/count, including zero, instead of letting comparable history overwrite the correction. Initial history/progression seeding remains intact. Its one-use and stale-source guards prevent duplicate or outdated application.

These changes had reproduced failing regressions before fixes. Independent source re-review also covered the strength baseline's prior mixed-setting labels and per-side confirmation corrections.

## Final local automated checks

Host checks used Node 22.17.0, matching the repository's Node 22 line. Logs live in the task's `output/validation/` directory outside Git.

| Check | Result |
| --- | --- |
| Frontend `npm test` | **5,347 tests / 414 files passed**, zero failed |
| API `npm test` | **601 passed**, zero skipped/cancelled/failed |
| MCP `npm test` | **95 tests / 3 files passed** |
| Frontend production build | Passed |
| Locale/source validation | 18 locales × 2,445 keys; 1,921 source strings present |
| Fatigue probe | 108,000 monotonic comparisons and 1,800 history-edit comparisons passed |
| MCP and API coach/core plain-Node graphs | Passed |
| Generated coach assets | 5,632 exercises and six prompts in sync |
| API images | Default, coach and untargeted images built, booted and passed 35 build/runtime/cleanup assertions |
| Dependency audit | Frontend **0**, MCP **0**, API **0** |
| Diff whitespace | Passed |
| Impeccable detector | No reported detections in changed slice targets; manual rendering review also performed |
| Lint / static types | No lint or TypeScript check is configured in this repository; no fictitious pass claimed. Build validates JSX/import resolution. |

The first full frontend run failed only the pt-BR inherited-key fingerprint after five intentional replacement-sheet fallback keys were added. The exact inheritance list was compared with baseline (no changed/removed translations), its expected fingerprint was updated, and the final full run passed. Existing chunk-size/ineffective-dynamic-import build warnings and the API MockTimers experimental warning remain.

API images were local Linux/arm64 builds/runs, not hosted Linux/amd64 CI. Four initial harness absence assertions expected the wrong Docker exit code; the repository's negated check already passed. The harness was corrected to inspect executable absence and all assertions passed. Original failures and corrected evidence are retained, rather than hidden.

## Browser and visual evidence

The production harness uses the actual API with password login, guest and coach disabled, a disposable synthetic account/data directory, and a loopback-only self-signed HTTPS proxy. Certificate exceptions are confined to isolated Chrome contexts. Fixture setup via the authenticated data API is separate from the observed UI actions. No personal account/history was used.

The initial current-worktree production run exercised load/reps edits, swap after logged work, final-only RIR, service-worker offline reload, offline Finish/reconnect with one history record, synthetic backup export/restore, repeated Markdown import, stale schedule rejection, and a real committed PUT whose response was deliberately lost before retry. Final source changed during that run, so those results were retained as earlier evidence. The final production rebuild repeated the affected core flows; exact build/cache/source manifests and per-flow details are in the local production report.

Final source core replay observed original 9-setting × 12 work preserved across a station swap, replacement 4-setting rows with final RIR 0 only, byte-identical active data after offline reload, and exactly one new server history record after repeated Finish, offline reopening and reconnection. A 390 × 480 viewport with input focus, rest and offline sync banner kept Complete above the rest dock and below the banner with no horizontal overflow. This is viewport emulation, not an iOS keyboard measurement.

The final build also passed a real UI-started 45-second hold → reload while running → early Done: it saved 17 seconds of actual work while retaining the 45-second prescription. Explicit synthetic legacy-storage setup then exercised an already-expired unknown-load hold: reload kept it incomplete, kept `loadNeedsReview` and `planSec: 45`, and Start remained blocked with the review message. An explicitly seeded past workout verified bulk completion leaves unknown bilateral/right-side values pending while completing a known load and the already-reviewed left side. These setup writes are test fixtures, not claims about a user import. The final source comparison at 17:56 UTC reported no source changes since the final production build.

Manual Chrome rendering checks covered Focus, List, replacement/load review, Finish review, dark/light styling, 320/360/390/430px mobile widths, desktop layout, reduced motion and 200% root text. At each Focus width, a 227.5 value fit, visible controls measured at least 44px, and the measured dock height was reserved after ResizeObserver settled. At 200%, the layout scrolls vertically rather than squeezing digits. Keyboard-only collapsed/expanded replacement-disclosure loops were verified in actual Chrome. Unit tests separately cover stacked modals, focus return, rest and sync isolation.

Evidence is retained under the local task's `output/playwright/`, including `visual-accessibility-checks.txt`, `modal-keyboard-review.json`, the production harness reports/manifests, and screenshots. The review gallery is `http://127.0.0.1:5180` while its local process is running (standalone source: the task’s `output/preview/index.html`); screenshots are not evidence of physical iPhone behavior.

## Dependency disposition

[Dependency readiness](WORKOUT_DEPENDENCY_READINESS.md) records the npm Arborist crash, compatible Vite/Vitest fixes, and removal of unused native asset-generation tooling. Normal npm 10.9.2 clean installs succeed from the final locks. The targeted lock mutation used already-installed npm 11.19.1; no global upgrade or forced override occurred. The old critical advisory was a tooling-chain finding, not proof of a served-PWA exploit.

## Remaining device check and limits

No existing supported HTTPS iPhone origin or connected physical iPhone was available. The self-signed loopback harness is not a substitute. On the user's supported test origin, use only a disposable profile and synthetic data:

1. Install/open the PWA on iPhone. Start one short session; edit a decimal load and reps, log one set, then enter optional final RIR. Confirm keyboard controls stay visible and reachable with rest/sync indicators.
2. Start a hold/rest, lock the screen briefly, reopen, and verify elapsed/remaining time and saved values. Repeat once while the app is backgrounded.
3. Enable airplane mode after the shell has loaded. Log and finish, close/reopen offline, reconnect, and confirm exactly one new history record from a second signed-in view.
4. Export the synthetic backup, restore it through the confirmation, reopen, and confirm the same IDs and ratings. Check large text/reduced motion and a VoiceOver modal loop.

This bounded device pass is required before claiming daily-device readiness. Storage eviction/server-loss recovery, all browser engines, production TLS, and hosted CI were not established by this local task. New locale copy follows the project's English fallback convention and is not a translation review. No known actionable source-review findings remain; any later base/code change requires revalidation of its affected paths before merging.
