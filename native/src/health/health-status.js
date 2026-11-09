// The Health section's status lines, from the engine's status.
const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

export function healthLines(status) {
  const { on, write, exported = 0, waiting = 0, skipped = 0, error } = status ?? {}
  if (!on) {
    const lines = ['Off. Your workouts are not sent to Apple Health.']
    if (error) lines.push(`Last try: ${error}`)
    return lines
  }
  const lines = [
    write === 'off'
      ? 'On, but writing to Apple Health is turned off. Turn on Workouts in Settings → Health → Data Access & Devices → openGym.'
      : 'On. Finished workouts go to Apple Health.',
    `${count(exported, 'workout')} in Health`,
  ]
  if (waiting > 0) lines.push(`${waiting} waiting`)
  if (error) lines.push(`Last try: ${error}`)
  if (skipped > 0) lines.push(`${skipped} skipped (no start or end time)`)
  return lines
}
