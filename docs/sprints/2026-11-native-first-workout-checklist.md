# Native first offline workout: device checklist

Run this on the iPhone before the first real gym session. Tick each line. Record pass or fail per line in the PR, not here.

Read this first: the dev build and the Release build share one bundle id, so they share one database. Everything you log while testing is written to the same place as real sessions. That is why step 9 wipes the app once. After the wipe, any later test on that phone writes into the real record.

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

- [ ] Turn Airplane Mode on. Keep it on for steps 3 to 7.

## 3. Storage check

- [ ] Open Diagnostics: on the Workout start screen (no workout open), tap the ··· (More) button at the top right.
- [ ] Tap Storage check.
- [ ] It says "Storage check passed".

## 4. The six kill checks

Start Push A for these. Kill the app as described above each time.

- [ ] 1. Draft. Type a weight and tap Save without completing the set. Kill the app and reopen it. The draft is still there.
- [ ] 2. Typed, not saved. Tap the current set's weight to open the keypad and type a new weight. Do not tap Save. With the keypad still open, kill the app straight from it as described above: swipe up and pause, then swipe the openGym card up, without going to the Home Screen first. Reopen it. The set shows the typed weight as a draft.
- [ ] 3. Rest. Complete a set. Kill the app during the rest. Reopen it. The set is still done and the rest time left is right.
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

## 7. Airplane Mode off

- [ ] Turn Airplane Mode off when the checks above are done.

## 8. Before the wipe

- [ ] Every line above has a recorded pass or fail in the PR. Fix any failure before wiping.
- [ ] From the repository root, `git status` does not list `native/local/`.
- [ ] The privacy search covers every tracked file in the repository, not only `native/` and `docs/sprints/`: `git grep -n -I -e '<your user id>' -e '<one of your routine ids>' -e '<one of your custom exercise ids>'` prints nothing. Your user id is the part of your data file's name between `state-` and `.json`. Type the real values only in the terminal, never into a tracked file, this one included.

## 9. The wipe

This removes the test workouts so your first real session starts clean.

- [ ] Delete the openGym app from the phone.
- [ ] Install the Release build fresh with the command from step 1. Check the snapshot is still in place.
- [ ] Open it. Push A is next.
- [ ] No workouts are listed. Export says "Nothing to export yet".
- [ ] The example-data banner is absent.

From here on, do not install a dev build over the Release app. Any test on this phone now writes into the real record.

## After each real session

- [ ] Tap Export workouts and AirDrop the JSON to the Mac. Until Phase 5 pairing, the phone holds the only copy.
