# Science lane, overnight 6 November 2026

Brief for standup. Facts below are the merged pull requests on `native/phase-1` at `cedf787` and the defaults in `docs/science/decisions.md`.

## Merged

| PR | Outcome |
| --- | --- |
| #43 | Science register, `whyThis` payload, warm-up exclusion from progression, PRs, e1RM, and volume, and a rule-id audit. The audit walker lives in `native/scripts/` and scans `.js`, `.jsx`, `.mjs`, `.ts`, and `.tsx`. |
| #46 | Standup defaults recorded. Warm-ups are 2×6 at 40% and 80%. Unnamed reps work uses double progression. A warm-up is prompted on the first exercise per catalogue body part. |
| #47 | Work at or under the bar returns no warm-up sets. Optional RIR, with "This looks far from failure." above `HARD_RIR` 3, and the note does not change the load. `WhyThisSheet` is not mounted. `migrateLinearRoutines` is opt-in and leaves exercise-level `linear` alone. |
| #49 | A `TODO` or blank population is omitted from `whyThis` and is not rendered. `programRepRange` keeps the stored range and does not fill 8-12. |
| #51 | Every Phase 4 status row names its PR. |
| #53 | `weeklyVolumeTarget` returns null. No weekly set target ships. |
| #55 | Tests lock kilogram versus pound rounding, the bar boundary, RIR 0 through 10, and a second migration call. |
| #56 | `docs/science/sources-needed.md` lists the current default, the owning file, the question a source must answer, and what would change for weekly set targets, deload, Epley, rest, and increments. It does not cite a study. |

## Current defaults

From `docs/science/decisions.md` on that commit:

- Warm-ups: 6 reps at 40% and 80%, rounded down on the unit step, never under the bar, never over the work weight. At or under the bar, no sets. 80 lb on a 5 lb step with a 45 lb bar is 45 and 60.
- Reps with no named policy: double progression. One session at the top of the range raises the weight and returns to the bottom. That trigger is convention. An explicit policy, including linear and Greyskull, is kept. The shared web default stays linear.
- Prompt: first catalogue body part in the session only.
- Rep range: the program's stored `reps` and `repsMin`. 8-12 is not labeled optimal. A missing range is not filled.
- Effort: optional RIR, whole numbers 0 through 10. Above 3 reps left shows "This looks far from failure." The note does not change the load.
- Old routines stored as `prog: 'linear'` stay linear until something calls `migrateLinearRoutines`. A second call returns the same object.
- Rest: 90 seconds, and 15 seconds between rest-pause bursts.
- Increments: 2.5 kg or 5 lb, and 5 kg or 10 lb for upper legs, lower legs, back, hips, and glutes.
- Estimated 1RM: Epley, 12-rep cap. The weighted blend is not the default.
- Weekly sets: no target.

## Blocked on a source

`docs/science/sources-needed.md` is the list. In short:

- Cited-rule `population` stays `TODO`. The PRD evidence list does not say who was studied.
- No weekly set target until the primary paper is read. `weeklyVolumeTarget()` returns null.
- Deload after misses, the e1RM formula, rest, and increments stay convention until audited. No number was replaced.

## For Michael at standup

`docs/science/decisions.md` says each default can be overridden. The ones recorded tonight:

- Keep 40/80 warm-ups in native science and leave the shared midpoint ramp alone.
- Use double progression only when no policy is named, and keep the one-session trigger as convention.
- Treat the catalogue body part as the muscle group for the warm-up prompt.
- Leave populations `TODO`.
- Keep deload, e1RM, rest, and increments as four entries.
- Keep rest at 90 seconds and 15 seconds, increments at 2.5 kg / 5 lb (5 kg / 10 lb on the heavy body parts), and Epley with the 12-rep cap.
- Keep far-from-failure at the inherited `HARD_RIR` of 3, with no load change.
- Migrate a routine from `linear` to `double` only when called, and leave exercise-level `linear` in place.
