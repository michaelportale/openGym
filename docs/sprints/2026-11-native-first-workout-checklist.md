# Native first offline workout: device checklist

Run this on the iPhone before the first real gym session. Tick each line. Record pass or fail per line in the PR, not here.

Read this first: the dev build and the Release build share one bundle id, so they share one database. Everything you log while testing is written to the same place as real sessions. That is why step 16 wipes the app once. After the wipe, any later test on that phone writes into the real record.

## Before you build

1. Node 22 must be on PATH.
2. Generate your snapshot from your own data:
   `cd native && node scripts/make-snapshot.mjs <path to your state-*.json>`
   This writes `native/local/snapshot.json`. It is gitignored. Do not commit it.
   Then check that no exercise of yours will run native double progression. This prints only a number and should print 0:
   `cd native && node --input-type=module -e "import s from './local/snapshot.json' with { type: 'json' }; import { nativeRepPolicy } from './src/science/native-progression.js'; let n = 0; for (const r of s.state.routines) for (const c of r.ex ?? []) if (r.excludeFromProgression !== true && nativeRepPolicy(c, r) === 'double') n++; console.log(n)" 2>/dev/null`
   A number above 0 means that many exercises will get Next time lines after Finish and will open at the suggested weight. A routine with no progression named counts, because it defaults to double. A pyramid also counts, and it gets no line, so that is a safe false positive. If it prints nothing at all, the check failed (for example, the snapshot is missing): run it again without the final `2>/dev/null` to see the error.
3. Find the phone's hardware UDID: `xcrun xctrace list devices`. The CoreDevice identifier from `xcrun devicectl list devices` is rejected by the build.
4. Unlock the phone. The install works while it is locked, but the app only launches when it is unlocked.

## How to kill the app

Swipe up from the bottom edge and pause to open the app switcher. Then swipe the openGym card up. Reopen it from the Home Screen. It opens on the Workout tab every time.

## 1. Install the Release build

- [ ] Run:
  `cd native && LANG=en_US.UTF-8 npx expo run:ios --configuration Release --device <hardware UDID> --no-bundler`
- [ ] `--no-bundler` is required. Without it Expo starts Metro on 8081, which is taken on this Mac, and its TypeScript check fails on a test fixture.
- [ ] The app opens on the Workout tab, not Home.
- [ ] The example-data banner is absent. If you see "Example data. Your routines are not loaded on this build.", the snapshot is missing. Stop and rebuild.
- [ ] Only if this phone already holds real gym sessions (logged since an earlier wipe), do this now, before any test below: the reinstall in step 10 and the wipe in step 16 delete everything on the phone. On the Mac, from the repository root, note the count: `node -e "console.log(JSON.parse(require('fs').readFileSync('data/state-<user id>.json','utf8')).workouts.length)"` (the user id is the part of the file name between `state-` and `.json`). In ··· More, Diagnostics, pair with the **real** server: print a code with `docker compose exec api node scripts/pair-code.mjs` (or the bare-metal form in SELF_HOSTING) and enter the https address you open the web app at and the code. Run the count again: it went up by the sessions on the phone. Then tap "Forget this server" and confirm, so no test below reaches the real server. With no real sessions on the phone, skip this line.

## 2. Airplane Mode

- [ ] Turn Airplane Mode on. Keep it on for steps 3 to 8.

## 3. Storage check

- [ ] Open Diagnostics: on the Workout start screen (no workout open), tap the ··· (More) button at the top right.
- [ ] Tap Storage check.
- [ ] It says "Storage check passed".

## 4. The six kill checks

Start Push A for these. Kill the app as described above each time.

- [ ] 1. Draft. Type a weight and tap Save without completing the set. Kill the app and reopen it. The draft is still there.
- [ ] 2. Typed, not saved. Tap the current set's weight to open the keypad and type a new weight. Do not tap Save. With the keypad still open, kill the app straight from it as described above: swipe up and pause, then swipe the openGym card up, without going to the Home Screen first. Reopen it. The set shows the typed weight as a draft.
- [ ] 3. Rest. Complete a set. On a fresh install this first rest shows the iOS notification prompt: tap Allow, since step 7 needs alerts on. Kill the app during the rest. Reopen it. The set is still done and the rest time left is right.
- [ ] 4. Left and right. On cable lateral raise, complete the left side. Kill the app and reopen it. Left is still done and the dock asks for the right side.
- [ ] 5. Finish. Finish the workout. Kill the app and reopen it. The workout is saved and no session is open.
- [ ] 6. Next workout. Start Push A again from the routine list on the Workout start screen, not from the Next button: Next has moved on to Pull A, whose exercises differ. The bench opens at the weight you just lifted.
- [ ] Discard that second Push A before the Export step: tap Finish, then Discard workout, then Discard. Export only shows on the Workout start screen and on the "Saved on this phone" screen, not while a workout is open.

## 5. VoiceOver, large text and midnight

Start Push A again for these, and discard it when they are done (Finish, then Discard workout, then Discard).

- [ ] VoiceOver. Turn VoiceOver on. Swipe through the workout screen: the dock, a set row and its boxes. Then open the keypad and swipe through its fields and buttons. Every label reads as words, for example "Set 2, 75 pounds each, 8 reps", never a dash or a symbol. Turn VoiceOver off.
- [ ] Largest text. In Settings, turn on Larger Accessibility Sizes and drag the text size to the largest. Open the keypad. It scrolls to its last button, and every button label reads whole: no word is broken across lines. Set the text size back.
- [ ] Midnight. Set Auto-Lock to Never. Leave a workout open on screen, in the foreground, past midnight. Then tap a set. It asks you to choose Resume, Finish or Discard, and logs nothing. Set Auto-Lock back.

## 6. Export

- [ ] On the Workout start screen, tap Export workouts. The share sheet opens.
- [ ] AirDrop the JSON to the Mac. It arrives and opens as JSON.

## 7. Rest alerts, haptics and motion

Phase 3. Start Push A from the routine list on the Workout start screen for these. The Old alert check saves that workout; the checks after it need a new Push A, and you discard that one when the step is done.

iOS shows the notification prompt once per install, at the first rest. On a fresh install that was kill check 3 in step 4, not this step. If the prompt never appeared (an earlier install on this phone already answered it), open Settings, Notifications, openGym and check Allow Notifications is on before you start.

