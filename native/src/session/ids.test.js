import { afterEach, expect, test } from 'vitest'
import { createEventId } from './ids.js'

const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
const UUID = '11111111-1111-4111-8111-111111111111'

function useCrypto(value) {
  Object.defineProperty(globalThis, 'crypto', { value, configurable: true, writable: true })
}

afterEach(() => {
  Object.defineProperty(globalThis, 'crypto', originalCrypto)
})

test('createEventId uses crypto.randomUUID when it is available', () => {
  let calls = 0
  useCrypto({
    randomUUID: () => {
      calls += 1
      return UUID
    },
  })
  expect(createEventId()).toBe(UUID)
  expect(calls).toBe(1)
})

test('createEventId keeps the timestamp fallback when randomUUID is missing', () => {
  useCrypto({})
  expect(createEventId()).toMatch(/^evt-\d+-[0-9a-f]+$/)
})

test('createEventId keeps the timestamp fallback when randomUUID returns nothing', () => {
  useCrypto({ randomUUID: () => undefined })
  expect(createEventId()).toMatch(/^evt-\d+-[0-9a-f]+$/)
})

test('createEventId keeps the timestamp fallback when crypto is missing', () => {
  useCrypto(undefined)
  expect(createEventId()).toMatch(/^evt-\d+-[0-9a-f]+$/)
})
