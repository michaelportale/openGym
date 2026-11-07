# Native Phase 1 decisions

Scope: the five-tab shell, the existing visual system, and the Workout preview.
Phase 0 versions, HealthKit, and the shared library stay as they are. Later phases own
logging, the science register, and the remaining tab features.

## Selected and unselected tab colours

Context. The reference shows the selected tab label and icon in icy blue and the other
tabs in secondary text. The shell painted every label with the secondary colour, so the
selected tab was distinguished by its icon only.

Options. Keep one secondary colour for every label. Or set `labelStyle.default` to
secondary and `labelStyle.selected` to accent, which Expo Router 58.0.30 accepts on the
tab host.

Why. Selection has to be visible in the label as well as the icon, using colours already
in the token set. Accent on the dark background clears the text contrast bar already
used for these tokens.

Revisit if. A check on the iPhone shows iOS ignoring `labelStyle.selected`. Do not add a
second tab bar to work around that in this phase.

## Pinning tab colours on iOS

Context. Liquid Glass recolours a tab item from the content behind it unless both
appearances are set. The shell pinned the label and the tint, and left icon colours as
plain values.

Options. Pin labels only. Or pin every tab-bar colour passed to the host, on iOS only,
with dark and light set to the same token. Other platforms keep the hex value so a web
preview does not depend on `DynamicColorIOS`.

Why. Selected and unselected colours should survive Liquid Glass, and a Linux preview
should still show them.

Revisit if. A device check shows the pinned icon colour fighting the system tint.

## Workout safe area

Context. Native tabs inset the first scroll view. The Workout preview pins its dock to
the bottom, so that tab turns automatic insets off and applies top and bottom insets
itself. The other four tabs keep the automatic inset.

Options. Use the same inset path on every tab. Or keep the exception on Workout only.

Why. One inset path would put the pinned dock under the tab bar or add a second inset
above it. The exception is already how this preview is built.

Revisit if. A device check shows the dock under the tab bar or a doubled bottom gap.

## Unbuilt destinations

Context. Home, Plan, Progress, and Exercises are not built. The PRD puts Plan, Progress,
and Exercises in Phase 7, and puts WHOOP in Phase 8. Home's next session and its
nutrition summary are not one phase: the workout flow and the remaining tabs own
different parts. The previous Home screen said the whole screen arrives in Phase 2.

Options. Keep "Arrives in Phase 2" for Home. Or say Home is not built, name what is
missing, and give a phase line only where the PRD assigns the whole destination.

Why. A single phase number for Home claims a schedule the PRD does not give it. The
status line stays "Not built yet". None of these screens record a workout.

Revisit if. A later phase takes ownership of the whole Home screen.

## Preview actions

Context. The preview uses sample rows and a bright "Complete set" control so the layout
matches the reference. The controls did nothing and did not say so at the point of
press. A silent press can be read as a failed save.

Options. Restyle the controls as disabled, which leaves the reference. Or leave the
press silent. Or keep the reference appearance, announce a preview hint, and on press
replace the notice with an unavailable result that records nothing.

Why. The preview has to look like the locked Workout screen and still be incapable of
claiming a log, a save, or a sync. The sample data is not copied into state, so a press
cannot change a set.

Revisit if. Phase 2 connects these controls to the journal. Until then the result stays
`unavailable`.

## Focus

Context. The native tab item exposes selection. Buttons also need a keyboard focus state
in the web preview without changing the resting iOS controls.

Options. Add a border to every button. Or draw an accent outline only while a button is
focused on web.

Why. An outline does not change the resting size or colour. iOS keeps the system focus
treatment.

Revisit if. A device check needs a visible focus style that web outline does not provide.

## Accessibility preferences a platform does not implement

Context. The preview asks whether motion and transparency are reduced. iOS can answer
both. The web preview can answer motion and has no transparency reader. Calling the
missing function threw, and the Workout screen did not render.

Options. Keep the call. Or treat a missing reader as a request for the reduced
treatment. Or start reduced only when a reader exists, and leave the treatment off
when the platform has no preference to report.

Why. A missing reader is not a request. Where a reader exists, the reduced treatment
still starts on until the platform answers. iOS behaviour for both preferences is
unchanged.

Revisit if. The web preview gains a transparency reader.

## Web preview of the native tab pill

Context. On the web host the five tabs are a fixed pill at the top of the screen.
Its built-in padding hides Exercises at a phone width, and the pill draws over the
title. iOS draws the tab bar itself and insets the screen.

Options. Replace the tab host on web. Or leave the titles underneath the pill.
Or keep the host, clear the title by a web-only top inset, and reduce only the
web pill's horizontal padding so all five names fit.

Why. The iOS bar stays the system bar. The preview can show every tab and the
title without a second navigator. The Workout screen also fills the panel.
Without that, the web column shrinks to the preview notice and the phone
width clips the dock.

Revisit if. The web host moves the pill or insets the screen itself.

## Symbols off iOS

Context. More, pause, add set, the done marks, and the up-next row use
`expo-symbols` with an SF Symbol name string. The installed non-iOS
`SymbolView` only draws a name when it is an object with an `android` or
`web` key. A string becomes null, and the view then renders `fallback`,
which these call sites do not pass. iOS uses the native SF Symbol view.

Options. Pass Material names in that object and load the icon font. Or
replace the symbol view on every platform. Or keep the SF Symbol on iOS
and draw a short text glyph on every other platform.

Why. iOS keeps the locked symbols. The other platforms need a mark that is
visible without a new dependency. The button and row labels stay the
accessible names. The glyph is decorative.

Revisit if. `expo-symbols` draws SF Symbol strings off iOS, or a device
check prefers the Material set to these glyphs.

## Header action

The ellipsis opens the existing diagnostics screen. It is not a workout action. Its hint
says "Opens diagnostics."
