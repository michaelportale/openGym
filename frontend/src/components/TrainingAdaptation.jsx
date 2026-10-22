import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { acceptTrainingAdaptation, undoTrainingAdaptation } from '../store/training-adaptation.js'
import { proposeAdaptation, setDisposition, dispositionOf, estimateSession, adaptationNeedsReview, coverageShortfalls, adaptationOf } from '../lib/training-adaptation.js'
import { todayISO, isoOf, exerciseNameText } from '../lib/format.js'
import { exOr } from '../lib/exercises.js'
import { t } from '../lib/i18n.js'
import { Button } from './ui.jsx'

const statusNames=()=>({unknown:t('Unknown'),rest:t('Rest'),missed:t('Missed'), 'trained-unlogged':t('Trained but unlogged')})
const errorText=error=>error==='stale'?t('Training changed. Preview again before accepting.')
  :error==='external'?t('Adopt this external queue in Plan before adjusting it.')
    :error==='conflict'?t('An available date already has unrelated training. Choose another date or edit that schedule first.')
    :error==='active'?t('Finish or discard the active workout before adjusting future sessions.')
    :error==='baseline'?t('Choose your original Push, Pull and Leg routines before previewing.')
      :t('Choose available dates and a valid time budget. Each accepted session needs working sets.')
