const destinations = {
  home: {
    title: 'Home',
    phase: null,
    summary: 'Your next session, with start and resume, is not built. The nutrition summary is not built. Nothing on this screen is logged, saved, or synced.'
  },
  plan: {
    title: 'Plan',
    phase: 7,
    summary: 'Your rotation and routines, with reorder, swap and progression overrides.'
  },
  progress: {
    title: 'Progress',
    phase: 7,
    summary: 'Body weight, lift history and e1RM, measurements and nutrition. WHOOP follows in Phase 8.'
  },
  exercises: {
    title: 'Exercises',
    phase: 7,
    summary: 'Browse and search the catalogue and your custom exercises.'
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
