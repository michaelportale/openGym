// What typed weigh-ins go to Apple Health, decided without touching Health. Pure.

export const weightSyncId = (d) => 'opengym-bw-' + d

// Exactly the fields Health receives.
export const weightExportHash = (row) => `${row.w}|${row.t}`

// A day is in Health only while this phone's typed set is also the day's effective entry: a
// newer web edit or a deletion on the server means Health must not keep a weight the server rejected.
function qualifies(row, entry) {
  return row.op === 'set' && row.src == null && !!entry && entry.src == null && entry.t === row.t && entry.w === row.w
}

// rows: weighIns.list(); effectiveByDay: day -> the entry the server copy plus pending ops give.
export function planWeightExport({ rows, effectiveByDay, links, now }) {
  const linkOf = new Map(links.filter((l) => l.kind === 'bw').map((l) => [l.key, l]))
  const save = []
  const remove = []
  for (const row of rows) {
    const link = linkOf.get(row.d)
    linkOf.delete(row.d)
    if (!qualifies(row, effectiveByDay[row.d])) {
      if (link) remove.push({ key: row.d, syncId: link.syncId })
      continue
    }
    const hash = weightExportHash(row)
    const same = link && link.hash === hash
    if (same && link.state === 'exported') continue
    const stored = link && Number.isFinite(link.version) ? link.version : undefined
    // Health replaces only on a greater sync version, so a new plan always outranks the stored one.
    const version = stored === undefined ? now : same && link.state === 'pending' ? stored : Math.max(now, stored + 1)
    save.push({ key: row.d, syncId: weightSyncId(row.d), version, hash, w: row.w, at: row.t })
  }
  for (const l of linkOf.values()) remove.push({ key: l.key, syncId: l.syncId })
  return { save, remove }
}
