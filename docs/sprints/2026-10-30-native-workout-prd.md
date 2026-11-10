# Native openGym sprint: PRD

Status: agreed scope. Implementation is under way; see the Status table under Delivery phases.
Replaces the October 30 draft. Decisions come from the grilling sessions of November 2026.

## Summary

Build a React Native iPhone app that replaces the web app as the owner's daily training tool. It
logs workouts offline, survives every ordinary interruption, syncs with Apple Health in both
directions, and bases its training guidance on cited evidence. The self-hosted API and MCP server
stay on as the off-phone copy and the bridge to chatbot analysis. The web UI is removed at the end
of the sprint.

The product thesis: this is not a nicer notes app. Each recommendation the app makes can show where
it came from and how strong the evidence is.

## Goals

1. Log a real gym session on an iPhone 16 with no network, without losing a set or a correct time.
2. Make the app the source of truth, replacing free-text logging and analysis by chatbot.
3. Sync with Apple Health in both directions, without duplicates.
4. Back every training rule with a cited source, or label it plainly as convention.
5. Deliver a clearly better UI: graphite and icy blue, with purposeful motion.
6. Keep all data recoverable after losing the phone.

## Non-goals

- Android, Apple Watch, Live Activities.
- Background Health sync.
- Reading workouts, heart rate or calories from Health.
- Set types beyond those in Scope: L/R split sets, drop sets, rest-pause, supersets, cardio logging.
- Micronutrients or a food database.
- The AI coach and structural balance screens. Chatbot analysis through MCP replaces both.
- Automatic training changes based on WHOOP data.
- Writing sessions back to Obsidian.
- Friends on TestFlight, and any App Store release.
- A commercial or closed-source product, or a rename.

## Users

The owner, on one iPhone 16, training in pounds. English only. Friends may test in a later sprint.

## Scope by tab

Five tabs stay in fixed positions: Home, Plan, Workout, Progress, Exercises.

| Tab | In this sprint |
| --- | --- |
| Home | Next session from the rotation, start or resume, nutrition summary card. |
| Plan | View rotation and routines. Reorder, swap exercise, change sets and rep range, override progression per exercise. |
| Workout | Full logging flow (below). |
| Progress | Body-weight trend, per-lift history and e1RM, Measurements, Nutrition, read-only WHOOP recovery, strain and cardio. |
| Exercises | Browse and search the catalogue and custom exercises. Text built in; animations per the licence rules below. |

**Workout flow:** weight x reps sets, complete and undo, add a set, edit any set during or after the
workout, move between exercises, finish, rest timer. Warm-up sets are prompted at the start of a
lift. Dumbbell load can mean "each" (per hand), so a lateral raise logged at 20 lb counts as 40 lb
of volume. Machine loads remain displayed settings and are not compared across machines.

**Nutrition** ports the existing feature: daily calories, protein, carbs, fat, fiber, day type,
targets and supplement check-offs. It starts empty.

**Imported data the app cannot edit yet** (for example a drop set in history) is shown read-only and
must never be lost or altered on a round trip.

**Functionality cleanup:** the app ports behavior, not quirks. Where a web flow is clunky, the
implementer flags it and the owner decides, rather than changing it silently.

## Architecture

```
native/ (Expo dev build, React Native)
  screens, motion, native adapters
  SQLite: active-session journal, drafts, workouts, health links, push outbox
  imports the pure helpers in frontend/src/lib
        |  PUT and GET /api/data with baseRev, Bearer token from pairing
        v
api/ (self-hosted, reached over the owner's private network)
  data/state-<uid>.json
        ^
mcp/ reads the same data, so chatbot analysis keeps working
```

- **Package:** a new `native/` Expo package in this repo. It is exempt from the web app's "React +
  Router + Zustand only" dependency rule, though each dependency still has to justify itself.
  `api/` stays dependency-light.
- **Shared logic:** import `frontend/src/lib` in place this sprint. A boundary test fails if a reused
  module reaches browser or Capacitor code. `rest-alert.js` and `health-sync.js` are tied to
  Capacitor and are rebuilt as native adapters.
- **Native libraries:** versions are chosen from current official docs when the implementation plan
  is written. This PRD does not pin an Expo SDK.
