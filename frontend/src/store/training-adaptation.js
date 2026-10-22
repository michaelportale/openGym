import { useStore } from './useStore.js'
import { applyAdaptation, undoAdaptation } from '../lib/training-adaptation.js'
import { undoMarks, markUndone } from '../lib/sync-merge.js'

export function acceptTrainingAdaptation(proposal) {
  let before
  let result
  useStore.getState().updateCurrent(s=>{
    before=structuredClone(s)
    result=applyAdaptation(s,proposal)
    if (!result.error) Object.assign(s,result.state)
  })
  if (!result.error) result.undo.marks=undoMarks(before,useStore.getState().S)
  return result
}
export function undoTrainingAdaptation(undo) {
  let result
  useStore.getState().updateCurrent(s=>{
    result=undoAdaptation(s,undo)
    if (!result.error) { Object.assign(s,result.state); markUndone(s,undo.marks) }
  })
  return result
}
