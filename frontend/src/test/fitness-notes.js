// Invented records only; never copy private vault data into fixtures.
export const fitnessNote = ({ key = 'synthetic-alpha', date = '2040-02-03', reps = 'Unreported', load = '6.5', setup = 'Dumbbells', convention = 'kg per hand', exercise = 'Example dumbbell raise', status = 'complete' } = {}) => `---
type: workout
date: ${date}
timezone: America/New_York
session: Synthetic session
status: ${status}
data_status: partial
load_unit: kg
source_session_key: "${key}"
---
## Planned targets — not completed work
| Exercise / variant | Equipment / attachment | Load and units / convention | Planned sets and reps | Rationale / prior source |
| --- | --- | --- | --- | --- |
| Example cable raise | Cable | 9 kg setting per arm | 4 × 5–7 | Synthetic proposal |
## Actual warm-ups
| Exercise | Order | Equipment / attachment | Load | Units / per-hand, per-side, or total | Actual reps | Evidence / source |
| --- | ---: | --- | ---: | --- | ---: | --- |
| ${exercise} | 1 | ${setup} | 3 | ${convention} | 6 | Synthetic report |
## Actual working sets
| Exercise / variant | Set | Equipment / attachment | Load | Units / load convention | Actual reps | Effort / form, if reported | Evidence / source |
| --- | ---: | --- | ---: | --- | ---: | --- | --- |
| ${exercise} | 1 | ${setup} | ${load} | ${convention} | 9 | Controlled eccentric | Synthetic report |
| ${exercise} | 2 | Same setup | ${load} | ${convention} | ${reps} | Near failure; incomplete attempted rep | Synthetic report |
## Drop sets, supersets, and substitutions
- Reported substitutions: Example dumbbell raise replaced Example cable raise.
## Next exposure — proposed
| Exercise | Proposed target | Basis and source | Proposal date |
| --- | --- | --- | --- |
| Example dumbbell raise | Keep load; cleaner execution | Synthetic proposal | 2040-02-03 |
## Readiness and constraints
Unrelated private narrative must not be imported.
`