- **Pure logic:** timer, journal folding, warm-up and sync planning rules live in pure modules with
  unit tests, following the repo's rule for training logic.

### Data layer

| Store | Shape | Why |
| --- | --- | --- |
| Active session | Append-only journal in SQLite: set commit, edit, undo, rest change. Each event has a unique id. | Crash-safe, replayable, and a repeated tap cannot double count. A correction is a new event. |
| Drafts | Own table | Partial input is kept but never counts as a completed set. |
| Finished workouts | One row per workout: the web-format JSON plus indexed id and date | Reused helpers work unchanged and the API already stores this format. |
| Health links | Workout id to Health sample id and sync version | Retries and edits replace instead of duplicating. |
| Outbox | Pending API pushes | Pushes wait until the server is reachable. |

The whole app is not event-sourced. On finish, the journal folds into a finished-workout document.
State keys the app does not understand must be preserved when it writes back to the API.

## Science-based training

Every training rule gets an entry in `docs/science/`: claim, source, population, evidence strength,
and what is our own inference. The app has a "Why this?" sheet showing that entry, and says plainly
when evidence is thin. **No number ships without an entry.** Not every number can have a study behind
it, so the standard is an honest label rather than false certainty.

The sprint also audits rules inherited from the web app, and labels any without support as
convention.

| Rule | Decision | Basis | Label |
| --- | --- | --- | --- |
| Warm-up loads | 2 sets, 6 reps, at 40% and 80% of working weight, rounded down to loadable weight, never below the bar. 80 lb dumbbells gives about 30 and 60. | Ribeiro et al. [1] | Limited: one crossover study, bench result |
| Warm-up volume | More sets are not assumed to help. The owner can add a set at any time. | [2] found 1-2 sets similar to none before 10RM work | Limited |
| When to prompt | First lift for a muscle group in the session; not later lifts. | [2] supports skipping near 10RM loads | Our inference |
| Warm-up accounting | Saved and shown in history, counted in session duration. Excluded from progression, PRs, e1RM and volume. | Warm-ups are priming, not work | Definition |
| Injury claims | The app makes no claim that warm-ups prevent lifting injuries. | [3] insufficient; [4] found no upper-body injury studies | Evidence gap |
| Rep ranges | Default to the program's range. The app does not call 8-12 uniquely optimal. | [5] gains across a wide range of loads | Abstract only; read in full before citing further |
| Progression | Double progression: when every work set reaches the top of the range in one session, raise the weight and return to the bottom of the range. | [6] load and rep progression both viable | The one-session trigger is convention |
| Effort | Optional reps-left-in-the-tank per set. Reports of many reps left show "this looks far from failure". | [7] growth improves closer to failure; strength similar across a wide range | Exploratory, estimated proximity |
| Weekly volume | No targets ship until the primary paper is read. | [8] known through secondary summaries only | Unverified |
| Deload after 3 misses, e1RM formula, rest defaults, increments | Inherited, pending audit. | None reviewed yet | Convention until audited |

The existing warm-up helpers ramp by midpoint, not 40/80, so the warm-up rule needs a new pure helper
with tests. This is general training information, not medical advice.

## Apple Health

| Direction | Data |
| --- | --- |
| Write | Finished strength workouts (type, start, end, total volume in metadata) and weigh-ins logged in the app. |
| Read | Body weight from other apps and devices. |

- **Timing:** syncs when the app opens, a workout finishes or a weigh-in is saved.
- **Workout edit or delete in the app:** replaces or removes the Health copy.
- **Workout deleted in Health:** does not touch history in the app. The app owns set-level data.
- **Weigh-ins:** one per day. A manual app entry beats an import; otherwise the latest Health reading
  wins. The app ignores its own samples when reading.
- **Imported weigh-in deleted in Health:** also removed from the app.
- **Failure:** a refused permission or failed export never blocks recording. Local save always comes
  first, and retries never create duplicates.

## Backup, pairing and cutover

- The phone is the only writer after cutover. It pushes after changes when the API is reachable, and
  pushes queue while the Mac is asleep or off the private network.
- Restore pulls from the API. The off-phone copy relies on the Mac's own backups.
- Saves use the API's `baseRev` conflict check. On a conflict the phone never overwrites: it keeps
  local data and shows the problem.
