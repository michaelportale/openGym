// Every tab is built, so there is no placeholder destination left. An id here would be shown by
// UnbuiltScreen with its "Not built yet" copy.
const destinations = {}

export function destinationCopy(id) {
  if (!Object.hasOwn(destinations, id)) throw new Error(`Unknown destination: ${id}`)
  const destination = destinations[id]
  return {
    title: destination.title,
    phase: destination.phase,
    summary: destination.summary,
    status: 'Not built yet',
    phaseLabel: destination.phase == null ? null : `Arrives in Phase ${destination.phase}`,
    recorded: false
  }
}
