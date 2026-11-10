# Native device acceptance (Phase 9): log

Phase 9 is done when the [PRD](2026-10-30-native-workout-prd.md)'s physical-device scenarios and one real gym session pass on an internal TestFlight build. You record the results here, dated. Fill this in on the phone build, not the simulator.

Start only after [the device checklist](2026-11-native-first-workout-checklist.md) has passed through step 16 (the wipe and the cutover). The phone must already be paired with your real server.

## 1. Build and upload to TestFlight

These steps are yours: they use your Apple account. Run every command from the repository root.

1. **App record (once).** In App Store Connect, create an app with the bundle id `io.github.michaelportale.opengym`. The name must be unique on the App Store; it does not have to be "openGym", because only you will see it.
2. **Keep your data out of the upload.** A Release build bundles `native/local/snapshot.json`, which holds your routines and history. A TestFlight upload sends the whole app to Apple. Move the snapshot aside before archiving:
   `mv native/local/snapshot.json native/local/snapshot.json.off`
   The build then carries only the example data. Your real routines and history come from your server once the phone is paired, which it already is.
3. **Regenerate the iOS project:** `(cd native && LANG=en_US.UTF-8 npx expo prebuild --platform ios)`. This applies `app.json`, including the build number and the export-compliance answer. Don't add `--clean`, because that drops your signing team.
4. **Archive in Xcode.** Open `native/ios/openGym.xcworkspace`. In the openGym target, under Signing & Capabilities, check that Team is yours and Automatically manage signing is on. Then choose the "Any iOS Device (arm64)" destination and Product > Archive.
5. **Upload.** In the Archives window, choose Distribute App, then the App Store Connect upload. Recent Xcode may offer "TestFlight Internal Only", which fits: only you test this.
6. **Restore your snapshot:** `mv native/local/snapshot.json.off native/local/snapshot.json`.
7. **Add yourself as a tester.** Wait for the build to finish processing in App Store Connect. Then, in TestFlight, add yourself as an internal tester. Internal testing needs no review.

What `app.json` declares for you:
- `buildNumber` is `"1"`. Every later upload needs a higher number: edit it, commit it, and repeat this section **from step 2**. Step 2 keeps your data out of that upload too.
- `usesNonExemptEncryption: false` answers Apple's export-compliance question for every build. It is true for this app: it uses only HTTPS and the Keychain, both through iOS, and no encryption library of its own. If that ever changes, change this line.

TestFlight builds stop launching 90 days after upload. Your data stays on the phone and the server. Upload a new build (this section, from step 2) before then.

## 2. Install over your current build

- [ ] **Before installing:** open ··· More, then Diagnostics, and tap Sync now. It says "Synced to <host> at <time>", with nothing waiting to send.
- [ ] Install the build from the TestFlight app. It replaces the Xcode-installed app, because both use the same bundle id.
- [ ] Diagnostics still says "Signed in as <your profile>". Then check your data the way the cutover did:
  - "Next: <routine>" on the Workout start screen follows your rotation;
  - starting a routine shows your real previous weights in the "Last" column (discard it: Finish, then Discard workout, then Discard);
  - Progress, Your lifts lists your real lifts;
  - no example-data banner.
- [ ] If it says "Not paired" instead, the install did not keep the app's data. Until you pair, this build shows the example routines and the example-data banner. That is expected here, and it is not the checklist's "stop and rebuild". Start nothing. Pair again with the real server, as in checklist step 16. Everything you synced before installing comes back from the server.
- [ ] Apple Health is still on. If it is off, turn it on again and allow access.
- [ ] Rest alerts are allowed (Settings > Notifications > openGym).

Build installed: ______ (TestFlight build number) on ______ (date).

## 3. Physical-device scenarios

**Every row here writes into your real record.** The phone can discard an open session, but it cannot delete a finished one, and a finished one goes to the server, Apple Health and your rotation. So:
- run a row inside a real session where it fits;
- otherwise, use a session you discard at the end (Finish, then Discard workout, then Discard);
- run "Finish during rest" as the finish of a real session, such as section 4's.

Rows that change a setting say "then turn it back". Do that before the next row.

All rows must pass. Write Pass or Fail, the date, and anything odd. A failure stops Phase 9: file it, fix it, upload a new build (section 1, from step 2, with a higher build number), and run the failed row again.

