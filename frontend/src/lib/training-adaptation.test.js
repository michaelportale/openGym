import { describe, expect, it } from 'vitest'
import { proposeAdaptation, applyAdaptation, undoAdaptation, dispositionOf, setDisposition } from './training-adaptation.js'
import { queueDone, queueRemaining } from './queue.js'
import { refillAfter, chooseFixedWeek, chooseRotation, scheduleModeOf, saveRotation } from './rotation.js'
import { coverageForState } from './training-coverage.js'
import { mergeStates, stampChange } from './sync-merge.js'
import { effectiveRoutineIds } from './history.js'
const today = '2026-10-21'
const ts = d => new Date(d + 'T12:00:00').getTime()
const fixture = () => ({ routines: [
  { id: 'p', name: 'Push', ex: [{ id: '0047', sets: 3, reps: 8, stationId: 'preferred' }] },
  { id: 'u', name: 'Pull', ex: [{ id: '2330', sets: 3, reps: 10 }] },
  { id: 'l', name: 'Legs', ex: [{ id: '0043', sets: 3, reps: 8 }] },
], rotation: { id: 'rot', sequence: ['p', 'u', 'l'], label: 'PPL' }, queue: { ids: ['p', 'u', 'l'], since: ts('2026-10-18'), startsOn: '2026-10-18', rotationId: 'rot', strict: true }, week: {}, dayPlan: {}, workouts: ['p','u','l'].map((id,i) => ({ id: 'w'+i, routineId: id, d: '2026-10-'+(18+i), start: ts('2026-10-'+(18+i)), end: ts('2026-10-'+(18+i))+1000, entries: [{ id: ['0047','2330','0043'][i], sets: [{done: true}]}] })) })
const propose = (state, extra = {}) => proposeAdaptation({ state, today, availability: { dates: ['2026-10-22','2026-10-24'], totalSessions: 5, minutes: 75, baselineIds:{push:'p',pull:'u',legs:'l'} }, ...extra })
describe('accepted future adaptation', () => {
  it('marks a missed day explicitly without treating absence as missed or changing the accepted plan', () => {
    const s = fixture(), before = structuredClone(s)
    expect(dispositionOf(s, today)).toBe('unknown')
    setDisposition(s, today, 'missed', 10)
    expect(dispositionOf(s, today)).toBe('missed')
    const p = propose(s)
    expect(p.remainingSessions.map(r => r.kind)).toEqual(['upper', 'lower'])
    expect(s.queue).toEqual(before.queue)
    expect(s.workouts).toEqual(before.workouts)
    expect(s.routines).toEqual(before.routines)
  })
  it('accepts distinct future occurrences, preserving completed credit, original definition and provenance', () => {
    const s = fixture(), before = structuredClone(s), p = propose(s)
    const result = applyAdaptation(s,p)
    expect(result.error).toBeNull()
    expect(result.state.workouts).toEqual(before.workouts)
    expect(result.state.rotation).toEqual(before.rotation)
    expect(result.state.queue).toMatchObject({ since: before.queue.since, startsOn: before.queue.startsOn, strict: true, rotationId:'rot' })
    expect(queueDone(result.state)).toEqual(['p','u','l'])
    expect(queueRemaining(result.state)).toHaveLength(2)
    expect(new Set(result.state.queue.ids).size).toBe(5)
    expect(result.state.routines.find(r => r.id===queueRemaining(result.state)[0]).ex[0]).toMatchObject({id:'0047',stationId:'preferred',sets:3})
    expect(result.state.routines.slice(0,3)).toEqual(before.routines)
    expect(applyAdaptation(result.state,p).error).toBe('stale')
  })
  it('rejects newly completed work and relevant routine edits but ignores unrelated settings', () => {
    const s = fixture(), p = propose(s)
    const changed = structuredClone(s); changed.workouts.push({ id:'off', d:today, start:ts(today), entries:[] })
    expect(applyAdaptation(changed,p).error).toBe('stale')
    const edited = structuredClone(s); edited.routines[0].ex[0].sets=4
    expect(applyAdaptation(edited,p).error).toBe('stale')
    s.theme='dark'; s.routines.push({id:'irrelevant',ex:[]})
    expect(applyAdaptation(s,p).error).toBeNull()
  })
  it('undo restores only future planning and refuses to roll over a concurrent completion', () => {
    const s=fixture(), accepted=applyAdaptation(s,propose(s))
    accepted.state.theme='dark'
    const undone=undoAdaptation(accepted.state,accepted.undo)
    expect(undone.error).toBeNull()
    expect(undone.state.queue).toEqual(s.queue)
    expect(undone.state.workouts).toEqual(s.workouts)
    expect(undone.state.theme).toBe('dark')
    accepted.state.workouts.push({id:'new',d:today,start:ts(today),routineId:queueRemaining(accepted.state)[0],entries:[]})
    expect(undoAdaptation(accepted.state,accepted.undo).error).toBe('stale')
  })
  it('can add a later sixth day from the original PPL templates without compounding UL copies', () => {
    const s=fixture(), accepted=applyAdaptation(s,propose(s)).state
    const p=propose(accepted,{availability:{dates:['2026-10-22','2026-10-23','2026-10-24'],totalSessions:6,minutes:75}})
    expect(p.remainingSessions.map(r=>r.kind)).toEqual(['push','pull','legs'])
    const result=applyAdaptation(accepted,p)
    expect(result.error).toBeNull()
    expect(queueRemaining(result.state)).toHaveLength(3)
    expect(result.state.rotation).toEqual(s.rotation)
  })
  it('bounds duration and explains work deferred instead of squeezing rest or inventing unknown metadata', () => {
    const s=fixture(); s.routines[0].ex.push({id:'mystery',sets:3,stationId:'keep-me'})
    const p=propose(s,{availability:{dates:['2026-10-22','2026-10-24'],totalSessions:5,minutes:5,baselineIds:{push:'p',pull:'u',legs:'l'}}})
    expect(p.estimatedMinutes.every(n=>n<=5)).toBe(true)
    expect(p.shortfalls.some(x=>x.code==='time')).toBe(true)
    expect(p.shortfalls.some(x=>x.code==='unknown')).toBe(true)
    expect(p.remainingSessions.flatMap(r=>r.deferred).some(e=>e.id==='mystery' && e.stationId==='keep-me')).toBe(true)
  })
  it('uses actual rolling coverage including off-program work without advancing the queue', () => {
    const s=fixture(); s.workouts=[]
    const before=propose(s)
    s.workouts.push({id:'off',d:today,start:ts(today),entries:[{id:'0047',sets:[{done:true}]}]})
    const after=propose(s)
    expect(queueDone(s)).toEqual([])
    expect(after.coverageGaps.chest.directDays).toBe(1)
    expect(before.coverageGaps.chest.directDays).toBe(2)
    expect(coverageForState(s,today).cycle.byMuscle.chest.actual.gap.directDays).toBeNull()
  })
  it('completed adapted pass returns to reusable rotation', () => {
    const s=applyAdaptation(fixture(),propose(fixture())).state
    const ids=queueRemaining(s)
    for (const [i,id] of ids.entries()) s.workouts.push({id:'future'+i,routineId:id,d:'2026-10-24',start:ts('2026-10-24')+i,entries:[]})
    expect(refillAfter(s,s.workouts.at(-1),'2026-10-24',ts('2026-10-24')+10)).toBe(true)
    expect(s.queue.ids).toEqual(['p','u','l'])
    expect(s.queue.startsOn).toBe('2026-10-25')
  })
  it('does not silently adopt an externally managed queue', () => {
    const s=fixture(); delete s.queue.rotationId
    expect(propose(s).error).toBe('external')
  })
})

