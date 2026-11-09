// The other file in native/ that may import from frontend/: the English steps and descriptions of the
// exercises (about 2.4 MB of text). The import() paths are literals so scripts/check-shared-lib.mjs
// follows them. They are dynamic so Metro evaluates the packs on the first call, not at app launch.
import { i18nCore } from './training.js'

let loading = null

// Resolves true once instrFor / descFor can answer, false if a pack failed to load (a later call retries).
export function loadExerciseText() {
  if (!loading) {
    loading = Promise.all([
      import('../../../frontend/src/instr/en.js'),
      import('../../../frontend/src/exercise-desc/en.js'),
    ]).then(([instr, descs]) => {
      i18nCore._setDetails(instr.default, descs.default, null, 'en')
      return true
    }).catch(() => {
      loading = null
      return false
    })
  }
  return loading
}
