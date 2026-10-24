// Press and hold a stepper's + or − to keep stepping: one step on the press, then after 400 ms
// eight steps a second until the finger lifts or leaves the button. A plain tap still steps once
// through the click (which is also what a keyboard or a switch control sends); the click that
// ends a hold is swallowed so the hold does not step one extra time.
//
// One hold at a time, so the timers live here rather than on the button: a step re-renders the
// row, and the handlers of the render that started the hold are not the ones that see it end.
export const HOLD_DELAY = 400
export const HOLD_EVERY = 125

let hold = null
const stop = () => {
  if (!hold) return
  clearTimeout(hold.wait); clearInterval(hold.every)
  hold.wait = hold.every = null
  if (hold.off) { hold.off(); hold.off = null }
}

// A lift anywhere ends the hold: the button's own pointerup is lost when the row re-renders
// under the finger or the pointer is released outside the window's hit-test of the button.
const listenForRelease = h => {
  if (typeof document === 'undefined') return
  const end = () => { if (hold === h) stop() }
  document.addEventListener('pointerup', end, true)
  document.addEventListener('pointercancel', end, true)
  h.off = () => {
    document.removeEventListener('pointerup', end, true)
    document.removeEventListener('pointercancel', end, true)
  }
}

// The view that rendered the buttons is leaving: a hold it started stops with it, so no timer
// keeps stepping a set that is no longer on screen.
export function cancelHold(owner) {
  if (!hold || (owner !== undefined && hold.owner !== owner)) return
  stop(); hold = null
}

export function holdRepeat(step, owner) {
  return {
    onPointerDown: e => {
      if (e.button != null && e.button !== 0) return
      stop()
      const h = hold = { repeated: false, wait: null, every: null, off: null, owner }
      listenForRelease(h)
      h.wait = setTimeout(() => {
        h.repeated = true
        step()
        h.every = setInterval(step, HOLD_EVERY)
      }, HOLD_DELAY)
    },
    onPointerUp: stop,
    // Sliding off the button ends the hold. A mouse or pen that slides off while still pressed
    // sends no closing click, so the hold forgets that it repeated and the next tap is not
    // swallowed. A finger is different: its lift sends pointerup, then pointerleave, then the
    // click, so a touch leave (or any leave with nothing pressed) keeps `repeated` and the click
    // that ends a long press is still swallowed.
    onPointerLeave: e => {
      stop()
      if (hold && e?.pointerType !== 'touch' && e?.buttons > 0) hold.repeated = false
    },
    onPointerCancel: stop,
    onContextMenu: e => { if (hold?.repeated) e.preventDefault() },
    onClick: () => {
      if (hold?.repeated) { hold = null; return }
      stop(); hold = null
      step()
    },
  }
}
