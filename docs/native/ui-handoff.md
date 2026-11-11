# UI handoff

Archived on 2026-11-11 as `archive/pr-106`. Unless explicitly updated below, this document describes the historical #105 snapshot `ed4fdc288`, not the current app or current work instructions. T2 and T3 subsequently merged in #107 (`11db2ec37`) and #108 (`e1c9a7bf2`), both present at `c5d6e8dbf`. No new implementation or device validation is authorized or claimed by this archive.

For Gus. The journal lane does not mount screens.

## What is merged

The shell and the symbol fixes are on `native/phase-1`. No iPhone validation is claimed for any of them.

From the merged PR list:

- #44 native: lock the five-tab shell and Workout preview
- #50 native: show a glyph when SF Symbols are not drawn
- #59 native: let iOS draw a symbol that has no text glyph
- #61 native: keep the symbol scanner out of the app tree

`docs/sprints/2026-11-native-phase-1-decisions.md` records the shell choices: selected tab colour, Liquid Glass label and icon colours, the Workout safe area, preview presses that record nothing, web-only focus outline, missing accessibility readers, the web tab pill, and symbols off iOS. Those are decisions in the repo. They are not a device pass.

The Workout tab is still the preview in `native/src/app/(tabs)/workout.js`. A press uses `preview-actions.js` and records nothing. Do not wire `useActiveSession` into it from the journal lane.

## Still to check on the iPhone

Word for word:

> the shell and symbol fixes are merged, but NO iPhone validation is claimed. Still to check on the iPhone: SF Symbols, Liquid Glass labels, focus, the native tab bar vs the dock, Dynamic Type, reduced motion, and haptics. A clean install and the Metro export passed earlier, but the export still needed `EXPO_NO_TYPESCRIPT_SETUP=1`.

No iPhone validation is claimed. Do not write that any of those checks passed on a phone.

## What passed earlier

A clean install passed earlier. The Metro export passed earlier. The export still needed `EXPO_NO_TYPESCRIPT_SETUP=1`.

`native/package.json` has no export script. The environment variable is recorded. The export argv is not in this repo. Do not invent it.

That is not iPhone validation. Device rendering was not checked for this handoff.
