// What the user typed in the "your server" box -> the base URL the app will talk to, or a
// plain-words reason it cannot. Parsed by hand: React Native's URL class is only partly
// implemented (no reliable hostname/port), and this has to behave the same under vitest.

const HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/

const NEEDS_HTTPS = 'Plain http only works for a server on your own network (a .local name, a 192.168 / 10 / 172.16 address, a Tailscale 100.x address). For anything else use https.'
const NOT_AN_ADDRESS = "That doesn't look like a server address. Try something like gym.example.com or 192.168.1.20:3000."

const fail = error => ({ ok: false, error })

function ipv4Octets(host) {
  const o = host.split('.').map(Number)
  return o.length === 4 && o.every(n => n >= 0 && n <= 255) ? o : null
}

function privateIPv4([a, b]) {
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
}

function privateIPv6(host) {
  const first = host.split(':')[0]
  if (!first) return false
  const v = parseInt(first, 16)
  return (v & 0xfe00) === 0xfc00 || (v & 0xffc0) === 0xfe80
}

function isLocalHost(host, v6) {
  if (v6) return privateIPv6(host)
  if (IPV4.test(host)) {
    const o = ipv4Octets(host)
    return !!o && privateIPv4(o)
  }
  return host === 'localhost' || (host.endsWith('.local') && host.length > '.local'.length)
}

export function normalizeServer(input) {
  if (typeof input !== 'string') return fail(NOT_AN_ADDRESS)
  let s = input.trim()
  if (!s) return fail('Enter the address of your openGym server.')

  let scheme = 'https'
  const m = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/i.exec(s)
  if (m) {
    scheme = m[1].toLowerCase()
    s = m[2]
    if (scheme !== 'http' && scheme !== 'https') return fail('The address has to start with https:// (or http:// on your own network).')
  }

  const authority = s.split(/[/?#]/)[0]
  if (!authority) return fail(NOT_AN_ADDRESS)
  if (authority.includes('@')) return fail('Leave the username and password out of the address.')

  let host, port = '', v6 = false
  if (authority.startsWith('[')) {
    const close = authority.indexOf(']')
    if (close < 0) return fail(NOT_AN_ADDRESS)
    host = authority.slice(1, close).toLowerCase()
    const rest = authority.slice(close + 1)
    if (rest) { if (!rest.startsWith(':')) return fail(NOT_AN_ADDRESS); port = rest.slice(1) }
    if (!host.includes(':') || !/^[0-9a-f:.]+$/.test(host)) return fail(NOT_AN_ADDRESS)
    v6 = true
  } else {
    const i = authority.lastIndexOf(':')
    host = (i < 0 ? authority : authority.slice(0, i)).toLowerCase()
    if (i >= 0) port = authority.slice(i + 1)
    if (!HOSTNAME.test(host)) return fail(NOT_AN_ADDRESS)
    if (IPV4.test(host) && !ipv4Octets(host)) return fail(NOT_AN_ADDRESS)
  }
  if (port && (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535)) return fail(NOT_AN_ADDRESS)

  if (scheme === 'http' && !isLocalHost(host, v6)) return fail(NEEDS_HTTPS)
  return { ok: true, base: `${scheme}://${v6 ? `[${host}]` : host}${port ? `:${port}` : ''}` }
}
