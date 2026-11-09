import { useCallback } from 'react'
import { useFocusEffect } from 'expo-router'
import { getHealth } from '../health/use-health'
import { getSync } from './use-sync'

// While the screen is focused: calls reload() once on focus, then again on every Health or sync emit.
// Unsubscribes on blur, including when an engine resolves after blur. `reload` must already be
// coalesced by the caller (see body/coalesce.js).
export function useFocusReload(reload) {
  useFocusEffect(useCallback(() => {
    let focused = true
    const offs = []
    const listen = engine => engine
      .then(e => {
        const off = e.subscribe(() => { reload() })
        if (focused) offs.push(off)
        else off() // blurred while the engine was being built
      })
      .catch(() => {})
    reload()
    listen(getHealth())
    listen(getSync())
    return () => {
      focused = false
      for (const off of offs.splice(0)) off()
    }
  }, [reload]))
}
