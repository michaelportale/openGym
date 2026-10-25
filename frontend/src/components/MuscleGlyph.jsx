// A small body glyph naming the muscle an exercise trains, for exercise rows without a picture.
// Drawn for this app on the icon set's 24×24 grid (see Icon.jsx), cropped to the figure so it fills
// its tile: one shared, abstract figure in
// outline, with the target region filled. Back-view muscles add a spine line, so biceps and
// triceps, or quads and hamstrings, still read apart. Decoration only: the row already names the
// muscle, so the glyph is hidden from screen readers.
import { MUSCLES, muscleGroupsOf } from '../lib/muscles.js'

const FIGURE = <>
  <circle cx="12" cy="4.3" r="1.9" />
  <path d="M8.6 7.4h6.8l-.7 7.6H9.3Z" />
  <path d="M8.6 7.6 6.6 14.6M15.4 7.6l2 7" />
  <path d="M9.3 15 8.8 21M14.7 15l.5 6M12 15.6v5.4" />
</>
const SPINE = <path d="M12 8.2v6" />

// Filled regions. Each list is the shapes for one muscle; `back` marks a back-view muscle.
const R = {
  trapezius: { back: true, d: ['M9.7 7.4 12 6.2l2.3 1.2Z'] },
  deltoids: { d: ['M8.6 7.4a1.3 1.3 0 1 0 .2 2.4Z', 'M15.4 7.4a1.3 1.3 0 1 1-.2 2.4Z'] },
  chest: { d: ['M9 8.2h2.7v2.6H9.2Z', 'M12.3 8.2H15l-.2 2.6h-2.5Z'] },
  'upper-back': { back: true, d: ['M9 8h6l-.3 3.4H9.3Z'] },
  serratus: { d: ['M9.3 10.4h1v2.4h-.8Z', 'M14.7 10.4h-1v2.4h.8Z'] },
  biceps: { d: ['M8.5 8.6 7.3 12l1 .3 1-3.3Z', 'M15.5 8.6l1.2 3.4-1 .3-1-3.3Z'] },
  triceps: { back: true, d: ['M8.5 8.6 7.3 12l1 .3 1-3.3Z', 'M15.5 8.6l1.2 3.4-1 .3-1-3.3Z'] },
  forearm: { d: ['M7.3 12.2 6.5 14.7l.9.3.9-2.5Z', 'M16.7 12.2l.8 2.5-.9.3-.9-2.5Z'] },
  abs: { d: ['M10.9 10.6h2.2v4h-2.2Z'] },
  obliques: { d: ['M9.5 10.8h1v3.8h-.8Z', 'M14.5 10.8h-1v3.8h.8Z'] },
  'lower-back': { back: true, d: ['M9.6 12h4.8l-.2 2.8H9.8Z'] },
  gluteal: { back: true, d: ['M9.3 14.4H12v2.4H9.1Z', 'M12 14.4h2.7l.2 2.4H12Z'] },
  quadriceps: { d: ['M9.2 15.4h2.2v3.4H9Z', 'M12.6 15.4h2.2l.2 3.4h-2.4Z'] },
  hamstring: { back: true, d: ['M9.2 15.4h2.2v3.4H9Z', 'M12.6 15.4h2.2l.2 3.4h-2.4Z'] },
  adductors: { d: ['M11 15.2h2l-.4 3h-1.2Z'] },
  'hip-flexors': { d: ['M9.4 13.8l2 1.4H9.3Z', 'M14.6 13.8l-2 1.4h2.1Z'] },
  calves: { back: true, d: ['M8.9 18.4h1.6l-.2 2.2H8.8Z', 'M13.5 18.4h1.6l.1 2.2h-1.5Z'] },
  tibialis: { d: ['M8.9 18.4h1.6l-.2 2.2H8.8Z', 'M13.5 18.4h1.6l.1 2.2h-1.5Z'] },
  full: { d: ['M8.6 7.4h6.8l-.7 7.6H9.3Z'] },
}

/** The muscle a glyph shows for an exercise: its first canonical muscle, else the full figure. */
export function glyphMuscleOf(ex) {
  const m = muscleGroupsOf(ex)[0]
  return MUSCLES.includes(m) ? m : 'full'
}

export function MuscleGlyph({ muscle }) {
  const r = R[muscle] || R.full
  return <svg className="mglyph" viewBox="4.6 1.9 14.8 19.8" aria-hidden="true" focusable="false" data-muscle={muscle in R ? muscle : 'full'}>
    <g className="mglyph-fig">{FIGURE}{r.back && SPINE}</g>
    <g className="mglyph-on">{r.d.map(d => <path key={d} d={d} />)}</g>
  </svg>
}

export const GLYPH_MUSCLES = Object.keys(R)
