# Native Phase 0 results

Outcome: every gate passed. Decision: use `@kingstinct/react-native-healthkit` 16.2.0, pinned exactly.

## Versions

| Item | Version |
| --- | --- |
| Device | iPhone 16, iOS 26.6.2 |
| Xcode | 26.6 (SDK 26.5) |
| Expo | ~58.0.23 |
| React Native | 0.88.1 |
| React | 19.3.0 |
| expo-dev-client | ~58.0.18 |
| @kingstinct/react-native-healthkit | 16.2.0 (pinned, no range) |
| react-native-nitro-modules | 0.37.2 |

## Bundling notes

- Only `metro.config.js` `watchFolders` was needed so the app can import `frontend/src/lib`.
- `import.meta.env` and JSON import attributes in `frontend/src/lib` bundled with no babel changes.

## Device proof

- Release build in Airplane Mode: the shared estimated-1RM calculation ran and the exercise catalogue loaded (5632 exercises, e1RM 133.3 for the fixed test input).
- Debug development build loaded from Metro and showed the e1RM screen.

## HealthKit gates

| Gate | Result | Notes |
| --- | --- | --- |
| Save workout | pass | One Strength Training workout appears in the Health app. |
| Retry (same sync identifier and version) | pass | Same-version save succeeded with no error; still one workout. Behavior: succeeded, did not throw. |
| Replace (higher sync version) | pass | One workout, version 2. |
| Delete | pass | Method: `deleteObjects('HKWorkoutTypeIdentifier', { uuid })`. No leftovers. |
| Read body weight | pass | A hand-entered Health weight read back as `pass`. |
| Write access off | pass | Save fails, later gates are skipped, no crash. |

Owner confirmed on device: saving the manual test workout twice gives one workout in the Health app, and Remove clears it.

Review follow-up: Remove test workouts now clears gate workouts from every run, under both the current and old sync keys. Owner confirmed on device: after saving one test workout it removed 1 and left or kept none, and the Health app shows no openGym test workouts. So no earlier gate run left anything behind.

Important finding: the first run failed retry (2 found) and replace (3 found) because the plan used `HKSyncIdentifier` / `HKSyncVersion`. Apple's raw metadata keys are `HKMetadataKeySyncIdentifier` / `HKMetadataKeySyncVersion`. The library's generated schema has the wrong names. Phase 6 must use the Apple names.

## Decision

Rule: all gates pass, so choose `@kingstinct/react-native-healthkit`. It is pinned to 16.2.0 in `native/package.json` and `native/package-lock.json`. No custom Expo module is proposed.

## Known limitations

Setup notes:
- Xcode needed the iOS 26.5 platform: `xcodebuild -downloadPlatform iOS -architectureVariant arm64` (without the variant it found nothing).
- CocoaPods needs a UTF-8 locale (`LANG=en_US.UTF-8`).
- Port 8081 may be taken; Metro ran with `npx expo start --dev-client --port 8082`.
- The launcher's manual URL field defaulted to https. The working deep link is `exp+opengym://expo-development-client/?url=http%3A%2F%2F<mac-ip>%3A<port>`, launched with `xcrun devicectl device process launch --payload-url`.
- Device builds print a launch error when the phone is locked; the install still succeeds.

Unverified or open:
- Simulator behavior is unverified. The first launch of the simulator runtime triggered a long macOS verification and the simulator build was not completed. Device builds do not depend on it.
- `npm audit` reports 5 moderate advisories, from `glob` and `minimatch` via Expo's tooling. The fix path goes through Expo; unresolved.
- The library's dev dependency is React Native 0.81.5. Compatibility with 0.88.1 rests on the peer range plus these device gates, not on release notes.
- Not tested: interrupted exports, background delivery (turned off), read-denied behavior, and body-weight writes (only workouts were written).
- The shared-lib scanner still misses a regex literal containing a quote or backtick, bracket access such as `window['localStorage']`, aliases such as `const w = window`, and globals outside its token list such as `location.`. None exist in the shared graph today, checked with a parser-based walk.

## Carry into Phase 6

- Every edit must bump the sync version. The gates only tried same-version saves with identical data; a same-version save with changed data may be dropped.
- Unverified: the uuid returned by a save may not be the stored one after a no-op retry or replace. Key Health links on the sync id and re-query the uuid, or add a gate first.
- `toRead` currently includes workouts, although the PRD excludes reading workouts. Try dropping it and rerun the gates.
- Adapter reads need guards for missing metadata and missing `sourceRevision`.
- `npm audit fix --force` proposes downgrading Expo to 53; don't take it.
