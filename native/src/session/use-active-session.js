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

// Restores the open session once, when the screen mounts. options.storage, base, now, and
// timeZone are read from the first render. A storage error comes back as { ok: false, saved: false }
// from the action and as error on the hook value. The set stays unsaved.
export function useActiveSession(options) {
  const controllerRef = useRef(null)
  if (controllerRef.current == null) controllerRef.current = createSessionController(sessionOptionsFrom(options))
  const controller = controllerRef.current
  const [state, setState] = useState(() => controller.getState())
  const liveRef = useRef(true)
  const actionsRef = useRef(null)
  if (actionsRef.current == null) {
    const actions = Object.fromEntries(ACTIONS.map(name => [name, async (...args) => {
      const result = await controller.call(name, ...args)
      if (liveRef.current) setState(controller.getState())
      return result
    }]))
    actions.finishSession = async (input) => {
      const result = await controller.finishSession(input)
      if (liveRef.current) setState(controller.getState())
      return result
    }
    actionsRef.current = actions
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
