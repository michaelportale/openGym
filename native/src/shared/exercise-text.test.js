import { describe, it, expect } from 'vitest'
import { i18nCore, exercises } from './training.js'
import { loadExerciseText, exerciseTextLoaded } from './exercise-text.js'

describe('loadExerciseText', () => {
  const ex = exercises.EXIDX['0001']

  it('has no English text until it loads, then has steps and a description', async () => {
    expect(i18nCore.instrFor(ex)).toEqual([])
    expect(i18nCore.descFor(ex)).toBe('')
    expect(exerciseTextLoaded()).toBe(false)
    expect(await loadExerciseText()).toBe(true)
    const steps = i18nCore.instrFor(ex)
    expect(exerciseTextLoaded()).toBe(true)
    expect(steps.length).toBeGreaterThan(0)
    expect(steps.every(s => typeof s === 'string')).toBe(true)
    const desc = i18nCore.descFor(ex)
    expect(typeof desc).toBe('string')
    expect(desc.length).toBeGreaterThan(0)
  })

  it('memoises: a second call is the same promise', () => {
    expect(loadExerciseText()).toBe(loadExerciseText())
  })

  it('leaves a custom exercise its own description and no steps', async () => {
    await loadExerciseText()
    const custom = { id: 'cX', desc: 'mine' }
    expect(i18nCore.descFor(custom)).toBe('mine')
    expect(i18nCore.instrFor(custom)).toEqual([])
  })
})
