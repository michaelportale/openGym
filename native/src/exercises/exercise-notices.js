// Sentences for a custom exercise the phone could not send. They render on the Exercises tab.
// A routine's "move or swap" line does not belong here: a custom exercise has no slot to move.
import { isRoutineDeleted } from '../sync/edit-guard.js'

const FALLBACK = 'this exercise'
const FALLBACK_START = 'This exercise'

const EDIT = {
  changed: name => `Your change to ${name} wasn't sent: it was changed on the web first.`,
  deleted: name => `Your change to ${name} wasn't sent: it was deleted on the web.`,
  unsafe: name => `Your change to ${name} wasn't sent: it couldn't be sent safely.`,
}
const LINES = {
  edit: EDIT,
  create: {
    changed: EDIT.changed,
    deleted: (name, Name) => `${Name} wasn't added: an exercise with that id was deleted on your server.`,
    unsafe: (name, Name) => `${Name} wasn't added: it couldn't be sent safely. Try adding it again.`,
  },
  delete: {
    changed: (name, Name) => `${Name} changed on the web, so it wasn't deleted.`,
  },
}

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)
// A blank or whitespace-only string is not a name. The stored text is kept as it is.
const named = s => typeof s === 'string' && s.trim() !== ''

function exerciseName(row, state, key) {
  if (isMap(row?.value) && named(row.value.n)) return row.value.n
  const list = Array.isArray(state?.customEx) ? state.customEx : []
  const found = list.find(e => e && e.id === key)
  if (named(found?.n)) return found.n
  return null
}

// One line per customEx notice, in the store's order. `op` is read from the pending row: a create
// is base 0, a delete is the marker, and anything else (including a missing row) is an edit. A
// reason this kind has no sentence for reads as changed. The name is the row's n, then the
// exercise still in state, then "this exercise". Only that fallback is capitalised to open a sentence.
export function exerciseNoticeLines(notices, rows, state) {
  const stored = (Array.isArray(rows) ? rows : []).filter(isMap)
  return (Array.isArray(notices) ? notices : []).filter(n => n && n.kind === 'customEx').map(n => {
    const row = stored.find(r => r.kind === n.kind && r.key === n.key)
    const op = row?.baseTs === 0 ? 'create' : isRoutineDeleted(row?.value) ? 'delete' : 'edit'
    const name = exerciseName(row, state, n.key)
    const mid = name ?? FALLBACK
    const start = name ?? FALLBACK_START
    const lines = LINES[op]
    const text = (lines[n.reason] ?? lines.changed)(mid, start)
    return { key: n.key, text, dismissLabel: `Dismiss notice about ${mid}` }
  })
}

// Create, edit and delete need a server copy. Made on the snapshot, they would be sent into the
// real record at pairing. `copy` is the one readScreenSource hands back (null when unpaired).
export function canAuthorCustom(copy) {
  return copy != null
}