it('keeps repeated preferred exercises as distinct occurrences, including station metadata',()=>{
  const s=fixture();s.routines[0].ex.push({id:'0047',sets:1,reps:12,stationId:'second'})
  const p=propose(s)
  expect(p.remainingSessions[0].ex.filter(e=>e.id==='0047').map(e=>e.stationId)).toEqual(['preferred','second'])
})
it('includes explicitly planned warm-ups in the duration budget',()=>{
  const s=fixture();s.routines[0].ex[0].warmupSets=4
  const p=propose(s)
  // Four additional 45-second sets add three minutes (rest remains conservatively 150s).
  expect(p.remainingSessions[0].estimate.warmupMinutes).toBeGreaterThanOrEqual(3)
})
it('refuses an active workout and rejects a preview once a workout starts',()=>{
  const s=fixture(),p=propose(s)
  s.active={id:'active',start:ts(today),routineIds:['p'],entries:[]}
  expect(applyAdaptation(s,p).error).toBe('stale')
  expect(propose(s).error).toBe('active')
})
it('requires three explicit distinct baseline mappings and does not guess from unrelated routines',()=>{
  const s=fixture()
  expect(propose(s,{availability:{dates:['2026-10-22'],totalSessions:5,minutes:75}}).error).toBe('baseline')
  expect(propose(s,{availability:{dates:['2026-10-22'],totalSessions:5,minutes:75,baselineIds:{push:'p',pull:'p',legs:'p'}}}).error).toBe('baseline')
})
it('treats malformed external payloads as requiring recovery instead of replacing them',()=>{
  const s=fixture();s.queue={ids:['missing'],since:1}
  expect(propose(s).error).toBe('external')
})
it('materializes the same reviewed proposal deterministically on two devices',()=>{
  const s=fixture(),p=propose(s)
  expect(applyAdaptation(s,p).state.queue.ids).toEqual(applyAdaptation(structuredClone(s),p).state.queue.ids)
})
it('merges concurrent adjustments as one accepted schedule without keeping the losing generated dates',()=>{
  const s=fixture();s.workouts=[]
  const accept=(dates,at)=>{
    const p=propose(s,{availability:{dates,totalSessions:5,minutes:75,baselineIds:{push:'p',pull:'u',legs:'l'}}})
    const next=applyAdaptation(s,p).state
    next._ts=stampChange(s,next,at)
    return next
  }
  const a=accept(['2026-10-22','2026-10-24'],100),b=accept(['2026-10-23','2026-10-25'],200)
  for(const [first,second] of [[a,b],[b,a]]) {
    const merged=mergeStates(first,second)
    expect(merged.queue.ids).toEqual(b.queue.ids)
    expect(merged.dayPlan).toEqual(b.dayPlan)
    expect(effectiveRoutineIds(merged,'2026-10-22',today)).toEqual([])
    expect(effectiveRoutineIds(merged,'2026-10-23',today)).toEqual([b.queue.ids[0]])
    const again=mergeStates(merged,a)
    expect(again.dayPlan).toEqual(b.dayPlan)
    expect(again.edited['dayPlan.2026-10-22']).toBeGreaterThan(a.edited['dayPlan.2026-10-22'])
  }
  for(const restart of [false,true]) {
    const stopped=structuredClone(b)
    chooseFixedWeek(stopped,today)
    if(restart) chooseRotation(stopped,today,300)
    stopped._ts=stampChange(b,stopped,300)
    for(const [first,second] of [[a,stopped],[stopped,a]]) {
      const merged=mergeStates(first,second)
      expect(merged.queue).toEqual(stopped.queue)
      expect(merged.dayPlan).toEqual({})
      expect(effectiveRoutineIds(merged,'2026-10-22',today)).toEqual([])
      expect(mergeStates(merged,a).dayPlan).toEqual({})
    }
  }
  const renamed=structuredClone(a)
  renamed.queue.label='Renamed pass'
  renamed._ts=stampChange(a,renamed,150)
  expect(mergeStates(renamed,b).dayPlan).toEqual(b.dayPlan)
  const edited=structuredClone(a)
  edited.dayPlan['2026-10-22']='p'
  edited.dayPlan['2026-10-26']=a.queue.ids[0]
  edited.workouts.push({id:'offline-done',d:'2026-10-22',start:ts('2026-10-22'),routineId:a.queue.ids[0],entries:[]})
  edited._ts=stampChange(a,edited,300)
  const merged=mergeStates(edited,b)
  expect(merged.queue.ids).toEqual(b.queue.ids)
  expect(merged.dayPlan).toEqual({...b.dayPlan,'2026-10-22':'p','2026-10-26':a.queue.ids[0]})
  expect(merged.workouts.map(w=>w.id)).toEqual(['offline-done'])
})
it('keeps dated adjusted sessions when the winning rotation deliberately retains their IDs',()=>{
  const s=fixture();delete s.queue;delete s.rotation;s.week={1:'p',3:'u',5:'l'}
  const accepted=applyAdaptation(s,propose(s)).state
  accepted._ts=stampChange(s,accepted,100)
  const adopted=structuredClone(accepted)
  saveRotation(adopted,adopted.queue.ids,'My rotation',today,200)
  adopted._ts=stampChange(accepted,adopted,200)
  for(const [first,second] of [[accepted,adopted],[adopted,accepted]]) {
    const merged=mergeStates(first,second)
    expect(merged.queue).toEqual(adopted.queue)
    expect(merged.dayPlan).toEqual(accepted.dayPlan)
    expect(effectiveRoutineIds(merged,'2026-10-22',today)).toEqual([accepted.queue.ids[0]])
  }
})
it('accepts a fixed-week plan as an explicit queue without changing its saved weekdays',()=>{
  const s=fixture();delete s.queue;delete s.rotation;s.week={1:'p',3:'u',5:'l'}
  const result=applyAdaptation(s,propose(s))
  expect(result.error).toBeNull()
  expect(result.state.week).toEqual(s.week)
  expect(result.state.queue.ids).toHaveLength(2)
})
it('can leave an accepted fixed-week adjustment without adopting its occurrences as a rotation',()=>{
  const s=fixture();delete s.queue;delete s.rotation;s.week={1:'p',3:'u',5:'l'}
  const accepted=applyAdaptation(s,propose(s)).state
  chooseFixedWeek(accepted,today)
  expect(scheduleModeOf(accepted)).toBe('week')
  expect(accepted.queue).toBeNull()
  expect(accepted.dayPlan).toEqual({})
  expect(accepted.week).toEqual(s.week)
  expect(accepted.rotation).toBeUndefined()
  expect(accepted.workouts).toEqual(s.workouts)
})
it('uses the active fixed-week routines after leaving a different saved rotation',()=>{
  const s=fixture();s.routines.push({id:'old',name:'Old',ex:[]})
  s.rotation={id:'old-rotation',sequence:['old']};s.queue={ids:['old'],rotationId:'old-rotation',since:1,startsOn:today}
  s.week={1:'p',3:'u',5:'l'}
  chooseFixedWeek(s,today)
  expect(propose(s).error).toBeNull()
  expect(s.rotation.sequence).toEqual(['old'])
})
it('can revise an accepted fixed-week queue when a later sixth date opens',()=>{
  const s=fixture();delete s.queue;delete s.rotation;s.week={1:'p',3:'u',5:'l'}
  // Sunday belongs to the earlier calendar week; including its Push is an explicit review.
  const p5=propose(s,{availability:{dates:['2026-10-22','2026-10-24'],totalSessions:5,minutes:75,baselineIds:{push:'p',pull:'u',legs:'l'},cycleStart:'2026-10-18'}})
  const accepted=applyAdaptation(s,p5).state
  const p=propose(accepted,{availability:{dates:['2026-10-22','2026-10-23','2026-10-24'],totalSessions:6,minutes:75}})
  expect(p.error).toBeNull()
  expect(p.remainingSessions.map(r=>r.kind)).toEqual(['push','pull','legs'])
})
it('explains an explicit set aim shortfall using rolling actuals and known proposed credit',()=>{
  const s=fixture();s.coverageTargets={chest:{directDays:2,sets:100}}
  const p=propose(s)
  expect(p.shortfalls).toContainEqual({code:'coverage-sets',muscle:'chest',sets:96})
})
it('keeps original unknown exercise metadata in a fitting proposal without fabricating a role',()=>{
  const s=fixture();s.routines[0].ex.push({id:'unknown',sets:1,trainingSnapshot:{role:null,primary:[],secondary:[],status:'unknown'},stationId:'unknown-station'})
  const p=propose(s)
  expect(p.remainingSessions[0].ex.find(e=>e.id==='unknown')).toMatchObject({trainingSnapshot:{role:null,primary:[]},stationId:'unknown-station'})
  expect(p.shortfalls).toContainEqual({code:'unknown',exerciseId:'unknown'})
})
it('the accepted fixed-week occurrence replaces its original weekday prescription without extra baseline work',async()=>{
  const { effectiveRoutineIds }=await import('./history.js')
  const s=fixture();delete s.queue;delete s.rotation;s.workouts=[];s.week={3:'p',4:'u',5:'l'}
  const p=propose(s,{availability:{dates:['2026-10-22','2026-10-24'],totalSessions:5,minutes:75,baselineIds:{push:'p',pull:'u',legs:'l'}}})
  const accepted=applyAdaptation(s,p).state
  expect(effectiveRoutineIds(accepted,'2026-10-22',today)).toEqual([accepted.queue.ids[0]])
  expect(effectiveRoutineIds(accepted,'2026-10-23',today)).toEqual([])
  expect(accepted.week).toEqual(s.week)
})
it('does not overwrite an unrelated dated pin or silently add unrelated weekly training to the budget',()=>{
  const s=fixture();s.routines.push({id:'other',name:'Other',ex:[]});s.dayPlan['2026-10-22']='other'
  expect(propose(s).error).toBe('conflict')
  delete s.dayPlan['2026-10-22'];s.week[4]='other'
  expect(propose(s).error).toBe('conflict')
})
it('keeps baseline snapshot load conventions correct after a profile unit conversion',async()=>{
  const {convertStateUnit}=await import('./units.js')
  const s=fixture();s.unit='kg';s.routines[0].ex[0].weight=100;s.routines[1].ex[0].weight=7;s.routines[1].ex[0].loadConvention='machine-setting'
  const accepted=applyAdaptation(s,propose(s)).state
  const pounds=convertStateUnit(accepted,'lb')
  const p=propose(pounds,{availability:{dates:['2026-10-22','2026-10-23','2026-10-24'],totalSessions:6,minutes:75}})
  expect(p.remainingSessions[0].ex[0].weight).toBe(220.5)
  expect(p.remainingSessions[1].ex[0].weight).toBe(7)
  expect(accepted.queue.adaptation.baseline[0].ex[0].weight).toBe(100)
})
it('reaccepting an undone identical proposal reuses its retained occurrence records without duplicate IDs',()=>{
  const s=fixture(),p=propose(s),first=applyAdaptation(s,p)
  const restored=undoAdaptation(first.state,first.undo).state
  const second=applyAdaptation(restored,propose(restored))
  expect(second.error).toBeNull()
  expect(second.state.routines).toHaveLength(5)
  expect(new Set(second.state.routines.map(r=>r.id)).size).toBe(5)
})
it('tolerates a malformed adaptation payload from another writer without taking ownership or crashing',async()=>{
  const {adaptationNeedsReview}=await import('./training-adaptation.js')
  const s=fixture();delete s.queue.rotationId;s.queue.adaptation={baseline:{bad:true}}
  expect(()=>propose(s)).not.toThrow()
  expect(propose(s).error).toBe('external')
  expect(adaptationNeedsReview(s)).toBe(false)
})

