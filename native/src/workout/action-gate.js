// One in-flight action at a time: a double tap on Complete must not log two sets.
export function createActionGate() {
  let pending = false
  return async function run(fn) {
    if (pending) return { ignored: true }
    pending = true
    try {
      return await fn()
    } finally {
      pending = false
    }
  }
}
