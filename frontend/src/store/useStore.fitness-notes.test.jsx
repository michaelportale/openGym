// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest'
import { useStore, DEF } from './useStore.js'
import { parseFitnessNotes, prepareFitnessNotes, fitnessNotesPreview } from '../lib/import-fitness-notes.js'
import { mergeImport } from '../lib/import-csv.js'
import { mergeStates } from '../lib/sync-merge.js'
import { exportBackupZip, readBackupFile } from '../lib/backup-media.js'
import { convertStateUnit } from '../lib/units.js'
import { fitnessNote } from '../test/fitness-notes.js'
afterEach(()=>{localStorage.clear();useStore.setState({S:structuredClone(DEF),user:null,ready:false})})
it('keeps source identity, unknowns and equipment through real backup export/restore, unit switch and sync',async()=>{
  const state=structuredClone(DEF)
  const parsed=parseFitnessNotes([{name:'synthetic.md',text:fitnessNote({convention:'lb per hand',load:'22'})}])
  mergeImport(state,prepareFitnessNotes(parsed,state))
  const exported=await exportBackupZip(state)
  const read=await readBackupFile(exported.blob)
  useStore.setState({S:structuredClone(DEF),user:null,ready:true})
  useStore.getState().importBackup(read.state)
  const restored=useStore.getState().S
  expect(restored.workouts[0]).toMatchObject({sourceKey:'fitness-notes:synthetic-alpha',historicalImport:true,start:null,end:null})
  expect(restored.workouts[0].entries[0].sets[2]).toMatchObject({r:null,sourceLoad:{value:22,unit:'lb',basis:'lb per hand'}})
  const other=convertStateUnit(structuredClone(restored),'lb')
  const merged=mergeStates(restored,other)
  expect(fitnessNotesPreview(merged,parsed)).toMatchObject({fresh:0,duplicates:1,conflicts:0})
  expect(mergeImport(merged,prepareFitnessNotes(parsed,merged)).added).toBe(0)
  expect(merged.workouts).toHaveLength(1)
  expect(merged.workouts[0].entries[0].trainingSnapshot).toEqual({role:null,primary:[],secondary:[],status:'unknown'})
  expect(merged.workouts[0].entries[0].sets[2].r).toBeNull()
})

it('unit switches update imported display units once, retaining raw source loads and missing values',async()=>{
  const {setLabel}=await import('../lib/history.js')
  const s=structuredClone(DEF),parsed=parseFitnessNotes([{name:'synthetic.md',text:fitnessNote({load:'22',convention:'lb per hand'})}])
  mergeImport(s,prepareFitnessNotes(parsed,s))
  const switched=convertStateUnit(s,'lb'),e=switched.workouts[0].entries[0]
  expect(setLabel(e.id,e.sets[2])).toBe('22 lb per hand × ?')
  expect(e.sets[2].sourceLoad.value).toBe(22)
  expect(e.sets[2].r).toBeNull()
})

it('keeps a source load with an unknown unit unknown through a profile unit switch',()=>{
  const s=structuredClone(DEF),p=parseFitnessNotes([{name:'synthetic.md',text:fitnessNote({load:'22',convention:'as reported; unit unknown'})}])
  mergeImport(s,prepareFitnessNotes(p,s))
  const converted=convertStateUnit(s,'lb')
  expect(converted.workouts[0].entries[0].sets[1].w).toBe(22)
  expect(converted.workouts[0].entries[0].equipmentSnapshot.unit).toBeNull()
})
