/**
 * Opt-in copy of routines that stored the old reps default.
 * A routine whose own prog is 'linear' is copied with prog 'double'.
 * Exercise-level prog is left as stored. Nothing calls this on its own.
 */
export function migrateLinearRoutines(routines) {
  if (!Array.isArray(routines)) return []
  return routines.map(routine => {
    if (!routine || routine.prog !== 'linear') return routine
    return { ...routine, prog: 'double' }
  })
}
