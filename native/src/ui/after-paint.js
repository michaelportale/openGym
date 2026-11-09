// Runs fn once the screen has painted and the JS thread is idle, so a heavy model never holds the
// first frame. Returns a cancel function. React Native's requestIdleCallback, with a timeout so a
// busy thread still gets there (InteractionManager is gone from react-native core); setTimeout
// where there is none. `host` is the global, passed in by tests.
export function afterPaint(fn, host = globalThis) {
  if (typeof host.requestIdleCallback === 'function') {
    const id = host.requestIdleCallback(() => fn(), { timeout: 500 })
    return () => host.cancelIdleCallback?.(id)
  }
  const id = host.setTimeout(fn, 0)
  return () => host.clearTimeout(id)
}
