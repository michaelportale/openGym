// A row pops its Done mark only when it goes from a known open state to done. `previous` is
// undefined on the row's first render, so a set that was already done when the screen mounted,
// or when the exercise changed, never animates.
export function becameDone(previous, status) {
  return previous !== undefined && previous !== 'done' && status === 'done'
}
