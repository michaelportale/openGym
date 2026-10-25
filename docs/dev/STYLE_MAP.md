# Frontend style map

How `frontend/` styles things, measured at `main` `5dd3da32` (2026-10-22) before the theme work.
Re-run the colour numbers with `cd frontend && node scripts/color-audit.mjs`.

## Where styles live

| File | Lines | Loaded by | Role |
|---|---:|---|---|
| `src/index.css` | 2148 | `main.jsx` | The design system: `:root` tokens, light theme, accent presets, every shared component class |
| `src/coach.css` | 294 | `CoachChat.jsx`, `CoachIntake.jsx` | AI Coach screens |
| `src/admin.css` | 155 | `Admin.jsx` | Admin dashboard |
| `src/views/WorkoutLedger.css` | 120 | `main.jsx` | Workout screen (`body.no-tabbar`); redefines the surface and label tokens with its own green-tinted greys |
| `src/views/FocusView.css` | 91 | `main.jsx` | Focus view of a workout |
| `src/components/WorkoutReplacementSheet.css` | 34 | `main.jsx` | Swap sheet |
| `src/components/StrengthFeedback.css` | 23 | `main.jsx` | Strength feedback card |
| `src/components/RestTimer.css` | 20 | `main.jsx` | Rest timer dock |
| `src/components/Modals.css` | 16 | `main.jsx` | Sheet/modal helpers |

There is no CSS-in-JS library and no Tailwind. JSX uses `className` plus inline `style={{…}}`
(867 inline style objects in 38 files; 300 of them in `sheets.jsx`). SVG charts (`LineChart.jsx`,
`Heatmap.jsx`, `BodyMap.jsx`) take colours as `var(--…)` strings.

## How colour is switched today

- `index.css :root` holds the tokens: surfaces `--bg --bg-el --surface --surface-2 --surface-3`,
  text `--label --label-2 --label-3 --label-4`, lines `--sep --sep-op --hair`, the iOS system
  hues `--blue --green --red --orange --yellow --teal --indigo --pink --purple --mint --brown
  --grey`, the accent `--acc --acc-2 --on-acc --acc-soft --acc-line`, geometry `--r-* --pad`,
  motion `--ease --fast --med`.
- `<html data-theme="dark|light">` is set by `App.jsx applyPrefs` from the synced `theme` setting
  (`dark`, `light`, `system`). `TimerFlash.jsx` flips it for the rest-end flash.
- `<html data-accent="lime|sky|orange|violet|pink|red|teal|gold|custom">` is set by
  `lib/accent.js applyAccent`. The default accent is `lime`, i.e. `--acc: var(--green)`; a custom
  colour is written as inline custom properties on `<html>`.
- `index.html` has `<meta name="theme-color" content="#0c0e12">`, which `applyPrefs` overwrites
  with `#000000` (dark) or `#f2f2f7` (light). `public/manifest.json` has `#0c0e12` for both
  `theme_color` and `background_color`, so the installed app and the running app disagree.
- The PNG icons are lime (`#a3e635`) on `#0c0e12`. There are no iOS splash images.

## Hardcoded colours (before)

250 colour literals outside comments: 195 hex, 48 `rgb()/rgba()`, 0 `hsl()`, 0 named colours,
plus 7 distinct pixel colours in the two icons.

| Where | Total | Green | Other |
|---|---:|---:|---:|
| CSS custom-property values (`--x: …`) | 87 | 5 | 82 |
| Other CSS declarations | 81 | 1 | 80 |
| JS / JSX (inline styles, fallbacks, print sheet, presets) | 72 | 7 | 65 |
| `index.html` meta theme-color | 1 | 0 | 1 |
| `manifest.json` | 2 | 0 | 2 |
| Icon pixel colours | 7 | 5 | 2 |
| **All** | **250** | **18** | **232** |

Green literals: `index.css` `--green #30d158`, `--acc-2 #248a3d` (×3), light `--green #34c759`, the
own-colour rainbow `#30d158`; `format.js` lime preset `#30d158`; `sheets.jsx` share-card fallback
`#30d158`; `Settings.jsx` colour-input default `#30d158` (×2); `plan-share.js` print sheet olive
`#6a7a3a` (×2) and pale lime `#cfe08a`; icon pixels `#a3e635 #577a23 #31441a`.

Not counted as green by the hue rule but green-tinted: the 18 neutrals in `WorkoutLedger.css`
(hue ≈ 90–120°, saturation under 20%).

Green by reference rather than literal: 42 `var(--green)` uses in 14 files, and every accent use
(199 `var(--acc*)` references), because the default accent is `--acc: var(--green)`.
`var(--orange)`: 73 references.

Charts and scales: the activity heatmap mixes `--acc` into `--surface-2` (30/55/78/100%); the
fatigue heatmap uses yellow/orange/red; the effort (RIR) scale is purple, red, orange, yellow,
green, `--acc-2`; Stats set-type series are blue, green, orange, purple, pink.

Undefined custom properties (used, never defined, no fallback): `--line`
(`TrainingAdaptation.jsx` ×2), `--dim` (`index.css` ×2, `CoachSetup.jsx`), `--text-2`
(`sheets.jsx`), `--fill-3` (`Settings.jsx`).
