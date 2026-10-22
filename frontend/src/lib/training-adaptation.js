import { EXIDX } from './exercises.js'
import { isoOf, weekKey, weekStartOf } from './format.js'
import { queueOf, queueDone } from './queue.js'
import { trainingMetadataOf } from './training-metadata.js'
import { coverageForState, completedDateOf } from './training-coverage.js'

const clone = value => structuredClone(value)
const dateOK = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && isoOf(new Date(value + 'T12:00:00')) === value
const shift = (date, days) => { const d = new Date(date + 'T12:00:00'); d.setDate(d.getDate() + days); return isoOf(d) }
const clean = value => Array.isArray(value) ? value.map(clean) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).filter(k => !['_ts', '_f'].includes(k)).sort().map(k => [k, clean(value[k])])) : value
const encode = value => JSON.stringify(clean(value))
const routineIds = w => w.routineIds || (w.routineId ? [w.routineId] : [])
const metaOf = (s,e) => trainingMetadataOf({ ...(EXIDX[e.id] || s.customEx?.find(x=>x.id===e.id)), ...e, ...(s.trainingMetadata?.[e.id] ? {trainingMetadata:s.trainingMetadata[e.id]} : {}) })
export const adaptationOf = s => {
  const a=s.queue?.adaptation
  return a?.policyVersion===1 && typeof a.token==='string' && Array.isArray(a.baseline) && a.baseline.every(r=>r && typeof r.id==='string' && Array.isArray(r.ex)) ? a : null
}
const baselineOf = s => {
  const adaptation=adaptationOf(s)
  if (adaptation) return clone(adaptation.baseline)
  const q = queueOf(s)
  const ids = q ? s.rotation?.sequence || q.ids : [...new Set(Object.values(s.week || {}).flat().filter(Boolean))]
  return ids.map(id=>s.routines.find(r=>r.id===id)).filter(Boolean).map(clone)
}
const relevantWork = (s,today) => (s.workouts || []).filter(w => {
  const d=completedDateOf(w)
  return !d || (d>=shift(today,-6) && d<=today) || (s.queue && (w.start>=s.queue.since || w.d>=s.queue.startsOn) && routineIds(w).some(id=>s.queue.ids?.includes(id)))
})
export function adaptationFingerprint(s,today) {
  const baseline=baselineOf(s), ids=new Set([...baseline.map(r=>r.id), ...(queueOf(s)?.ids || [])])
  const exerciseIds=new Set([...baseline,...s.routines.filter(r=>ids.has(r.id))].flatMap(r=>(r.ex || []).map(e=>e.id)))
  return encode({unit:s.unit || 'kg',active:s.active?{id:s.active.id,start:s.active.start,routineIds:routineIds(s.active)}:null,today,queue:s.queue || null,rotation:s.rotation || null,week:s.week || {},dayPlan:s.dayPlan || {},
    routines:s.routines.filter(r=>ids.has(r.id)),workouts:relevantWork(s,today),baselineWork:baselineWork(s,baseline),
    trainingMetadata:Object.fromEntries(Object.entries(s.trainingMetadata || {}).filter(([id])=>exerciseIds.has(id))),
    customEx:(s.customEx || []).filter(e=>exerciseIds.has(e.id)),coverageTargets:s.coverageTargets || {},dayDispositions:s.dayDispositions || {}})
}
export const dispositionOf = (s,date) => ['rest','missed','trained-unlogged'].includes(s.dayDispositions?.[date]?.status) ? s.dayDispositions[date].status : 'unknown'
export function setDisposition(s,date,status,now=Date.now()) {
  if (!dateOK(date) || !['unknown','rest','missed','trained-unlogged'].includes(status)) return false
  s.dayDispositions ||= {}
  s.dayDispositions[date]={status,_ts:now}
  return true
}

// Unknown roles use the longer rest assumption, while retaining the uncertainty in the preview.
export function estimateSession(s,entries,policy={}) {
  const restMulti=policy.restMultiSeconds ?? 150, restSingle=policy.restSingleSeconds ?? 90
  const setSeconds=policy.setSeconds ?? 45, transitionSeconds=policy.transitionSeconds ?? 120
  let work=0,rest=0,unknown=false,warmupSeconds=0
  for (const e of entries) {
    if (!Number.isInteger(e.sets) || e.sets<0) { unknown=true; continue }
    const role=metaOf(s,e).role
    if (!role) unknown=true
    const single=['chest-isolation','shoulder-isolation','elbow-flexion','elbow-extension','knee-flexion','knee-extension','calf-raise','core'].includes(role)
    const warmups=Number.isInteger(e.warmupSets) && e.warmupSets>0 ? e.warmupSets : 0
    warmupSeconds+=warmups*(setSeconds+(single?restSingle:restMulti))
    work+=e.sets*setSeconds
    rest+=Math.max(0,e.sets-1)*(single?restSingle:restMulti)
  }
  const transitions=Math.max(0,entries.length-1)*transitionSeconds, warmup=entries.length?(policy.warmupMinutes ?? 0)+warmupSeconds/60:0
  return {minutes:Math.ceil((work+rest+transitions)/60+warmup),workSeconds:work,restSeconds:rest,transitionSeconds:transitions,warmupMinutes:warmup,unknown}
}

