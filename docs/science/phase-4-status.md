# Phase 4 status

Checked against the science section and the Phase 4 done-when line in
`docs/sprints/2026-10-30-native-workout-prd.md`. This is the science lane only.

## Done when

| Item | Status |
| --- | --- |
| `docs/science/` register | Done. PR #43. |
| Warm-up prompt | Done in science: first catalogue body part in the session. PR #46. Showing the prompt on a screen is blocked on the shell. |
| Progression | Done in science: double progression when neither the exercise nor the routine names a policy. PR #46. Putting the suggestion on a finished session is blocked on the journal. |
| Effort | Done in science: optional reps left, the far-from-failure note, and no change to the load. PR #47. Saving it on a set is blocked on the journal. |
| "Why this?" sheet | Done in science: reason, source, and a Convention or Definition label. PR #47. A TODO or missing population is left off the payload and the sheet has no population row. PR #49. Mounting the sheet is blocked on the shell. |
| Rule audit | Done. PR #43. A non-literal or unknown `whyThis` id fails the scan. |

## Register rows

| Rule | Status |
| --- | --- |
| Warm-up loads | Done. The 40/80 helper is in science. PR #46. Work at or under the bar returns no sets. PR #47. |
| Warm-up volume | Done as a register entry. PR #43. The helper does not add sets past the pair. The control to add a set is blocked on the shell. |
| When to prompt | Done in science. PR #46. The screen is blocked on the shell. |
| Warm-up accounting | Done in science: warm-ups stay out of progression, records, estimated 1RM, and volume. PR #43. Saving them in history and counting them in session duration is blocked on the journal. |
| Injury claims | Done as a register entry: the app makes no injury-prevention claim. PR #43. Keeping that sentence off the screens is blocked on the shell. |
| Rep ranges | Done in science. Register entry PR #43. `programRepRange` on PR #49 keeps the stored `reps` and `repsMin`. A missing range stays empty, and nothing labels 8-12 optimal. The shared normalizer is unchanged. |
| Progression | Done in science. PR #46. An old routine stored as `prog: 'linear'` changes only if something calls `migrateLinearRoutines`. PR #47. |
| Effort | Done in science. PR #47. Journal wiring is blocked on the session lane. |
| Weekly volume | Done as a register entry, and not started as a number. No target ships until the primary paper is read. PR #43. |
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
