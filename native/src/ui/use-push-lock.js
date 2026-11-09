import { useCallback, useRef } from 'react'
import { useFocusEffect } from 'expo-router'

// A second tap while the first push is still animating would stack another screen, so taps are
// ignored until the tab is focused again (or a second has passed, in case the push never lands).
// guard(push) runs push unless one is already in flight.
export function usePushLock() {
  const pushing = useRef(false)
  useFocusEffect(useCallback(() => { pushing.current = false }, []))
  return useCallback(push => {
    if (pushing.current) return
    pushing.current = true
    setTimeout(() => { pushing.current = false }, 1000)
    push()
  }, [])
}
