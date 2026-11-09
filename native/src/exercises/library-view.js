// The Exercises list's view model: rows, filter chips and close matches. Pure, so the tab
// renders it and the Phase 7C picker can reuse it. Ports frontend/src/views/Library.jsx.
import { exercises, libraryFilter, favourites, equipment } from '../shared/training.js'
import { cap } from '../sync/source.js'

const SIMILAR_LIMIT = 30

export function libraryView({ state, q = '', bp = '', cat = '', eq = '', showAll = false }) {
  const S = state || {}
  const searching = !!q.trim()
  const { catOpts, catOn, eqOpts, eqOn, list } = libraryFilter.libraryFilter({ S, q, bp, cat, eq, showAll })
  const sorted = searching
    ? favourites.sortYoursFirst(list, S, favourites.usageOf(S))
    : favourites.sortFavouritesFirst(list, S)
  const row = ex => ({
    id: ex.id,
    name: cap(ex.n),
    sub: `${ex.tg} · ${ex.eq}`,
    yours: exercises.isCustomEx(ex),
    fav: favourites.isFav(S, ex.id),
  })
  const profileActive = !!equipment.activeProfile(S)
  let similar = []
  if (searching && sorted.length === 0) {
    const pool = exercises.allExercises(S).filter(e =>
      (!bp || e.bp === bp) && (!profileActive || showAll || equipment.exAvailable(S, e)))
    similar = exercises.similarExercises(pool, q, [], SIMILAR_LIMIT).map(row)
  }
  return {
    rows: sorted.map(row),
    bodyParts: ['', ...exercises.BODYPARTS],
    catOpts, catOn, eqOpts, eqOn,
    profileActive,
    similar,
  }
}