export function proposeAdaptation({state:s,availability,coverage,policy={},today}) {
  const empty={baseFingerprint:adaptationFingerprint(s,today),today,remainingSessions:[],reasons:[],shortfalls:[],estimatedMinutes:[],error:null}
  const q=queueOf(s)
  if (s.queue && (!q || !(adaptationOf(s) && !q.rotationId) && (!s.rotation || q.rotationId!==s.rotation.id))) return {...empty,error:'external'}
  if (s.active) return {...empty,error:'active'}
  const dates=availability?.dates
  const minutes=availability?.minutes ?? 75, total=availability?.totalSessions
  if (!dateOK(today) || ![5,6].includes(total) || !Array.isArray(dates) || !dates.length || dates.length>6 || new Set(dates).size!==dates.length || dates.some(d=>!dateOK(d) || d<today || d>shift(today,6)) || !Number.isFinite(minutes) || minutes<1 || minutes>180) return {...empty,error:'availability'}
  if (Object.values(policy).some(n=>!Number.isFinite(n) || n<0)) return {...empty,error:'policy'}
  const baseline=baselineOf(s), groups={push:[],pull:[],legs:[]}
  const mapping=availability.baselineIds || adaptationOf(s)?.availability?.baselineIds
  for (const kind of Object.keys(groups)) {
    const ids=[].concat(mapping?.[kind] || [])
    groups[kind]=ids.map(id=>baseline.find(r=>r.id===id)).filter(Boolean)
  }
  if (Object.values(groups).some(list=>!list.length) || new Set(Object.values(groups).flat().map(r=>r.id)).size!==Object.values(groups).flat().length) return {...empty,error:'baseline'}
  const allowed=new Set([...baseline.map(r=>r.id),...(q?.ids || [])])
  if (dates.some(date=>{const pin=s.dayPlan?.[date];const weekly=[].concat(s.week?.[new Date(date+'T12:00:00').getDay()] || []);return pin && pin!=='rest' && !allowed.has(pin) || weekly.some(id=>s.routines.some(r=>r.id===id) && !allowed.has(id))})) return {...empty,error:'conflict'}
  const coverageTargets={...s.coverageTargets}
  for (const r of baseline) for (const e of r.ex || []) for (const m of metaOf(s,e).primary) coverageTargets[m] ||= {directDays:2,sets:null}
  const rolling=coverage?.rolling || coverageForState({...s,coverageTargets},today).rolling
  const coverageGaps=Object.fromEntries(Object.entries(rolling.byMuscle).map(([m,v])=>[m,clone(v.actual.gap)]))
  const baseIds=new Set(baseline.map(r=>r.id))
  const cycleBoundary=availability.cycleStart != null
    ? {date:availability.cycleStart,since:null}
    : adaptationOf(s)?.cycleBoundary || (q ? {date:q.startsOn,since:Number.isFinite(q.since)?q.since:null} : {date:weekKey(today,weekStartOf(s)),since:null})
  if (!dateOK(cycleBoundary.date) || (availability.cycleStart!=null && cycleBoundary.date>today)) return {...empty,error:'cycle'}
  // An automatically refilled pass can start tomorrow; review it now without moving its start.
  if (dates.some(date=>date<cycleBoundary.date || (q && date<q.startsOn))) return {...empty,error:'availability'}
  const pattern=total===5?['push','pull','legs','upper','lower']:['push','pull','legs','push','pull','legs']
  const credited=new Set(),seen=new Set()
  let unmatched=0,unknownCycle=0
  for (const w of [...(s.workouts || [])].sort((a,b)=>(a.start || 0)-(b.start || 0))) {
    if (w.historicalImport === true) continue
    const key=w.id || `${w.d}|${w.start}`
    if (seen.has(key)) continue
    seen.add(key)
    const kinds=[...new Set(routineIds(w).flatMap(id=>{
      const family=Object.keys(groups).find(kind=>groups[kind].some(r=>r.id===id))
      if (family) return [family]
      const r=s.routines.find(r=>r.id===id)
      return r?.adaptationPolicyVersion===1 && r.adaptationSourceIds?.some(id=>baseIds.has(id)) ? [r.adaptationKind || 'unknown'] : []
    }))]
    if (!kinds.length) continue
    const d=completedDateOf(w)
    if (!d) { unknownCycle++; continue }
    if (d<cycleBoundary.date || d>today) continue
    if (cycleBoundary.since!=null) {
      if (Number.isFinite(w.start)) { if(w.start<cycleBoundary.since) continue }
      else {
        const acceptedDay=isoOf(new Date(cycleBoundary.since))
        if (d<acceptedDay) continue
        if (d===acceptedDay) { unknownCycle++; continue }
      }
    }
    let matched=false
    for (const kind of kinds) {
      const i=pattern.findIndex((value,index)=>value===kind && !credited.has(index))
      if (i>=0) { credited.add(i);matched=true }
    }
    if (!matched) unmatched++
  }
  const pending=pattern.map((kind,i)=>({kind,i})).filter(({i})=>!credited.has(i))
  const shortfalls=[], remainingSessions=[]
  if (unmatched) shortfalls.push({code:'unmatched-program',sessions:unmatched})
  if (unknownCycle) shortfalls.push({code:'unknown-cycle',sessions:unknownCycle})
  if (dates.length<pending.length) shortfalls.push({code:'availability',sessions:pending.length-dates.length})
  const replacedPins=Object.entries(s.dayPlan || {}).filter(([date,id])=>date>=today && date<=[...dates].sort().at(-1) && baseIds.has(id)).map(([date,id])=>({date,id}))
  const score=e=>metaOf(s,e).primary.reduce((sum,m)=>sum+(coverageGaps[m]?.directDays ?? 0)+(coverageGaps[m]?.sets ?? 0)/10,0)
  pending.slice(0,dates.length).forEach(({kind,i},index)=>{
    const second=i>=3
    const source=kind==='upper'?[groups.push.at(-1),groups.pull.at(-1)]:kind==='lower'?[groups.legs.at(-1)]:[groups[kind][second?groups[kind].length-1:0]]
    const entries=source.flatMap(r=>(r.ex || []).map(e=>({...clone(e),adaptationSourceId:r.id})))
    const ranked=entries.map((e,i)=>({e,i})).sort((a,b)=>score(b.e)-score(a.e)||a.i-b.i)
    const chosen=[],deferred=[]
    for (const {e,i} of ranked) {
      if (!Number.isInteger(e.sets) || e.sets<1) { deferred.push(e); shortfalls.push({code:'unknown',exerciseId:e.id}); continue }
      let sets=e.sets
      while (sets>0 && estimateSession(s,[...chosen.map(c=>c.e),{...e,sets}],policy).minutes>minutes) sets--
      if (sets) chosen.push({e:{...e,sets},i})
      if (sets<e.sets) deferred.push({...e,sets:e.sets-sets})
      if (!metaOf(s,e).role || !metaOf(s,e).primary.length) shortfalls.push({code:'unknown',exerciseId:e.id})
    }
    const ex=chosen.sort((a,b)=>a.i-b.i).map(c=>c.e)
    const estimate=estimateSession(s,ex,policy)
    if (deferred.length) shortfalls.push({code:'time',session:index,exercises:deferred.length})
    remainingSessions.push({kind,name:kind==='upper'?'Upper':kind==='lower'?'Lower':source[0].name,date:[...dates].sort()[index],ex,deferred,sourceIds:source.map(r=>r.id),estimate})
  })
  shortfalls.push(...coverageShortfalls(s,remainingSessions,coverageGaps))
  if (Object.values(rolling.unknowns.actual).some(n=>n>0)) shortfalls.push({code:'unknown-actual',counts:clone(rolling.unknowns.actual)})
  return {...empty,baseline,cycleBoundary,creditedKinds:pattern.filter((_,i)=>credited.has(i)),replacedPins,availability:clone(availability),policy:clone(policy),policyVersion:1,remainingSessions,coverageGaps,
    reasons:[total===5?'ppl-ul':'ppl', 'rolling-observed','duration-estimate'],shortfalls,estimatedMinutes:remainingSessions.map(r=>r.estimate.minutes)}
}

