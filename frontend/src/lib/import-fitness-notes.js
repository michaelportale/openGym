import { importId, priorCustom } from './import-csv.js'
import { EXIDX } from './exercises.js'
import { convertWeight } from './units.js'

const normalize = value => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim()
const missing = value => !value || /^(unreported|unknown|not reported|n\/a|—|-)$/i.test(value)
const unknownTraining = () => ({ role: null, primary: [], secondary: [], status: 'unknown' })
const numberOf = (value, integer = false) => missing(value) ? null : /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value) && Number.isFinite(Number(value)) && (!integer || Number.isInteger(Number(value))) ? Number(value) : NaN
const dateOK = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(value + 'T12:00:00Z')) && new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) === value
const volume = entries => entries.reduce((sum, e) => sum + e.sets.reduce((n, s) => n + (s.phase === 'warmup' || s.sourceLoad?.physical === false ? 0 : (s.w || 0) * (s.r || 0)), 0), 0)
const unitOf = basis => /\bkg\b/i.test(basis) ? 'kg' : /\blbs?\b/i.test(basis) ? 'lb' : null
const conventionOf = basis => /\bsetting\b/i.test(basis) ? 'machine-setting'
  : /per hand/i.test(basis) ? 'db-per-hand' : /per side/i.test(basis) ? 'plate-per-side'
    : /\btotal\b/i.test(basis) ? 'total' : null
const cells = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'))
const headers = {
  'Actual warm-ups': ['Exercise', 'Order', 'Equipment / attachment', 'Load', 'Units / per-hand, per-side, or total', 'Actual reps', 'Evidence / source'],
  'Actual working sets': ['Exercise / variant', 'Set', 'Equipment / attachment', 'Load', 'Units / load convention', 'Actual reps', 'Effort / form, if reported', 'Evidence / source'],
  'Planned targets — not completed work': ['Exercise / variant', 'Equipment / attachment', 'Load and units / convention', 'Planned sets and reps', 'Rationale / prior source'],
}

