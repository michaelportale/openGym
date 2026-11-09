// What goes to Apple Health, decided without touching Health. Pure.

export const workoutSyncId = (id) => 'opengym-w-' + id

export function exportable(doc) {
  return Number.isFinite(doc.start) && Number.isFinite(doc.end) && doc.end > doc.start
}

// Exactly the fields Health receives; built by hand so key order and JSON round trips cannot change it.
export const exportHash = (doc) => `${doc.start}|${doc.end}|${doc.vol}|${doc.volumePartial ? 1 : 0}`

export function planWorkoutExport({ rows, links, now }) {
  const linkOf = new Map(links.filter((l) => l.kind === 'w').map((l) => [l.key, l]))
  const save = []
  const skip = []
  for (const doc of rows) {
    const link = linkOf.get(doc.id)
    linkOf.delete(doc.id)
    const hash = exportHash(doc)
    if (!exportable(doc)) {
      if (!(link && link.state === 'skipped' && link.hash === hash)) skip.push({ key: doc.id })
      continue
    }
    const same = link && link.hash === hash
    if (same && link.state === 'exported') continue
    const version = same && link.state === 'pending' ? link.version : now
    save.push({ key: doc.id, syncId: workoutSyncId(doc.id), version, hash, doc })
  }
  const remove = [...linkOf.values()].map((l) => ({ key: l.key, syncId: l.syncId }))
  return { save, remove, skip }
}
