# Decisions for standup

Defaults chosen from the native workout PRD for the open questions on the science register.
Each one can be overridden. Nothing here adds a citation. General training information, not medical advice.

## Warm-up loads (`warmup-loads`)

Ship two warm-up sets of 6 reps at 40% and 80% of the working weight, rounded down to a loadable weight and never below the bar. An 80 lb dumbbell working weight on a 5 lb step is 30 and 60.

The PRD states that prescription and says the shared helper, which closes half the gap, is the wrong shape for it. The new helper lives in native science code. `frontend/src/lib` is left on the midpoint ramp so the web app and any unreconciled strength logic stay as they are.

When the working weight is at or under the bar, `warmupRamp` returns no sets. The screen renders that list and does not need its own skip. A heavier work weight still gets the two sets, and a percentage that lands under the bar is still raised to the bar.

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
