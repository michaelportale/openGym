// @vitest-environment happy-dom
// Empty states say what will appear and offer a 44 px secondary button; disabled buttons read
// as inert instead of fading out.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { DEF, useStore } from '../store/useStore.js'
import History from './History.jsx'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// vitest stubs CSS imports, so read the stylesheet from disk
const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')

let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('empty states', () => {
  it('History with no workouts offers to start the first one', () => {
    const st = JSON.parse(JSON.stringify(DEF))
    useStore.setState({ S: { ...st, workouts: [] }, user: null })
    act(() => root.render(<MemoryRouter><History /></MemoryRouter>))
    const btn = host.querySelector('.empty .empty-cta-btn')
    expect(btn.textContent).toContain('Start your first workout')
    expect(btn.className).not.toContain('primary')
  })
})

describe('disabled controls', () => {
  it('are inert but readable, not faded to a third', () => {
    const rule = css.match(/\.btn:disabled,\.btn\[aria-disabled="true"\]\{([^}]*)\}/)
    expect(rule).toBeTruthy()
    expect(rule[1]).toContain('opacity:1')
    expect(rule[1]).toContain('color:var(--label-3)')
    expect(css).toMatch(/\.empty-cta \.btn\.empty-cta-btn\{min-height:44px/)
  })
})