- Pairing reuses `/api/pair/create` and `/api/pair/redeem`. Tokens last `SESSION_DAYS` and renew with
  use. The token is stored in the iOS Keychain.
- A Mac command prints a one-time pairing code or QR code, because web Settings is going away.

**Cutover:** back up `data/`, pair the phone, load existing routines, rotation and history once, then
stop logging on web. No Obsidian parser is needed: that history is already in the API. Nutrition
starts fresh, and weigh-ins come from Health going forward.

## WHOOP

Move the fetch from the local WHOOP dashboard into the API, and show recovery, strain and cardio
read-only in Progress. WHOOP secrets never reach the phone. The dashboard keeps its tokens in the
macOS Keychain, which the API's container cannot read, so the implementation plan must choose secure
server-side storage first. Built after Health sync.

## Visual direction and motion

Reference: [`assets/2026-10-30-native-workout-reference.png`](assets/2026-10-30-native-workout-reference.png).

- Graphite surfaces, restrained icy blue, smoked glass on navigation and overlays, flat controls.
- Exercise card with Set / LB / Reps / Done rows, rest panel, "Up next" row, full-width "Complete set".
- No inflated clay bevels or orange accents. Comfortable touch targets for one-handed use.
- Follow React Native best practice, and be proactive about motion: coordinated set completion, rest
  and next-set transitions that can be interrupted, with purposeful haptics.
- Reduced motion and disabled haptics remain fully usable.
- The web Tide theme is not changed.

## Interruption-safe workout contract

Workout changes are saved as they happen, not only when the app leaves the foreground. On return,
the app restores the current exercise, set and meaningful screen position, and does not reopen the
keyboard or steal focus after a long interruption.

Session time keeps running while the phone is locked or another app is open. Leaving the app does
not pause, finish a set or end the workout. An explicit rest pause keeps its remaining time until
resumed. Timer deadlines and pause state are stored durably rather than counted from JavaScript
ticks. Clock and time-zone changes must not create negative times or made-up duration; the
implementation plan documents the timing strategy.

A native local notification is scheduled when rest starts, and replaced or cancelled when rest
changes, pauses, is skipped or the workout ends. Relaunch reconciles timer state with pending alerts,
including termination between saving and scheduling. No duplicate or stale alerts, and an old
notification never restarts a finished workout.

Notification permission is requested in context. If refused, the workout stays fully usable and the
app explains that background alerts are unavailable. System notification, silent-mode and Focus
settings are respected, and audible delivery is never promised. The app does not keep the CPU awake
or play silent audio in the background, and brief feedback avoids stopping the user's music.

If a save fails (for example full storage), the app never claims the set was saved. It keeps the
visible entry and offers a retry.

The app records workout state and elapsed time, not activity in other apps. Phone pickup is a usage
scenario, not rep detection or motion surveillance.

## Delivery phases

There is no fixed deadline and nothing is cut. The sprint ends when every acceptance criterion
passes on the iPhone 16. This is much larger than the original draft, so each phase lands as one or
more reviewable branches and PRs, split at implementation time.

| # | Phase | Done when |
| --- | --- | --- |
| 0 | Foundation and feasibility | Dev build runs on the iPhone. Metro loads the shared lib, including its JSON import attributes and 1.17 MB catalogue, with the boundary test in place. HealthKit gates below pass. |
| 1 | Visual system and shell | Five tabs fixed. Unbuilt destinations are honestly marked during testing. |
| 2 | Durable workout flow | Journal, drafts, edit, undo, finish and recovery after termination, with real shared logic. |
| 3 | Rest timer, notifications, motion | Interruption contract implemented; motion and haptics in place. |
| 4 | Science engine | `docs/science/` register, warm-up prompt, progression, effort, "Why this?" sheet, rule audit. |
| 5 | Pairing, backup, cutover | Pair command, push, restore, conflict handling, round-trip preservation. Restore is tested on a copy before the real cutover. |
| 6 | Apple Health sync | Two-way sync and all rules above. |
| 7 | Remaining tabs | Plan, Progress, Exercises, Nutrition, Measurements. |
| 8 | WHOOP | Read-only display through the API. |
| 9 | Device acceptance | Scenario table and a real gym session pass on an internal TestFlight release build. |
| 10 | Web retirement | Web UI removed; shared logic moved to `packages/core`, because `mcp/` still imports it; docs updated. |

