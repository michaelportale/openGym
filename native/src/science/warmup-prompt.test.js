import { expect, test } from 'vitest'
import { exercises } from '../shared/training.js'
import { muscleGroupOf, warmupPrompts, warmupPromptWhy } from './warmup-prompt.js'

const idsFor = bp => Object.values(exercises.EXIDX).filter(ex => ex.bp === bp).map(ex => ex.id)
const [firstChest, secondChest] = idsFor('chest')
const [back] = idsFor('back')

test('the first lift for a body part is prompted, and a later lift for that body part is not', () => {
  expect(muscleGroupOf(firstChest)).toBe('chest')
  expect(muscleGroupOf({ id: firstChest })).toBe('chest')
  expect(muscleGroupOf({ id: 'not-a-catalogue-id' })).toBeNull()
  expect(muscleGroupOf(null)).toBeNull()
  const prompts = warmupPrompts([firstChest, secondChest, back, firstChest])
  expect(prompts).toEqual([
    { id: firstChest, group: 'chest', prompt: true },
    { id: secondChest, group: 'chest', prompt: false },
    { id: back, group: 'back', prompt: true },
    { id: firstChest, group: 'chest', prompt: false }
  ])
})

test('an exercise with no catalogue body part is not prompted and does not consume a group', () => {
  const prompts = warmupPrompts(['not-a-catalogue-id', firstChest])
  expect(prompts[0]).toEqual({ id: 'not-a-catalogue-id', group: null, prompt: false })
  expect(prompts[1].prompt).toBe(true)
})

test('an empty session prompts nothing', () => {
  expect(warmupPrompts([])).toEqual([])
  expect(warmupPrompts(null)).toEqual([])
})

test('the prompt explains itself as our inference', () => {
  const why = warmupPromptWhy()
  expect(why.ruleId).toBe('warmup-prompt')
  expect(why.source).toContain('Our inference')
  expect(why.reason.toLowerCase()).toContain('first lift')
})
