// The backup the owner shares after a session: every finished workout on the phone, in the
// shape the API stores, so a later import can read it. Null when there is nothing to send, so
// the screen says so instead of opening an empty share sheet.
export function exportPayload(workouts, { exportedAt, appVersion } = {}) {
  if (!Array.isArray(workouts) || workouts.length === 0) return null
  return JSON.stringify({
    app: 'opengym-native',
    version: 1,
    exportedAt,
    appVersion: appVersion ?? null,
    workouts,
  })
}
