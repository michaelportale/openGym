# Phase 4 status

Checked against the science section and the Phase 4 done-when line in
`docs/sprints/2026-10-30-native-workout-prd.md`. This is the science lane only.

## Done when

| Item | Status |
| --- | --- |
| `docs/science/` register | Done. PR #43. |
| Warm-up prompt | Done in science: first catalogue body part in the session. PR #46. The prompt now shows on the Workout screen (see Where it shows). |
| Progression | Done in science: double progression when neither the exercise nor the routine names a policy. PR #46. The suggestion now shows as a Next time line on the saved screen after Finish. |
| Effort | Done in science: optional reps left, the far-from-failure note, and no change to the load. PR #47. The reps-left row is in the keypad and saves with the set. |
| "Why this?" sheet | Done in science: reason, source, and a Convention or Definition label. PR #47. A TODO or missing population is left off the payload and the sheet has no population row. PR #49. The sheet is mounted on the Workout screen. |
| Rule audit | Done. PR #43. A non-literal or unknown `whyThis` id fails the scan. |

## Where it shows

Nothing is blocked on the shell or the journal any more. What was blocked now shows in the app:

- **Warm-up prompt.** On the first exercise for each body part in a session, while there is no warm-up row and no work set is done. It shows 40% and 80% of the first work set's weight, 6 reps each, never under the bar. Add warm-ups adds both rows, not done. Ignoring it skips it.
- **Reps left.** An optional 0 to 5 row in the keypad for work sets, with 5 shown as "5+". It saves with Complete or Update, on both sides of a per-side set, and never changes a load.
- **Next time.** After Finish, the saved screen lists a line per exercise that used double progression and has a completed work row. The next session opens at that weight and reps, and the target is stamped to match.
- **Why sheets.** About rest times on the resting dock, About load steps under the keypad's ±5 and ±10 chips, Why? and Why offered? on the warm-up prompt, Why? on a Next time line, and Why? on the effort note and the keypad's reps-left row.

Lines are double-only. Linear, Greyskull, triple, pyramid, off, excluded, timed, drop-set and rest-pause exercises get no line and open exactly as before Phase 4: the weight follows last time, and the reps, drops and bursts stay as the shared builder made them. That holds under any policy, including none named. A deload line opens the new `deload` Why kind, which shows the `deload-after-misses` entry.

Phase 4 added no rule, number or citation. The register entries are as before.

Known gap: when an exercise stores one rep target and no `repsMin`, the shared normalizer (`frontend/src/lib/rep-range.js`) treats the range as two below it, so a routine with 8 reps gives a Next time line "back to 6 reps". That default has no register entry and no Why. It reaches the screen only for an exercise with progression on.

## Register rows

| Rule | Status |
| --- | --- |
| Warm-up loads | Done. The 40/80 helper is in science. PR #46. Work at or under the bar returns no sets. PR #47. |
| Warm-up volume | Done as a register entry. PR #43. The helper does not add sets past the pair. The Add warm-ups control on the prompt adds both rows. |
| When to prompt | Done in science. PR #46. The prompt is on the Workout screen. |
| Warm-up accounting | Done in science: warm-ups stay out of progression, records, estimated 1RM, and volume. PR #43. Warm-up rows are saved with the session; they stay out of the Next time lines. |
| Injury claims | Done as a register entry: the app makes no injury-prevention claim. PR #43. No Phase 4 screen makes that claim. |
| Rep ranges | Done in science. Register entry PR #43. `programRepRange` on PR #49 keeps the stored `reps` and `repsMin`. A missing range stays empty, and nothing labels 8-12 optimal. The shared normalizer is unchanged. |
| Progression | Done in science. PR #46. An old routine stored as `prog: 'linear'` changes only if something calls `migrateLinearRoutines`. PR #47. |
| Effort | Done in science. PR #47. Reps left is saved with the set and never changes a load. |
| Weekly volume | Not started as a number. The register entry is PR #43. `weeklyVolumeTarget` returns null, so this lane does not ship a set target. The primary paper is still unread. |
| Deload, e1RM, rest, increments | Done as four register entries, labeled convention until audited. PR #43. The audit itself is not started. The numbers stay in the shared engine. |

## Populations that need a source

The PRD evidence list does not say who was studied. A title that names a lift, such as bench press, is not a population. None of these are filled in. Each needs a source before the register can change.

- `warmup-loads`
- `warmup-volume`
- `warmup-prompt`
- `warmup-injury`
- `rep-ranges`
- `double-progression`
- `effort-proximity`
- `weekly-volume`

`warmup-accounting`, `deload-after-misses`, `e1rm-formula`, `rest-defaults`, and `load-increments` are `Not a study`. They are not waiting on a population. The sheet can show that label. It does not show `TODO`.

## Still needs a source

A weekly set target and the audit of deload, estimated 1RM, rest, and increments are still not started. Each one needs a reviewed source, so this lane does not fill them in. Kilogram and pound rounding, the bar boundary, reps-left bounds, and a second migration call are specified in [Decisions](decisions.md).

The current value, the file that owns it, the question a source must answer, and what would change are in [Sources needed](sources-needed.md). That list does not cite a study.
