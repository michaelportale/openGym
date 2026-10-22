# PR stack merge review — 2026-10-22

What this change does: PRs #4–#8 add personal strength planning, exact load identity, imports, coverage, schedule adjustments, and a revised workout loop. This review traces the combined implementation and its callers, fixes the issues below on the final PR, and verifies the stack before ordered integration into `main`.

Reviewed load: a personal self-hosted installation with multiple users, tabs, and intermittently connected devices. This is not a load test of a public multi-tenant service. Three independent reviewers covered strength/history, adaptation/sync, and workout/accessibility; the integrating reviewer checked dependencies, tests, containers, and the production browser. Fixes received a second independent source pass.

**Must fix — resolved before merge**

1. **Repeated swaps could change the wrong future exercise** (`frontend/src/lib/active-exercise-swap.js`, `session-start.js`, `sheets.jsx`).
   - **What this is:** A workout replacement can separately update the future routine after a preview.
   - **Problem:** Starting with bench/row, swapping bench to row for this session, then swapping that occurrence again selected the routine's original row slot. A session addition could also be mistaken for an original slot.
   - **Fix:** Keep active-only source identity from session creation, preserve it through swaps, and require a unique proven source before offering the future-plan update. Update that identity after acceptance; strip it from both normal and edited history saves.
   - **If skipped:** Accepting a preview can overwrite an unrelated routine exercise. Old active drafts without source proof now conservatively offer session-only swaps.

2. **A local adjustment locked the Fixed Week control** (`frontend/src/lib/rotation.js`, `views/Plan.jsx`, `views/Settings.jsx`).
   - **What this is:** A fixed-week user can accept a temporary adjusted sequence.
   - **Problem:** The sequence has no saved rotation ID, so existing controls classified it as externally owned and refused to stop it.
   - **Fix:** Recognize validated local adjustments in the shared ownership check. Returning to Fixed Week clears the pass and its future pins while keeping saved weekdays and history; genuinely external queues remain protected.
   - **If skipped:** The user cannot return to their saved weekly schedule through the normal controls.

3. **An inactive rotation replaced the current weekly baseline** (`frontend/src/lib/training-adaptation.js`).
   - **What this is:** Adjustment previews read the routines that currently define the schedule.
   - **Problem:** After returning to Fixed Week, an older saved rotation still won baseline selection. Valid current routines could therefore be rejected as unavailable.
   - **Fix:** When no active queue exists, derive the baseline from saved weekdays. Retain the inactive rotation for later explicit use.
   - **If skipped:** The preview uses the wrong plan or refuses a valid adjustment.

4. **Competing offline adjustments left extra calendar sessions** (`frontend/src/lib/sync-merge.js`).
   - **What this is:** Reconnecting devices merge schedules and independently stamped calendar dates.
   - **Problem:** One accepted queue won, but the losing proposal's dates survived as ordinary pins. The same defect persisted when the winning device stopped or replaced the queue.
   - **Fix:** Remove only untouched generated pins belonging to the losing adjustment and persist removal stamps. Preserve manual edits, completed workouts, and dates whose session IDs were deliberately retained by the winning rotation. Keep the original acceptance stamp across later queue-label edits.
   - **If skipped:** Reconnection adds workouts the winning plan never scheduled. Regression cases cover both merge directions, repeated merges, stopping, restarting, renaming, explicit adoption, and manual edits.

5. **Timed left/right work doubled coverage** (`frontend/src/lib/training-coverage.js`).
   - **What this is:** Two prescribed unilateral timed sets are stored as four alternating left/right rows.
   - **Problem:** Coverage counted four actual sets against two planned sets, unlike its handling of paired repetition sets.
   - **Fix:** Reuse the existing set-pair boundary helper and count each completed pair once. Keep incomplete pairs in the partial-work bucket and preserve warm-up and unknown-phase handling.
   - **If skipped:** Coverage overstates completed work and understates the remaining target.

