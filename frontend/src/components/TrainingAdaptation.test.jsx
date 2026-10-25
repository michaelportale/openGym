// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../lib/api.js', async original => ({ ...await original(), api: vi.fn() }))
import Plan from '../views/Plan.jsx'
import Home from '../views/Home.jsx'
import Modals from './Modals.jsx'
import { useUI } from '../store/useUI.js'
import { freshState, useStore } from '../store/useStore.js'
import { todayISO, isoOf } from '../lib/format.js'
import { mergeStates, stampChange, sinceReset, resetIdsOf } from '../lib/sync-merge.js'
let root,host
const state=()=>({...freshState(),routines:[{id:'p',name:'Push',ex:[{id:'0047',sets:3}]},{id:'u',name:'Pull',ex:[{id:'2330',sets:3}]},{id:'l',name:'Legs',ex:[{id:'0043',sets:3}]}],rotation:{id:'rot',sequence:['p','u','l']},queue:{ids:['p','u','l'],since:1,startsOn:todayISO(),rotationId:'rot'}})
beforeEach(()=>{globalThis.IS_REACT_ACT_ENVIRONMENT=true;useUI.setState({sheets:[]});host=document.createElement('div');document.body.append(host);root=createRoot(host);useStore.setState({S:state(),user:null});localStorage.removeItem('gym_plan_view')})
afterEach(()=>{act(()=>root.unmount());host.remove();localStorage.clear()})
// A sheet that closes arms Modals' scroll-restore timer (350 ms). Let the last one run before the
// test environment is torn down, or it fires against a missing window.
afterAll(()=>new Promise(r=>setTimeout(r,400)))
// Plan shows a row; the form itself opens in a sheet.
const row=()=>[...host.querySelectorAll('.adaptation-row .lrow')].find(x=>x.textContent.includes('Adjust upcoming training'))
const openForm=()=>{act(()=>root.render(<><Plan/><Modals/></>));act(()=>row().click())}
const card=()=>host.querySelector('[aria-label="Adjust upcoming training"]')
const button=text=>[...card().querySelectorAll('button')].find(x=>x.textContent===text)
const input=(label,value)=>{const el=card().querySelector(`[aria-label="${label}"]`);act(()=>{Object.getOwnPropertyDescriptor(el instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event(el instanceof HTMLSelectElement?'change':'input',{bubbles:true}))})}
const prepare=()=>{
  act(()=>button('Review availability').click())
  input('Push routine','p');input('Pull routine','u');input('Leg routine','l')
  const checks=card().querySelectorAll('input[type="checkbox"]')
  act(()=>{checks[0].click();checks[1].click()})
  act(()=>button('Preview adjustment').click())
}
// The form lives in Plan only; Home used to render a second copy.
it('is not rendered on Home',()=>{
  act(()=>root.render(<Home/>));expect(card()).toBeNull()
})
it('offers explicit day disposition in Plan and saving missed previews without changing the queue',()=>{
  openForm();expect(card()).not.toBeNull()
  expect(card().textContent).toContain('Unknown')
  input('Day status','missed')
  act(()=>button('Save day status').click())
  expect(useStore.getState().S.dayDispositions[todayISO()].status).toBe('missed')
  expect(useStore.getState().S.queue.ids).toEqual(['p','u','l'])
  expect(card().textContent).toContain('Available training dates')
})
it('previews edits, cancels without mutation, accepts through the store, and undoes future planning',()=>{
  openForm();const before=structuredClone(useStore.getState().S.queue)
  prepare()
  expect(card().textContent).toContain('Estimated duration')
  expect(card().textContent).toContain('3 → 3')
  act(()=>button('Cancel').click());expect(useStore.getState().S.queue).toEqual(before)
  act(()=>button('Preview adjustment').click())
  input('Working sets 1.1','2')
  expect(card().textContent).toContain('3 → 2')
  act(()=>button('Accept adjustment').click())
  expect(useStore.getState().S.queue.ids).toHaveLength(2)
  const id=useStore.getState().S.queue.ids[0]
  expect(useStore.getState().S.routines.find(r=>r.id===id).ex[0].sets).toBe(2)
  expect(JSON.parse(localStorage.getItem('gym_state_v1')).queue.ids).toContain(id)
  act(()=>button('Undo adjustment').click())
  expect(useStore.getState().S.queue).toEqual(before)
})
it('rejects a preview after a concurrent completed workout',()=>{
  openForm();prepare()
  act(()=>useStore.getState().update(s=>{s.workouts.push({id:'new',d:todayISO(),start:Date.now(),entries:[]})}))
  act(()=>button('Accept adjustment').click())
  expect(card().textContent).toContain('Training changed. Preview again before accepting.')
  expect(useStore.getState().S.queue.ids).toEqual(['p','u','l'])
})
it('merges independent explicit day statuses and reset clears the map',()=>{
  const base={...freshState(),dayDispositions:{},_ts:1},a=structuredClone(base),b=structuredClone(base)
  a.dayDispositions['2026-10-20']={status:'rest',_ts:10};b.dayDispositions['2026-10-21']={status:'trained-unlogged',_ts:20}
  stampChange(base,a,10);stampChange(base,b,20)
  const merged=mergeStates(a,b)
  expect(merged.dayDispositions).toMatchObject({'2026-10-20':{status:'rest'},'2026-10-21':{status:'trained-unlogged'}})
  expect(sinceReset(merged,30,resetIdsOf(merged)).dayDispositions).toEqual({})
})
it('unseen baseline completion warns for review without overwriting adapted completion, active work or new pins',()=>{
  const s=state();useStore.setState({S:s});openForm();prepare()
  act(()=>button('Accept adjustment').click())
  const accepted=structuredClone(useStore.getState().S.queue)
  act(()=>useStore.getState().update(merged=>{
    merged.workouts.push({id:'offline',d:todayISO(),start:2,routineId:'p',entries:[]})
    merged.workouts.push({id:'adapted',d:todayISO(),start:Date.now(),routineId:accepted.ids[0],entries:[]})
    merged.active={id:'running',routineIds:[accepted.ids[1]],entries:[]}
    merged.dayPlan['2099-01-01']='l'
  }))
  expect(card().textContent).toContain('New training arrived after this adjustment. Review upcoming sessions.')
  expect(row().textContent).toContain('New training arrived after this adjustment.')
  const merged=useStore.getState().S
  expect(merged.queue).toEqual(accepted)
  expect(merged.workouts.map(w=>w.id)).toEqual(['offline','adapted'])
  expect(merged.active.id).toBe('running')
  expect(merged.dayPlan['2099-01-01']).toBe('l')
})
it('lets the user include additional warm-up time before choosing work that fits',()=>{
  openForm();prepare()
  input('Additional warm-up minutes','10');input('Minutes per session','15')
  act(()=>button('Preview adjustment').click())
  expect(card().textContent).toContain('3 → 2')
  expect(card().textContent).toContain('warm-up 10 min')
})
it('checks another tab’s saved completion before accepting, even before its storage event arrives',()=>{
  openForm();prepare()
  const before=useStore.getState().S,other=structuredClone(before)
  other.workouts.push({id:'other-tab',d:todayISO(),start:Date.now(),entries:[]})
  stampChange(before,other,Date.now()+100)
  localStorage.setItem('gym_state_v1',JSON.stringify(other));localStorage.setItem('gym_state_wid','other-tab-write');localStorage.setItem('gym_state_owner','')
  act(()=>button('Accept adjustment').click())
  expect(card().textContent).toContain('Training changed. Preview again before accepting.')
  expect(useStore.getState().S.queue.ids).toEqual(['p','u','l'])
  expect(useStore.getState().S.workouts.some(w=>w.id==='other-tab')).toBe(true)
})
it('updates the coverage shortfall when the user edits proposed working sets',()=>{
  const s=state();s.coverageTargets={chest:{sets:10,directDays:2}};useStore.setState({S:s})
  openForm();prepare()
  expect(card().textContent).toContain('chest: 7 estimated-set gaps')
  input('Working sets 1.1','1')
  expect(card().textContent).toContain('chest: 9 estimated-set gaps')
})
it('names proposed exercises from the real catalogue so the review is actionable',()=>{
  openForm();prepare()
  expect(card().textContent.toLowerCase()).toContain('barbell incline bench press')
})
it.each([null,5,6])('defaults to six or preserves accepted total %s on reopen',total=>{
  const s=state()
  if(total)s.queue.adaptation={token:'accepted',policyVersion:1,baseline:s.routines,availability:{totalSessions:total},reviewedWork:'[]'}
  useStore.setState({S:s});openForm();act(()=>button('Review availability').click())
  expect(card().querySelector('[aria-label="Total training sessions"]').value).toBe(String(total || 6))
})
it('lets a user explicitly include a prior completed PPL prefix and reviews displaced pins',()=>{
  const s=state(),start=new Date(todayISO()+'T12:00:00');start.setDate(start.getDate()-1);const prior=isoOf(start)
  s.queue.since=Date.now();s.workouts=['p','u','l'].map((id,i)=>({id:'prior'+i,routineId:id,d:prior,start:start.getTime()+i,entries:[]}))
  const future=new Date(todayISO()+'T12:00:00');future.setDate(future.getDate()+1);s.dayPlan[isoOf(future)]='l'
  useStore.setState({S:s});openForm();prepare()
  expect(card().querySelector('[aria-label="Cycle credit"]')).not.toBeNull()
  input('Total training sessions','5');input('Cycle credit','selected');input('Cycle start',prior)
  act(()=>button('Preview adjustment').click())
  expect(card().textContent).toContain('Credited families: push, pull, legs')
  expect(card().textContent).toContain('Upper')
  expect(card().textContent).toContain('Original dated sessions replaced:')
})
it('Plan keeps the form behind one row, and the row carries the review warning',()=>{
  act(()=>root.render(<><Plan/><Modals/></>))
  expect(card()).toBeNull()
  expect(row()).toBeTruthy()
  expect(row().textContent).not.toContain('New training arrived')
  act(()=>row().click())
  expect(card()).not.toBeNull()
})
