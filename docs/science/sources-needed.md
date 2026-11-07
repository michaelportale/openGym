# Sources still needed

These five defaults stay as they are until a source is read. This file does not cite a study and does not name one. A candidate source type is the kind of document that could answer the question. It is not a citation. Populations that are still `TODO` are listed in [Phase 4 status](phase-4-status.md). They are not filled in here.

Nothing in this list is medical advice.

## Weekly set targets

- Current default: no target. `weeklyVolumeTarget()` returns `null`.
- Where it lives: `native/src/science/weekly-volume.js`. The register entry is `weekly-volume`.
- Question a source must answer: how many hard sets per muscle per week should the app show, for whom, and for which outcome.
- What would change: `weeklyVolumeTarget()` would return that count instead of `null`, and the register claim, evidence, and population would follow the source. Until then the screen shows nothing.
- Candidate source type: a primary dose-response paper or a systematic review, read in full. A secondary record is not enough.

## Deload

- Current default: the load drops to 90% after repeated misses. Linear, double, triple, and timed policies wait for 3 misses. Greyskull waits for 1. The factor is `0.9`.
- Where it lives: `DELOAD_AFTER` and `DELOAD_FACTOR` in `frontend/src/lib/progression.js`. The register entry is `deload-after-misses`, labeled convention until audited. Native science does not wrap these numbers.
- Question a source must answer: after how many missed sessions the load should drop, by what fraction, and whether that differs by progression policy.
- What would change: those two constants, and the register would leave "Convention until audited". The shared engine keeps today's numbers until that file changes. This lane does not edit it.
- Candidate source type: a comparison of planned load reductions against continued training with no reduction.

## Estimated 1RM

- Current default: Epley, `weight * (1 + reps / 30)`, named `epley`. A single formula is not shown above 12 reps. A weighted blend of other formulas exists and is not the default.
- Where it lives: `DEFAULT_FORMULA` and `REP_CAP` in `frontend/src/lib/onerm.js`. The register entry is `e1rm-formula`, labeled convention until audited.
- Question a source must answer: which formula should be the default estimate of a tested one-rep max, through how many reps that estimate is still about maximal strength, and whether a blend should replace the single formula.
- What would change: `DEFAULT_FORMULA` and `REP_CAP`, and the register would leave "Convention until audited". The blend stays off unless the source supports making it the default. This lane does not edit the shared file.
- Candidate source type: a validation comparison of estimated one-rep max formulas against a measured one-rep max.

## Rest

- Current default: a new profile rests 90 seconds between sets, and 15 seconds between rest-pause bursts.
- Where it lives: `restSec` and `restPauseSec` on the default profile in `frontend/src/store/useStore.js`. The register entry is `rest-defaults`, labeled convention until audited.
- Question a source must answer: how many seconds should pass between straight sets, and between rest-pause bursts, for the outcomes this app trains.
- What would change: those two profile defaults, and the register would leave "Convention until audited". Existing profiles that already stored a rest time would keep it. This lane does not edit the shared store.
- Candidate source type: a rest-interval comparison that reports rest duration against strength or muscle growth.

## Increments

- Current default: 2.5 kg, or 5 lb. Upper legs, lower legs, back, hips, and glutes use 5 kg, or 10 lb. An exercise can override the step.
- Where it lives: `defaultIncrement` in `frontend/src/lib/exercises.js`. The register entry is `load-increments`, labeled convention until audited.
- Question a source must answer: what load step a successful session should add, and whether upper legs, lower legs, back, hips, and glutes should use a larger step.
- What would change: `defaultIncrement` for those body parts, and the register would leave "Convention until audited". An exercise that already stores its own step would keep it. This lane does not edit the shared helper.
- Candidate source type: a progression comparison of practical load steps, not a program template copied in as if it were a finding.
