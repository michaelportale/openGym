// While a screen's own Start button is on screen, the tab bar's Start (the round button in the
// middle) would be a second copy of the same action, so it steps aside: `body.fab-aside` fades
// it out and takes it out of the tap and focus order; it comes back as soon as the screen's
// button scrolls out of view or goes away. Without IntersectionObserver nothing changes.
import { useEffect } from 'react'

export const FAB_ASIDE = 'fab-aside'

export function useFabAsideWhileVisible(ref, on) {
  useEffect(() => {
    const el = ref.current
    if (!on || !el || typeof IntersectionObserver !== 'function') return undefined
    const io = new IntersectionObserver(([entry]) => {
      document.body.classList.toggle(FAB_ASIDE, !!entry?.isIntersecting)
    }, { threshold: 0.5 })
    io.observe(el)
    return () => { io.disconnect(); document.body.classList.remove(FAB_ASIDE) }
  }, [ref, on])
}
