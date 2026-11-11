// Customs live in state.customEx and are read through EXIDX (a mode, a default, a session).
// healCustomEx only supplies the list registerCustom sees. A missing flag is not written back:
// the heal is not an edit, and the caller's entry stays the object it was.
import { exercises } from '../shared/training.js'

export function registerScreenCustoms(state) {
  const list = state && state.customEx
  // A document with no customEx list is not "no customs". registerCustom replaces the whole
  // index, so treating a missing key as empty would drop customs another screen just registered.
  if (!Array.isArray(list)) return
  exercises.registerCustom(exercises.healCustomEx(list))
}
