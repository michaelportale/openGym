# On-device checklist

Not run for this handoff. No iPhone validation is claimed.

The overnight audit (`docs/reviews/2026-11-06-overnight-pr-audit.md` on open PR #65) says device rendering and real Expo SQLite are unverified. That audit's snapshot stops at #103. `expo-sqlite` is not a dependency. The Workout screen is still the preview and does not mount the session hook. Gus owns that screen. See [ui-handoff.md](ui-handoff.md).

Shell checks that are still open on the phone are listed there: SF Symbols, Liquid Glass labels, focus, the native tab bar versus the dock, Dynamic Type, reduced motion, and haptics. A clean install and the Metro export passed earlier. The export still needed `EXPO_NO_TYPESCRIPT_SETUP=1`.

Run the session checks below only on a build that actually opens a session.

## Kill and reopen

- Mid-set. Committed sets come back. An open draft comes back. A partial draft is not a completed set.
- Mid-rest. Remaining time matches the stored deadline, or the paused remaining if rest was paused. No negative countdown.

## Midnight and resume

- Cross local midnight in the session's time zone.
- A short gap, within `REST_MAX_MS` (15 minutes), still counts.
- A longer overnight gap does not count as session time.
- The app offers resume, finish with an explicit end, or discard. It does not finish silently.
- Resume moves the activity stamp. Sets, rest, notes, and a finish stay as they were.

## A short rest and a long gap

- A normal rest counts.
- A gap longer than `DURATION_GAP_MS` (4 hours) is not added to elapsed.
- Elapsed does not shrink if the clock steps backward.

## JSON1 on expo-sqlite

The adapter's statements use `json_patch`, `json_object`, `json_extract`, `json_set`, and a `json()` wrap around the seen trail. On the device database, after a kill:

- The seen trail is still a JSON array, not a quoted string.
- The first stored time zone is unchanged.
- A stamp, trail, or zone key that was never stored is absent, not JSON null.

## node:sqlite versus expo-sqlite

Compare `sqlite_version()` on the phone with `node:sqlite` in the verify environment before trusting a JSON1 edge case.

The comment in `native/src/session/sqlite-storage.js` names SQLite 3.53.4 for "a `json_extract` array stays an array inside `json_set`." The audit names a Node SQLite 3.50.0 probe for clear and rollback. Those notes are not the phone's version. The production `json()` wrap stays either way. See [architecture.md](architecture.md).

## Per-side sets

- `row.done` is true only when both L and R are done.
- A commit that does not send `sides` ticks both.
- A commit that sends `sides` keeps those ticks.
- Adding a copy of a per-side set clears both ticks.
