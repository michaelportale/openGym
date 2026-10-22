import { describe, expect, it } from 'vitest'
import { parseFitnessNotes, prepareFitnessNotes, fitnessNotesPreview } from './import-fitness-notes.js'
import { mergeImport } from './import-csv.js'
import { trainingCoverage } from './training-coverage.js'
import { fitnessNote } from '../test/fitness-notes.js'
const parse = (options = {}) => parseFitnessNotes([{name:'synthetic.md',text:fitnessNote(options)}])
const state = () => ({unit:'kg',workouts:[],customEx:[],routines:[],bodyweight:[],exWeights:{},queue:{ids:['keep'],since:1},rotation:{sequence:['keep']}})

describe('documented fitness notes', () => {
  it('imports actual phases with unknown reps, effort and times, retaining load and form evidence', () => {
    const p=parse(), w=p.workouts[0], e=w.entries[0]
    expect(p.workouts).toHaveLength(1)
    expect(e.sets).toHaveLength(3)
    expect(e.sets[0]).toMatchObject({phase:'warmup',r:6,w:3,done:true})
    expect(e.sets[2]).toMatchObject({phase:'work',r:null,w:6.5,done:true})
    expect(e.sets[2].rir).toBeUndefined()
    expect(w.start).toBeNull(); expect(w.end).toBeNull()
    expect(w.vol).toBe(58.5)
    expect(e.equipmentSnapshot).toMatchObject({stationId:null,unit:'kg',loadConvention:'db-per-hand',status:'unknown'})
    expect(e.trainingSnapshot).toEqual({role:null,primary:[],secondary:[],status:'unknown'})
    expect(e.note).toContain('Controlled eccentric')
    expect(e.note).toContain('incomplete attempted rep')
    expect(w.note).toContain('replaced Example cable raise')
    expect(JSON.stringify(w)).not.toContain('Unrelated private narrative')
    expect(p.proposedRoutines).toHaveLength(1)
    expect(p.proposedRoutines[0].ex).toHaveLength(1)
    expect(p.workouts[0].entries.some(x=>x.name==='Example cable raise')).toBe(false)
    const coverage=trainingCoverage({workouts:[w],window:{startDate:w.d,endDate:w.d}})
    expect(coverage.unknowns.actual.targetSets).toBe(2)
  })
  it('does not turn plans or incomplete sessions into completed work', () => {
    const plan=fitnessNote().replace(/## Actual warm-ups[\s\S]*?## Drop sets/, '## Drop sets')
    expect(parseFitnessNotes([{name:'plan.md',text:plan}]).workouts).toEqual([])
    expect(parse({status:'planned'}).workouts).toEqual([])
  })
  it.each([{reps:'8/7'}, {load:'6–8'}, {date:'2040-02-30'}, {key:''}])('rejects unsupported actual grammar or identity: %j', opts=>{
    const p=parse(opts)
    expect(p.warnings.length).toBeGreaterThan(0)
    if (opts.date || opts.key==='') expect(p.workouts).toHaveLength(0)
    else expect(p.workouts[0].entries[0].sets.every(s=>s.r!==8 && s.w!==6)).toBe(true)
  })
  it('rejects unknown headers and ignores tables outside actual sections', () => {
    const text=fitnessNote().replaceAll('Actual reps','Repetitions')
    const p=parseFitnessNotes([{name:'bad.md',text}])
    expect(p.workouts).toEqual([]); expect(p.warnings.join(' ')).toContain('bad.md')
  })
  it('deduplicates renamed sources but reports changed copies instead of accepting either', () => {
    const p=parseFitnessNotes([{name:'a.md',text:fitnessNote()},{name:'renamed.md',text:fitnessNote()}])
    expect(p.workouts).toHaveLength(1)
    const conflict=parseFitnessNotes([{name:'a.md',text:fitnessNote()},{name:'b.md',text:fitnessNote({reps:'8'})}])
    expect(conflict.workouts).toEqual([])
    expect(conflict.warnings.join(' ')).toMatch(/conflict/i)
  })
  it('keeps equipment and load basis distinct, and handles escaped pipes', () => {
    const p=parse({setup:'Cable \\| rope',convention:'lb displayed setting',exercise:'Example curl'})
    expect(p.workouts[0].entries[0].equipmentSnapshot).toMatchObject({label:'Cable | rope',loadConvention:'machine-setting',unit:'lb'})
    expect(p.workouts[0].entries[0].sets).toHaveLength(3)
    expect(parse({setup:'Different station'}).customEx[0].id).not.toBe(parse().customEx[0].id)
    expect(parse({convention:'kg total'}).customEx[0].id).not.toBe(parse().customEx[0].id)
  })
})

describe('fitness-note preview and merge', () => {
  it('uses source identity across same-day sessions and repeated import without affecting current plans', () => {
    const s=state(), p=parse(), q=parse({key:'synthetic-beta'})
    const before=structuredClone(s.queue)
    expect(mergeImport(s,prepareFitnessNotes(p,s)).added).toBe(1)
    expect(mergeImport(s,prepareFitnessNotes(q,s)).added).toBe(1)
    expect(fitnessNotesPreview(s,p)).toMatchObject({fresh:0,duplicates:1,conflicts:0})
    expect(mergeImport(s,prepareFitnessNotes(p,s)).added).toBe(0)
    expect(s.workouts).toHaveLength(2); expect(s.queue).toEqual(before)
    expect(s.routines).toEqual([])
    expect(s.exWeights[p.customEx[0].id]).toBeUndefined()
  })
  it('warns about corrections and never silently overwrites existing results', () => {
    const s=state();mergeImport(s,prepareFitnessNotes(parse(),s))
    const changed=parse({reps:'8'}), preview=fitnessNotesPreview(s,changed)
    expect(preview).toMatchObject({fresh:0,duplicates:0,conflicts:1})
    const result=mergeImport(s,prepareFitnessNotes(changed,s))
    expect(result.added).toBe(0); expect(result.conflicts).toBe(1)
    expect(s.workouts[0].entries[0].sets[2].r).toBeNull()
  })
  it('requires explicit mappings and proposal opt-in, retaining uncertainty on approved catalogue ids', () => {
    const s=state(), p=parse(), id=p.customEx[0].id
    const custom=prepareFitnessNotes(p,s)
    expect(custom.workouts[0].entries[0].id).toBe(id)
    expect(custom.routines).toEqual([])
    const approved=prepareFitnessNotes(p,s,{mappings:{[id]:'0047'},proposalIds:[p.proposedRoutines[0].id]})
    mergeImport(s,approved)
    expect(s.workouts[0].entries[0].id).toBe('0047')
    expect(s.workouts[0].entries[0].trainingSnapshot.status).toBe('unknown')
    expect(s.routines).toHaveLength(1)
    expect(s.rotation.sequence).toEqual(['keep']);expect(s.queue.ids).toEqual(['keep'])
    expect(s.workouts[0].entries[0].equipmentSnapshot.stationId).toBeNull()
  })
  it('reuses confirmed custom identities and converts physical units once without changing per-hand basis', () => {
    const s=state(), p=parse({convention:'lb per hand',load:'22'})
    s.customEx=[{...p.customEx[0],id:'existing'}]
    const prepared=prepareFitnessNotes(p,s)
    mergeImport(s,prepared)
    expect(s.workouts[0].entries[0]).toMatchObject({id:'existing',equipmentSnapshot:{unit:'kg',loadConvention:'db-per-hand'}})
    expect(s.workouts[0].entries[0].sets[1]).toMatchObject({w:10,sourceLoad:{value:22,unit:'lb',basis:'lb per hand'}})
    const machine=prepareFitnessNotes(parse({convention:'lb displayed setting',load:'22'}),s)
    expect(machine.workouts[0].entries[0].sets[1].w).toBe(22)
    expect(machine.workouts[0].entries[0].equipmentSnapshot.unit).toBe('lb')
  })
})

it('renders source units and missing repetitions without claiming zero or a different load basis', async () => {
  const {setLabel}=await import('./history.js')
  const e=parse({convention:'lb per hand',load:'22'}).workouts[0].entries[0]
  expect(setLabel(e.id,e.sets[2])).toBe('22 lb per hand × ?')
})

it.each(['2040-13-03','2040-00-03'])('rejects invalid calendar dates without throwing: %s',date=>{
  const p=parse({date});expect(p.workouts).toEqual([]);expect(p.warnings.length).toBeGreaterThan(0)
})
it('keeps explicit unknown loads and zero reps distinct',()=>{
  const e=parse({load:'Unknown',reps:'0'}).workouts[0].entries[0]
  expect(e.sets[1].w).toBeNull();expect(e.sets[2].r).toBe(0)
})

it('lets preview explicitly unite aliases within this batch without equating equipment automatically',()=>{
  const p=parseFitnessNotes([{name:'a.md',text:fitnessNote()},{name:'b.md',text:fitnessNote({key:'synthetic-beta',exercise:'Example raise alias'})}])
  const ids=p.workouts.map(w=>w.entries[0].id),s=state()
  const chosen=prepareFitnessNotes(p,s,{mappings:{[ids[1]]:ids[0]}})
  mergeImport(s,chosen)
  expect(s.workouts.map(w=>w.entries[0].id)).toEqual([ids[0],ids[0]])
  expect(s.customEx.filter(c=>c.id===ids[0])).toHaveLength(1)
})
it('reads converted and subsequently edited weights in the current unit while preserving source provenance',async()=>{
  const {setLabel}=await import('./history.js')
  const p=prepareFitnessNotes(parse({load:'22',convention:'lb per hand'}),state())
  const e=p.workouts[0].entries[0]
  expect(setLabel(e.id,e.sets[2])).toBe('10 kg per hand × ?')
  expect(setLabel(e.id,{...e.sets[2],w:12})).toBe('12 kg per hand × ?')
  expect(e.sets[2].sourceLoad.value).toBe(22)
})
it('preserves frontmatter load provenance without inventing a total for an unspecified bar mass',()=>{
  const text=fitnessNote({convention:'lb as reported; bar-mass inclusion unspecified'}).replace('load_unit: kg','load_unit: lb\nload_unit_basis: user_report')
  const p=parseFitnessNotes([{name:'example.md',text}])
  expect(p.workouts[0].sourceMetadata).toMatchObject({loadUnit:'lb',loadUnitBasis:'user_report'})
  expect(p.workouts[0].entries[0].equipmentSnapshot.loadConvention).toBeNull()
})

it('retains all referenced custom definitions when preview mappings cross each other',()=>{
  const p=parseFitnessNotes([{name:'a.md',text:fitnessNote()},{name:'b.md',text:fitnessNote({key:'synthetic-beta',exercise:'Example alias'})}]),s=state()
  const [a,b]=p.workouts.map(w=>w.entries[0].id)
  mergeImport(s,prepareFitnessNotes(p,s,{mappings:{[a]:b,[b]:a}}))
  expect(s.workouts.every(w=>s.customEx.some(c=>c.id===w.entries[0].id))).toBe(true)
})

it('rejects non-finite actual numbers before JSON persistence can turn them into null',()=>{
  const p=parse({load:'9'.repeat(400)})
  expect(p.warnings.length).toBeGreaterThan(0)
  expect(p.workouts[0].entries.flatMap(e=>e.sets).every(s=>s.w==null||Number.isFinite(s.w))).toBe(true)
})

it('keeps machine settings and unresolved load bases out of physical load totals and estimates while retaining history',async()=>{
  const {workoutVolume,bestWeightForEntry}=await import('./history.js')
  const {bestSetOf}=await import('./onerm.js')
  const {exerciseHistory}=await import('./exercise-history.js')
  for(const convention of ['lb displayed setting','as reported; unit unknown','lb as reported; bar-mass inclusion unspecified']){
    const p=parse({convention,load:'22'}),w=p.workouts[0],e=w.entries[0]
    expect(w.vol).toBe(0);expect(w.volumePartial).toBe(true)
    expect(workoutVolume(w)).toBe(0)
    expect(bestWeightForEntry(e)).toBe(0)
    expect(bestSetOf(e)).toBeNull()
    const h=exerciseHistory({workouts:[w],customEx:p.customEx},e.id)
    expect(h.total).toBe(1);expect(h.sessions[0].sets).toHaveLength(2)
    expect(h.metric).toBe('reps');expect(h.e1rmPoints).toEqual([])
  }
})
it('labels an incomplete physical load total in text export while retaining all actual rows',async()=>{
  const {workoutText}=await import('./workout-text.js')
  const p=parse(),w=p.workouts[0]
  expect(w.volumePartial).toBe(true)
  expect(workoutText(w,{unit:'kg',nameOf:e=>e.name})).toContain('Partial load total')
})

// A malformed plan must never become an executable routine with an unbounded row count.
it.each([
  '9'.repeat(400)+' × 5', '3 × '+'9'.repeat(400),
  '9007199254740992 × 5', '11 × 5', '3 × 1001', '3 × 8–1001',
])('rejects unsupported baseline counts before constructing a routine: %s', prescription=>{
  const text=fitnessNote().replace('4 × 5–7',prescription)
  const p=parseFitnessNotes([{name:'synthetic-plan.md',text}])
  expect(p.proposedRoutines).toEqual([])
  expect(p.warnings.some(w=>/prescription|baseline/i.test(w))).toBe(true)
})
it.each([['3 × 8–12',3,8,12],['10 × 1–1000',10,1,1000]])('retains supported bounded baseline prescription %s',(prescription,sets,repsMin,reps)=>{
  const p=parseFitnessNotes([{name:'synthetic-plan.md',text:fitnessNote().replace('4 × 5–7',prescription)}])
  expect(p.proposedRoutines[0].ex[0]).toMatchObject({sets,repsMin,reps})
  expect(p.warnings).toEqual([])
})
