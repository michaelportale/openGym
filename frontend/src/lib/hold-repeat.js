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
}

export function holdRepeat(step) {
  return {
    onPointerDown: e => {
      if (e.button != null && e.button !== 0) return
      stop()
      const h = hold = { repeated: false, wait: null, every: null }
      h.wait = setTimeout(() => {
        h.repeated = true
        step()
        h.every = setInterval(step, HOLD_EVERY)
      }, HOLD_DELAY)
    },
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
    onContextMenu: e => { if (hold?.repeated) e.preventDefault() },
    onClick: () => {
      if (hold?.repeated) { hold = null; return }
      stop(); hold = null
      step()
    },
  }
}