**HealthKit gates (Phase 0).** `@kingstinct/react-native-healthkit` is the first candidate. On the
iPhone it must: save a workout, retry without a duplicate, replace after an edit, delete it, and read
body weight from another app. If any gate fails, build a small custom Expo module instead.

Phase 10 depends on Phase 9 passing and on the pair command existing. The nginx `web` container also
proxies the API and serves exercise media, so its replacement is planned before removal.

### Status

| Phase | State | Where |
| --- | --- | --- |
| 0 | Done | PR #41 |
| 1 | Done | PR #110 ("Promote native phase 1 foundation to main") |
| 2 | Code done; the owner's device checklist is pending | Engine hardening PRs #101–#105, #107–#109 and #111 (real-SQLite kill tests); real workout stage 1 in PR #112 (merged 2026-11-09); stage 2 in PR #113 (merged 2026-11-09) |
| 3 | Code done; the owner's device checklist is pending | PR #114 |
| 4 | Code done; the owner's device checklist is pending | PR #115 |
| 5 | Code done; the owner's device checklist is pending | PR #116 |
| 6 | Code done; the owner's device checklist is pending | PRs #117 and #118 |
| 7 | Phase 7 code done, with the device checklist pending | PR #119, PR #120, PR #121 and PR #122 |
| 8-10 | Not started | |

Phase 9's device acceptance and the real gym sessions are the owner's to run. The checklist is
[`2026-11-native-first-workout-checklist.md`](2026-11-native-first-workout-checklist.md).

## Acceptance criteria

**Logging**
- Logging needs no network and survives app termination.
- Completion, undo and edits keep set data and totals correct, with no double counting.
- Active fields and completed sets are distinguishable without relying on color.
- All five tabs keep fixed positions. Reduced motion and disabled haptics remain usable.
- Rest and session times stay correct after backgrounding and process restart, without JavaScript
  timers or continuous background execution.

**Science**
- Every training number shown has a `docs/science/` entry and a "Why this?" explanation.
- Warm-ups never affect progression, PRs, e1RM or volume.
- A finished session produces next-session suggestions from the shared progression engine, using
  imported history.

**Data**
- Delete the app, reinstall and restore: every set returns.
- Imported data, including set types the app cannot edit, survives a round trip unchanged.
- A server conflict never overwrites data on either side.
- The MCP server reads phone-pushed data correctly.
- The API, MCP and shared-logic test suites pass.

**Health**
- Retried exports never duplicate. An edit replaces the Health copy; a delete removes it.
- Refusal or failure never blocks local recording.
- The weigh-in rules above hold, with no echo of the app's own samples.

**Physical-device scenarios** (all must pass; results go in a dated log in `docs/sprints/`)

| Scenario | Expected behavior |
| --- | --- |
| Complete a set, immediately lock the phone | Set remains saved; rest deadline is correct when unlocked. |
| Switch to Messages while editing weight or reps | Draft and place preserved; partial input never counts as completed. |
| Change music and return repeatedly | Same workout and exercise; no reset, duplicate timers or needless audio interruption. |
| Lock during rest and return before its deadline | Correct remaining time shown immediately. |
| Return after rest expired | Rest shown complete; no negative countdown, replayed alarm or automatic next set. |
| Pause or extend rest, then background | Pause or new deadline preserved; old alert cancelled or replaced. |
| Tap a rest notification | Opens the matching active workout; a stale one opens a safe current state. |
| OS kills app, force-quit or device restart | Session and drafts recovered, timing recomputed; notification behavior verified for each case. |
| Lose connectivity or enable airplane mode | Recording, timing and local notifications continue; pushes queue. |
| Deny notifications; Focus, silent mode or Low Power Mode | Recording and recovery still work; alert scheduling is distinguished from presentation and sound. |
| Undo or complete rapidly, or background during completion | No double counting; last durable state recovered; alerts reconciled. |
| Finish during rest, then reopen from an old alert | History appears once; no remaining alert or revived session. |
| Leave a session unfinished overnight | Offer resume, finish with a chosen end time, or discard; overnight time is never logged silently. |
| Change system clock or time zone mid-session | No negative timers, duplicated session or corrupted duration. |
| Interrupt Health permission or export | Local workout remains saved; retry is explicit and creates no duplicate. |
| Storage full during save | No false "saved"; entry preserved with an actionable retry. |
| One-handed use and keyboard during a real session | Controls reachable; keyboard never hides the active field. |

