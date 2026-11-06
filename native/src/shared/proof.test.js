import { expect, test } from 'vitest'
import { sharedLogicProof } from './proof.js'

test('runs shared logic with known values', () => {
  const { e1rm, catalogueSize } = sharedLogicProof()
  expect(e1rm).toBe(133.3)
  expect(catalogueSize).toBeGreaterThan(1000)
})
