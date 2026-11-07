import { expect, test } from 'vitest'
import { foldJournal } from './fold.js'
import { plannedSetId } from './ids.js'

const base = {
  id: 'w1',
  entries: [
    { id: 'bench', sets: [{ id: 'bench-0', w: 60, r: 5, done: false }] },
    { id: 'row', sets: [{ id: 'row-0', w: 40, r: 8, done: false }] },
  ],
}

function shape(model) {
  return model.entries.map(entry => ({
    id: entry.id,
    sets: entry.sets.map(slot => slot.setId),
  }))
}

test('a replayed add that reuses a set id is dropped', () => {
  const otherExercise = foldJournal(base, [
    { id: 'add-other', type: 'set.add', at: 1, exerciseId: 'row', setId: 'bench-0', fields: { w: 99, r: 9 } },
  ])
  expect(shape(otherExercise)).toEqual([
    { id: 'bench', sets: ['bench-0'] },
    { id: 'row', sets: ['row-0'] },
  ])

  const sameExercise = foldJournal(base, [
    { id: 'add-same', type: 'set.add', at: 1, exerciseId: 'bench', setId: 'bench-0', fields: { w: 99, r: 9 } },
  ])
  expect(shape(sameExercise)).toEqual([
    { id: 'bench', sets: ['bench-0'] },
    { id: 'row', sets: ['row-0'] },
  ])

  const copiedSet = foldJournal(base, [
    {
      id: 'copy-taken',
      type: 'exercise.add',
      at: 1,
      exerciseId: 'curl',
      entry: { sets: [{ id: 'bench-0', w: 12, r: 10 }, { id: 'curl-plain', w: 10, r: 8 }] },
    },
  ])
  expect(shape(copiedSet)).toEqual([
    { id: 'bench', sets: ['bench-0'] },
    { id: 'row', sets: ['row-0'] },
  ])

  const copiedPair = foldJournal(base, [
    {
      id: 'copy-pair',
      type: 'exercise.add',
      at: 1,
      exerciseId: 'curl',
      entry: { sets: [{ id: 'same', w: 12, r: 10 }, { id: 'same', w: 14, r: 8 }] },
    },
  ])
  expect(shape(copiedPair)).toEqual([
    { id: 'bench', sets: ['bench-0'] },
    { id: 'row', sets: ['row-0'] },
  ])

  const copiedNumber = foldJournal(base, [
    { id: 'plant-zero', type: 'set.add', at: 1, exerciseId: 'row', setId: '0', fields: { w: 1, r: 1 } },
    {
      id: 'copy-number',
      type: 'exercise.add',
      at: 2,
      exerciseId: 'curl',
      entry: { sets: [{ id: 0, w: 12, r: 10 }] },
    },
  ])
  expect(shape(copiedNumber)).toEqual([
    { id: 'bench', sets: ['bench-0'] },
    { id: 'row', sets: ['row-0', '0'] },
  ])

  const copiedPlan = foldJournal(base, [
    { id: 'plant-plan', type: 'set.add', at: 1, exerciseId: 'bench', setId: plannedSetId('fly', 0), fields: { w: 8, r: 12 } },
    {
      id: 'copy-plan',
      type: 'exercise.add',
      at: 2,
      exerciseId: 'fly',
      entry: { sets: [{ w: 8, r: 12 }] },
    },
  ])
  expect(shape(copiedPlan)).toEqual([
    { id: 'bench', sets: ['bench-0', plannedSetId('fly', 0)] },
    { id: 'row', sets: ['row-0'] },
  ])
})

test('a replayed add with fresh set ids is kept', () => {
  const model = foldJournal(base, [
    { id: 'add-fresh', type: 'set.add', at: 1, exerciseId: 'row', setId: 'extra', fields: { w: 40, r: 8 } },
    {
      id: 'copy-fresh',
      type: 'exercise.add',
      at: 2,
      exerciseId: 'curl',
      entry: { sets: [{ id: 'curl-0', w: 10, r: 10 }, { w: 12, r: 8 }] },
    },
  ])
  expect(shape(model)).toEqual([
    { id: 'bench', sets: ['bench-0'] },
    { id: 'row', sets: ['row-0', 'extra'] },
    { id: 'curl', sets: ['curl-0', plannedSetId('curl', 1)] },
  ])
  const curl = model.entries.find(entry => entry.id === 'curl')
  expect(curl.sets[0].row).toMatchObject({ w: 10, r: 10, done: false })
  expect(curl.sets[1].row).toMatchObject({ w: 12, r: 8, done: false })
})
