# Engineering guide

openGym is a self-hosted workout and body-weight tracker. The web client is an installable
PWA. The Docker deployment serves the client, API and exercise media from one origin.

## Architecture

| Directory | Responsibility |
| --- | --- |
| `frontend/` | React, React Router and Zustand client, built with Vite |
| `api/` | Node HTTP API, authentication, persistence, notifications and optional AI Coach |
| `web/` | Frontend image build and nginx reverse proxy |
| `catalogue/` | Exercise metadata and separately licensed media |
| `mcp/` | Optional read-only stdio interface to training data |

The main client store is `frontend/src/store/useStore.js`. It persists application state
locally and synchronizes signed-in profiles through `frontend/src/lib/api.js`.
`store/useUI.js` holds transient interface state. Routes are defined in `App.jsx`; shared
components and domain helpers live in `components/` and `lib/` respectively.

The API stores account data and per-user state under `DATA_DIR`. Writes use temporary files
and atomic renames. Passkey authentication requires an appropriate `RP_ID`, origin and HTTPS
configuration. See [Self-hosting](SELF_HOSTING.md) and the [HTTP API](API.md) for deployment
and endpoint details. The optional [AI Coach](AI_COACH.md) is disabled by default.

This repository targets the web/PWA deployment. Native integration helpers and dependencies
remain in the source, but the upstream Android and iOS project directories are not included.

## Development and verification

Use Node 22 and the committed npm lockfiles. Install dependencies separately in `frontend/`,
`api/` and `mcp/` with `npm ci` (`npm ci --omit=optional` for the API's default installation).

```sh
# Frontend development server; API requests are proxied to port 3000.
cd frontend
npm run dev

# Frontend tests and production build.
npm test
npm run build
```

Run `npm test` in `api/` and `mcp/` for their suites. The complete CI commands, including
localization checks and container validation, are defined in
[the test workflow](../.github/workflows/test.yml). Tests for domain helpers are colocated
with their implementations. Changes to progression, completed-session interpretation or
sync behavior require coverage of the affected invariants.

## Workout state

`frontend/src/lib/workout-model.js` defines shared set-row operations. A set's `phase`
distinguishes work from warm-up; `type` distinguishes straight sets, drop sets and rest-pause.
An absent type is interpreted as straight.

- **Drop sets:** `w` and `r` describe the main effort. `drops` contains additional efforts.
  Volume includes the main effort plus each drop's weight multiplied by repetitions.
- **Rest-pause:** `r` is the total repetition count. `clusters` decomposes that total into
  bursts; it must not be added to volume a second time.
- **Failure:** `failure: true` is independent of set type. Explicitly logged RIR/RPE takes
  precedence over the failure flag when resolving effort. Warm-ups are excluded.

Exercise configuration can include an `intensifier`. `applyIntensifierPlan` in `history.js`
uses the prescribed loads to construct the nested set rows. Rest-pause configuration builds
a warm-up and a rest-pause work row. Live edits must preserve the total-repetitions invariant.
Completion, volume and progression consumers share these helpers; new consumers should not
implement a separate interpretation of nested sets.

### Combined routines

`session-merge.js` builds entries from an ordered list of routine IDs. It removes duplicate
IDs, ignores missing routines, concatenates the resolved entries and stamps each entry's
source routine as `rid`. Duplicate exercises from different routines remain separate.

Weekly planner slots can contain multiple routine IDs. Per-date overrides remain scalar.
Active and saved sessions use `routineIds`; compatibility readers accept older single-ID
records. Saved sessions retain their source associations so progression can update the
correct routine rather than whichever routine happens to be displayed.

Coach day overrides are single-routine operations. Applying one replaces that date's
combined-day selection with the chosen routine; callers must make that scope clear.

### Workout layouts

The workout view supports `cards`, `list`, `compact` and `focus`. An absent or unrecognized
value falls back to cards. A session snapshots the saved default at creation; its layout can
then be changed without altering that default.

All layouts share the completion pipeline, including rest timers and superset progression.
Focus uses a transient visible-set pointer and starts at the first incomplete set. Compact
hides secondary information while retaining exercise actions in the menu. Tests for layout
selection and session defaults are in `Workout.test.jsx`, `Settings.workoutview.test.jsx`
and `sheets.workoutview.test.jsx`.

## Training calculations

### Coverage

`training-coverage.js` distinguishes prescribed work from completed work. A completed working
set contributes one direct set to an explicitly identified primary muscle and half a set of
credit to an explicitly identified secondary muscle. Direct and secondary totals remain
available separately. Warm-ups and unfinished sets do not count as completed work. Unknown
exercise metadata is reported rather than converted into a known zero.

Direct-work days are counted by local training date. Targets are configurable planning aims;
coverage totals do not establish whether an individual has received sufficient physiological
stimulus. Secondary credit is an accounting estimate, not a measured biological conversion.

### Comparability and suggestions

Exercise identity, equipment station, load convention, units and movement variant determine
whether observations are comparable. Per-hand loads, total barbell loads and machine settings
must not be treated as interchangeable. Preserve the exercise metadata attached to recorded
workouts when interpreting history.

Progression and adaptation suggestions must distinguish recorded facts, missing information
and application heuristics. Proposed changes to future training use a preview and acceptance
flow; completed history is not rewritten to match a new plan. See `progression.js`,
`training-adaptation.js` and their tests for the active rules and validation conditions.

### Duration estimates

`training-adaptation.js` estimates session time from work, rest, warm-ups and exercise
transitions. Defaults are 45 seconds per set, 150 seconds between compound sets, 90 seconds
between isolation sets and 120 seconds between exercises. Inter-set rest is not added after
an exercise's final working set. Estimates expose uncertainty when required metadata is
missing and can be adjusted through the policy input. These are scheduling assumptions,
not guarantees of workout duration.

### Fatigue model

`recovery.js` derives a decaying estimate from logged work and effort. Its secondary-muscle
weighting is separate from the coverage calculation. It is not a diagnosis or a countdown to
physiological recovery. Individual muscles can retain high estimates under repeated loading;
that is a possible model output. Removing an older workout can change later sessions’
effort anchors and therefore rescore later fatigue contributions. Deleting the latest workout
is tested separately for monotonicity. The recovery tests
cover decay, effort handling and repeated-session behavior.

## Styling

Base styles live in `frontend/src/index.css`, shared tokens in `theme/tokens.css`, and
screen-specific styles next to their views. Palette definitions live in `theme/palettes.json`.
Generate palette styles with `node scripts/gen-palettes.mjs` from `frontend/`; verify them
with the same command's `--check` option. Do not hand-edit generated palette CSS.

Verify changed interfaces at phone and desktop widths, with keyboard navigation and reduced
motion enabled. Automated browser checks do not replace physical-device checks for installed
PWA behavior, background timers or the software keyboard.

## Local development material

Agent instructions, implementation plans, review logs, private notes and generated browser
captures are local-only and excluded through `.gitignore` and `.dockerignore`. Maintained
public documentation describes supported behavior, interfaces and operational requirements.
