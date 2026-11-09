const destinations = {
  home: {
    title: 'Home',
    phase: null,
    summary: 'Workouts are logged in the Workout tab. A summary of your next session and the nutrition summary are not built here yet. Nothing on this screen is logged, saved, or synced.'
  },
  plan: {
    title: 'Plan',
    phase: 7,
    summary: 'Your rotation and routines, with reorder, swap and progression overrides.'
  },
  progress: {
    title: 'Progress',
    phase: 7,
    summary: 'Measurements and nutrition arrive in Phase 7D. WHOOP follows in Phase 8.'
  }
}

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
