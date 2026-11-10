# Native device acceptance (Phase 9): log

Phase 9 is done when the [PRD](2026-10-30-native-workout-prd.md)'s physical-device scenarios and one real gym session pass on an internal TestFlight build. You record the results here, dated. Fill this in on the phone build, not the simulator.

Start only after [the device checklist](2026-11-native-first-workout-checklist.md) has passed through step 16 (the wipe and the cutover). The phone must already be paired with your real server.

## 1. Build and upload to TestFlight

These steps are yours: they use your Apple account.

1. **App record (once).** In App Store Connect, create an app with the bundle id `io.github.michaelportale.opengym`. The name must be unique on the App Store; it does not have to be "openGym", because only you will see it.
2. **Keep your data out of the upload.** A Release build bundles `native/local/snapshot.json`, which holds your routines and history. A TestFlight upload sends the whole app to Apple. Move the snapshot aside before archiving:
   `mv native/local/snapshot.json native/local/snapshot.json.off`
   The build then carries only the example data. Your real routines and history come from your server once the phone is paired, which it already is.
3. **Regenerate the iOS project:** `cd native && LANG=en_US.UTF-8 npx expo prebuild --platform ios`. This applies `app.json`, including the build number and the export-compliance answer.
4. **Archive in Xcode.** Open `native/ios/openGym.xcworkspace`. Choose the "Any iOS Device (arm64)" destination, then Product > Archive.
5. **Upload.** In the Archives window, choose Distribute App > App Store Connect > Upload.
6. **Restore your snapshot:** `mv native/local/snapshot.json.off native/local/snapshot.json`.
7. **Add yourself as a tester.** Wait for the build to finish processing in App Store Connect. Then, in TestFlight, add yourself as an internal tester. Internal testing needs no review.

What `app.json` declares for you:
- `buildNumber` is `"1"`. Every later upload needs a higher number: edit it, commit it, and repeat from step 3.
- `usesNonExemptEncryption: false` answers Apple's export-compliance question for every build. It is true for this app: it uses only HTTPS and the Keychain, both through iOS, and no encryption library of its own. If that ever changes, change this line.

## 2. Install over your current build

- [ ] Install the build from the TestFlight app. It replaces the Xcode-installed app, because both use the same bundle id.
- [ ] Open ··· More, then Diagnostics. It still says "Signed in as <your profile>". Your workouts are all there, and their count matches the server's.
- [ ] If it says "Not paired", pair again with the real server, the same way as in checklist step 16. Your history comes back from the server.
- [ ] Apple Health is still on. If it is off, turn it on again and allow access.
- [ ] Rest alerts are allowed (Settings > Notifications > openGym).

Build installed: ______ (TestFlight build number) on ______ (date).

## 3. Physical-device scenarios

All must pass. Write Pass or Fail, the date, and anything odd. A failure stops Phase 9: file it, fix it, upload a new build, and run the failed row again.

| Scenario | Expected behaviour | Result | Date | Notes |
| --- | --- | --- | --- | --- |
| Complete a set, immediately lock the phone | Set remains saved; rest deadline is correct when unlocked. | | | |
| Switch to Messages while editing weight or reps | Draft and place preserved; partial input never counts as completed. | | | |
| Change music and return repeatedly | Same workout and exercise; no reset, duplicate timers or needless audio interruption. | | | |
| Lock during rest and return before its deadline | Correct remaining time shown immediately. | | | |
| Return after rest expired | Rest shown complete; no negative countdown, replayed alarm or automatic next set. | | | |
| Pause or extend rest, then background | Pause or new deadline preserved; old alert cancelled or replaced. | | | |
| Tap a rest notification | Opens the matching active workout; a stale one opens a safe current state. | | | |
| Force-quit (app switcher) | Session and drafts recovered, timing recomputed; rest alert still arrives or is reconciled. | | | |
| Device restart during a workout | Session and drafts recovered, timing recomputed; note what the rest alert did. | | | |
| OS kills the app (opened many heavy apps until openGym reloads from scratch) | Session and drafts recovered, timing recomputed; note what the rest alert did. | | | |
| Lose connectivity or enable airplane mode | Recording, timing and local notifications continue; pushes queue and go out when back online. | | | |
| Deny notifications | Recording and recovery still work; the app says "Rest alerts are off. Turn on notifications for openGym in Settings…". | | | |
| Focus, silent mode, Low Power Mode | Recording and recovery still work; an alert that is scheduled but not shown or not heard is iOS's choice, not a lost alert. | | | |
| Undo or complete rapidly, or background during completion | No double counting; last durable state recovered; alerts reconciled. | | | |
| Finish during rest, then reopen from an old alert | History appears once; no remaining alert or revived session. | | | |

The PRD's "OS kills app, force-quit or device restart" row is split into three rows here, because it asks for each case. Its "Deny notifications; Focus, silent mode or Low Power Mode" row is split into two for the same reason.

## 4. A real gym session

Log one real session start to finish on this build. Use the rest timer and lock the phone between sets as you normally would.

- [ ] Every set you did is logged, with the right weight and reps, and none is logged twice.
- [ ] Rest alerts arrived when the rest ended, or the row above explains why not.
- [ ] After Finish, the session is in history once. Next time lines (where your progression is on) match what you expect.
- [ ] Back online, the session reaches the server: the web's History (look, don't edit) or `list_workouts` in your MCP client shows it with the same sets.
- [ ] It is in Apple Health once, as a strength workout with the right start and end.

Session: ______ (date), ______ (routine), ______ sets. Notes:

## 5. Acceptance criteria not covered above

Each criterion has already been checked once, in the place named. Tick it again on this build.

- [ ] **The MCP server reads phone-pushed data correctly.** In your MCP client, `get_workout` for the session above shows the same exercises, sets, weights and reps as the phone. This is not in the checklist.
- [ ] **Delete the app, reinstall and restore: every set returns.** Checklist step 10 checked this on a copy. Do not repeat it on the real server unless you want to.
- [ ] **A server conflict never overwrites data on either side.** Checklist section 10 and the web-edit rows at the end of step 16 checked this.
- [ ] **Every training number shown has a `docs/science/` entry and a "Why this?" explanation.** Checklist section 8 checked this. Spot-check one "Why this?" on this build.
- [ ] **The API, MCP and shared-logic test suites pass.** They pass on every merged PR. Note the commit this build was archived from: ______

## Sign-off

Phase 9 passed on ______ (date), build ______. Phase 10 (retiring the web UI) can start after this line is filled in.
