export function plannedSetId(exerciseId, index) {
  return `plan:${exerciseId}:${index}`
}

export function createEventId() {
  const crypto = globalThis.crypto
  if (crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `evt-${Date.now()}-${Math.random().toString(16).slice(2)}`
}
