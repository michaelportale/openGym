import { describe, expect, test } from 'vitest'
import { routeId } from './route-id.js'

describe('routeId', () => {
  test('decodes an encoded id', () => expect(routeId('a%20b%2Fc')).toBe('a b/c'))
  test('a malformed escape keeps the raw text', () => expect(routeId('100%')).toBe('100%'))
  test('takes the first of an array', () => expect(routeId(['x', 'y'])).toBe('x'))
  test('missing is empty', () => expect(routeId(undefined)).toBe(''))
})
