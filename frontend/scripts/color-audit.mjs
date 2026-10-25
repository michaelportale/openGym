#!/usr/bin/env node
// Colour audit: finds every hardcoded colour in the shipped frontend and says which are green.
//
//   node scripts/color-audit.mjs            → summary table
//   node scripts/color-audit.mjs --json f   → also writes every hit to f
//
// Scanned: src/**/*.{css,js,jsx} (tests excluded), index.html, public/manifest.json, public/sw.js,
// and the two PNG icons (their distinct pixel colours). Comments are stripped first, so an issue
// reference such as "(#275)" is not mistaken for a colour.
//
// A hit is bucketed by where it sits:
//   token     — the value of a CSS custom property (--x: …) in a token / palette file
//   css       — any other CSS declaration (index.css rules, component CSS)
//   js        — JS / JSX source (inline styles, SVG fill/stroke, canvas, print sheets)
//   html      — index.html (meta theme-color)
//   manifest  — public/manifest.json theme_color / background_color
//   icon      — a pixel colour in public/icon-*.png
// and also counted when it is a reference to the green system colour (var(--green)).
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { join, relative, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const TOKEN_FILES = /(^|\/)src\/theme\//

const NAMED = 'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen'.split(' ')
const NAMED_GREEN = new Set('chartreuse darkgreen darkolivegreen darkseagreen forestgreen green greenyellow lawngreen lightgreen lime limegreen mediumseagreen mediumspringgreen olive olivedrab palegreen seagreen springgreen yellowgreen'.split(' '))
const NAMED_RX = new RegExp(`(?<![\\w-])(${NAMED.join('|')})(?![\\w-])`, 'g')

// --- comment stripping (keeps line numbers: comments become spaces, newlines kept) ---
function blank(s) { return s.replace(/[^\n]/g, ' ') }
export function stripCss(src) { return src.replace(/\/\*[\s\S]*?\*\//g, blank) }
export function stripHtml(src) { return src.replace(/<!--[\s\S]*?-->/g, blank).replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/g, (m, a, b, c) => a + stripJs(b) + c) }
export function stripJs(src) {
  // A small JS tokenizer: strings, template literals (with nested ${…} code), regex literals and
  // comments. Only comments are blanked; everything else is copied through.
  let out = '', i = 0, last = ''
  const n = src.length
  const regexOk = () => /[(,=:[!&|?{};+\-*%<>~^]$|^$|\breturn$|\btypeof$|\bcase$/.test(last)
  // Copies code until an unmatched `}` (when inTemplate) or the end.
  function code(inTemplate) {
    let depth = 0
    while (i < n) {
      const c = src[i], d = src[i + 1]
      if (c === '/' && d === '/') { const e = src.indexOf('\n', i); const j = e < 0 ? n : e; out += blank(src.slice(i, j)); i = j; continue }
      if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); const j = e < 0 ? n : e + 2; out += blank(src.slice(i, j)); i = j; continue }
      if (c === '"' || c === "'") {
        let j = i + 1
        while (j < n && src[j] !== c && src[j] !== '\n') { if (src[j] === '\\') j++; j++ }
        out += src.slice(i, j + 1); i = j + 1; last = 'x'; continue
      }
      if (c === '`') { out += c; i++; template(); last = 'x'; continue }
      if (c === '/' && regexOk()) {
        let j = i + 1, cls = false
        while (j < n && src[j] !== '\n') { if (src[j] === '\\') { j += 2; continue } if (src[j] === '[') cls = true; else if (src[j] === ']') cls = false; else if (src[j] === '/' && !cls) break; j++ }
        if (src[j] === '/') { out += src.slice(i, j + 1); i = j + 1; last = 'x'; continue }
      }
      if (c === '{') depth++
      if (c === '}') { if (inTemplate && depth === 0) return; depth-- }
      out += c; i++
      if (!/\s/.test(c)) last = (/\w/.test(c) ? (last.match(/\w*$/)[0] + c) : c).slice(-8)
    }
  }
  function template() {
    while (i < n) {
      const c = src[i]
      if (c === '\\') { out += src.slice(i, i + 2); i += 2; continue }
      if (c === '`') { out += c; i++; return }
      if (c === '$' && src[i + 1] === '{') { out += '${'; i += 2; last = '{'; code(true); if (i < n) { out += '}'; i++ } continue }
      out += c; i++
    }
  }
  code(false)
  return out
}

// --- colour parsing ---
const HEX_RX = /(?<![\w&#])#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![\w-])/g
const FN_RX = /\b(rgba?|hsla?)\(\s*([^)]*)\)/g
function hexToRgb(h) {
  if (h.length <= 4) h = [...h].map(x => x + x).join('')
  const n = parseInt(h.slice(0, 6), 16)
  return [n >> 16, (n >> 8) & 255, n & 255]
}
function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return [r, g, b].map(v => Math.round((v + m) * 255))
}
function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min
  if (!d) return [0, 0, l]
  const s = d / (1 - Math.abs(2 * l - 1))
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  h *= 60; if (h < 0) h += 360
  return [h, s, l]
}
// Green: hue 70°–165° (yellow-green through green to sea-green), visibly saturated, not near black/white.
export function isGreenRgb(rgb) { const [h, s, l] = rgbToHsl(rgb); return h >= 70 && h <= 165 && s >= 0.2 && l > 0.08 && l < 0.95 }

function parseFn(kind, args) {
  const parts = args.split(/[\s,/]+/).filter(Boolean)
  if (parts.some(p => /var\(|calc\(|\$\{/.test(p))) return null
  const num = p => parseFloat(p)
  if (kind.startsWith('rgb')) {
    const v = parts.slice(0, 3).map(p => p.endsWith('%') ? num(p) * 2.55 : num(p))
    return v.every(Number.isFinite) ? v : null
  }
  const [h, s, l] = [num(parts[0]), num(parts[1]) / 100, num(parts[2]) / 100]
  return [h, s, l].every(Number.isFinite) ? hslToRgb(((h % 360) + 360) % 360, s, l) : null
}

function lineOf(text, idx) { let n = 1; for (let i = 0; i < idx; i++) if (text.charCodeAt(i) === 10) n++; return n }

// Which bucket a hit in a CSS text belongs to: a custom property value (token) or a rule.
function cssBucket(text, idx, file) {
  const start = Math.max(text.lastIndexOf(';', idx), text.lastIndexOf('{', idx), text.lastIndexOf('}', idx))
  const decl = text.slice(start + 1, idx)
  return /^\s*--[\w-]+\s*:/.test(decl) ? (TOKEN_FILES.test(file) ? 'token' : 'css-var') : 'css'
}

function scanText(file, raw, kind) {
  const text = kind === 'css' ? stripCss(raw) : kind === 'html' ? stripHtml(raw) : kind === 'json' ? raw : stripJs(raw)
  const hits = []
  const push = (idx, literal, rgb, named) => {
    let bucket = kind === 'css' ? cssBucket(text, idx, file) : kind === 'html' ? 'html' : kind === 'json' ? 'manifest' : 'js'
    if (bucket === 'js') {
      // CSS custom properties set from JS (style.setProperty('--x', …) or { '--x': … })
      const before = text.slice(Math.max(0, idx - 40), idx)
      if (/['"]--[\w-]+['"]\s*[:,]\s*['"]?$/.test(before)) bucket = TOKEN_FILES.test(file) ? 'token' : 'js'
    }
    hits.push({ file, line: lineOf(text, idx), literal, rgb, green: rgb ? isGreenRgb(rgb) : NAMED_GREEN.has(named), bucket })
  }
  for (const m of text.matchAll(HEX_RX)) push(m.index, m[0], hexToRgb(m[1]))
  for (const m of text.matchAll(FN_RX)) { const rgb = parseFn(m[1], m[2]); if (rgb) push(m.index, m[0], rgb) }
  // named colours: CSS declaration values; JS strings in a colour slot
  if (kind === 'css') {
    for (const m of text.matchAll(/([\w-]+)\s*:\s*([^;{}]+)/g)) {
      if (m[1].startsWith('--') && false) continue
      const val = m[2].replace(/var\([^)]*\)|url\([^)]*\)|"[^"]*"|'[^']*'/g, s => ' '.repeat(s.length))
      if (/^(font|font-family|grid-template-areas|content|animation|animation-name|transition|transition-property|will-change|counter-reset|list-style)$/.test(m[1])) continue
      for (const k of val.matchAll(NAMED_RX)) push(m.index + m[0].indexOf(m[2]) + k.index, k[0], null, k[0])
    }
  } else if (kind === 'js' || kind === 'html') {
    const rx = new RegExp(`(fill|stroke|color|Color|background|stop-color|stopColor|shadow|Shadow)\\s*[:=]\\s*\\{?\\s*['"\`](${NAMED.join('|')})['"\`]`, 'g')
    for (const m of text.matchAll(rx)) push(m.index + m[0].lastIndexOf(m[2]), m[2], null, m[2])
  }
  // references to the green system colour
  const greenVars = [...text.matchAll(/var\(--green\b/g)].map(m => ({ file, line: lineOf(text, m.index) }))
  // custom properties used and defined (defined: `--x:` in CSS, '--x' as a JS string key/argument)
  const refs = [...text.matchAll(/var\(\s*(--[\w-]+)\s*(,?)/g)].map(m => ({ name: m[1], fallback: !!m[2], file, line: lineOf(text, m.index) }))
  const defs = kind === 'css'
    ? [...text.matchAll(/(?<![\w-])(--[\w-]+)\s*:/g)].map(m => m[1])
    : [...text.matchAll(/['"`](--[\w-]+)['"`]/g)].map(m => m[1])
  return { hits, greenVars, refs, defs }
}

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(css|jsx?|mjs)$/.test(f) && !/\.test\.|(^|\/)test\//.test(p.slice(root.length))) out.push(p)
  }
  return out
}

function iconColours(p) {
  // Distinct opaque pixel colours of a PNG, via the built-in zlib (8-bit RGB/RGBA, non-interlaced).
  const buf = readFileSync(p)
  let off = 8, w, h, ct, idat = []
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('ascii', off + 4, off + 8), data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9] }
    if (type === 'IDAT') idat.push(data)
    off += 12 + len
  }
  return { w, h, ct, idat: Buffer.concat(idat) }
}

export async function audit() {
  const { inflateSync } = await import('node:zlib')
  const files = walk(join(root, 'src'))
  const all = [], greenVars = [], refs = [], defs = new Set()
  const add = (p, kind) => {
    const r = scanText(relative(root, p), readFileSync(p, 'utf8'), kind)
    all.push(...r.hits); greenVars.push(...r.greenVars); refs.push(...r.refs); r.defs.forEach(d => defs.add(d))
  }
  for (const p of files) add(p, extname(p) === '.css' ? 'css' : 'js')
  add(join(root, 'index.html'), 'html')
  add(join(root, 'public/manifest.json'), 'json')
  if (existsSync(join(root, 'public/sw.js'))) add(join(root, 'public/sw.js'), 'js')
  for (const f of readdirSync(join(root, 'public')).filter(f => f.endsWith('.png'))) {
    const { w, h, ct, idat } = iconColours(join(root, 'public', f))
    const bpp = ct === 6 ? 4 : ct === 2 ? 3 : 0
    if (!bpp) continue
    const raw = inflateSync(idat), stride = w * bpp, prev = Buffer.alloc(stride), cur = Buffer.alloc(stride)
    const seen = new Map()
    for (let y = 0; y < h; y++) {
      const ft = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
      for (let x = 0; x < stride; x++) {
        const a = x >= bpp ? cur[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c)
        const pred = ft === 0 ? 0 : ft === 1 ? a : ft === 2 ? b : ft === 3 ? (a + b) >> 1 : (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
        cur[x] = (line[x] + pred) & 255
      }
      for (let x = 0; x < stride; x += bpp) {
        if (bpp === 4 && cur[x + 3] === 0) continue
        const k = '#' + [cur[x], cur[x + 1], cur[x + 2]].map(v => v.toString(16).padStart(2, '0')).join('')
        seen.set(k, (seen.get(k) || 0) + 1)
      }
      cur.copy(prev)
    }
    for (const [k, count] of seen) { const rgb = hexToRgb(k.slice(1)); all.push({ file: `public/${f}`, line: 0, literal: `${k} ×${count}px`, rgb, green: isGreenRgb(rgb), bucket: 'icon' }) }
  }
  // var(--x) with no definition anywhere, and no fallback after the name
  const undefinedRefs = refs.filter(r => !defs.has(r.name) && !r.fallback)
  const refCounts = {}
  for (const r of refs) refCounts[r.name] = (refCounts[r.name] || 0) + 1
  return { hits: all, greenVars, refCounts, undefinedRefs }
}

export function summarise({ hits, greenVars, refCounts, undefinedRefs }) {
  const buckets = ['token', 'css-var', 'css', 'js', 'html', 'manifest', 'icon']
  const row = b => { const h = hits.filter(x => x.bucket === b); return { bucket: b, total: h.length, green: h.filter(x => x.green).length, other: h.filter(x => !x.green).length } }
  const rows = buckets.map(row)
  const outside = hits.filter(h => h.bucket !== 'token')
  return {
    rows,
    total: hits.length,
    green: hits.filter(h => h.green).length,
    hardcodedOutsideTokens: outside.length,
    greenOutsideTokens: outside.filter(h => h.green).length,
    greenVarRefs: greenVars.length,
    greenVarRefsOutsideTokens: greenVars.filter(g => !TOKEN_FILES.test(g.file)).length,
    refCounts,
    undefinedVars: [...new Set(undefinedRefs.map(r => r.name))].sort(),
    undefinedRefs: undefinedRefs.map(r => `${r.file}:${r.line} ${r.name}`),
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = await audit()
  const s = summarise(r)
  console.log('bucket     total  green  other')
  for (const x of s.rows) console.log(`${x.bucket.padEnd(9)} ${String(x.total).padStart(6)} ${String(x.green).padStart(6)} ${String(x.other).padStart(6)}`)
  console.log(`all        ${String(s.total).padStart(6)} ${String(s.green).padStart(6)} ${String(s.total - s.green).padStart(6)}`)
  console.log(`outside token files: ${s.hardcodedOutsideTokens} colours, ${s.greenOutsideTokens} green`)
  console.log(`var(--green) references: ${s.greenVarRefs} (${s.greenVarRefsOutsideTokens} outside token files)`)
  const acc = ['--acc', '--acc-2', '--on-acc', '--acc-soft', '--acc-line'].reduce((n, k) => n + (s.refCounts[k] || 0), 0)
  console.log(`var(--acc*) references: ${acc}; var(--orange): ${s.refCounts['--orange'] || 0}`)
  console.log(`undefined custom properties: ${s.undefinedVars.join(' ') || 'none'}`)
  for (const u of s.undefinedRefs) console.log('  ' + u)
  const j = process.argv.indexOf('--json')
  if (j > 0) writeFileSync(process.argv[j + 1], JSON.stringify({ summary: s, ...r }, null, 1))
}