| Scenario | Expected behaviour | Result | Date | Notes |
| --- | --- | --- | --- | --- |
| Complete a set, immediately lock the phone | Set remains saved; rest deadline is correct when unlocked. | | | |
| Switch to Messages while editing weight or reps | Draft and place preserved; partial input never counts as completed. | | | |
| Change music and return repeatedly | Same workout and exercise; no reset, duplicate timers or needless audio interruption. | | | |
| Lock during rest and return before its deadline | Correct remaining time shown immediately. | | | |
| Return after rest expired | Rest shown complete; no negative countdown, replayed alarm or automatic next set. | | | |
| Pause or extend rest, then background | Pause or new deadline preserved; old alert cancelled or replaced. | | | |
| Tap a rest notification | Opens the matching active workout; a stale one opens a safe current state. | | | |
| Force-quit during rest (app switcher) | Session and drafts recovered, timing recomputed; the "Rest over" alert still arrives when rest ends. | | | |
| OS kills the app during rest (open many heavy apps until openGym reloads from scratch) | Session and drafts recovered, timing recomputed; the "Rest over" alert still arrives when rest ends. | | | |
| Device restart during rest | Session and drafts recovered, timing recomputed. The "Rest over" alert arrives when rest ends; if it does not, write that down. | | | |
| Lose connectivity or enable airplane mode, then turn it back | Recording, timing and local notifications continue; pushes queue and go out when back online. | | | |
| Deny notifications, then turn them back | Recording and recovery still work; the app says "Rest alerts are off. Turn on notifications for openGym in Settings…". | | | |
| Focus, silent mode, Low Power Mode (each, then turn it back) | Recording and recovery still work. Lock the phone during rest: when rest ends, the "Rest over" alert is in Notification Centre even if no banner showed or no sound played. | | | |
| Undo or complete rapidly, or background during completion | No double counting; last durable state recovered; alerts reconciled. | | | |
| Finish during rest, then reopen from an old alert | History appears once; no remaining alert or revived session. | | | |
| Leave a session unfinished overnight | Offer resume, finish with a chosen end time, or discard; overnight time is never logged silently. | | | Checklist section 5 "Midnight" checked the prompt. Here, leave a discardable session open overnight for real. |
| Change the clock or time zone mid-session, then turn it back | No negative timers, duplicated session or corrupted duration. | | | Settings, General, Date & Time: turn off Set Automatically, change the time zone, then the time. Afterwards, turn Set Automatically back on. |
| Interrupt Health permission or export | Local workout remains saved; retry is explicit and creates no duplicate. | | | As checklist section 11 "Writing off" and "Writing back on", on this build. |
| Storage full during save | No false "saved"; entry preserved with an actionable retry. | | | A really full phone isn't practical. Run Diagnostics, Storage check ("Storage check passed"), and write "not run on a full phone" here. Failed saves are covered by unit tests on real SQLite (`native/src/session/checkpoint-error.test.js`). |
| One-handed use and keyboard during a real session | Controls reachable; keyboard never hides the active field. | | | Tick it during section 4's real session. |

The PRD's "OS kills app, force-quit or device restart" row is split into three rows here, because it asks for each case. Its "Deny notifications; Focus, silent mode or Low Power Mode" row is split into two for the same reason. No row is dropped.

## 4. A real gym session

Log one real session start to finish on this build. Use the rest timer and lock the phone between sets as you normally would. Notifications, Focus and airplane mode should be back to your normal settings from section 3.

- [ ] Every set you did is logged, with the right weight and reps, and none is logged twice.
- [ ] Rest alerts arrived when the rest ended.
- [ ] After Finish, the session shows once: in an exercise's "Your history" (Exercises tab), and on the server (next line). Next time lines (where your progression is on) match what you expect.
- [ ] Back online, the session reaches the server: the web's History (look, don't edit) or `list_workouts` in your MCP client shows it once, with the same sets.
- [ ] It is in Apple Health once, as a strength workout with the right start and end.

Session: ______ (date), ______ (routine), ______ sets. Notes:

## 5. Acceptance criteria not covered above

- [ ] **The MCP server reads phone-pushed data correctly.** In your MCP client, `get_workout` for the session above shows the same exercises, sets, weights and reps as the phone. This is not in the checklist.
- [ ] **Delete the app, reinstall and restore: every set returns.** Tick it from checklist section 10's result, where this was done on a copy. Don't repeat it on the real server.
- [ ] **A server conflict never overwrites data on either side.** Tick it from checklist step 16's web-edit rows: Plan "Changed on the web first" and "Deleted on the web", and Nutrition "Changed on the web first".
- [ ] **Every training number shown has a `docs/science/` entry and a "Why this?" explanation.** Checklist sections 8 and 12 checked these. Spot-check one "Why" sheet on this build.
- [ ] **The API, MCP and shared-logic test suites pass.** On the commit you archived, run `(cd frontend && npm test)`, `(cd api && npm test)`, `(cd mcp && npm test)` and `(cd native && npm run verify)`. Commit: ______

## Sign-off

Phase 9 passed on ______ (date), build ______. Phase 10 (retiring the web UI) can start after this line is filled in.
