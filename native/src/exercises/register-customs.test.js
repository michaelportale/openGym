import { expect, test } from 'vitest'
import { exercises, history } from '../shared/training.js'
import { registerScreenCustoms } from './register-customs.js'

// A custom with no mode is reps until it is in EXIDX. Cardio is the body part, read by modeOf
// only after registerCustom. healCustomEx must not be written back onto the caller's list.
test('a flagged cardio custom is cardio after registration, and the stored entry is not copied', () => {
  const entry = { id: 'c-cardio-reg', n: 'Run', bp: 'cardio', eq: 'body weight', custom: true }
  const state = { customEx: [entry] }
  try {
    expect(history.modeOf({ id: 'c-cardio-reg' })).toBe('reps')
    registerScreenCustoms(state)
    expect(history.modeOf({ id: 'c-cardio-reg' })).toBe('cardio')
    expect(state.customEx[0]).toBe(entry)
  } finally {
    exercises.registerCustom([])
  }
})

test('a custom missing the flag is registered as custom, and the flag is not written back', () => {
  const entry = { id: 'c-heal-reg', n: 'Lift', bp: 'arms', eq: 'dumbbell' }
  const state = { customEx: [entry] }
  try {
    registerScreenCustoms(state)
    expect(exercises.isCustomEx(exercises.EXIDX['c-heal-reg'])).toBe(true)
    expect(state.customEx[0]).toBe(entry)
    expect(state.customEx[0].custom).toBeUndefined()
  } finally {
    exercises.registerCustom([])
  }
})

test('a state with no customEx list leaves customs already registered', () => {
  const entry = { id: 'c-cardio-reg', n: 'Run', bp: 'cardio', eq: 'body weight', custom: true }
  try {
    registerScreenCustoms({ customEx: [entry] })
    expect(history.modeOf({ id: 'c-cardio-reg' })).toBe('cardio')
    registerScreenCustoms({})
    registerScreenCustoms(undefined)
    expect(history.modeOf({ id: 'c-cardio-reg' })).toBe('cardio')
    registerScreenCustoms({ customEx: [] })
    expect(history.modeOf({ id: 'c-cardio-reg' })).toBe('reps')
  } finally {
    exercises.registerCustom([])
  }
})
