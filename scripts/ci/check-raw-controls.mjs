import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const ROOTS = ['src', 'packages/overlay-chat-react/src', 'packages/overlay-modules-react/src']
const BASELINE_PATH = 'scripts/ci/raw-control-baseline.json'
const TAGS = new Set(['button', 'input', 'textarea', 'select'])
const SEMANTIC_INPUT_TYPES = new Set(['checkbox', 'color', 'file', 'hidden', 'radio', 'range'])
const SKIP_DIRS = new Set(['fixtures', '__fixtures__', '__mocks__', 'stories'])
const QUOTES = new Set(['"', "'", String.fromCharCode(96)])

function collect(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) collect(full, files)
    } else if (/\.(tsx|jsx)$/.test(entry.name) && !/\.(test|spec|stories)\.(tsx|jsx)$/.test(entry.name)) {
      files.push(path.relative(process.cwd(), full))
    }
  }
  return files
}

function tagEnd(source, start) {
  let quote = null
  let depth = 0
  for (let i = start + 1; i < source.length; i += 1) {
    const char = source[i]
    if (quote) {
      if (char === '\\') i += 1
      else if (char === quote) quote = null
      continue
    }
    if (QUOTES.has(char)) quote = char
    else if (char === '{') depth += 1
    else if (char === '}') depth -= 1
    else if (char === '>' && depth === 0) return i
  }
  return -1
}

function attrValue(tag, name) {
  const match = new RegExp('(?<![\\w:-])' + name + '\\s*=').exec(tag)
  if (!match) return null
  let i = match.index + match[0].length
  while (i < tag.length && /\s/.test(tag[i])) i += 1
  const quote = tag[i]
  if (quote === '"' || quote === "'") {
    const end = tag.indexOf(quote, i + 1)
    return end === -1 ? null : tag.slice(i + 1, end)
  }
  return quote === '{' ? 'dynamic' : null
}

function lineNumber(source, index) {
  return source.slice(0, index).split('\n').length
}

function annotated(source, index) {
  const lines = source.slice(0, index).split('\n')
  return lines.slice(-3).some((line) => line.includes('overlay:raw-control') || line.includes('eslint-disable-next-line no-restricted-syntax'))
}

function signature(tag) {
  return createHash('sha1').update(tag.replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 12)
}

function inventory() {
  const entries = []
  for (const root of ROOTS) {
    if (!existsSync(root)) continue
    for (const file of collect(root)) {
      const source = readFileSync(file, 'utf8')
      const pattern = /<(button|input|textarea|select)(?=[\s>/])/g
      for (const match of source.matchAll(pattern)) {
        const tag = match[1]
        const start = match.index ?? 0
        const end = tagEnd(source, start)
        if (end === -1) continue
        const opening = source.slice(start, end + 1)
        const type = tag === 'input' ? attrValue(opening, 'type') ?? 'default' : null
        if (tag === 'input' && type && SEMANTIC_INPUT_TYPES.has(type)) continue
        if (annotated(source, start)) continue
        entries.push({ file, tag, type, signature: signature(opening), line: lineNumber(source, start) })
      }
    }
  }
  return entries
}

function aggregate(entries) {
  const counts = new Map()
  for (const entry of entries) {
    const key = [entry.file, entry.tag, entry.type ?? '', entry.signature].join('|')
    counts.set(key, (counts.get(key) ?? 0) + (entry.count ?? 1))
  }
  return counts
}

const current = inventory()
if (process.env.RAW_CONTROLS_WRITE_BASELINE === '1') {
  const entries = [...aggregate(current).entries()].map(([key, count]) => {
    const [file, tag, type, entrySignature] = key.split('|')
    return { file, tag, type: type || null, signature: entrySignature, count }
  }).sort((a, b) => a.file.localeCompare(b.file) || a.tag.localeCompare(b.tag))
  writeFileSync(BASELINE_PATH, JSON.stringify({
    purpose: 'Existing raw-control debt allowed during the Phase 8 rollout. New raw controls fail; removals leave stale entries and pass.',
    generated: new Date().toISOString(),
    entries,
  }, null, 2) + '\n')
  console.log('Wrote ' + BASELINE_PATH + ' with ' + current.length + ' controls across ' + entries.length + ' signatures')
  process.exit(0)
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')).entries ?? []
const currentCounts = aggregate(current)
const baselineCounts = aggregate(baseline)
const violations = []
for (const [key, count] of currentCounts) {
  const allowed = baselineCounts.get(key) ?? 0
  if (count > allowed) {
    const [file, tag, type, entrySignature] = key.split('|')
    violations.push({ file, tag, type: type || null, signature: entrySignature, count, allowed })
  }
}
let stale = 0
for (const [key, count] of baselineCounts) stale += Math.max(0, count - (currentCounts.get(key) ?? 0))
if (violations.length) {
  console.error('Raw interactive controls are not allowed outside the Phase 8 baseline:')
  for (const violation of violations) {
    console.error('- ' + violation.file + ' <' + violation.tag + '>' + (violation.type ? ' type=' + violation.type : '') + ' signature=' + violation.signature + ' current=' + violation.count + ' baseline=' + violation.allowed)
  }
  process.exit(1)
}
console.log('Raw control guardrail passed: 0 new controls; ' + current.length + ' current baseline controls; ' + stale + ' stale baseline entries from completed sweeps')
