# Native first offline workout: device checklist

Run this on the iPhone before the first real gym session. Tick each line. Record pass or fail per line in the PR, not here.

Read this first: the dev build and the Release build share one bundle id, so they share one database. Everything you log while testing is written to the same place as real sessions. That is why step 13 wipes the app once. After the wipe, any later test on that phone writes into the real record.

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
- [ ] Only if this phone already holds real gym sessions (logged since an earlier wipe), do this now, before any test below: the reinstall in step 10 and the wipe in step 13 delete everything on the phone. On the Mac, from the repository root, note the count: `node -e "console.log(JSON.parse(require('fs').readFileSync('data/state-<user id>.json','utf8')).workouts.length)"` (the user id is the part of the file name between `state-` and `.json`). In ··· More, Diagnostics, pair with the **real** server: print a code with `docker compose exec api node scripts/pair-code.mjs` (or the bare-metal form in SELF_HOSTING) and enter the https address you open the web app at and the code. Run the count again: it went up by the sessions on the phone. Then tap "Forget this server" and confirm, so no test below reaches the real server. With no real sessions on the phone, skip this line.

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

This rehearses sync and restore against a **copy** of `data/`, never the real one. Do it before the wipe. It needs the Mac and the phone on the same network, and the Release build from step 1 on the phone. Anything you log here goes into the phone's database, like every other test in this file; the wipe in step 13 clears it.

- [ ] Back up the real data, with the tar from [SELF_HOSTING section 6](../SELF_HOSTING.md#6-backups): `tar czf opengym-backup-$(date +%F).tar.gz data/`. Only the real folder is read; nothing here changes it.
- [ ] Make the copy, from the repository root: `cp -a data ../opengym-data-copy`. The copy sits outside the repository so it cannot be committed. Then remove the copy's secret: `rm ../opengym-data-copy/secret`. The copy makes its own secret on first start, so nothing it signs (including the phone's sign-in token) works on the real server.
- [ ] Start a second API on the copy, on another port, with Docker, leaving the real container and the real `./data` alone: `docker build -t opengym-api-copy ./api`, then `docker run -d --name opengym-api-copy -p 3100:3000 -e DATA_DIR=/data -v "$PWD/../opengym-data-copy:/data" opengym-api-copy`. Use any free host port in place of `3100`; write it as `<port>` below. Without Docker, from `api/` (needs `npm install` there): `DATA_DIR=<the copy> PORT=<port> node server.js`. The copy has the real push subscriptions, so day reminders may arrive twice while it runs.
- [ ] Print a pairing code for the copy: `docker exec opengym-api-copy node scripts/pair-code.mjs` (bare metal: `cd api && DATA_DIR=<the copy> PORT=<port> node scripts/pair-code.mjs`). With more than one profile, add `--user <name>`. The code lasts 5 minutes.
- [ ] On the phone, open ··· More, then Diagnostics. In "Your server" tap "Pair with your server". Enter `http://<the Mac's LAN IP>:<port>` and the code, then tap Pair. The first connection shows the iOS Local Network prompt: tap Allow. If Pair says it couldn't reach the server, tap Allow on that prompt and tap Pair again with the same code: a request that never reached the server does not use the code up. If 5 minutes have passed, or Pair then says the code didn't work, print a new code. Plain http is for this rehearsal only: it sends the sign-in token unencrypted, which is acceptable here because the copy has its own secret, so the token opens nothing on the real server, but not for the real pairing (step 13 uses https). This uses the Release build from step 1. The section now shows the host, "Signed in as" your profile, the status line "Synced to <host> at <time>" and, if anything is queued, "N workouts waiting". A separate "Last synced" line shows only while the status line does not say when it last synced. Routines, rotation and history now come from the copy. Note the count on the Mac now: `node -e "console.log(JSON.parse(require('fs').readFileSync('<the copy>/state-<user id>.json','utf8')).workouts.length)"` (the user id is the part of the file name between `state-` and `.json`).
- [ ] Finish a short workout. The saved screen says "Synced to <host> at <time>".
- [ ] Turn Airplane Mode on, and Wi-Fi off in Control Centre. Finish another workout. The saved screen says "Saved on this phone. It will sync when <host> is reachable." Diagnostics shows "1 workout waiting".
- [ ] Turn Airplane Mode off and Wi-Fi back on, then return to the app. Tap "Sync now" in Diagnostics. Returning to the app syncs by itself only when the last try was more than a minute ago, and the Control Centre toggle may not background the app at all. The line then says "Synced to <host> at <time>" and no workouts are waiting.
- [ ] Delete the openGym app. Reinstall the Release build from step 1 with its command. Pair with the copy again (new code from the pair command, same address). The phone has no History screen, so check two things. On the Mac, run the count command above again: it prints the count before the rehearsal plus the workouts you finished (the server never lost any). On the phone, the start screen's "Next: <routine>" follows your rotation. From the routine list, start one of the routines you finished in this rehearsal: its "Last" column shows the weights you logged then. Discard it: tap Finish, then Discard workout, then Discard. After a reinstall, Export lists only workouts finished on this install; the server holds the full record.
- [ ] A weigh-in reaches the copy. Apple Health does not need to be on for this. On Progress tap "Log weight", type today's weight and tap Save. In Diagnostics tap "Sync now" and wait for "Synced to <host> at <time>". Then on the Mac, from the repository root, print today's weight from the copy (it prints one number and nothing else): `node -e "const d=new Date(),p=n=>String(n).padStart(2,'0'),t=d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());console.log(JSON.parse(require('fs').readFileSync('<the copy>/state-<user id>.json','utf8')).bodyweight.find(e=>e.d===t).w)"` (the user id is the part of the file name between `state-` and `.json`). It prints the weight you typed.
- [ ] In Diagnostics tap "Forget this server" and confirm. The section goes back to "Pair with your server" and the status says "Not paired. Saved on this phone." Forget drops the phone's copy of the server's data, so the Workout tab shows the routines bundled in this build again until you pair. Export still says "Nothing to export yet": since the reinstall the phone has logged nothing, and the rehearsal's workouts are on the copy.
- [ ] Stop the copy: `docker rm -f opengym-api-copy` (bare metal: stop the process). Delete `../opengym-data-copy` when done. Do not delete `data/`.

