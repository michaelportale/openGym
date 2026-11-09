import { useEffect, useRef, useState } from 'react'
import { createSessionController } from './session-controller.js'
import { createSqliteSessionStorage } from './sqlite-storage.js'
import { createSqliteFinishedWorkouts } from './finished-workouts.js'

const ACTIONS = [
  'putDraft',
  'commitSet',
  'editSet',
  'undoSet',
  'removeSet',
  'addSet',
  'addExercise',
  'removeExercise',
  'moveExercise',
  'setNote',
  'setExerciseNote',
  'startRest',
  'pauseRest',
  'extendRest',
  'cancelRest',
  'resume',
  'finish',
  'discard',
]

// A db handle becomes the SQLite journal and the finished-workout store. Storage or
// finishedWorkouts passed by the caller stay as given.
export function sessionOptionsFrom(options = {}) {
  if (!options.db) return options
  return {
    ...options,
    storage: options.storage ?? createSqliteSessionStorage(options.db),
    finishedWorkouts: options.finishedWorkouts ?? createSqliteFinishedWorkouts(options.db),
  }
}

// The controller the hook keeps, from the options of its first render.
export function activeSessionController(options) {
  return createSessionController(sessionOptionsFrom(options))
}

// What the hook hands the screen besides the state: each command on `controller`, then
// `publish()` so the screen re-renders with the state the command settled in.
export function sessionActions(controller, publish) {
  const settled = run => async (...args) => {
    const result = await run(...args)
    publish()
    return result
  }
  const actions = Object.fromEntries(ACTIONS.map(name => [name, settled((...args) => controller.call(name, ...args))]))
  actions.finishSession = settled(input => controller.finishSession(input))
  // The state as of the last settled action. After `await commitSet(...)` the hook value in a
  // closure is still the old render, and the screen needs the new row's `at` to start its rest.
  actions.getState = () => controller.getState()
  // The view at the clock now; writes nothing (the controller's refresh).
  actions.refresh = settled(() => controller.refresh())
  return actions
}

// Restores the open session once, when the screen mounts. options.storage, base, now, and
// timeZone are read from the first render. A storage error comes back as { ok: false, saved: false }
// from the action and as error on the hook value. The set stays unsaved.
export function useActiveSession(options) {
  const controllerRef = useRef(null)
  if (controllerRef.current == null) controllerRef.current = activeSessionController(options)
  const controller = controllerRef.current
  const [state, setState] = useState(() => controller.getState())
  const liveRef = useRef(true)
  const actionsRef = useRef(null)
  // Nothing is published once the screen has gone.
  if (actionsRef.current == null) {
    actionsRef.current = sessionActions(controller, () => {
      if (liveRef.current) setState(controller.getState())
    })
  }

  useEffect(() => {
    let live = true
    liveRef.current = true
    controller.open().then(next => {
      if (live) setState(next)
    })
    return () => {
      live = false
      liveRef.current = false
    }
  }, [controller])

  return { ...state, ...actionsRef.current }
}