- [ ] Saved set. Complete the current set. As it saves, the phone gives a single haptic (the system's success pattern, which can feel like a quick double tap), not a repeated one.
- [ ] Done pop. Watch the Done column and complete the current set. Its mark pops in, growing from small, rather than just appearing. Tap Add warm-up, then open the warm-up and complete it: its mark pops too.
- [ ] Rest ends in the app. Set Auto-Lock to Never. Complete a set and stay on the Workout tab until the rest runs out. As it ends, the phone gives a single haptic, and no banner or sound appears. Set Auto-Lock back.
- [ ] Rest ends under Control Centre. Complete a set, then pull down Control Centre a few seconds before the rest runs out and keep it open. As the rest ends, the "Rest over" alert arrives: as a banner, or in Notification Centre once you close Control Centre. (The simulator could not test this.)
- [ ] Locked alert. Complete a set, then lock the phone during the rest. The alert arrives when the rest ends.
- [ ] Tap the alert. Complete a set, tap the Home tab, then lock the phone. When the alert arrives, tap it. The app opens on the Workout tab, not on Home. (The simulator could not test this.)
- [ ] Pause, then lock. Complete a set, tap Pause on the rest, then lock the phone. No alert arrives while paused. Unlock, tap Resume, lock again: the alert arrives when the time left runs out.
- [ ] Old alert. Complete a set, lock the phone and let the alert arrive. Unlock without tapping the alert, so it stays in Notification Centre. Complete the next set, and during its rest tap Finish, then Save workout. Swipe down from the top of the screen: the openGym alert is gone from Notification Centre. Lock the phone and wait until after that second rest would have ended: no alert arrives.
- [ ] Deny notifications. Start a new Push A from the routine list on the Workout start screen, not from the Next button: Next has moved on to Pull A. In Settings, turn notifications off for openGym, then return to the app. Complete a set. The workout still works and "Rest alerts are off" shows. Complete another set: it does not show again.
- [ ] Reduce Motion. In Settings, Accessibility, Motion, turn Reduce Motion on. Complete a set and move to the next exercise: no pops or fades. Turn it back off.
- [ ] System haptics off. In Settings, Sounds & Haptics, turn System Haptics off. Complete a set: no buzz, and everything still works. Turn it back on.
- [ ] Long absence. Open the keypad and type a number without saving. Leave the app in the background for 5 minutes or more, then return. The keypad is closed and the typed numbers show in the row as a draft.
- [ ] Discard this Push A: tap Finish, then Discard workout, then Discard.

## 8. Warm-ups, reasons and reps left

Phase 4. Start Push A from the routine list on the Workout start screen. Discard it when the step is done (Finish, then Discard workout, then Discard), except where a line says to finish it.

- [ ] Warm-up prompt. On the first lift for a body part, before any warm-up row or finished set, the prompt shows two loads. (It needs the first work set to show a weight above zero, and above the bar for a barbell lift. A bodyweight or empty first set gets no prompt.) Tap Add warm-ups: two warm-up rows appear, prefilled and not done. Complete one: no rest starts.
- [ ] About rest times. Complete a set so the resting dock shows. Tap About rest times. A sheet opens that reads in plain words and ends with "General training information, not medical advice." Close it.
- [ ] About load steps. Open the keypad and type a number. Tap About load steps under the ±5 and ±10 chips. The sheet reads in plain words with the same closing line. Close it: the number you typed is still there.
- [ ] Warm-up Why. On the warm-up prompt, tap Why? The sheet reads in plain words with the same closing line. Close it, then tap Why offered? and check the same.
- [ ] Reps left Why. Open the keypad on a work set that is current or done. The Reps left row shows 0 to 5+ chips and a Why? beside the "Reps left" heading. On a per-side set the row shows only for the second side (R) of a set still in progress. Pick 2, tap Why?, close the sheet: 2 is still selected. The sheet reads in plain words with the same closing line.
- [ ] Reps left saved. On a work set, pick 3 and tap Complete. Reopen that set: 3 is selected. Kill the app and reopen it: it is still 3.
- [ ] Progression off. Your routines have progression off. Finish a workout: it shows no Next time lines. Start the same routine again: it opens at last time's weights exactly as before.
- [ ] Next time lines. With progression off on every exercise, Finish shows no Next time lines, so their Why? and the far-from-failure note cannot be checked on this phone. The unit tests and the pre-merge simulator walkthrough cover them. Once an exercise's progression is on (double progression, or none named) and you finished a work set of it, Finish shows a Next time line with a weight and reps and a Why?, and the next session opens that exercise at that weight. Timed, pyramid, drop-set and rest-pause exercises, and an exercise on its first session, get no line. Do not edit your real data to test this.
- [ ] Largest text. Set the text size to the largest. On the resting dock every button, About rest times included, stays usable. The reps-left row wraps or scrolls. Set the text size back.

## 9. Airplane Mode off

- [ ] Turn Airplane Mode off when the checks above are done.

## 10. Pairing and restore, on a copy

This rehearses sync and restore against a **copy** of `data/`, never the real one. Do it before the wipe. It needs the Mac and the phone on the same network, and the Release build from step 1 on the phone. Anything you log here goes into the phone's database, like every other test in this file; the wipe in step 16 clears it.

- [ ] Back up the real data, with the tar from [SELF_HOSTING section 6](../SELF_HOSTING.md#6-backups): `tar czf opengym-backup-$(date +%F).tar.gz data/`. Only the real folder is read; nothing here changes it.
- [ ] Make the copy, from the repository root: `cp -a data ../opengym-data-copy`. The copy sits outside the repository so it cannot be committed. Then remove the copy's secret: `rm ../opengym-data-copy/secret`. The copy makes its own secret on first start, so nothing it signs (including the phone's sign-in token) works on the real server.
- [ ] Start a second API on the copy, on another port, with Docker, leaving the real container and the real `./data` alone: `docker build -t opengym-api-copy ./api`, then `docker run -d --name opengym-api-copy -p 3100:3000 -e DATA_DIR=/data -v "$PWD/../opengym-data-copy:/data" opengym-api-copy`. Use any free host port in place of `3100`; write it as `<port>` below. Without Docker, from `api/` (needs `npm install` there): `DATA_DIR=<the copy> PORT=<port> node server.js`. The copy has the real push subscriptions, so day reminders may arrive twice while it runs.
- [ ] Print a pairing code for the copy: `docker exec opengym-api-copy node scripts/pair-code.mjs` (bare metal: `cd api && DATA_DIR=<the copy> PORT=<port> node scripts/pair-code.mjs`). With more than one profile, add `--user <name>`. The code lasts 5 minutes.
- [ ] On the phone, open ··· More, then Diagnostics. In "Your server" tap "Pair with your server". Enter `http://<the Mac's LAN IP>:<port>` and the code, then tap Pair. The first connection shows the iOS Local Network prompt: tap Allow. If Pair says it couldn't reach the server, tap Allow on that prompt and tap Pair again with the same code: a request that never reached the server does not use the code up. If 5 minutes have passed, or Pair then says the code didn't work, print a new code. Plain http is for this rehearsal only: it sends the sign-in token unencrypted, which is acceptable here because the copy has its own secret, so the token opens nothing on the real server, but not for the real pairing (step 16 uses https). This uses the Release build from step 1. The section now shows the host, "Signed in as" your profile, the status line "Synced to <host> at <time>" and, if anything is queued, "N workouts waiting". A separate "Last synced" line shows only while the status line does not say when it last synced. Routines, rotation and history now come from the copy. Note the count on the Mac now: `node -e "console.log(JSON.parse(require('fs').readFileSync('<the copy>/state-<user id>.json','utf8')).workouts.length)"` (the user id is the part of the file name between `state-` and `.json`).
- [ ] Finish a short workout. The saved screen says "Synced to <host> at <time>".
- [ ] Turn Airplane Mode on, and Wi-Fi off in Control Centre. Finish another workout. The saved screen says "Saved on this phone. It will sync when <host> is reachable." Diagnostics shows "1 workout waiting".
- [ ] Turn Airplane Mode off and Wi-Fi back on, then return to the app. Tap "Sync now" in Diagnostics. Returning to the app syncs by itself only when the last try was more than a minute ago, and the Control Centre toggle may not background the app at all. The line then says "Synced to <host> at <time>" and no workouts are waiting.
- [ ] Delete the openGym app. Reinstall the Release build from step 1 with its command. Pair with the copy again (new code from the pair command, same address). The phone has no History screen, so check two things. On the Mac, run the count command above again: it prints the count before the rehearsal plus the workouts you finished (the server never lost any). On the phone, the start screen's "Next: <routine>" follows your rotation. From the routine list, start one of the routines you finished in this rehearsal: its "Last" column shows the weights you logged then. Discard it: tap Finish, then Discard workout, then Discard. After a reinstall, Export lists only workouts finished on this install; the server holds the full record.
- [ ] A weigh-in reaches the copy. Apple Health does not need to be on for this. On Progress tap "Log weight", type today's weight and tap Save. In Diagnostics tap "Sync now" and wait for "Synced to <host> at <time>". Then on the Mac, from the repository root, print today's weight from the copy (it prints one number and nothing else): `node -e "const d=new Date(),p=n=>String(n).padStart(2,'0'),t=d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());console.log(JSON.parse(require('fs').readFileSync('<the copy>/state-<user id>.json','utf8')).bodyweight.find(e=>e.d===t).w)"` (the user id is the part of the file name between `state-` and `.json`). It prints the weight you typed. The command takes today from the Mac's date, so run it on the same day as the phone's weigh-in; if it prints nothing or an error, check the date.
- [ ] In Diagnostics tap "Forget this server" and confirm. The section goes back to "Pair with your server" and the status says "Not paired. Saved on this phone." Forget drops the phone's copy of the server's data, so the Workout tab shows the routines bundled in this build again until you pair. Export still says "Nothing to export yet": since the reinstall the phone has logged nothing, and the rehearsal's workouts are on the copy.
- [ ] Stop the copy: `docker rm -f opengym-api-copy` (bare metal: stop the process). Delete `../opengym-data-copy` when done. Do not delete `data/`.

## 11. Apple Health

Phase 6, Stages A (workouts) and B (weigh-ins). Do it before the wipe, on test workouts and a test weight, with the Release build. Turning Health on sends every workout finished on this install, so the test workouts from the steps above go to Health too; the last line removes them all. This section does not need the server, so it does not matter whether the phone is paired.

- [ ] Turn it on. In ··· More, Diagnostics, find the "Apple Health" section with a switch labelled "Apple Health". It starts off and says "Off. Your workouts are not sent to Apple Health." Turn the switch on. iOS asks for Health access: allow Workouts (write) and Weight (read and write), which "Turn On All" does, and tap Allow. If no access sheet appears, iOS kept the answers from Phase 0, when this iPhone was already asked for Health access (read and write, Workouts and Weight); carry on. The section says "On. Finished workouts go to Apple Health." and "<n> workouts in Health", where n counts the workouts finished on this install so far. A line "<n> weights in Health" ("1 weight in Health" for one) shows after it once a weight has gone to Health. Section 10's typed weigh-in goes to Health now, so after a moment that line may already say "1 weight in Health".
- [ ] See them in Health. The count is the workouts finished since step 10's reinstall, so it may be "0 workouts in Health" and there may be nothing to see yet; the next row's finish is the one to look for. If there are some, open the Health app, then Browse, Activity, Workouts (or Summary, Workouts): they show as "Traditional Strength Training", source openGym, once each.
- [ ] Finish a short workout. Start a routine from the routine list, complete one set and Finish, then Save workout. In Diagnostics the count goes up by one. In Health the new workout appears once, "Traditional Strength Training", source openGym, with the start and end times of your session.
- [ ] Lock and return. Finish another short workout and lock the phone right after Finish. Unlock, open the app and return to Diagnostics. Check Health: that workout is there once, not twice.
- [ ] Writing off. In Settings, Health, Data Access & Devices, openGym, turn Workouts off. Return to the app. Diagnostics says "On, but writing to Apple Health is turned off. Turn on Workouts in Settings → Health → Data Access & Devices → openGym." Finish a short workout. It saves in the app, the section shows "1 waiting" and, next to it, "Last try: <the error text>" (expected), and Health does not show it.
- [ ] Writing back on. Turn Workouts back on in Settings, Health, Data Access & Devices, openGym. Return to the app. It sends the waiting workout by itself if its last try was more than a minute ago; if "1 waiting" still shows, tap Retry. The waiting line goes away, the writing-off line goes away, and Health shows that workout once. Every workout from this section is in Health once each, none twice.
- [ ] Skipped workouts. A workout with no start or end time shows as "<n> skipped (no start or end time)" and is never retried. You do not need to make one; if the line shows, it is not an error.
- [ ] Take back the read access Phase 0 gave. Open Settings, Health, Data Access & Devices, openGym. Under write, Workouts and Weight are on. Under read, turn Workouts off (Weight stays on).
- [ ] Workout gates without reading workouts. The app no longer asks to read workouts, and the previous row took that access away. In Diagnostics, tap "Run workout gates". Four lines show: "save: pass (workouts found: 1)", "retry: pass (workouts found: 1)", "replace: pass (workouts found: 1, version 2)" and "delete: pass (workouts left: 0)". The gate workout is its own test and is deleted at the end, so the "workouts in Health" count does not change. If any line says fail, write down which one: the phone cannot see its own workouts without read access, and Phase 6 has to change before the wipe.
- [ ] Log a weight. With Apple Health on, open the Progress tab, tap "Log weight", type today's weight and tap Save. Progress shows "Today: <w> lb". After a moment Diagnostics' Apple Health section shows "1 weight in Health" ("2 weights in Health" if section 10's weigh-in was on another day). In the Health app, Summary → Show All Health Data → Weight shows today's value; Weight → Show All Data lists each entry with its source icon, and today's is there once, from openGym.
- [ ] A typed weight wins. In the Health app, on Weight tap Add Data and add a different weight for today. Back in openGym, Progress still shows your typed weight.
- [ ] Remove today's weight. On Progress tap "Log weight", then "Remove today's weight". After a moment Progress shows "Today: <the Health app weight> lb (from Apple Health)". In the Health app, Weight → Show All Data no longer lists openGym's entry.
- [ ] Delete in Health. In the Health app, Weight → Show All Data, swipe that weight left → Delete. Wait a minute before returning to openGym: on return the Health pass runs at most once a minute, and the previous row just ran one. Then switch to Progress: it shows "No weight logged today."
- [ ] Device-only checks. Rows above cover that weight writes and read-back work, and that a deletion made in the Health app is seen. Two more: (a) revoke openGym's Weight read access in Settings, Health, Data Access & Devices, openGym, add a weight in the Health app, then turn read access back on, wait a minute and return to openGym. Progress shows "Today: <w> lb (from Apple Health)" once that weight arrives, or stays "No weight logged today.": write down which. This is a known unverified behaviour, not a failure of this checklist. (b) Turn Apple Health off in openGym with "Keep what's there", add a weight in the Health app, turn Apple Health back on: after a moment Progress shows "Today: <that weight> lb (from Apple Health)", the weight taken while it was off.
- [ ] Log a weight again, so the next row has an openGym weight to remove. On Progress tap "Log weight", type today's weight and tap Save. Progress shows "Today: <w> lb", and after a moment Diagnostics shows "1 weight in Health" ("2 weights in Health" if section 10's weigh-in was on another day).
- [ ] Turn it off and remove. Turn the "Apple Health" switch off. The alert "Turn off Apple Health?" shows three buttons: "Keep what's there", "Also remove openGym's workouts and weights" and "Cancel". Tap "Also remove openGym's workouts and weights". The section goes back to "Off. Your workouts are not sent to Apple Health." In the Health app, Browse, Activity, Workouts, none of openGym's workouts are left, and Weight → Show All Data lists none from openGym (the weights you added in the Health app yourself stay). The workouts are still in the app: Export workouts lists them.
- [ ] Discard any test session still open: tap Finish, then Discard workout, then Discard. A finished test workout needs no discard; it stays in the app until the wipe.

## 12. Exercises and Progress

Phases 7A (text side) and 7B. Do it before the wipe, with the Release build. This adds native dependencies (expo-video, react-native-svg), so the phone needs a fresh Release build first: `npx expo run:ios --configuration Release …`, the command from step 1. The phone is unpaired here, so exercise screens show text only and Progress shows only what is logged on this phone (the bundled snapshot has no weigh-ins); the animation checks and the real-data Progress check come after the cutover, in step 16. Open the Exercises tab.

- [ ] Search. Tap the "Search exercises" field and type `db press`. Dumbbell presses are listed, each row showing the name and "target · equipment". A search with no match (try `zzzz`) says `No exercise matches “zzzz”.`, then "Close matches".
- [ ] Tap with the keyboard up. With the keyboard still showing, tap a row. The exercise screen opens at once, without a first tap that only closes the keyboard.
- [ ] Text. Clear the search and open Barbell Bench Press. The screen shows Back, the name, tags, the description, and "How to" with numbered steps, plus "Best: …" and "Last time: …" lines if you have logged it.
- [ ] Diagnostics ends with the media credit line.
- [ ] Body weight. Open the Progress tab. The Body weight card shows the "Today: …" line and "Log weight". Tap "Log weight", type a weight and Save. Below 3 weigh-ins it says "Log <n> more weigh-ins to see a trend." ("Log 1 more weigh-in" when one is missing), and the chart shows dots only, with no line. It counts weigh-ins in the selected range, including any from sections 10 and 11.
- [ ] Trend. After you have logged weigh-ins on 3 different days (or the Health import brought them in), "7-day average <x> lb" and "<±n> lb over 30 days" appear. The "this week" line needs a weigh-in 7 to 14 days before the latest one, so it will most likely show only in step 16's real-data check. Tap "Why this?": the sheet is titled "Why a 7-day average" and says Definition. If you cannot log on 3 days before the wipe, skip this row; the real-data check in step 16 covers it.
- [ ] Range chips. Tap 1M, 3M, 1Y and All. The selected chip changes and the chart stays drawn; 3M is selected by default. The ranges differ only once you have older weigh-ins.
- [ ] Your lifts. Finish a workout first if you have none on this phone. "Your lifts" lists the exercises you have logged, heaviest best first. Tap one: its exercise screen opens.
- [ ] Speed. On Progress, open a lift from Your lifts, go Back, and repeat with a few lifts: no Back shows a visible pause. Tap All: the chart draws without a pause. The first time the tab opens, Your lifts may say "Loading…" for a moment.
- [ ] Your history. Use a weighted lift, such as Barbell Bench Press. On that screen "Your history" lists the last sessions: each shows its date and its sets, like 185 × 5, with "PR" on the record session. From 2 sessions on it also shows a chart. Tap Est. 1RM to see the e1RM chart, then tap "Why this?" (the toggle and "Why this?" show only when the lift has e1RM points from at least 2 sessions: a timed or bodyweight exercise has none, and a lift logged once has no chart to switch): the sheet says Convention until audited.
- [ ] Below Your lifts a card links to "Nutrition" and "Measurements" (section 14 checks them). The old "arrive in Phase 7D" card is gone. Below them a WHOOP card is the last check in this section.
- [ ] WHOOP, unpaired. Below the Nutrition and Measurements card, the "WHOOP" card says "WHOOP shows here once this phone is paired with your server." It has no Connect button. Step 16 checks the rest, once the phone is paired.

## 13. Plan

Phase 7C. Do it before the wipe, with the Release build. The phone is unpaired here, so the Plan tab edits the routines bundled in this build and nothing reaches a server; the checks that sync an edit to the web come after the cutover, in step 16. These edits stay on the phone, waiting to sync, until the wipe in step 16 deletes the app and discards them, so do not pair the real server before the wipe: pairing would send them. Open the Plan tab.

- [ ] The tab. "How you train" shows "Rotation" with a "Next" tag on one routine, or "Fixed week", or nothing if no schedule is set. "Your routines" lists each routine with its exercise count.
- [ ] Open a routine. Tap one in "Your routines". Each exercise row shows its name and a target line like the web's, with an up and a down button. The first row's up button and the last row's down button are disabled.
- [ ] Move. Tap the down button on the first exercise. It moves down one place and saves at once, with no Save button. Go Back and open the routine again: the order held.
- [ ] Workout starts the edited routine. Open the Workout tab. Start that routine: the exercises come in the new order. Discard it: tap Finish, then Discard workout, then Discard. Move the exercise back up on the Plan tab.
- [ ] The Workout tab reloads. Leave the Workout tab on its start screen, switch to Plan, move an exercise, and switch back. The start screen shows the edited routine without a restart.
- [ ] Open the sheet. Tap an exercise row. A sheet opens with "Swap exercise", then the fields for the exercise: a weighted exercise shows Sets and Reps ("Reps from" and "Reps up to" under double or triple); a timed one shows Sets and Seconds; a cardio one shows Intervals and Minutes and no Progression choices. Below them come the Progression choices (not for cardio), Save and Cancel.
- [ ] Cancel writes nothing. Change any field, tap Cancel, and open the routine again: the row's target line is what it was. Change a field again, tap Save, and reopen: the row's target line shows the new numbers.
- [ ] Swap is held back. Step Sets up without saving. "Swap exercise" is disabled and the sheet says "Save or cancel your changes to swap." Tap Cancel.
- [ ] Swap. Tap an exercise, then "Swap exercise" and pick a different one of the same kind (strength for strength). The routine screen shows the new exercise in the same place, with the same settings carried over. Swapping between cardio and strength starts that exercise fresh instead.
- [ ] Rep range. Open an exercise whose progression is double or triple (set one in the Progression choices if none is). The Reps stepper reads "Reps from" and a second reads "Reps up to". Raise "Reps from" above "Reps up to": after Save the two come back in order.
- [ ] Progression. In the sheet choose a different Progression and tap Save. Reopen the sheet: that choice is selected. Choose the first choice, "Follow the routine (<rule>)", and Save, to put it back.
- [ ] A pyramid exercise. If a routine has one, its sheet shows no steppers and says "Pyramid sets: edit them on the web", with Close in place of Save and Cancel. Skip this row if you have none.
- [ ] An unsafe move or swap. If a move or swap is one the web's server would undo, nothing is saved. A refused move shows "This move or swap has to be made on the web." on the routine screen; a refused swap shows it on the Swap exercise screen, which stays open (tap Back to leave). You may not hit one; if you do not, skip this row.
- [ ] VoiceOver. On a routine, each move button reads "Move <exercise> up" or "Move <exercise> down", and each row reads its name and target line.

## 14. Nutrition, Measurements and Home

Phase 7D. Do it before the wipe, with the Release build. Installing the 7D build discards any Plan edits made on an earlier build and not yet sent: the Plan tab stops showing them and they are never sent. That is harmless here, because they were unpaired test edits, and nothing migrates them. The phone is unpaired here, and the bundled snapshot carries no nutrition and no measurements, so both start empty and nothing reaches a server; the checks that sync them to the web come after the cutover, in step 16. What you log here stays on the phone, waiting to sync, until the wipe in step 16 deletes the app and discards it, so do not pair the real server before the wipe: pairing would send it. Open the Progress tab.

Two limits to know before you start. The day sheets (Nutrition and Measurements) step one day at a time with the ‹ and › buttons: there is no date picker, so logging a day weeks back takes many taps. And editing a measurement keeps its date; to move one to another day, delete it and log it again.

- [ ] The links. Below Your lifts a card shows "Nutrition" ("Not logged today") and "Measurements" ("No measurements yet"). The old "Not built yet" card is gone. Tap Nutrition.
- [ ] Empty Nutrition. Today says "Nothing logged today yet." with Log. The week card says "This week", with › dimmed and Log today. Supplements and Recent days show their empty texts. No "NaN" and no "undefined" anywhere.
- [ ] Log today. Tap Log. The sheet "Log a day" shows today, › dimmed, and a day type (Training if you finished a workout today). Tap Save with a total blank: "Fill in all five totals." shows and what you typed stays. Type 20001 in calories: "One of the totals is out of range." Fix the numbers and Save. The sheet closes and Today shows the calories and four more lines, the week tiles appear, and Recent days lists today with Edit and Clear.
- [ ] Step a day. Tap Edit on Today, then ‹: the sheet moves to yesterday and its fields reload: the title reads "Log a day" and the totals are empty. Cancel.
- [ ] Edit a day. Tap Edit on today's row, change the calories and Save. Today and the row show the new number.
- [ ] Targets. Tap Targets. Set calories and protein for both day types, under Training day targets and under Rest day targets, then Done. With a changed field the sheet will not swipe away; Done saves and closes. Today shows "Target <n> kcal" and "Protein <x> g of <y> g" (the targets of today's day type), the week tiles show targets, and the Progress row reads "<kcal> of <target> kcal · <x> of <y> g protein". Open Targets again, empty a field and Done: that target goes.
- [ ] Add a supplement. In Targets, type "Creatine" in the supplement name and tap Add: it appears with Remove. Add "creatine" again: "That supplement is already on the list." Done. The Supplements card on Nutrition shows a checkbox for it.
- [ ] Tick a supplement. Tick it. It stays ticked, today's row in Recent days ends "Supplements 1/1", and after a relaunch it is still ticked. Tap Edit on Today straight after a tick: it is dimmed until the tick has saved, then it opens the sheet, and a Save there keeps the tick.
- [ ] Clear keeps ticks. Today has the tick from the row above. Tap Clear on today's row. An alert asks "Clear this day?" with Cancel and Clear. Tap Cancel: nothing changes. Tap Clear: the totals go and the row reads "No totals logged · Supplements 1/1", the tick still counted. Then log yesterday with no tick (Log on Today, ‹, the five totals, Save) and tap Clear on its row: that row leaves Recent days.
- [ ] A removed supplement's past ticks stay. Remove "Creatine" in Targets and Done. The Supplements card on Nutrition goes back to its empty text. Today's row stays in Recent days but now reads just "No totals logged": the tick is kept in the data, but a supplement no longer on the list is not counted, as on the web.
- [ ] Week. Tap ‹ on the week card: "Week of <date>", and › works. Tap ›: back to "This week".
- [ ] Empty Measurements. Go Back and open Measurements. It shows "Waist", a dash, Log, the chips (3M selected), "No data yet" and "No measurements yet" with "Add a measurement".
- [ ] Log in inches. Tap Log. The fields read in "in". Save with nothing typed: "Enter at least one measurement". Type 32.5 for waist and Save. The head reads "32.5 in", the chart shows a dot, the history row shows "<date>", "1 measurement" and "Waist 32.5 in", and the Progress row reads "Waist 32.5 in · <date>". Log again on the same date: "That date already has measurements. Edit it instead."
- [ ] See it in the chart. Log a second day: Log, tap ‹ to a day back, enter waist 33 and Save. The chart now shows two dots joined by a line, and the head reads "-0.5 in since previous". Tap Measurement and pick another field: the head and chart follow.
- [ ] Edit keeps the other values. Edit the 32.5 day, change only another field such as chest, and Save: waist still reads 32.5 in.
- [ ] Delete. Tap Delete on the 33 day. An alert asks "Delete measurements?". Tap Cancel: nothing changes. Tap Delete: the day leaves the history and the chart. Kill the app and reopen it: the day is still gone.
- [ ] Home. Open the Home tab. "Next: <routine>" follows your rotation. Tap it: the Workout tab opens on its start screen (on the session itself if one is open). Back on Home, today's nutrition card matches Nutrition: tap Log (or Edit) and the day sheet for today opens; change a number and Save. The card shows the new numbers without leaving Home.
- [ ] Home after a workout. Finish a short workout, then open Home: Next has moved on to the next routine in the rotation. Discard anything still open.
- [ ] VoiceOver. On Nutrition, tap Clear on a logged day: the alert reads "Clear this day?" with Cancel and Clear. On Measurements, the Delete alert reads "Delete measurements?" with Cancel and Delete. (These are the app's first system alerts.) In either day sheet, the day stepper reads as one adjustable control that follows the date: swipe up or down on it to step a day. Each Progress link reads like "Nutrition, not logged today, button" with the hint "Opens Nutrition.". Home's Next hint reads "Opens the Workout tab.".
- [ ] Largest text. Set the text size to the largest. The number rows on the day sheets wrap and nothing is clipped, and the keyboard does not cover the field you are typing in. Set the text size back.

## 15. Before the wipe

- [ ] Every line above has a recorded pass or fail in the PR. Fix any failure before wiping.
- [ ] From the repository root, `git status` does not list `native/local/`.
- [ ] The privacy search covers every tracked file in the repository, not only `native/` and `docs/sprints/`: `git grep -n -I -e '<your user id>' -e '<one of your routine ids>' -e '<one of your custom exercise ids>'` prints nothing. Your user id is the part of your data file's name between `state-` and `.json`. Type the real values only in the terminal, never into a tracked file, this one included.

## 16. The wipe

This removes the test workouts so your first real session starts clean.

- [ ] Delete the openGym app from the phone.
- [ ] Install the Release build fresh with the command from step 1. Check the snapshot is still in place.
- [ ] Open it. Push A is next.
- [ ] Before you pair, no workouts are listed. Export says "Nothing to export yet".
- [ ] The example-data banner is absent.
- [ ] This is the cutover. In ··· More, Diagnostics, pair with the **real** server: run the pair command against it (`docker compose exec api node scripts/pair-code.mjs`, or the bare-metal form in SELF_HOSTING), then enter the https address you open the web app at and the code. Routines, rotation and history load from the server. Check the start screen's "Next: <routine>" follows your rotation, and that starting a routine shows the "Last" column with your real previous weights. Then discard it without logging: tap Finish, then Discard workout, then Discard.
- [ ] Stop logging on the web. From now on the phone is the only writer.
- [ ] Close every web tab and installed web app that is signed in to openGym. An open tab holds its own copy of your data; when it next syncs it merges and pushes that copy to the server, which can put stale data next to what the phone wrote.
- [ ] Do not use "Sign out everywhere" on the web unless you mean to: it also unpairs the phone. The phone then says the server signed it out, keeps every workout, and syncs again after you pair it again.

- [ ] After pairing with the real server, turn Apple Health on in ··· More, Diagnostics and allow access, so real sessions go to Health from then on.

Exercise animations, now that the phone is paired with your real server (read-only checks). Open the Exercises tab.

- [ ] Animation. Open Barbell Bench Press. Within a few seconds the animation plays, muted, with the credit line under it.
- [ ] Music. Start music in another app, then open an exercise with an animation. The music keeps playing.
- [ ] Offline, new exercise. Turn Airplane Mode on. Open an exercise whose animation you have not watched. It shows text only, with no spinner and no error.
- [ ] Offline, watched exercise. Still in Airplane Mode, open an exercise whose animation you watched earlier. It plays again, from the cache. Turn Airplane Mode off.
- [ ] Reduce Motion. Turn on Settings, Accessibility, Motion, Reduce Motion. Open an exercise with an animation: the still shows, and a tap plays the clip. Turn it back off.
- [ ] Progress, real data. Open the Progress tab. Your lifts lists your real lifts, and Body weight shows your real trend; "this week" shows when your log has weigh-ins a week apart. The Strength trend card shows only if a lift's e1RM moved over the last 8 weeks across at least 2 sessions.
- [ ] Progress speed, real data. Open a lift from Your lifts, go Back, and repeat a few times: no Back shows a visible pause. Tap All: the chart draws without a pause.
- [ ] A custom exercise. Do not create one on the web: the phone is the only writer now. If you already have a custom exercise, find it in the list: its row says "Yours" and its screen shows its own description and no animation. Skip this row if you have none.

Plan edits, now that the phone is paired with your real server. This block deliberately uses the web for a few minutes, against "the phone is the only writer": reload the web tab before each web edit, close it when the block is done, and log nothing on the web. Open the Plan tab.

- [ ] An edit reaches the web. On the phone move an exercise in a routine, then in Diagnostics tap "Sync now" and wait for "Synced to <host> at <time>". Reload the web tab and open the routine: it shows the new order. Move it back on the phone and sync again. Close the web tab.
- [ ] An unknown web setting survives a phone move. On the web, reload, open a routine, tap an exercise and type a note in its "Note (optional)" box, then Save. Close the web tab. On the phone tap "Sync now" and wait for "Synced to <host> at <time>". Move that exercise up or down, tap "Sync now" and wait for "Synced to <host> at <time>" again. Reload the web: the note is still there. Remove the note on the web if you do not want it, then close the web tab.
- [ ] Changed on the web first. On the phone, in Airplane Mode, change a routine's sets. On the web, reload and change a different exercise's sets in the same routine, then close the web tab. Turn Airplane Mode off and tap "Sync now". The Plan tab, and that routine, show "Your change to <routine> wasn't sent: it was changed on the web first. This shows the web's version." with Dismiss, because the web changed the routine before the phone synced. The routine shows the web's version. Tap Dismiss: the notice goes. Put the web change back the same way (reload first, close the tab after).
- [ ] Deleted on the web. Use a throwaway routine, never a real one: a recreated routine gets a new id, which breaks the rotation and history links. On the web, reload and create a routine with one exercise, then close the tab. On the phone tap "Sync now" and wait for "Synced to <host> at <time>"; the routine is on the Plan tab. Turn Airplane Mode on and change its sets. On the web, reload and delete that routine, then close the web tab for good. Turn Airplane Mode off and tap "Sync now". The Plan tab shows "Your change to <routine> wasn't sent: it was deleted on the web." with Dismiss. Tap Dismiss. The web tab is closed for good from here on.

Plan authoring (7E-A), on a throwaway routine, against the real server. Use only a routine you create here. Do not rename, move, or delete a real one. Look at the web and do not edit it: reload the tab to check, then close it. Open the Plan tab.

- [ ] Create "Test 7E". Tap "New routine". The prompt is titled "New routine". Tap Create with the name empty: "Enter a name." shows and no routine is added. Type Test 7E and tap Create. The new routine opens, with no exercises. Go Back: "Test 7E" is last in "Your routines". In Diagnostics tap "Sync now" and wait for "Synced to <host> at <time>". Reload the web: "Test 7E" is there. Close the web tab.
- [ ] Rename it. Open "Test 7E". Tap the ··· button (VoiceOver reads "Routine actions"). Tap Rename. The prompt is titled "Rename" and starts as Test 7E. Clear it and tap Rename: "Enter a name." shows and the name stays. Type Test 7E b and tap Rename. The screen title is "Test 7E b". Sync now. Reload the web: the routine is named "Test 7E b". Close the web tab.
- [ ] Add two exercises. On "Test 7E b" tap "Add exercise" and pick a built-in exercise. The picker is the exercise list; its title says "Swap exercise". Tap "Add exercise" again and pick a second one. The routine lists both. Sync now. Reload the web: the routine shows both exercises. Close the web tab.
- [ ] Remove one. Tap one exercise. In the sheet tap "Remove from routine". The alert is "Remove <exercise>?" with Cancel and Remove. Tap Cancel: it stays. Open it again, tap "Remove from routine", then Remove. The routine lists the other exercise. Sync now. Reload the web: only that one remains. Close the web tab.
- [ ] Set its progression. Under Progression, tap "Greyskull LP". The check mark moves to it. Sync now. Reload the web and open the routine: its progression is Greyskull LP. Close the web tab.
- [ ] Move it up. Go Back. On the "Test 7E b" row tap the up arrow (VoiceOver reads "Move Test 7E b up"). It swaps with the routine above it. A new routine is added at the end, so one is above it unless the plan was empty; if it is already first, skip this row. Sync now. Reload the web: "Test 7E b" sits one place higher. Close the web tab.
- [ ] Duplicate it. Open "Test 7E b". Tap ···, then Duplicate. The copy opens, named "Test 7E b (Copy)", with the same exercise. Go Back: both names are in "Your routines". Sync now. Reload the web: both are there. Close the web tab.
- [ ] Delete both copies. Open "Test 7E b (Copy)". Tap ···, then Delete. The alert title is "Delete Test 7E b (Copy)?" and the body is "It's removed from your plan and your week. Your history keeps its workouts." with Cancel and Delete. Tap Cancel: it stays. Tap Delete again, then Delete. The Plan tab is showing and the copy is gone. Open "Test 7E b" and delete it the same way: the Plan tab shows again. Sync now. Reload the web: neither name is there. Tap "Sync now" once more and reload the web again: neither comes back, and the real routines are in the order they had before the move. Close the web tab.
- [ ] Create while offline, then sync. Turn Airplane Mode on. Tap "New routine", type Test 7E offline, and tap Create. It opens with no exercises. Go Back: it is in "Your routines". Diagnostics shows "1 plan or nutrition edit waiting to send" (or a higher count if something else is waiting). Turn Airplane Mode off and tap "Sync now" until it says "Synced to <host> at <time>". Reload the web: "Test 7E offline" is there. On the phone delete it the same way as the row above, sync, and reload the web: it is gone, and a second sync and reload does not bring it back. Close the web tab.

Device checks for the schedule (7E-B), on your real server, on a throwaway change to the schedule: look at the web and do not edit it, and put the real schedule back at the end.

- [ ] Note the current mode (Fixed Week or Rotation), which weekdays have routines, and that no workout is open. This is what gets put back.
- [ ] Switch to a fixed week. If a loop is running, the alert title is "Back to a fixed week?", the body is "The loop stops. Your weekdays stay as they are, and the loop is saved for later.", and the confirm button is "Use Fixed Week". Sync now. Reload the web: the plan is a fixed week. Close the web tab.
- [ ] Assign two weekdays. Tap two day rows. Each alert lists the routines, then "Rest day". Pick a routine for each. Sync now. Reload the web: those two days show those routines. Close the web tab.
- [ ] Override one of the next 14 days. In "The next 14 days" tap a day. The alert has the routines, "Rest", and "Back to weekly plan". Pick Rest. Sync now. Reload the web: that date is rest. Close the web tab.
- [ ] Switch back to the loop. Tap "Rotation". Sync now. Reload the web: the loop is back. Close the web tab.
- [ ] Start the loop over while no workout is open. Tap "Start the loop over". If a workout is open the app says "Finish the open workout before starting the loop over." and does not change the loop; finish or discard that workout first, then tap it again. Sync now. Reload the web: a new pass has started. Close the web tab.
- [ ] Put the real schedule back. Switch the mode back, set the two weekdays back ("Rest day" clears one), and on the date tap "Back to weekly plan". Sync now. Reload the web: the schedule matches what you noted. Tap Sync now once more and reload: it stays. Close the web tab.

Nutrition, Measurements and Home, now that the phone is paired with your real server. Like the Plan block, this deliberately uses the web for a few minutes: reload the web tab before each web edit, close it when the block is done, and log nothing else on the web. Use one throwaway day for the web-note and clash rows, a day you have no real numbers for, and clear it at the end. Open the Nutrition screen.

- [ ] Diagnostics lines. Pick one throwaway day, a day you have no real nutrition or waist reading for, and use only that day for every row in this block. In Airplane Mode, log nutrition for it on the phone, and log a waist measurement of 30.0 in for the same day. Diagnostics shows "1 plan or nutrition edit waiting to send" ("<n> plan or nutrition edits waiting to send" for more) and "1 measurement waiting" ("<n> measurements waiting"). Turn Airplane Mode off and tap "Sync now": both lines go.
- [ ] A phone day appears on the web. The previous row already synced the throwaway day. Reload the web tab and open Nutrition: the day shows with the numbers you typed. Open Measurements: the day shows with a waist of 30 in (a kg profile shows 76.2 cm, since 30.0 in is 76.2 cm).
- [ ] A web note on a day survives a phone edit of that day's numbers. In this order: (1) on the web, reload and add a note to the throwaway day, then close the web tab; (2) on the phone tap "Sync now" and wait for "Synced to <host> at <time>", so the phone has the note (open the day: the note shows); (3) on the phone change that day's numbers and Save; (4) tap "Sync now" and wait for "Synced to <host> at <time>" again. Reload the web: the day shows the note and the phone's new numbers. Do not edit the day on the web between steps 2 and 4: if the web changes a day after the phone last synced, the phone's change is not sent (next row).
- [ ] Changed on the web first. On the phone, in Airplane Mode, change the throwaway day's numbers. On the web, reload and change the same day, then close the web tab. Turn Airplane Mode off and tap "Sync now". The Nutrition screen shows "Your change to <day> nutrition wasn't sent: it was changed on the web first. This shows the web's version." with Dismiss, where <day> is the day's label, such as "Nov 9". The day shows the web's version. Open the Home tab: its nutrition card ends "A nutrition change wasn't sent. Open Nutrition to see it."; tap that line and Nutrition opens. Tap Dismiss: the notice goes, and back on Home the line has gone too.
- [ ] A measurement in inches shows on the web as the same length. On the phone, in Measurements, tap Edit on the throwaway day (logging it again would stop with "That date already has measurements. Edit it instead.") and change the waist to 32.0 in, then sync. The phone stores 81.3 cm (32.0 x 2.54 = 81.28, rounded to a tenth). Reload the web and open Measurements: with the web's units set to kg it shows 81.3 cm; with them set to lb (which a pound profile has) it shows 32 in, the same length, because it converts 81.3 cm back and rounds to a tenth. Both are the same stored length.
- [ ] A phone delete stays deleted, and nothing is left behind. On the phone delete the throwaway measurement day, tap "Sync now" and wait for "Synced to <host> at <time>". Reload the web: the day is gone from Measurements. Reload it once more after a minute: it has not come back. Then Clear the throwaway nutrition day on the phone, sync, and reload the web. Clear keeps that day's supplement ticks and writes an empty day, never a delete, so the web may still hold an empty entry for it (or only its ticks); that is expected and shows no numbers. Every write in this block was on the one throwaway day, so nothing else is left on the server. Close the web tab for good.

WHOOP, now that the phone is paired with your real server (Phase 8; [SELF_HOSTING section 8](../SELF_HOSTING.md#8-whoop-optional) has the setup). Open the Progress tab. These need your real WHOOP account, so they are not in the PR's automated checks.

- [ ] Register the WHOOP app. In the WHOOP developer dashboard create a new app for openGym, not the one your dashboard uses. Redirect URI `https://<your host>/api/whoop/callback`, exactly, with your `ORIGIN`. Scopes `read:recovery read:cycles read:sleep read:workout offline`.
- [ ] Put `WHOOP_CLIENT_ID` and `WHOOP_CLIENT_SECRET` in `.env`, then `docker compose up -d --build`, as [SELF_HOSTING section 9](../SELF_HOSTING.md#9-updating) does: plain `up -d` can keep an api image from before the WHOOP routes. (With `--env-file`, the two variables must be in that file.) Open the Progress tab again: while WHOOP isn't set up the card asks your server on every visit, so there is nothing to wait for (a minute at most, if its last read came while the api was restarting). If the card still says "WHOOP isn't set up on your server yet.", an api boot warning or an empty value is the cause: check `docker compose logs api`.
- [ ] Not connected. Open the Progress tab. Below Nutrition and Measurements the WHOOP card says "Connect WHOOP to see recovery, strain and cardio here." with a "Connect WHOOP" button.
- [ ] Connect. The phone must be paired at the `ORIGIN` address (the https address you entered in the cutover row), or Connect fails. Tap "Connect WHOOP". Safari opens the server's page "Connect WHOOP to the openGym profile <your name>?". Tap Continue, sign in at WHOOP and allow every permission. The page says "WHOOP is connected. You can close this tab and go back to openGym." Go back to the app: the card fills in with Today, "Recovery, last 7 days" and "Recent cardio".
- [ ] Same Safari. The WHOOP sign-in must finish in the Safari it started in. If WHOOP opens its own app and the server's page says "WHOOP wasn't connected: it didn't come back to the browser it started in.", tap Connect WHOOP again and finish the sign-in in Safari. If Connect itself fails ("Couldn't open WHOOP's sign-in. Try again."), the phone couldn't get a link from your server, or Safari couldn't open it: the phone is offline or can't reach the server, the server signed this phone out, or the server answered with an error. Check the phone is online and Diagnostics shows it synced (pair again if it says the server signed this phone out), then look in `docker compose logs api`.
- [ ] Today against WHOOP. Open the WHOOP app. Today's recovery %, HRV, resting HR and strain on the card match it (strain to one decimal). A value WHOOP hasn't scored shows "–", never 0. The numbers are at most about 10 minutes old: your server keeps what it reads from WHOOP for 10 minutes, and the card asks again once that copy has expired.
- [ ] Cardio against WHOOP. "Recent cardio" lists your last WHOOP workouts, newest first, each with sport, date, duration, strain, average HR and kcal. Compare them with WHOOP's workout list.
- [ ] VoiceOver. Turn VoiceOver on and swipe through the WHOOP card: the heading "WHOOP", each Today line, each cardio row and the Disconnect button read in plain words. Turn it off.
- [ ] Offline. Force-quit openGym first: the card holds a good read in memory for up to 10 minutes and would show it again without asking. Turn Airplane Mode on, open openGym and go to Progress: the card keeps the last numbers and ends with "As of <time>". Turn Airplane Mode off.
- [ ] Disconnect and reconnect (optional). Tap Disconnect: the alert "Disconnect WHOOP?" reads "Your server stops reading WHOOP and asks WHOOP to remove its access." Tap Disconnect. The card goes back to "Connect WHOOP to see recovery, strain and cardio here." Connect again as above. If it says "WHOOP is disconnected here, but WHOOP couldn't be told. Remove openGym's access in the WHOOP app.", do that.

From here on, do not install a dev build over the Release app. Any test on this phone now writes into the real record.

Next is Phase 9: the TestFlight build, the device scenarios and a real gym session, in [the acceptance log](2026-11-native-device-acceptance.md).

## After each real session

- [ ] Check the saved screen says "Synced to <host> at <time>". If it says "It will sync when <host> is reachable", open the app again with the server reachable, or tap "Sync now" in Diagnostics, until it does.
- [ ] Optional: tap Export workouts and AirDrop the JSON to the Mac as an extra copy. The server holds the synced copy.