export function applyAdaptation(s,proposal) {
  if (proposal.baseFingerprint!==adaptationFingerprint(s,proposal.today)) return {state:s,error:'stale'}
  const fresh=proposeAdaptation({state:s,availability:proposal.availability,policy:proposal.policy,today:proposal.today})
  if (fresh.error || !fresh.remainingSessions.length || fresh.remainingSessions.length!==proposal.remainingSessions?.length) return {state:s,error:fresh.error || 'invalid'}
  for (const [i,r] of fresh.remainingSessions.entries()) {
    const edited=proposal.remainingSessions[i]
    if (!Array.isArray(edited.ex) || edited.ex.length!==r.ex.length) return {state:s,error:'invalid'}
    for (const [j,e] of edited.ex.entries()) {
      const original=r.ex[j]
      if (!Number.isInteger(e.sets) || e.sets<0 || e.sets>original.sets || encode({...e,sets:original.sets})!==encode(original)) return {state:s,error:'invalid'}
    }
    r.ex=clone(edited.ex.filter(e=>e.sets>0))
    r.estimate=estimateSession(s,r.ex,fresh.policy)
    if (!r.ex.length || r.estimate.minutes>fresh.availability.minutes) return {state:s,error:'invalid'}
  }
  const next=clone(s), oldQueue=clone(s.queue || null), oldPins=clone(s.dayPlan || {}), done=queueDone(s)
  // Occurrences are ordinary routines: the existing queue and all its readers keep one cursor.
  const text=encode([proposal.baseFingerprint,fresh.availability,fresh.policy,fresh.remainingSessions.map(r=>r.ex)])
  let h=2166136261
  for (let i=0;i<text.length;i++) h=Math.imul(h^text.charCodeAt(i),16777619)
  const token=`adapt-${(h>>>0).toString(36)}`
  const occurrences=fresh.remainingSessions.map((r,i)=>({id:`${token}-${i}`,name:r.name,ex:clone(r.ex),adaptationSourceIds:r.sourceIds,adaptationKind:r.kind,adaptationPolicyVersion:1}))
  if (occurrences.some(r=>{const existing=next.routines.find(x=>x.id===r.id);return existing && encode(existing)!==encode(r)})) return {state:s,error:'invalid'}
  next.routines.push(...occurrences.filter(r=>!next.routines.some(x=>x.id===r.id)))
  const ids=occurrences.map(r=>r.id)
  next.dayPlan ||= {}
  for (const [date,id] of Object.entries(next.dayPlan)) if (date>=proposal.today && oldQueue?.ids.includes(id) && !done.includes(id)) delete next.dayPlan[date]
  fresh.replacedPins.forEach(({date})=>{delete next.dayPlan[date]})
  fresh.remainingSessions.forEach((r,i)=>{next.dayPlan[r.date]=ids[i]})
  next.queue={...(oldQueue || {since:Date.now(),startsOn:proposal.today,strict:true}),ids:[...done,...ids],
    adaptation:{token,today:proposal.today,baseline:fresh.baseline,policyVersion:1,availability:fresh.availability,cycleBoundary:fresh.cycleBoundary,reviewedWork:baselineWork(s,fresh.baseline)}}
  const undo={today:proposal.today,queue:oldQueue,dayPlan:oldPins,afterPins:clone(next.dayPlan),fingerprint:adaptationFingerprint(next,proposal.today)}
  return {state:next,error:null,undo}
}
export function undoAdaptation(s,undo) {
  if (!undo || undo.fingerprint!==adaptationFingerprint(s,undo.today)) return {state:s,error:'stale'}
  const next=clone(s)
  next.queue=clone(undo.queue)
  for (const date of new Set([...Object.keys(undo.dayPlan),...Object.keys(undo.afterPins)])) {
    if (date<undo.today) continue
    if (date in undo.dayPlan) next.dayPlan[date]=undo.dayPlan[date]
    else delete next.dayPlan[date]
  }
  return {state:next,error:null}
}

