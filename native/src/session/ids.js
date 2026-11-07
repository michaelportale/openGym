export function plannedSetId(exerciseId, index) {
  return `plan:${exerciseId}:${index}`
}

export function createEventId() {
  const id = globalThis.crypto?.randomUUID?.()
  if (typeof id === 'string' && id) return id
  return `evt-${Date.now()}-${Math.random().toString(16).slice(2)}`
}
