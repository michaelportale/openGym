// One frame at a time, and only for a mouse: no sensor access, idle loop or touch work.
export function installMaterialLight(root = document) {
  const motion = window.matchMedia('(prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine)')
  let card = null
  let frame = 0
  let point = null
  const reset = () => {
    cancelAnimationFrame(frame)
    frame = 0
    card?.classList.remove('material-lit')
    card?.style.removeProperty('--shine-x')
    card?.style.removeProperty('--shine-y')
    card = null
  }
  const move = event => {
    if (!motion.matches || event.pointerType !== 'mouse') return
    const next = event.target.closest?.('.today-card, .coverage-glance, .weight-card, .streak-card')
    if (next !== card) { reset(); card = next }
    if (!card) return
    point = { x: event.clientX, y: event.clientY }
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      const rect = card.getBoundingClientRect()
      card.style.setProperty('--shine-x', `${point.x - rect.left}px`)
      card.style.setProperty('--shine-y', `${point.y - rect.top}px`)
      card.classList.add('material-lit')
    })
  }
  const leave = event => { if (!event.relatedTarget || (card && !card.contains(event.relatedTarget))) reset() }
  root.addEventListener('pointermove', move, { passive: true })
  root.addEventListener('pointerout', leave)
  motion.addEventListener('change', reset)
  return () => {
    reset()
    root.removeEventListener('pointermove', move)
    root.removeEventListener('pointerout', leave)
    motion.removeEventListener('change', reset)
  }
}
