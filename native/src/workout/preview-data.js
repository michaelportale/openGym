// Six rows is on purpose: it is the worst case Phase 2 has to fit.
export const previewWorkout = {
  routine: 'Push day',
  exerciseNumber: 2,
  exerciseCount: 6,
  exercise: {
    category: 'Chest · Compound',
    name: 'Bench press',
    lastSession: 'Last session 135 lb × 8',
    sets: [
      { number: 1, weight: 135, reps: 8, status: 'done' },
      { number: 2, weight: 135, reps: 8, status: 'done' },
      { number: 3, weight: 135, reps: 8, status: 'active' },
      { number: 4, weight: 135, reps: 8, status: 'pending' },
      { number: 5, weight: 135, reps: 8, status: 'pending' },
      { number: 6, weight: 135, reps: 8, status: 'pending' }
    ]
  },
  upNext: 'Incline dumbbell press',
  rest: { remainingText: '01:24', progress: 0.55 }
}
