# Decisions for standup

Defaults chosen from the native workout PRD for the open questions on the science register.
Each one can be overridden. Nothing here adds a citation. General training information, not medical advice.

## Warm-up loads (`warmup-loads`)

Ship two warm-up sets of 6 reps at 40% and 80% of the working weight, rounded down to a loadable weight and never below the bar. An 80 lb dumbbell working weight on a 5 lb step is 30 and 60.

The PRD states that prescription and says the shared helper, which closes half the gap, is the wrong shape for it. The new helper lives in native science code. `frontend/src/lib` is left on the midpoint ramp so the web app and any unreconciled strength logic stay as they are.

When the working weight is at or under the bar, `warmupRamp` returns no sets. The screen renders that list and does not need its own skip. A heavier work weight still gets the two sets, and a percentage that lands under the bar is still raised to the bar. A weight just above the bar still returns the two sets. 80 on a 5 lb step with a 45 lb bar is 45 and 60: the low percentage is raised to the bar, and the high one stays above it. A negative floor is treated as no bar.

Rounding uses that unit's step. With no step passed, chest uses 2.5 kg or 5 lb, and back uses 5 kg or 10 lb. A work weight of 73 is 27.5 and 57.5 on the chest kilogram step, and 25 and 55 on the chest pound step. The same 73 on a back exercise is 25 and 55 in kilograms, and 20 and 50 in pounds.

## Weekly volume (`weekly-volume`)

`weeklyVolumeTarget` returns null. No weekly set target ships until the primary paper is read. A screen calls that helper and shows nothing. Inventing a set count here would overstate a secondary record. The population stays `TODO`.

## Rep ranges (`rep-ranges`)

`programRepRange` returns the `reps` and `repsMin` already stored on the program. A missing or unreadable bound stays empty. There is no optimal range, so 8-12 is not filled in and is not labeled uniquely best. The shared normalizer in `frontend/src/lib` still fills a missing range. This lane does not edit it.

## Progression (`double-progression`)

When a reps exercise and its routine do not name a policy, native suggestions use double progression: one session in which every work set reaches the top of the range raises the weight and returns to the bottom. That one-session trigger is convention.

An explicit policy on the exercise or the routine is kept, including linear and Greyskull. Greyskull's deload after 1 miss is not the native default. The PRD names double progression, and it names deload after 3 misses as the inherited convention still waiting on an audit. The shared engine's double policy already waits for 3 misses. The web app's own default stays linear because this lane does not edit `frontend/src/lib`.

## When to prompt (`warmup-prompt`)

Prompt a warm-up on the first exercise in the session for a catalogue body part, and not on a later exercise for that same body part. A later exercise for a different body part is still prompted. An exercise the catalogue does not know is not prompted.

The PRD calls the timing our inference and does not name which field is a muscle group. The catalogue body part, such as chest or back, is the group the data already has. A finer muscle name can replace it.

## Population

Leave `population` as `TODO` on every cited rule. The PRD evidence list does not say who was studied. Filling a population in would be a citation we do not have. Revisit only after that source is read again.

## Four inherited entries

Keep deload (`deload-after-misses`), the e1RM formula (`e1rm-formula`), rest (`rest-defaults`), and increments (`load-increments`) as separate entries. The PRD names four rules in one row and says no number ships without an entry.

## Rest and increments (`rest-defaults`, `load-increments`)

Keep the inherited numbers, labeled convention until audited. A new profile rests 90 seconds, and 15 seconds between rest-pause bursts. The default load step is 2.5 kg, or 5 kg for upper legs, lower legs, back, hips, and glutes. In pounds it is 5, or 10 for those body parts. The PRD says these are inherited and none of them has a reviewed source, so replacing a number would ship a new uncited value.

## Estimated 1RM (`e1rm-formula`)

Keep showing Epley, with the inherited 12-rep cap for a single formula, labeled convention until audited. Do not switch the default to the weighted blend. Epley is the inherited default the PRD told us to audit. The blend is also uncited.

## Effort (`effort-proximity`)

The PRD names optional reps left in the tank, which is RIR. A new log is a whole number from 0 to 10, or omitted. `validateRir` checks that before anything is saved. 0 and 10 are inside the bounds. 11, a negative number, and a fraction are not. `effortProgressionNote` reads a hand-entered RIR, or an existing RPE through the shared scale, and returns "This looks far from failure." when the rating is above the inherited `HARD_RIR` of 3. Reps left of 0, 1, 2, or 3 do not show that line. 4 through 10 do. An existing RPE of 10 is 0 reps left, and an existing RPE of 0 is 10. Warm-ups and a bare failure flag do not count. `withEffortNote` copies a prescription and adds that note. It does not change the load.

Charlie can call those three from the journal later. This lane does not edit `native/src/session/`.

## Why this sheet

`WhyThisSheet` renders a `whyThis()` payload: the reason, the source, and a Convention or Definition label when the register uses that plain source. A cited rule shows the citation and no plain label. Gus mounts it by passing that payload. It is mounted only by `native/src/workout/WhySheet.js`.

## Linear routines

`migrateLinearRoutines` copies a routine whose own `prog` is `linear` and writes `double` on the copy. A second call is idempotent: a routine already stored as `double` comes back as the same object, and an exercise still stored as `linear` stays linear. It does not run on its own. Prescription, boot, and the journal do not call it. Charlie calls it only after an explicit owner action. Exercise-level `prog: 'linear'` is left alone, and that exercise stays linear because the exercise policy wins. Writing `double` keeps the shared web engine on the same policy after a sync. Clearing the field would send the web engine back to linear.
