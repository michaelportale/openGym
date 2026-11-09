// The model behind one exercise's screen: lookup, tags, animation URLs from the user's own
// server, best and last-session lines, and the media credit. Pure; the screen renders it.
import { exercises, history } from '../shared/training.js'
import { cap } from '../sync/source.js'

export const MEDIA_CREDIT = 'Exercise media © Aliaksandr Makatserchyk, Gym visual, gymvisual.com. Media licensed for use in openGym only; see NOTICE.md'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function findExercise(state, id) {
  const stored = (state?.customEx || []).find(e => e && e.id === id)
  if (stored) return stored
  const ex = exercises.EXIDX[exercises.canonicalExId(id)]
  // EXIDX also holds registered customs; one no longer in state.customEx is gone.
  return ex && !exercises.isCustomEx(ex) ? ex : null
}

const join = (server, path) => `${server.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`

// 'YYYY-MM-DD' -> 'Nov 9, 2026', from the parts so no time zone can shift the day.
function shortDate(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || '')
  return m ? `${MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}` : String(d || '')
}

export function exerciseDetail({ state, id, server }) {
  const ex = findExercise(state, id)
  if (!ex) return null
  const S = state || {}
  // Stored customs can lose their flag, so where it was found counts first.
  const custom = (S.customEx || []).includes(ex) || exercises.isCustomEx(ex)
  const withWorkouts = {
    ...S,
    workouts: (S.workouts || []).map(w => ({ ...w, entries: w.entries || [] })),
  }
  const figure = exercises.figureOf(S)
  const media = custom || !server || S.gifSize === 'off' ? null : {
    still: join(server, exercises.imgSrc(ex, figure)),
    clip: join(server, exercises.gifSrc(ex, figure)),
  }
  const bestW = history.bestWeightFor(withWorkouts, ex.id)
  const entry = history.lastEntryFor(withWorkouts, ex.id)
  let last = null
  if (entry) {
    const s = entry.sets?.[0]
    last = `Last time: ${shortDate(entry.d)}` + (s && s.w > 0 && s.r > 0 ? ` · ${s.w} lb × ${s.r}` : '')
  }
  return {
    id: ex.id,
    name: cap(ex.n),
    custom,
    tags: [ex.bp, ex.tg, ex.eq, ex.cat, ...exercises.smOf(ex)].filter(Boolean),
    media,
    best: bestW > 0 ? `Best: ${bestW} lb` : null,
    last,
    credit: MEDIA_CREDIT,
  }
}