// New original-program work can arrive after offline acceptance. Surface it without rolling
// back a newer plan, a running workout, or an adapted session already completed elsewhere.
const baselineWork = (s,baseline) => {
  const ids=new Set(baseline.map(r=>r.id))
  return encode((s.workouts || []).filter(w=>routineIds(w).some(id=>ids.has(id))).sort((a,b)=>String(a.id || a.start).localeCompare(String(b.id || b.start))))
}
export const adaptationNeedsReview = s => {
  const a=adaptationOf(s)
  return !!a && a.reviewedWork!==baselineWork(s,a.baseline)
}

export function coverageShortfalls(s,remainingSessions,coverageGaps) {
  const shortfalls=[]
  for (const [muscle,gap] of Object.entries(coverageGaps)) {
    const direct=remainingSessions.filter(r=>r.ex.some(e=>e.sets>0 && metaOf(s,e).primary.includes(muscle))).length
    if (gap.directDays!==null && gap.directDays>direct) shortfalls.push({code:'coverage',muscle,directDays:gap.directDays-direct})
    const sets=remainingSessions.flatMap(r=>r.ex).reduce((sum,e)=>{const m=metaOf(s,e);return sum+e.sets*(m.primary.includes(muscle)?1:m.secondary.includes(muscle)?0.5:0)},0)
    if (gap.sets!==null && gap.sets>sets) shortfalls.push({code:'coverage-sets',muscle,sets:gap.sets-sets})
  }
  return shortfalls
}