/** Only the documented tables are evidence. Narrative and prescriptions never become sets. */
export function parseFitnessNotes(files) {
  const workouts = [], proposedRoutines = [], warnings = [], customs = new Map(), sources = new Map(), conflicts = new Set()
  for (const file of files) {
    const warn = reason => warnings.push(`${file.name}: ${reason}`)
    const text = String(file.text || '').replace(/\r\n/g, '\n')
    const front = text.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)
    if (!front) { warn('Expected workout frontmatter and documented actual tables.'); continue }
    const meta = Object.fromEntries(front[1].split('\n').filter(l => /^[a-z_]+:/.test(l)).map(l => {
      const at = l.indexOf(':'); return [l.slice(0, at), l.slice(at + 1).trim().replace(/^(['"])(.*)\1$/, '$2')]
    }))
    if (meta.type !== 'workout' || !dateOK(meta.date) || !meta.source_session_key) { warn('Missing or invalid type, local date, or source_session_key.'); continue }
    const sourceKey = 'fitness-notes:' + meta.source_session_key
    const sections = new Map()
    let section = null
    for (const line of text.slice(front[0].length).split('\n')) {
      const heading = line.match(/^## (.+?)\s*$/)
      if (heading) { section = heading[1]; if (!sections.has(section)) sections.set(section, []); else warn('Repeated section: ' + section) }
      else if (section) sections.get(section).push(line)
    }
    const entries = new Map(), plan = [], setups = new Map()
    const identity = (name, setup, basis) => {
      const key = [name, setup, basis].map(normalize).join('|')
      const id = importId('fnx', key)
      if (!customs.has(id)) customs.set(id, { id, n: `${name} — ${setup || '?'} [${basis || '?'}]`, custom: true, eq: 'custom', tg: '', desc: '', sourceName: name, sourceEquipment: setup, sourceBasis: basis })
      return id
    }
    for (const [heading, expected] of Object.entries(headers)) {
      const lines = sections.get(heading) || []
      const tableStart = lines.findIndex(l => l.trim().startsWith('|'))
      if (tableStart < 0) continue
      const header = cells(lines[tableStart]), divider = cells(lines[tableStart + 1] || '')
      if (JSON.stringify(header) !== JSON.stringify(expected) || divider.length !== expected.length || divider.some(c => !/^:?-{3,}:?$/.test(c))) { warn('Unsupported table header in ' + heading); continue }
      for (const line of lines.slice(tableStart + 2).filter(l => l.trim().startsWith('|'))) {
        const row = cells(line)
        if (row.length !== expected.length || !row[0]) { warn('Malformed row in ' + heading); continue }
        if (heading.startsWith('Planned')) {
          const [name, setup, basis, prescription, evidence] = row
          const match = prescription.match(/^(\d+)\s*[×x]\s*(\d+)(?:\s*[–-]\s*(\d+))?$/)
          const [sets, lower, upper] = match ? [Number(match[1]), Number(match[2]), Number(match[3] || match[2])] : []
          // Import support follows the 10-set pyramid/triple caps and CSV's 1000-rep ceiling.
          if (!match || ![sets, lower, upper].every(Number.isSafeInteger) || sets < 1 || sets > 10 || lower < 1 || upper < lower || upper > 1000) { warn('Baseline prescription needs 1–10 sets × 1–1000 reps, with an ordered rep range.'); continue }
          const id = identity(name, setup, basis.replace(/^\d+(?:\.\d+)?\s*/, ''))
          plan.push({ id, sets, reps: upper, ...(match[3] ? { repsMin: lower } : {}), note: [basis, evidence].filter(Boolean).join(' · '), trainingSnapshot: unknownTraining() })
          continue
        }
        if (meta.status !== 'complete') continue
        const [name, ordinal, reportedSetup, load, basis, reps] = row
        const w = numberOf(load), r = numberOf(reps, true)
        if (!Number.isInteger(numberOf(ordinal, true)) || Number(ordinal) < 1 || Number.isNaN(w) || Number.isNaN(r)) { warn('Unsupported actual numeric form in ' + heading + '; row skipped.'); continue }
        let setup = reportedSetup
        if (/^same (setup|machine)$/i.test(setup)) {
          setup = setups.get(normalize(name)) || ''
          if (!setup) warn('Unresolved setup reference for ' + name)
        } else if (!missing(setup)) setups.set(normalize(name), setup)
        if (missing(setup)) setup = ''
        const id = identity(name, setup, basis), unit = unitOf(basis), phase = heading === 'Actual warm-ups' ? 'warmup' : 'work'
        if (!entries.has(id)) entries.set(id, { id, name, sets: [], note: '', trainingSnapshot: unknownTraining(), equipmentSnapshot: { stationId: null, label: setup, loadConvention: conventionOf(basis), unit, status: 'unknown', sourceBasis: basis } })
        const e = entries.get(id), effort = phase === 'work' ? row[6] : '', evidence = row.at(-1)
        const form = !missing(effort) ? effort : ''
        e.sets.push({ w, r, done: true, phase, sourceOrder: +ordinal, sourceEquipment: reportedSetup, loadUnit: unit, sourceLoad: { value: w, unit, basis, physical: !!unit && !!conventionOf(basis) && conventionOf(basis) !== 'machine-setting' }, ...(form ? { note: form } : {}), ...(evidence ? { sourceEvidence: evidence } : {}) })
        if (form) e.note = [e.note, form].filter(Boolean).join(' · ')
      }
    }
    const work = [...entries.values()]
    const note = (sections.get('Drop sets, supersets, and substitutions') || []).filter(line => line.trim()).join('\n')
    const workout = work.length ? { id: importId('fnw', sourceKey), sourceKey, historicalImport: true, d: meta.date, timezone: meta.timezone || null, start: null, end: null, routineId: null,
      sourceMetadata: { loadUnit: meta.load_unit || null, loadUnitBasis: meta.load_unit_basis || null, programSlot: meta.program_slot || null }, name: meta.session || 'Imported', dataStatus: meta.data_status || null, entries: work, prs: [], volumePartial: work.some(e => e.sets.some(s => s.phase === 'work' && (s.sourceLoad.physical === false || s.w == null || s.r == null))), vol: volume(work), ...(note ? { note } : {}) } : null
    const proposal = plan.length ? { id: importId('fnr', sourceKey), name: `${meta.session || meta.date} — baseline proposal`, sourceKey, ex: plan, importedProposal: true } : null
    const fingerprint = importId('fnf', JSON.stringify([workout, proposal]))
    if (sources.has(sourceKey)) {
      if (sources.get(sourceKey) !== fingerprint) { conflicts.add(sourceKey); warn('Source key conflict; conflicting copies excluded: ' + sourceKey) }
      continue
    }
    sources.set(sourceKey, fingerprint)
    if (workout) workouts.push({ ...workout, sourceFingerprint: fingerprint })
    else warn(meta.status !== 'complete' ? 'Session is not complete; no history imported.' : 'No supported actual rows; no history imported.')
    if (proposal) proposedRoutines.push(proposal)
  }
  const acceptedWorkouts = workouts.filter(w => !conflicts.has(w.sourceKey)), proposals = proposedRoutines.filter(r => !conflicts.has(r.sourceKey))
  const used = new Set([...acceptedWorkouts.flatMap(w => w.entries.map(e => e.id)), ...proposals.flatMap(r => r.ex.map(e => e.id))])
  return { kind: 'fitness-notes', workouts: acceptedWorkouts, proposedRoutines: proposals, warnings, sourceKeys: acceptedWorkouts.map(w => w.sourceKey), customEx: [...customs.values()].filter(c => used.has(c.id)) }
}

/** Same collision rule as commit; a correction is a conflict requiring review, never overwrite. */
export function fitnessNotesPreview(state, parsed) {
  let fresh = 0, duplicates = 0, conflicts = 0
  const seen = new Map((state.workouts || []).filter(w => w.sourceKey).map(w => [w.sourceKey, w.sourceFingerprint]))
  for (const w of parsed.workouts) {
    if (!seen.has(w.sourceKey)) { fresh++; seen.set(w.sourceKey, w.sourceFingerprint) }
    else if (seen.get(w.sourceKey) === w.sourceFingerprint) duplicates++
    else conflicts++
  }
  return { fresh, duplicates, conflicts }
}

/** Resolve only explicitly approved mappings; keep snapshots unknown even on a catalogue id. */
export function prepareFitnessNotes(parsed, state, { mappings = {}, proposalIds = [] } = {}) {
  const idMap = Object.fromEntries(parsed.customEx.map(c => {
    const approved = mappings[c.id]
    const known = approved && (EXIDX[approved] || state.customEx?.find(x => x.id === approved) || parsed.customEx.find(x => x.id === approved))
    return [c.id, known ? approved : priorCustom(state.customEx, c.id, c.n)?.id || c.id]
  }))
  const workouts = parsed.workouts.map(w => ({ ...w, entries: w.entries.map(e => {
    const source = e.equipmentSnapshot, convert = source.loadConvention !== 'machine-setting' && source.unit && source.unit !== state.unit
    return { ...e, id: idMap[e.id], equipmentSnapshot: { ...source, unit: convert ? state.unit : source.unit }, sets: e.sets.map(s => ({ ...s, loadUnit: convert ? state.unit : s.loadUnit, w: convert ? convertWeight(s.w, source.unit, state.unit) : s.w })) }
  }) }))
  workouts.forEach(w => { w.vol = volume(w.entries) })
  return { ...parsed, workouts, customEx: parsed.customEx, routines: parsed.proposedRoutines.filter(r => proposalIds.includes(r.id)).map(r => ({ ...r, ex: r.ex.map(e => ({ ...e, id: idMap[e.id] })) })) }
}
