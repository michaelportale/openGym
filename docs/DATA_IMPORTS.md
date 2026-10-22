# Importing and exporting data

Everything here lives in the app under **Settings → Data & backup**, except plan sharing, which is on the
**Plan** screen.

| You want to | Use |
|---|---|
| Bring your workout history from another app | **Import from another app** (CSV) |
| Preview structured Markdown workout notes | **Import from another app** (one or more `.md` files) |
| Pull workouts, routines and weigh-ins from Hevy Pro | **Import from Hevy** (API key) |
| Bring body weight over from an iPhone | **Import from another app** with the Apple Health export |
| Give someone your routines | **Plan → Share your plan → Export plan file** |
| Back up or move everything | **Export backup** / **Import backup** |

## Workout history from another app

Export a CSV from your old app, then pick it under **Settings → Data & backup → Import from another app**.
openGym matches exercise names against its library; anything it doesn't recognise becomes one of
your own exercises, so nothing in the file is dropped. Days that already have a workout in openGym
are left alone, so importing the same file twice never duplicates anything.

These exports work without any editing:

| App | Where to export |
|---|---|
| FitNotes (Android) | Settings → Backup/Export → **Spreadsheet Export** |
| FitNotes 2 (iOS) | Export workouts as CSV |
| Strong | Settings → Export Data |
| Hevy | Profile → Settings → Export & Import Data |
| Gravl | Profile → Export Data |