it('credits actual mapped families, retaining missing families and exposing repeated unmatched work',()=>{
  const s=fixture();s.workouts=s.workouts.map(w=>({...w,routineId:'p'}))
  const p=propose(s)
  expect(p.remainingSessions.map(r=>r.kind)).toEqual(['pull','legs'])
  expect(p.creditedKinds).toEqual(['push'])
  expect(p.shortfalls).toContainEqual({code:'unmatched-program',sessions:2})
})
it('credits an out-of-order PPL prefix by family, without mistaking two families for three',()=>{
  const s=fixture();s.workouts.reverse()
  expect(propose(s).remainingSessions.map(r=>r.kind)).toEqual(['upper','lower'])
  s.workouts=s.workouts.filter(w=>w.routineId!=='u')
  expect(propose(s).remainingSessions.map(r=>r.kind)).toEqual(['pull','upper'])
})
it('excludes an earlier pass, but permits explicitly reviewing its completed PPL prefix',()=>{
  const s=fixture();s.queue.since=ts(today);s.queue.startsOn=today
  expect(propose(s).remainingSessions.map(r=>r.kind)).toEqual(['push','pull'])
  const p=propose(s,{availability:{...propose(s).availability,dates:['2026-10-22','2026-10-24'],totalSessions:5,baselineIds:{push:'p',pull:'u',legs:'l'},cycleStart:'2026-10-18'}})
  expect(p.remainingSessions.map(r=>r.kind)).toEqual(['upper','lower'])
  expect(applyAdaptation(s,p).state.queue.adaptation.cycleBoundary).toEqual(p.cycleBoundary)
})
it('reviews and removes only baseline pins within the accepted window and restores them on undo',async()=>{
  const {effectiveRoutineIds}=await import('./history.js')
  const s=fixture();delete s.queue;delete s.rotation;s.week={3:'p',4:'u',5:'l'}
  s.routines.push({id:'other',name:'Other',ex:[]})
  s.dayPlan={'2026-10-21':'other','2026-10-23':'l','2026-10-25':'l'}
  const p=propose(s)
  expect(p.replacedPins).toEqual([{date:'2026-10-23',id:'l'}])
  const accepted=applyAdaptation(s,p)
  expect(effectiveRoutineIds(accepted.state,'2026-10-23',today)).toEqual([])
  expect(accepted.state.dayPlan['2026-10-21']).toBe('other')
  expect(accepted.state.dayPlan['2026-10-25']).toBe('l')
  expect(undoAdaptation(accepted.state,accepted.undo).state.dayPlan).toEqual(s.dayPlan)
})
it('does not establish same-day cycle credit without a start time, and explains uncertainty',()=>{
  const s=fixture();s.queue.since=ts(today);s.queue.startsOn=today;s.workouts=[{id:'unknown-time',routineId:'p',d:today,entries:[]}]
  const p=propose(s)
  expect(p.remainingSessions.map(r=>r.kind)).toEqual(['push','pull'])
  expect(p.shortfalls).toContainEqual({code:'unknown-cycle',sessions:1})
})
it('uses the exact acceptance day for unknown timing even when startsOn names an earlier calendar day',()=>{
  const s=fixture();s.queue.since=ts(today);s.queue.startsOn='2026-10-19';s.workouts=[{id:'unknown-time',routineId:'p',d:today,entries:[]}]
  const p=propose(s)
  expect(p.creditedKinds).toEqual([])
  expect(p.shortfalls).toContainEqual({code:'unknown-cycle',sessions:1})
})