export default function TrainingAdaptation({ S }) {
  const today=todayISO(), update=useStore(s=>s.update)
  const [open,setOpen]=useState(false),[day,setDay]=useState(today),[status,setStatus]=useState(dispositionOf(S,today))
  const [policy,setPolicy]=useState({restMultiSeconds:150,restSingleSeconds:90,warmupMinutes:0})
  const [total,setTotal]=useState(5),[minutes,setMinutes]=useState(75),[dates,setDates]=useState([])
  const [mapping,setMapping]=useState(adaptationOf(S)?.availability?.baselineIds || {push:'',pull:'',legs:''})
  const [proposal,setProposal]=useState(null),[error,setError]=useState(null),[undo,setUndo]=useState(null)
  const base=adaptationOf(S)?.baseline || S.routines.filter(r=>!r.adaptationSourceIds)
  const preview=()=>{
    const p=proposeAdaptation({state:useStore.getState().S,availability:{dates,totalSessions:total,minutes,baselineIds:mapping},policy,today})
    setError(p.error);setProposal(p.error?null:p)
  }
  const changeSet=(i,j,value)=>setProposal(p=>{
    const next=structuredClone(p);next.remainingSessions[i].ex[j].sets=Number(value)
    next.remainingSessions[i].estimate=estimateSession(S,next.remainingSessions[i].ex.filter(e=>e.sets>0),next.policy)
    next.shortfalls=[...next.shortfalls.filter(f=>!['coverage','coverage-sets'].includes(f.code)),...coverageShortfalls(S,next.remainingSessions,next.coverageGaps)]
    return next
  })
  return <section className="card" aria-label={t('Adjust upcoming training')} style={{padding:16,marginBottom:16}}>
    <h3>{t('Adjust upcoming training')}</h3>
    <p className="muted small">{t('No log means unknown. Record what happened, then preview future training changes.')}</p>
    <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
      <label>{t('Training date')} <input className="input" type="date" aria-label={t('Training date')} value={day} max={today} onChange={e=>{setDay(e.target.value);setStatus(dispositionOf(S,e.target.value))}} /></label>
      <label>{t('Day status')} <select className="input" aria-label={t('Day status')} value={status} onChange={e=>setStatus(e.target.value)}>{Object.entries(statusNames()).map(([key,name])=><option key={key} value={key}>{name}</option>)}</select></label>
      <Button onClick={()=>{update(s=>{setDisposition(s,day,status)});setOpen(true);setProposal(null)}}>{t('Save day status')}</Button>
      <Button onClick={()=>setOpen(v=>!v)}>{t('Review availability')}</Button>
    </div>
    {open && <div style={{marginTop:16}}>
      <p className="muted small">{t('Use the original preferred routines. Five sessions proposes PPL plus upper/lower; six keeps PPL twice. Logged program sessions count toward that total.')}</p>
      <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
        {[["push",t('Push routine')],["pull",t('Pull routine')],["legs",t('Leg routine')]].map(([kind,label])=><label key={kind}>{label}<br/><select className="input" aria-label={label} value={mapping[kind]} onChange={e=>{setMapping({...mapping,[kind]:e.target.value});setProposal(null)}}><option value="">{t('Choose routine')}</option>{base.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label>)}
        <label>{t('Total training sessions')}<br/><select className="input" aria-label={t('Total training sessions')} value={total} onChange={e=>{setTotal(Number(e.target.value));setProposal(null)}}><option value="5">5</option><option value="6">6</option></select></label>
        <label>{t('Minutes per session')}<br/><input className="input" type="number" min="1" max="180" aria-label={t('Minutes per session')} value={minutes} style={{width:80}} onChange={e=>{setMinutes(Number(e.target.value));setProposal(null)}} /></label>
      </div>
      <details><summary>{t('Duration assumptions')}</summary><div style={{display:'flex',gap:12,flexWrap:'wrap'}}>{[['warmupMinutes',t('Additional warm-up minutes')],['restMultiSeconds',t('Multi-joint rest seconds')],['restSingleSeconds',t('Single-joint rest seconds')]].map(([key,label])=><label key={key}>{label}<br/><input className="input" type="number" min="0" style={{width:80}} aria-label={label} value={policy[key]} onChange={e=>{setPolicy({...policy,[key]:Number(e.target.value)});setProposal(null)}} /></label>)}</div></details>
      <p className="muted small">{t('Aim around 75 minutes, usually 60–90. Estimates include sets, rest, transitions and planned warm-ups. Add any extra warm-up time below.')}</p>
      <fieldset style={{border:'1px solid var(--line)',borderRadius:8,padding:8,display:'flex',gap:12,flexWrap:'wrap'}}><legend>{t('Available training dates')}</legend>
        {Array.from({length:7},(_,i)=>{const d=new Date(today+'T12:00:00');d.setDate(d.getDate()+i);const date=isoOf(d);return <label key={date}><input type="checkbox" checked={dates.includes(date)} onChange={e=>{setDates(e.target.checked?[...dates,date]:dates.filter(v=>v!==date));setProposal(null)}} /> {date}</label>})}
      </fieldset>
      {!S.queue && <p>{t('Accepting switches the current plan to a dated session queue. Your original routines and weekly plan stay saved.')}</p>}
      <Button onClick={preview}>{t('Preview adjustment')}</Button>
    </div>}
    {adaptationNeedsReview(S) && <p role="alert">{t('New training arrived after this adjustment. Review upcoming sessions.')}</p>}
    {error && <p role="alert">{errorText(error)}</p>}
    {proposal && <div aria-label={t('Proposed changes')} style={{marginTop:16}}>
      <p>{t('Only future sessions change. Completed work and the reusable program stay saved.')}</p>
      <p className="muted small">{t('Priorities use observed rolling seven-day gaps. Off-program work counts; unknown work is not zero. Future dates may move older work outside that window.')}</p>
      {proposal.remainingSessions.map((r,i)=><div key={r.date} style={{borderTop:'1px solid var(--line)',paddingTop:12,marginTop:12}}>
        <strong>{r.date} · {r.name}</strong>
        <p>{t('Estimated duration: {0} min',r.estimate.minutes)}</p>
        <p className="muted small">{t('Work {0}s · rest {1}s · transitions {2}s · warm-up {3} min',r.estimate.workSeconds,r.estimate.restSeconds,r.estimate.transitionSeconds,r.estimate.warmupMinutes)}</p>
        {r.ex.map((e,j)=><label key={j} style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,marginBottom:8}}><span>{exerciseNameText(exOr(e.id))} · {proposal.baseline.find(b=>b.id===e.adaptationSourceId)?.ex.find(x=>x.id===e.id)?.sets ?? '?'} → {e.sets}</span><input className="input" type="number" min="0" max="50" style={{width:60}} aria-label={t('Working sets {0}.{1}',i+1,j+1)} value={e.sets} onChange={ev=>changeSet(i,j,ev.target.value)} /></label>)}
        {r.deferred.length>0 && <p>{t('Deferred exercises: {0}',r.deferred.map(e=>`${exerciseNameText(exOr(e.id))} (${e.sets ?? '?'})`).join(', '))}</p>}
      </div>)}
      {proposal.shortfalls.length>0 && <div role="note"><strong>{t('Planning shortfalls')}</strong>{proposal.shortfalls.map((f,i)=><p className="small" key={i}>{f.code==='time'?t('Some prescribed work does not fit the time budget. It remains deferred; rest is not shortened.'):f.code==='availability'?t('{0} planned sessions have no available date.',f.sessions):f.code==='coverage-sets'?t('{0}: {1} estimated-set gaps remain against your aim.',f.muscle,f.sets):f.code==='coverage'?t('{0}: {1} observed direct-day gaps remain after these opportunities.',f.muscle,f.directDays):t('Some targets, roles or logged work are unknown. Review these separately; uncertainty counts may overlap.')}</p>)}</div>}
      <div style={{display:'flex',gap:8,marginTop:12}}><Button variant="primary" onClick={()=>{const result=acceptTrainingAdaptation(proposal);setError(result.error);if(!result.error){setUndo(result.undo);setProposal(null)}}}>{t('Accept adjustment')}</Button><Button onClick={()=>{setProposal(null);setError(null)}}>{t('Cancel')}</Button></div>
    </div>}
    {undo && <Button onClick={()=>{const result=undoTrainingAdaptation(undo);setError(result.error);if(!result.error)setUndo(null)}}>{t('Undo adjustment')}</Button>}
  </section>
}
