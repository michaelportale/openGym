// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { useStore, DEF } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { importFromApp } from './sheets.jsx'
import { fitnessNote } from './test/fitness-notes.js'
let host,root
beforeEach(()=>{globalThis.IS_REACT_ACT_ENVIRONMENT=true;useUI.setState({sheets:[],toasts:[]});useStore.setState({S:structuredClone(DEF),user:null,ready:true})})
afterEach(()=>{if(root)act(()=>root.unmount());root=null;document.body.innerHTML='';localStorage.clear()})
const open=async files=>{
  await act(async()=>{importFromApp(files);for(let i=0;i<50&&!useUI.getState().sheets.length;i++)await new Promise(r=>setTimeout(r,5))})
  const sheet=useUI.getState().sheets.at(-1);expect(sheet).toBeTruthy()
  host=document.createElement('div');document.body.appendChild(host);root=createRoot(host)
  act(()=>root.render(sheet.render(()=>{})))
}
const button=text=>[...host.querySelectorAll('button')].find(b=>b.textContent===text)
it('previews multiple Markdown records with explicit mapping, then imports only on confirmation',async()=>{
  await open([new File([fitnessNote()],'first.md'),new File([fitnessNote({key:'synthetic-beta'})],'second.md')])
  expect(useStore.getState().S.workouts).toHaveLength(0)
  expect(host.textContent).toContain('2')
  expect(host.textContent).toContain('kg per hand')
  expect(host.querySelectorAll('select').length).toBeGreaterThan(0)
  const optIns=host.querySelectorAll('input[type=checkbox]')
  expect(optIns).toHaveLength(2);expect([...optIns].every(c=>!c.checked)).toBe(true)
  act(()=>button('Import').click())
  expect(useStore.getState().S.workouts).toHaveLength(2)
  expect(useStore.getState().S.routines).toHaveLength(0)
})
it('allows proposals alone as saved routines without activation or history',async()=>{
  const text=fitnessNote().replace(/## Actual warm-ups[\s\S]*?## Drop sets/,'## Drop sets')
  await open([new File([text],'plan.md')])
  expect(button('Import').disabled).toBe(true)
  act(()=>host.querySelector('input[type=checkbox]').click())
  expect(button('Import').disabled).toBe(false)
  act(()=>button('Import').click())
  expect(useStore.getState().S.workouts).toHaveLength(0)
  expect(useStore.getState().S.routines).toHaveLength(1)
  expect(useStore.getState().S.queue).toBeNull()
})
it('shows source conflicts, blocks a repeated correction and permits cancellation without writes',async()=>{
  await open([new File([fitnessNote()],'first.md')]);act(()=>button('Import').click())
  act(()=>root.unmount());root=null;useUI.setState({sheets:[]})
  await open([new File([fitnessNote({reps:'8'})],'renamed.md')])
  expect(host.textContent).toMatch(/conflict/i)
  expect(button('Import').disabled).toBe(true)
  act(()=>button('Cancel').click())
  expect(useStore.getState().S.workouts).toHaveLength(1)
  expect(useStore.getState().S.workouts[0].entries[0].sets[2].r).toBeNull()
})
it('explains limits on settings-based load aggregates before the explicit import',async()=>{
  await open([new File([fitnessNote({convention:'lb displayed setting'})],'settings.md')])
  expect(host.textContent).toContain('Machine settings and unknown load conventions stay out of load totals and strength estimates.')
})