Other files work too, as long as they have a date, an exercise name and something measured
(weight and reps, a time or a distance). See [your own CSV](#your-own-csv) below.

> [!NOTE]
> History is a log of what you did, so it's imported separately from your routines. Importing
> workouts doesn't create or change any plan.

## Structured Markdown workout notes

Select one or more `.md` files through **Import from another app**. The preview shows actual
sets, warnings, equipment/load basis, and exercise mappings. Uncertain variants start as separate
custom exercises; choose a shared identity only when the movement and equipment are confirmed.
Nothing is saved until **Import**. This import reads files locally and never edits your notes.

Only the documented table format is accepted. Frontmatter needs `type: workout`, a valid local
`date: YYYY-MM-DD`, and a durable `source_session_key`. Actual rows require `status: complete`;
`data_status: partial` is allowed. Optional `timezone`, `session`, `load_unit`, and `load_unit_basis`
retain their source meaning. Missing times stay unknown.

These exact level-two headings and ordered table columns identify performed sets:

- `## Actual warm-ups`: `Exercise`, `Order`, `Equipment / attachment`, `Load`,
  `Units / per-hand, per-side, or total`, `Actual reps`, `Evidence / source`.
- `## Actual working sets`: `Exercise / variant`, `Set`, `Equipment / attachment`, `Load`,
  `Units / load convention`, `Actual reps`, `Effort / form, if reported`, `Evidence / source`.

Use one row per actual set, scalar numeric loads/reps, and exercise-local integer set ordinals.
Blank, `Unknown`, or `Unreported` values stay unknown. Free-text effort does not supply numeric
RIR. `Same setup` and `Same machine` refer only to the prior explicit setup for that exercise in
that document. Escape pipes inside cells as `\|`. Unsupported headers and numeric shorthand
produce warnings, without guessing additional sets.

Source keys distinguish sessions on the same day. Reimporting the same source adds nothing;
changed copies of one key are reported as conflicts and never silently replace results.
Warm-ups stay out of work totals. Physical units can be converted without doubling per-hand
loads or adding bar mass. Machine settings and unknown load conventions retain their exact
reported labels and stay out of load totals and strength estimates; incomplete totals are labeled
**Partial load total**. Exercise targets and station identities remain unknown until verified.
Historical imports never advance the current program queue. The [local acceptance record](dev/PERSONAL_STRENGTH_ACCEPTANCE.md) covers repeat-import and synthetic backup/restore verification; importing personal history remains a separate previewed operation.

`## Planned targets — not completed work` can offer separately labeled baseline proposals with
columns `Exercise / variant`, `Equipment / attachment`, `Load and units / convention`,
`Planned sets and reps`, `Rationale / prior source`. Only explicit prescriptions such as
`3 × 8–12` are supported, bounded to 1–10 sets and 1–1000 reps (finite safe integers,
with an ordered range). Unsupported prescriptions warn and are skipped. These are unchecked by default; selecting them saves independent
routines without activating a program. Next-exposure prose and summaries never become results.

## Hevy, directly

With **Hevy Pro** you can skip the CSV:

1. In Hevy, open [Settings → Developer](https://hevy.com/settings?developer) and create an API key.
2. In openGym, go to **Settings → Data & backup → Import from Hevy** and paste the key. It's used for this
   import only and isn't saved.
3. Choose workouts, routines, weigh-ins or any mix, then confirm.

Routines always arrive as new plans; nothing you already have is overwritten.

## Body weight from Apple Health

In the Health app on your iPhone, tap your profile picture, then **Export All Health Data**. Unzip
the result and pick `export.xml` under **Import from another app**. The file is often hundreds of
megabytes; openGym reads only the body-weight records from it, in whatever unit each one was saved
in, and keeps one weigh-in per day. Days that already have a weigh-in are left alone.

A CSV with a date column and a weight column works the same way.

## Sharing a plan

On the **Plan** screen, tap the share icon:

- **Export plan file** writes your routines and weekly schedule to a small JSON file. It contains
  no workouts and no weigh-ins.
- **Import a plan file** adds someone else's plan to yours. It merges, so your own routines are
  never overwritten.
- **Print / Save as PDF** gives you a clean printout.

An export always contains every routine. To share only some of them, import the file into the
[demo](https://opengym.ch/demo/), delete what you don't want, and export again. The
demo keeps everything in your browser; nothing is uploaded. The same trick works for building a plan
on a computer and then importing it into the phone app.

Writing a plan file by hand is possible but fiddly, because the exercise ids have to match the
library.

## Backups

- **Export backup (JSON)** saves your whole profile as one file. **Export with photos & videos
  (.zip)** includes your media as well.
- **Import backup** restores such a file and *replaces* everything currently in the app.
- **Auto-backup on changes** (phone app only) saves a dated copy to `Documents/openGym` after each
  workout or routine edit and keeps the newest 14. Point a sync app at that folder to get them off
  the phone — or, on Android, choose the sync app's own folder under Settings → Data & backup → **Backup folder**.

If you host openGym yourself, backing up the `./data` folder covers every profile at once; see
[backups](SELF_HOSTING.md#6-backups).

## Your own CSV

The smallest file that works:

```csv
workout name,exercise,date,weight kg,reps
Leg Day,Squat,2026-08-21,120,5
Leg Day,Squat,2026-08-21,125,4
Leg Day,Leg Press,2026-08-21,200,1
```

One row per set. Column names are matched ignoring case and punctuation; the first match wins.

| Field | Accepted headers |
|---|---|
| exercise | `exercise`, `exercise name`, `exercise title` |
| date | `date`, `workout date` |
| start time | `start time`, `start date` |
| end time | `end time` |
| workout name | `workout name`, `title`, `workout` |
| category | `category`, `body part`, `muscle group` |
| weight in kg | `weight kg` |
| weight in lb | `weight lbs`, `weight lb` |
| weight, unit in another column | `weight` |
| weight unit | `weight unit`, `unit` |
| reps | `reps`, `repetitions` |
| RPE | `rpe`, `rpe rating` |
| RIR | `rir`, `reps in reserve` |
| distance in km | `distance km` |
| distance, unit in another column | `distance` |
| distance unit | `distance unit` |
| duration in seconds | `seconds`, `duration seconds`, `set duration sec` |
| duration | `time`, `duration` |
| set type | `set type` |
| note | `comment`, `comments`, `notes`, `note`, `workout notes` |

## For developers

The CSV parser is `frontend/src/lib/import-csv.js`. The Hevy API import and a detected Hevy CSV
resolve exercises through the same generated lookup, `frontend/src/lib/hevy-id-map.js` (template id
for the API, English title for the CSV). To regenerate it, set `HEVY_API_KEY` in the environment or
`.env` and run `node scripts/build-hevy-id-map.mjs`. Localised (non-English) Hevy titles fall back
to name matching.
