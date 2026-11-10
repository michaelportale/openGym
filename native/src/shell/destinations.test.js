import { expect, test } from 'vitest'
import { destinationCopy } from './destinations.js'

test('every tab is built, so none is a destination', () => {
  for (const id of ['home', 'plan', 'exercises', 'progress']) expect(() => destinationCopy(id)).toThrow(/Unknown destination/)
})

test('an unknown destination throws', () => {
  expect(() => destinationCopy('workout')).toThrow('workout')
  expect(() => destinationCopy('constructor')).toThrow('constructor')
})