## 11. Apple Health

Phase 6, Stages A (workouts) and B (weigh-ins). Do it before the wipe, on test workouts and a test weight, with the Release build. Turning Health on sends every workout finished on this install, so the test workouts from the steps above go to Health too; the last line removes them all. This section does not need the server, so it does not matter whether the phone is paired.

- [ ] Turn it on. In ··· More, Diagnostics, find the "Apple Health" section with a switch labelled "Apple Health". It starts off and says "Off. Your workouts are not sent to Apple Health." Turn the switch on. iOS asks for Health access: turn on Workouts (allow writing) and tap Allow. If no access sheet appears, iOS kept the answers from Phase 0, when this iPhone was already asked for Health access (read and write, Workouts and Weight); carry on. The section says "On. Finished workouts go to Apple Health." and "<n> workouts in Health", where n counts the workouts finished on this install so far. A line "<n> weights in Health" ("1 weight in Health" for one) shows after it only once a weight has gone to Health.
- [ ] See them in Health. The count is the workouts finished since step 10's reinstall, so it may be "0 workouts in Health" and there may be nothing to see yet; the next row's finish is the one to look for. If there are some, open the Health app, then Browse, Activity, Workouts (or Summary, Workouts): they show as "Traditional Strength Training", source openGym, once each.
- [ ] Finish a short workout. Start a routine from the routine list, complete one set and Finish, then Save workout. In Diagnostics the count goes up by one. In Health the new workout appears once, "Traditional Strength Training", source openGym, with the start and end times of your session.
- [ ] Lock and return. Finish another short workout and lock the phone right after Finish. Unlock, open the app and return to Diagnostics. Check Health: that workout is there once, not twice.
- [ ] Writing off. In Settings, Health, Data Access & Devices, openGym, turn Workouts off. Return to the app. Diagnostics says "On, but writing to Apple Health is turned off. Turn on Workouts in Settings → Health → Data Access & Devices → openGym." Finish a short workout. It saves in the app, the section shows "1 waiting" and, next to it, "Last try: <the error text>" (expected), and Health does not show it.
- [ ] Writing back on. Turn Workouts back on in Settings, Health, Data Access & Devices, openGym. Return to the app. It sends the waiting workout by itself if its last try was more than a minute ago; if "1 waiting" still shows, tap Retry. The waiting line goes away, the writing-off line goes away, and Health shows that workout once. Every workout from this section is in Health once each, none twice.
- [ ] Skipped workouts. A workout with no start or end time shows as "<n> skipped (no start or end time)" and is never retried. You do not need to make one; if the line shows, it is not an error.
- [ ] Take back the read access Phase 0 gave. Open Settings, Health, Data Access & Devices, openGym. Under write, Workouts and Weight are on. Under read, turn Workouts off (Weight stays on).
- [ ] Workout gates without reading workouts. The app no longer asks to read workouts, and the previous row took that access away. In Diagnostics, tap "Run workout gates". Four lines show: "save: pass (workouts found: 1)", "retry: pass (workouts found: 1)", "replace: pass (workouts found: 1, version 2)" and "delete: pass (workouts left: 0)". The gate workout is its own test and is deleted at the end, so the "workouts in Health" count does not change. If any line says fail, write down which one: the phone cannot see its own workouts without read access, and Phase 6 has to change before the wipe.
- [ ] Log a weight. With Apple Health on, open the Progress tab, tap "Log weight", type today's weight and tap Save. Progress shows "Today: <w> lb". Diagnostics' Apple Health section shows "1 weight in Health". In the Health app, Browse, Body Measurements, Weight shows it once, source openGym.
- [ ] A typed weight wins. In the Health app, tap Add Data on Weight and add a different weight for today. Back in openGym, Progress still shows your typed weight.
- [ ] Remove today's weight. On Progress tap "Log weight", then "Remove today's weight". Return to the Progress tab and allow a moment: it shows "Today: <the Health app weight> lb (from Apple Health)". In the Health app, openGym's own sample is gone.
- [ ] Delete in Health. In the Health app, delete that weight. Return to openGym: Progress shows "No weight logged today."
- [ ] Device-only checks. Rows above cover that weight writes and read-back work, and that a deletion made in the Health app is seen. Two more: (a) revoke openGym's Weight read access in Settings, Health, Data Access & Devices, openGym, add a weight in the Health app, then turn read access back on and return to openGym. Write down whether that weight arrives: this is a known unverified behaviour, not a failure of this checklist. (b) Turn Apple Health off in openGym with "Keep what's there", add a weight in the Health app, turn Apple Health back on: readings taken while it was off come in.
- [ ] Turn it off and remove. Turn the "Apple Health" switch off. The alert "Turn off Apple Health?" shows three buttons: "Keep what's there", "Also remove openGym's workouts and weights" and "Cancel". Tap "Also remove openGym's workouts and weights". The section goes back to "Off. Your workouts are not sent to Apple Health." In the Health app, Browse, Activity, Workouts, none of openGym's workouts are left, and Browse, Body Measurements, Weight shows none from openGym (a weight you added in the Health app yourself stays). The workouts are still in the app: Export workouts lists them.
- [ ] Discard any test session still open: tap Finish, then Discard workout, then Discard. A finished test workout needs no discard; it stays in the app until the wipe.

## 12. Before the wipe

- [ ] Every line above has a recorded pass or fail in the PR. Fix any failure before wiping.
- [ ] From the repository root, `git status` does not list `native/local/`.
- [ ] The privacy search covers every tracked file in the repository, not only `native/` and `docs/sprints/`: `git grep -n -I -e '<your user id>' -e '<one of your routine ids>' -e '<one of your custom exercise ids>'` prints nothing. Your user id is the part of your data file's name between `state-` and `.json`. Type the real values only in the terminal, never into a tracked file, this one included.

## 13. The wipe

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

From here on, do not install a dev build over the Release app. Any test on this phone now writes into the real record.

## After each real session

- [ ] Check the saved screen says "Synced to <host> at <time>". If it says "It will sync when <host> is reachable", open the app again with the server reachable, or tap "Sync now" in Diagnostics, until it does.
- [ ] Optional: tap Export workouts and AirDrop the JSON to the Mac as an extra copy. The server holds the synced copy.
