import { useEffect, useRef, useState } from 'react'
import { createSessionController } from './session-controller.js'

const ACTIONS = [
  'putDraft',
  'commitSet',
  'editSet',
  'undoSet',
  'addSet',
  'moveExercise',
  'startRest',
  'pauseRest',
  'extendRest',
  'cancelRest',
  'resume',
  'finish',
  'discard',
]

// Restores the open session once, when the screen mounts. options.storage, base, now, and
// timeZone are read from the first render. A storage error comes back as { ok: false, saved: false }
// from the action and as error on the hook value. The set stays unsaved.
export function useActiveSession(options) {
  const controllerRef = useRef(null)
  if (controllerRef.current == null) controllerRef.current = createSessionController(options)
  const controller = controllerRef.current
  const [state, setState] = useState(() => controller.getState())
  const liveRef = useRef(true)
  const actionsRef = useRef(null)
  if (actionsRef.current == null) {
    actionsRef.current = Object.fromEntries(ACTIONS.map(name => [name, async (...args) => {
      const result = await controller.call(name, ...args)
      if (liveRef.current) setState(controller.getState())
      return result
    }]))
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