6. **Modal validation messages disappeared from screen readers** (`frontend/src/components/Modals.jsx`, `Toast.jsx`, `WorkoutMedia.jsx`, `Modals.css`).
   - **What this is:** A modal isolates the background from focus and accessibility navigation.
   - **Problem:** The global status toast was isolated too. Invalid body weight, blank exercise names, and other rejected inputs left no exposed explanation while the dialog stayed open.
   - **Fix:** Mirror status text inside the active dialog while retaining the existing visual toast and background isolation. Include centered dialogs, nested sheets, and the media viewer.
   - **If skipped:** A screen-reader user cannot tell why Save did nothing. The new tests verify that only the active dialog's status is exposed and that the page status returns on close.

7. **Corrected imported workouts stayed marked as partial** (`frontend/src/lib/session-edit.js`).
   - **What this is:** An imported record with missing repetitions has a partial-volume marker.
   - **Problem:** Supplying the missing repetitions correctly recalculated volume, but merging the edited record retained the old marker.
   - **Fix:** Remove the marker when the rebuilt record no longer needs it, following the existing handling of other derived flags.
   - **If skipped:** Complete data continues to display a partial total and remains excluded from full-volume comparisons.

**Should fix — resolved before merge**

8. **Newly indexed dependency advisory in both server lockfiles** (`api/package-lock.json`, `mcp/package-lock.json`).
   - **What this is:** Both locks included transitive `ip-address` 10.7.3. The API copy belongs to its optional dependency graph.
   - **Problem:** The [upstream advisory](https://github.com/advisories/GHSA-rxp7-6hxx-x8q5), added to GitHub's advisory database on October 22, describes excessive synchronous parsing time for crafted IPv6 input. This review did not establish an application-level exploit path.
   - **Fix:** Patch only that locked package to compatible 10.7.4, preserving other dependency versions and platform metadata. Repeat clean installs, audits, affected suites, and API image checks.
   - **If skipped:** The locks retain a known, readily patchable dependency defect. Earlier zero-audit reports are historical checkpoints, not the current audit result.

**Verification**

Each behavioral regression was observed failing before its correction. The initial unmodified stack passed 5,347 frontend tests, 601 API tests, and 95 MCP tests. During the fix review, a combined run caught the newly added adoption regression; the final frozen candidate is verified separately. No assertions, timeout limits, or quality checks were weakened.

Final frozen-source verification, Node 22.17.0:

- Frontend: **5,364 tests across 415 files passed**, using two workers.
- API: **601 tests passed**, none skipped, failed, or cancelled.
- MCP: **95 tests across three files passed**, plus its plain-Node import graph.
- Production build, 18-locale parity, all 1,921 source translation strings, 108,000 fatigue comparisons, 1,800 deletion probes, generated coach assets, and API plain-Node imports passed.
- Clean locked installs passed. Fresh complete-lock audits: **frontend 0 / API 0 / MCP 0** vulnerabilities.
- API default, coach, and untargeted published images built from the patched lock. Runtime checks confirmed startup/config, expected absence of AI tooling in default/published images, working coach SDK/Codex/bubblewrap, coach user, and private credential-directory permissions.
- Diff whitespace checks passed. Existing build warnings about bundle size and ineffective dynamic imports remain; this repository has no configured lint or TypeScript check. GitHub Actions are disabled on the fork, so these are explicit local checks.
- Production Chromium smoke at 390 × 844: invalid body-weight feedback remained inside the open dialog; edited load/repetitions survived the Cards-to-Focus switch; Complete and Finish saved the correct 225 kg volume. Reload retained exactly one workout with 22.5 kg × 10, no active workout, no source marker in history, and no horizontal page overflow. The only console error was the expected guest `/api/me` 401. A rendered Focus screenshot was inspected locally.

Verdict: Ship. No unresolved actionable findings remain in the reviewed scope.

**Not checked:** Physical iPhone installation, VoiceOver output, software keyboard, lock/background behavior, and airplane-mode reconnect on the supported HTTPS origin remain device rollout checks. Browser inspection here uses synthetic data in desktop Chromium at mobile viewports. No live deployment or personal-data import is part of this merge.
