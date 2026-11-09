import { describe, expect, test } from 'vitest'
import { normalizeServer } from './server-address.js'

describe('normalizeServer accepts', () => {
  test.each([
    ['gym.example.com', 'https://gym.example.com'],
    ['  gym.example.com/  ', 'https://gym.example.com'],
    ['https://gym.example.com/app/x?y=1#z', 'https://gym.example.com'],
    ['HTTPS://Gym.Example.com:8443/', 'https://gym.example.com:8443'],
    ['http://gym.local:3000', 'http://gym.local:3000'],
    ['http://localhost:8080/', 'http://localhost:8080'],
    ['http://10.1.2.3', 'http://10.1.2.3'],
    ['http://172.16.0.1', 'http://172.16.0.1'],
    ['http://172.31.255.254:80', 'http://172.31.255.254:80'],
    ['http://192.168.1.20:8081/api', 'http://192.168.1.20:8081'],
    ['http://100.64.0.5', 'http://100.64.0.5'],
    ['http://100.127.255.1', 'http://100.127.255.1'],
    ['http://[fd12:3456::1]:3000', 'http://[fd12:3456::1]:3000'],
    ['http://[fe80::1]', 'http://[fe80::1]'],
    ['https://8.8.8.8', 'https://8.8.8.8'],
    ['192.168.1.5:3000', 'https://192.168.1.5:3000'],
    ['http://10.0.0.1', 'http://10.0.0.1'],
  ])('%s', (input, want) => {
    expect(normalizeServer(input)).toEqual({ ok: true, base: want })
  })
})

describe('normalizeServer refuses', () => {
  test.each([
    ['http://gym.example.com'],
    ['http://8.8.8.8'],
    ['http://172.32.0.1'],
    ['http://172.15.0.1'],
    ['http://100.128.0.1'],
    ['http://100.63.0.1'],
    ['http://11.0.0.1'],
    ['http://192.169.0.1'],
    ['http://[2001:db8::1]'],
    ['http://gym.local.evil.com'],
    ['http://0x7f.0.0.1'],
  ])('plain http to %s', input => {
    const r = normalizeServer(input)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/https/i)
  })

  test.each([[''], ['   '], ['ftp://x.com'], ['http://'], ['https://bad host'], ['javascript:alert(1)'], ['https://user:pw@x.com'], [null], [undefined], [5]])('garbage %s', input => {
    const r = normalizeServer(input)
    expect(r.ok).toBe(false)
    expect(typeof r.error).toBe('string')
    expect(r.error.length).toBeGreaterThan(5)
  })

  test.each([['http://010.0.0.1'], ['http://192.168.01.5'], ['https://010.0.0.1']])('octal-looking octets are refused: %s', input => {
    expect(normalizeServer(input).ok).toBe(false)
  })

  test('a credential in the address is refused, and not echoed', () => {
    expect(normalizeServer('https://user:secret@x.com').error).not.toMatch(/secret/)
  })
})