it('reviews and accepts the real tomorrow pass created by refill without crediting the just-finished pass',async()=>{
  const {effectiveRoutineIds}=await import('./history.js')
  const s=fixture(),last=s.workouts.at(-1)
  last.d=today;last.start=ts(today);last.end=ts(today)+1000
  expect(refillAfter(s,last,today,ts(today)+2000)).toBe(true)
  expect(s.queue.startsOn).toBe('2026-10-22')
  const boundary={date:s.queue.startsOn,since:s.queue.since},workouts=structuredClone(s.workouts)
  const availability={dates:['2026-10-22','2026-10-23','2026-10-24','2026-10-25','2026-10-26'],totalSessions:5,minutes:75,baselineIds:{push:'p',pull:'u',legs:'l'}}
  const p=propose(s,{availability})
  expect(p.error).toBeNull()
  expect(p.creditedKinds).toEqual([])
  expect(p.remainingSessions.map(r=>r.kind)).toEqual(['push','pull','legs','upper','lower'])
  const accepted=applyAdaptation(s,p)
  expect(accepted.error).toBeNull()
  expect(accepted.state.queue).toMatchObject({startsOn:boundary.date,since:boundary.since,adaptation:{cycleBoundary:boundary}})
  expect(accepted.state.workouts).toEqual(workouts)
  expect(queueDone(accepted.state)).toEqual([])
  expect(effectiveRoutineIds(accepted.state,today,today)).toEqual([])
  expect(effectiveRoutineIds(accepted.state,'2026-10-22',today)).toEqual([accepted.state.queue.ids[0]])
  expect(propose(accepted.state,{availability}).error).toBeNull()
  expect(propose(s,{availability:{...availability,dates:[today,'2026-10-22']}}).error).toBe('availability')
  expect(propose(s,{availability:{...availability,cycleStart:'2026-10-22'}}).error).toBe('cycle')
})

