import { useEffect } from 'react'
import { useUI } from '../store/useUI.js'
import { darkAttrOf } from '../theme/palettes.js'

// Flips the app's real light/dark theme on and off twice (~2.4s) instead of laying an
// opaque black/white rectangle over the screen — the alert reads as the app itself
// blinking, and it always settles back on whatever theme the user actually had.
export default function TimerFlash() {
  const id = useUI(s => s.timerFlashId)
  useEffect(() => {
    if (!id) return
    const de = document.documentElement
    const original = de.dataset.theme
    // dark is the palette's own name (theme/palettes.js), so light flips back to that
    const opposite = original === 'light' ? darkAttrOf(de) : 'light'
    const steps = [opposite, original, opposite, original]
    const timers = steps.map((theme, i) => setTimeout(() => { de.dataset.theme = theme }, i * 600))
    return () => {
      timers.forEach(clearTimeout)
      de.dataset.theme = original
    }
  }, [id])
  return null
}
