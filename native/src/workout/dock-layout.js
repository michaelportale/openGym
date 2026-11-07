import { touch } from '../theme/tokens.js'

const MIN_VISIBLE_ROWS = 3

// Pinned, the header and dock hold still and only the gap between them scrolls.
// At the largest text sizes that gap vanishes, so everything scrolls together instead.
// Both measure the same either way, so the answer cannot flip back and forth.
export function dockFits({ screen, head, dock }) {
  if (!screen) return true
  return screen - head - dock >= MIN_VISIBLE_ROWS * touch.primary
}
