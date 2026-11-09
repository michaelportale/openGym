# Native first offline workout: device checklist

Run this on the iPhone before the first real gym session. Tick each line. Record pass or fail per line in the PR, not here.

Read this first: the dev build and the Release build share one bundle id, so they share one database. Everything you log while testing is written to the same place as real sessions. That is why step 11 wipes the app once. After the wipe, any later test on that phone writes into the real record.

## Before you build

1. Node 22 must be on PATH.
2. Generate your snapshot from your own data:
   `cd native && node scripts/make-snapshot.mjs <path to your state-*.json>`
   This writes `native/local/snapshot.json`. It is gitignored. Do not commit it.
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
- [ ] About load steps Open the keypad and type a number. Tap About load steps under the ±5 and ±10 chips. The sheet reads in plain words with the same closing line. Close it: the number you typed is still there.
- [ ] Warm-up Why. On the warm-up prompt, tap Why? The sheet reads in plain words with the same closing line. Close it, then tap Why offered? and check the same.
- [ ] Why reps left? In the keypad on a work set, tap Why reps left?. The sheet reads in plain words with the same closing line.
- [ ] Reps left saved. On a work set, pick 3 and tap Complete. Reopen that set: 3 is selected. Kill the app and reopen it: it is still 3.
- [ ] Progression off. Your routines have progression off. Finish a workout: it shows no Next time lines. Start the same routine again: it opens at last time's weights exactly as before.
- [ ] Next time lines. With progression off on every exercise, Finish shows no Next time lines, so their Why? and the far-from-failure note cannot be checked on this phone. The unit tests and the pre-merge simulator walkthrough cover them. Once an exercise's progression is on (double progression, or none named) and you finished a work set of it, Finish shows a Next time line with a weight and reps and a Why?, and the next session opens that exercise at that weight. Do not edit your real data to test this.
- [ ] Largest text. Set the text size to the largest. On the resting dock every button, About rest times included, stays usable. The reps-left row wraps or scrolls. Set the text size back.

## 9. Airplane Mode off

- [ ] Turn Airplane Mode off when the checks above are done.

## 10. Before the wipe

- [ ] Every line above has a recorded pass or fail in the PR. Fix any failure before wiping.
- [ ] From the repository root, `git status` does not list `native/local/`.
- [ ] The privacy search covers every tracked file in the repository, not only `native/` and `docs/sprints/`: `git grep -n -I -e '<your user id>' -e '<one of your routine ids>' -e '<one of your custom exercise ids>'` prints nothing. Your user id is the part of your data file's name between `state-` and `.json`. Type the real values only in the terminal, never into a tracked file, this one included.

## 11. The wipe

This removes the test workouts so your first real session starts clean.

- [ ] Delete the openGym app from the phone.
- [ ] Install the Release build fresh with the command from step 1. Check the snapshot is still in place.
- [ ] Open it. Push A is next.
- [ ] No workouts are listed. Export says "Nothing to export yet".
- [ ] The example-data banner is absent.

From here on, do not install a dev build over the Release app. Any test on this phone now writes into the real record.

## After each real session

- [ ] Tap Export workouts and AirDrop the JSON to the Mac. Until Phase 5 pairing, the phone holds the only copy.