it('keeps imported history in coverage without awarding adaptation family or occurrence credit', () => {
  const s=fixture()
  s.workouts=s.workouts.map(w=>({...w,historicalImport:true}))
  s.routines.push({id:'old-adaptation',name:'Old push',ex:[],adaptationPolicyVersion:1,adaptationKind:'push',adaptationSourceIds:['p']})
  s.workouts.push({...s.workouts[0],id:'old-import',routineId:'old-adaptation'})
  const p=propose(s)
  expect(p.creditedKinds).toEqual([])
  expect(p.remainingSessions.map(r=>r.kind)).toEqual(['push','pull'])
  expect(coverageForState(s,today).rolling.byMuscle.chest.actual.directSets).toBe(2)
})

it('an accepted lower set count cannot make truncated historical work complete for progression', async () => {
  const { suggestProgression } = await import('./progression-suggestion.js')
  const s = fixture()
  const target = { id: '0576', stationId: 'press', loadConvention: 'machine-total', sets: 3, repsMin: 8, reps: 12, weight: 50, inc: 2.5 }
  const equipmentSnapshot = { stationId: 'press', loadConvention: 'machine-total', unit: 'kg', status: 'exact' }
  s.routines[0].ex = [target]
  s.workouts[0].entries = [{ id: target.id, target, planned: { ...target }, equipmentSnapshot, sets: [{ w: 50, r: 12, done: true }, { w: 50, r: 12, done: true, rir: 3 }] }]
  const proposal = proposeAdaptation({ state: s, today, availability: { dates: ['2026-10-22'], totalSessions: 6, minutes: 4, baselineIds: { push: 'p', pull: 'u', legs: 'l' } } })
  const accepted = applyAdaptation(s, proposal)
  expect(accepted.error).toBeNull()
  const prescription = accepted.state.routines.find(r => r.adaptationKind === 'push').ex[0]
  expect(prescription.sets).toBe(2)
  expect(suggestProgression({ exercise: { id: target.id, target: prescription, equipmentSnapshot }, prescription, history: accepted.state.workouts, policy: 'double' }).action).toBe('hold')
})
