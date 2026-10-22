# Personal strength training — agreed design

Status: product scope confirmed by the user on 2026-10-21. Implementation has not started.

## Outcome

Make openGym the user's daily iPhone training system: retain history, explain what to train next, make set entry quick, and support consistent progression without reconstructing context in daily chats. Strength training ships first. Nutrition, WHOOP/Garmin ingestion, cardio coordination, recovery routines, and optional Obsidian exports are later work.

## Accepted behavior

- OpenGym owns structured training records. Existing Obsidian records provide import context, with plans, completed work, estimates, and unknowns kept separate.
- Keep preferred lifts and a stable PPL baseline. Default to six sessions (PPL twice); propose PPL plus upper/lower when availability falls to five. Do not require advance commitment to five or six days.
- Plan around 75 minutes, generally 60–90. Duration is an estimate, including rest and transitions. If coverage cannot fit, explain the shortfall rather than compressing all missed work into the remaining sessions.
- Log load and reps per set, felt RIR on the last working set of each exercise. Never copy that RIR onto earlier sets. Preserve optional ratings already entered elsewhere.
- Keep prescribed and completed work separate. No log does not mean a missed session. Offer explicit rest, missed, and trained-but-unlogged states.
- Count off-program completed work toward coverage and comparable lift history. Rotation advancement remains explicit.
- Show a rolling seven-day view and whole-cycle context: muscle-group frequency, direct sets, secondary contribution, and exercise roles. Aim for twice-weekly meaningful exposure, with editable targets.
- Use evidence-informed progression and coverage rules with sources and uncertainty. Physiological response is not deterministic. Missing RIR, equipment identity, or completion remains unknown.
- Propose meaningful future-plan changes with an explanation; apply only after acceptance. Never rewrite completed history. Routine next-session load/repetition suggestions are editable.
- Rank exercise swaps by role and muscle-target similarity, then prior usage among comparably suitable alternatives. A fly can be a lower-ranked chest alternative to a press, never silently equivalent.
- Save specific gym equipment stations, optional manufacturer/model details, supported exercises, attachments, and load conventions. A broad machine category cannot establish availability of a specific station. Allow temporary exclusions and custom entries.
- Default swaps to the current session; explicitly offer retaining a change in the plan.
- Keep DB per-hand, plate-loaded per-side, barbell total, and machine-setting loads distinct. Preserve exercise/equipment snapshots in history.
- Persist active workouts across refresh, screen lock/reopening, and interrupted network access using the existing PWA architecture. Verify on a real iPhone before claiming device readiness.

## Existing implementation to extend

React/Vite/Zustand frontend, pure domain helpers with Vitest, Node API storing per-user JSON, read-only MCP bridge. Keep existing architecture and dependency footprint.

- `frontend/src/lib/equipment.js`: category profiles, accessory checks and legacy compatibility; lacks exact station identity.
- `frontend/src/lib/similar-exercises.js`: primary-target match with same-equipment ordering; lacks role similarity and usage tie-breaks.
- `frontend/src/lib/effort.js`: actual RIR/RPE support already exists.
- `frontend/src/lib/progression.js`: existing progression policies do not consume effort.
- `frontend/src/lib/muscles.js`: explicit muscle metadata and snapshots already exist; its legacy secondary weight is 0.4. Do not silently replace this across recovery/history consumers.
- `frontend/src/lib/rotation.js`, `queue.js`: reusable rotations and active queues already exist.

## Evidence and research boundaries

[Pelland et al.](https://pubmed.ncbi.nlm.nih.gov/41343037/) compared indirect-set accounting methods; fractional (0.5) accounting had strongest support among evaluated models. A proposed new coverage policy may use direct=1, relevant indirect=0.5, while clearly labeling the result an estimate. This is not a validated universal coefficient for every exercise or muscle, nor a formula for RIR-based stimulus.

[ACSM 2026 position stand overview](https://acsm.org/science-spotlight-acsm-releases-new-position-stand-on-resistance-training/) and the cited research require focused review before choosing numeric volume, qualifying-exposure, progression, and adaptation rules. Twice-weekly coverage is the user's planning preference; no arbitrary exact exposure threshold has been approved.

Fitbod investigation is explicitly requested and remains open. Official documentation supports equipment profiles and replacements; it does not establish its proprietary ranking algorithm or universal gym inventory. Its [App Store listing](https://apps.apple.com/us/app/fitbod-gym-fitness-planner/id1041517543?platform=mac) supports compatible Apple Silicon Macs. No local Fitbod artifact was found and no phone runtime connection exists. Once available, inspect gym lookup, equipment editing, set logging and substitutions using REA/UI evidence. Record observations, inferences and unknowns separately; do not promise recovery of server-side data.

## Privacy and rollout

Do not commit personal workout notes or real health-record fixtures to this source repository. Use synthetic test data. Import actual vault records only into private application data after preview, preserving source identifiers and uncertainty; do not modify the vault as part of import.

Use a separate development branch and a reviewable PR for implementation. Keep old records, policies and equipment profiles compatible. Do not reset existing user state to simplify migrations.

## Acceptance scenario

On iPhone, begin the next PPL session, see comparable history and an explained prescription, log sets and final-set RIR, replace an occupied machine with a suitable alternative, reopen the app without losing work, and finish once. Coverage reflects actual work exactly once. Mark a subsequent planned day missed; preview and accept an adjustment to remaining sessions within the time budget. Completed records and the original program remain traceable. Importing the same historical record twice adds only one session.
