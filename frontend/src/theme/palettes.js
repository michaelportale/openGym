// The palettes the app can draw in (palettes.json, CSS in theme-<name>.css) and how a choice
// becomes attributes on <html>.
//
// <html data-theme> names what the page is drawn in: 'light', or in dark mode the palette's own
// name ('tide', 'ember', 'volt', 'chalk'), or 'dark' for Classic, the original look with no palette file.
// Every existing `[data-theme="light"]` rule and `=== 'light'` check keeps working unchanged.
// <html data-palette> always names the chosen palette, so light mode can still use its accent.
import data from './palettes.json'

export const CLASSIC = 'classic'
export const DEFAULT_PALETTE = data.default
export const PALETTES = [...data.palettes.map(p => p.name), CLASSIC]
// Translated in the locale packs; what Settings → Look shows.
export const PALETTE_NAMES = { tide: 'Tide', ember: 'Ember', volt: 'Volt', chalk: 'Chalk', [CLASSIC]: 'Classic' }

const byName = Object.fromEntries(data.palettes.map(p => [p.name, p.tokens]))
// The accent drawn while the accent setting is "From palette" (dark shade), for places outside
// CSS (the swatch, the native rest notification). Classic's is the original green.
export const PALETTE_ACCENT = { ...Object.fromEntries(data.palettes.map(p => [p.name, p.tokens.accent.toLowerCase()])), [CLASSIC]: '#30d158' }
// The page colour in dark mode, for <meta name="theme-color"> and the manifest.
export const PALETTE_BG = { ...Object.fromEntries(data.palettes.map(p => [p.name, p.tokens.bg0.toLowerCase()])), [CLASSIC]: '#000000' }
export const LIGHT_BG = '#f2f2f7'

/** The palette to draw: the stored one when known, otherwise the default. */
export const paletteKey = S => PALETTES.includes(S?.palette) ? S.palette : DEFAULT_PALETTE

/** The data-theme value for a resolved 'light' | 'dark' and a palette key. */
export const themeAttr = (mode, palette) => mode === 'light' ? 'light' : (byName[palette] ? palette : 'dark')

/** The dark data-theme value for the palette on `el` (TimerFlash flips to it from light). */
export const darkAttrOf = el => themeAttr('dark', el?.dataset?.palette)
