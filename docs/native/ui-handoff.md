# UI handoff

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

- SF Symbols
- Liquid Glass labels
- Focus
- The native tab bar versus the dock
- Dynamic Type
- Reduced motion
- Haptics

## What passed earlier

A clean install passed earlier. The Metro export passed earlier. The export still needed `EXPO_NO_TYPESCRIPT_SETUP=1`.

That is not iPhone validation. Device rendering was not checked for this handoff.