## Verification

Unit tests cover pure logic, using a fake clock for timers, time-zone changes, expired rest and
overnight sessions. The owner runs manual device checks against the scenario table. UI automation is
not in scope. GitHub Actions runs five jobs (test (frontend), api, api-image, mcp, native) on pull requests
that touch those folders. The suites still run locally before merging.

## Licence and media guardrails

This is general guidance, not legal advice.

- openGym stays an AGPL-3.0 derivative with attribution kept. A new UI does not change that, because
  the app imports the existing logic.
- Personal use has few obligations. Sharing a build with friends later counts as distribution, and
  they must be able to get the source. The App Store exception in `NOTICE.md` comes only from the
  original copyright holder, so other contributors' code may not be covered.
- A commercial or closed path would need a rewrite of the training logic, a lawyer and a separate
  decision.
- **Exercise media stays non-commercial and unmodified, with its notice.** It is not bundled (216 MB).
  It loads from the owner's server when reachable and is cached, with text only when offline.
- **Agents must not open, read, or generate from files in `catalogue/media/`.** The licence bars
  feeding this media to any AI system.
- This repo is public: no personal data, private addresses, or health data in commits.

## Risks

| Risk | Mitigation |
| --- | --- |
| Scope is far larger than the draft | Ordered phases, each independently useful; durable logging comes before Health. |
| Shared lib fails under Metro | Proved in Phase 0; a move to `packages/core` is the fallback. |
| HealthKit library falls short | Device gates in Phase 0; a custom Expo module is the fallback. |
| A web change breaks native | Boundary test now; web UI retired by Phase 10. |
| Phone writes lose state keys | Round-trip preservation test before cutover; `data/` backed up first. |
| Mac is off, so pushes stall | Outbox retries, with a visible last-synced time. An owner-side backup of the Mac is assumed. |
| Thin evidence behind a rule | The app labels it; the science register is the source of truth. |
| A push reaches the wrong server state | `baseRev` conflict check; the phone never overwrites on conflict. |

## Decisions still left to implementation planning

These are technical choices within the agreed scope:

- Expo SDK and library versions, from current official docs.
- The native timing and recovery strategy for clock changes.
- Secure server-side storage for WHOOP tokens.
- Splitting phases into branches and PRs, following good agentic coding practice. The owner reviews
  and merges.

## Evidence sources

Reading depth differs, and the register must state it for each entry.

1. [The Role of Specific Warm-up during Bench Press and Squat Exercises](https://pmc.ncbi.nlm.nih.gov/articles/PMC7558980/). Summary of the full text read.
2. [Warming up to improved performance?](https://sportrxiv.org/index.php/server/preprint/view/559) Preprint summary read; since published, DOI 10.1016/j.smhs.2025.08.002.
3. [Does warming up prevent injury in sport?](https://pubmed.ncbi.nlm.nih.gov/16679062/) Search summary only.
4. [Upper-body warm-up, performance and injury](https://pubmed.ncbi.nlm.nih.gov/25694615/). Search summary only.
5. [Loading recommendations and the repetition continuum](https://doaj.org/article/6d51b905504d46f0873bb43d5d84bf21). Abstract only.
6. [Load versus repetition progression](https://pmc.ncbi.nlm.nih.gov/articles/PMC9528903/). Summary of the full text read.
7. [Proximity to failure meta-regression](https://x-mol.com/paper/1810175950090465280). Abstract-level only; DOI 10.1007/s40279-024-02069-2.
8. [Resistance training dose-response](https://sponet.de/sponet/Record/4097139?lng=en). Secondary record only.

Platform references:
[UIKit app life cycle](https://developer.apple.com/documentation/uikit/managing-your-app-s-life-cycle),
[scheduling local notifications](https://developer.apple.com/documentation/usernotifications/scheduling-a-notification-locally-from-your-app),
[`@kingstinct/react-native-healthkit`](https://github.com/kingstinct/react-native-healthkit).
