# Fitbod research gate

Status: **open investigation**, checked 2026-10-21. This note separates public documentation from direct observation. Do not describe openGym as matching Fitbod behavior on the strength of the help pages alone.

## Access check

- A bounded search for `*fitbod*.app` under `/Applications` and `/Users/michaelportale/Applications` returned no installation. No connected phone runtime or authenticated Fitbod Mac session was available. No app was launched, installed, or signed in; no subscription or workout history was changed.
- The [Mac App Store listing](https://apps.apple.com/us/app/fitbod-gym-fitness-planner/id1041517543?platform=mac) identifies app `1041517543`, an iPhone-designed app compatible with macOS 15+ on Apple M1 or later. On this check the listing showed version `8.37.0`; that is a **store version, not an observed installed version**.
- REA artifact ID, bundle version/build, account state, UI capture IDs, and flow-level observations: **none**. Do not imply REA or live UI inspection occurred.

## Public-source observations and unknowns

| Requested flow | Public documentation says | Still to verify in an accessible session |
| --- | --- | --- |
| Gym lookup/location | Fitbod's [My Plan guide](https://help.fitbod.me/hc/en-us/articles/34336407191191-My-Plan) says Location can select or add a gym and equipment. A [partner-specific guide](https://help.fitbod.me/hc/en-us/sections/31891383789975-Partnerships) describes selecting a participating club profile and reviewing equipment. | Whether the user's gym appears, what lookup returns, whether any specific station inventory exists, and whether profiles are curated or user-entered. Public material does **not** establish universal automatic gym inventory. |
| Equipment editing | The [feature guide](https://help.fitbod.me/hc/en-us/sections/360012732693-App-Features) describes My Plan → Available Equipment, including weight increments for dumbbells, kettlebells, and barbells. | Exact Mac screens, station granularity, attachments, model identity, temporary exclusions, and how edits affect an active workout. |
| Set logging | Fitbod's [fields guide](https://help.fitbod.me/hc/en-us/articles/29486697282711-Exercise-Details-Screen-Sets-Reps-and-Weight-Fields-Explained) documents reps/load entry, per-dumbbell load, barbell total versus plates-only conventions, machine numbers, and RIR input. Its [workout editing guide](https://help.fitbod.me/hc/en-us/articles/360006335593-Editing-Workouts-in-Fitbod) says logged workouts can be edited. | Current Mac set-entry sequence, final-set RIR behavior, interrupted-session persistence, and account-specific history. |
| Substitutions | The [editing guide](https://help.fitbod.me/hc/en-us/articles/360006335593-Editing-Workouts-in-Fitbod) describes Replace, filters for equipment, and sort options including Best Replacements and Most Logged. | Exact candidate order and whether a replacement affects one session or future plans. “Best Replacements” is a UI label; the proprietary ranking formula is unknown. |

Fitbod's [workout-generation guide](https://help.fitbod.me/hc/en-us/articles/360004429814-How-Fitbod-Creates-Your-Workout) says training history, recovery, available equipment, preferences, and edits influence recommendations. That is a vendor description, not independent algorithm evidence. No server-side data or code was inspected, and public help pages do not reveal its complete ranking or progression logic.

## Required direct investigation when access exists

With an accessible Mac installation and account session, record the exact bundle ID/version/build and evidence IDs, then use REA and UI tooling to inspect: (1) location search and a gym profile, (2) equipment selection and editing, (3) set logging with load convention and RIR, and (4) an exercise replacement and its persistence scope. Use the least invasive read-only path or disposable unsaved workout state; do not change subscriptions or saved history. Keep raw account captures outside Git and put only deidentified observations, inferences, and unresolved questions in this note. Recheck public documentation against that installed version because the UI may differ.

Independent data modeling and logging work may proceed with explicit openGym requirements. Do not assert Fitbod parity, proprietary recommendation behavior, or automatic inventory until the corresponding direct evidence exists.
