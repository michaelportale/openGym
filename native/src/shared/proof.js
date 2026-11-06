import { exercises, onerm } from './training.js'

export function sharedLogicProof() {
  return {
    e1rm: onerm.estimate1RM(100, 10),
    catalogueSize: Object.keys(exercises.EXIDX).length
  }
}
