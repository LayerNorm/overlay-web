import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOTS = ['src', 'packages/overlay-chat-react/src', 'packages/overlay-modules-react/src']
const BASELINE_PATH = 'scripts/ci/raw-control-baseline.json'
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

function commentsInPrefix(prefix) {
  const comments = []
  let cursor = 0
  while (cursor < prefix.length) {
    while (/\s/.test(prefix[cursor] ?? '')) cursor += 1
    if (cursor >= prefix.length) return comments
    if (prefix.startsWith('{/*', cursor)) {
      const end = prefix.indexOf('*/}', cursor + 3)
      if (end === -1) return null
      comments.push(prefix.slice(cursor + 3, end))
      cursor = end + 3
    } else if (prefix.startsWith('/*', cursor)) {
      const end = prefix.indexOf('*/', cursor + 2)
      if (end === -1) return null
      comments.push(prefix.slice(cursor + 2, end))
      cursor = end + 2
    } else {
      return null
    }
  }
  return comments
}

function commentsAboveLine(lines, lineIndex) {
  const comments = []
  let inBlock = false
  for (let i = lineIndex; i >= 0; i -= 1) {
    const line = lines[i].trim()
    if (!line) break
    if (inBlock) {
      const opener = line.startsWith('{/*') ? 3 : line.startsWith('/*') ? 2 : -1
      if (opener !== -1) {
        const close = line.indexOf('*/', opener)
        const suffix = close === -1 ? '' : line.slice(close + 2).trim()
        if (suffix && !(line.startsWith('{/*') && suffix === '}')) break
        comments.push(line.slice(opener, close === -1 ? undefined : close))
        inBlock = false
      } else {
        const close = line.indexOf('*/')
        const suffix = close === -1 ? '' : line.slice(close + 2).trim()
        if (suffix && suffix !== '}') break
        comments.push(line.slice(0, close === -1 ? undefined : close).replace(/^\*\s?/, ''))
        if (close !== -1) inBlock = false
      }
      continue
    }
    if (line.startsWith('//')) {
      comments.push(line.slice(2))
      continue
    }
    if (line.startsWith('*/')) {
      const close = line.indexOf('*/')
      const suffix = line.slice(close + 2).trim()
      if (suffix && suffix !== '}') break
      inBlock = true
      continue
    }
    if (line.startsWith('{/*') || line.startsWith('/*')) {
      const opener = line.startsWith('{/*') ? 3 : 2
      const close = line.indexOf('*/', opener)
      if (close === -1) break
      const suffix = line.slice(close + 2).trim()
      if (suffix && !(line.startsWith('{/*') && suffix === '}')) break
      comments.push(line.slice(opener, close))
      continue
    }
    break
  }
  return inBlock ? [] : comments
}

function annotated(source, index) {
  const lineStart = source.lastIndexOf('\n', index - 1) + 1
  const lineIndex = lineNumber(source, index) - 1
  const currentLineComments = commentsInPrefix(source.slice(lineStart, index))
  if (currentLineComments === null) return false
  const comments = [
    ...currentLineComments,
    ...commentsAboveLine(source.slice(0, lineStart).split('\n'), lineIndex - 1),
  ]
  return comments.some((comment) => /overlay:raw-control:\s*\S/.test(comment))
}

function signature(tag) {
  return createHash('sha1').update(tag.replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 12)
}

export function findRawControls(source, file) {
  const entries = []
  const pattern = /<(button|input|textarea|select)(?=[\s>/])/g
  for (const match of source.matchAll(pattern)) {
    const tag = match[1]
    const start = match.index ?? 0
    const end = tagEnd(source, start)
    if (end === -1 || annotated(source, start)) continue
    const opening = source.slice(start, end + 1)
    const type = tag === 'input' ? attrValue(opening, 'type') ?? 'default' : null
    entries.push({ file, tag, type, signature: signature(opening), line: lineNumber(source, start) })
  }
  return entries
}

const BUTTON_STYLE_MARKER = /overlay:button-style:\s*\S/
const VARIANT_COLOR = /(?:^|[\s"'`])(?:[a-z-]+:)*(?:bg-(?!clip|cover|contain|center|no-repeat|fixed)|text-(?:\(--|\[#|white|black|red-|zinc-|gray-|neutral-|slate-|emerald-|amber-|rose-|blue-|green-)|border-(?:\(--|\[#|white|black|red-|zinc-|gray-|neutral-|transparent))/

function buttonStyleAnnotated(source, index) {
  const lineStart = source.lastIndexOf('\n', index - 1) + 1
  const lineEnd = source.indexOf('\n', index)
  const line = source.slice(lineStart, lineEnd === -1 ? undefined : lineEnd)
  if (BUTTON_STYLE_MARKER.test(line)) return true
  const above = commentsAboveLine(source.slice(0, lineStart).split('\n'), lineNumber(source, index) - 2)
  return above.some((comment) => BUTTON_STYLE_MARKER.test(comment))
}

function closingParen(source, open) {
  let depth = 0
  let quote = null
  for (let i = open; i < source.length; i += 1) {
    const char = source[i]
    if (quote) {
      if (char === '\\') i += 1
      else if (char === quote) quote = null
      continue
    }
    if (QUOTES.has(char)) quote = char
    else if (char === '(') depth += 1
    else if (char === ')' && (depth -= 1) === 0) return i
  }
  return -1
}

export function variantLook(classes) {
  if (/(?<![:\w-])bg-\(--foreground\)/.test(classes) && /(?<![:\w-])text-\(--background\)/.test(classes)) return 'primary'
  if (!/(?<![\w-])border border-\(--border\)/.test(classes)) return null
  if (/(?<![:\w-])bg-\(--surface-(?:subtle|muted)\)/.test(classes)) return 'secondary'
  if (!/(?<![:\w-])bg-/.test(classes) && /hover:bg-\(--surface-subtle\)/.test(classes)) return 'outline'
  return null
}

// Buttons should pick a variant rather than repaint one: flag unstyledButton() strings that
// rebuild a variant's look, and color classes passed to a standard (non-ghost) variant.
export function findButtonStyleOverrides(source, file) {
  const entries = []
  for (const match of source.matchAll(/unstyledButton\(/g)) {
    const start = match.index ?? 0
    const end = closingParen(source, start + 'unstyledButton'.length)
    if (end === -1 || buttonStyleAnnotated(source, start)) continue
    const look = variantLook(source.slice(start, end))
    if (look) entries.push({ file, kind: 'rebuilt-' + look, line: lineNumber(source, start) })
  }
  for (const match of source.matchAll(/<Button(?=[\s>/])/g)) {
    const start = match.index ?? 0
    const end = tagEnd(source, start)
    if (end === -1 || buttonStyleAnnotated(source, start)) continue
    const opening = source.slice(start, end + 1)
    const variant = attrValue(opening, 'variant')
    if (!variant || variant === 'ghost') continue
    const className = attrValue(opening, 'className')
    if (className && !className.includes('unstyledButton(') && VARIANT_COLOR.test(className)) {
      entries.push({ file, kind: 'recolored-' + variant, line: lineNumber(source, start) })
    }
  }
  return entries
}

function buttonStyleInventory() {
  const entries = []
  for (const root of ROOTS) {
    if (!existsSync(root)) continue
    for (const file of collect(root)) entries.push(...findButtonStyleOverrides(readFileSync(file, 'utf8'), file))
  }
  return entries
}

function inventory() {
  const entries = []
  for (const root of ROOTS) {
    if (!existsSync(root)) continue
    for (const file of collect(root)) {
      const source = readFileSync(file, 'utf8')
      entries.push(...findRawControls(source, file))
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

function main() {
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
  const overrides = buttonStyleInventory()
  if (overrides.length) {
    console.error('Buttons must use a variant instead of restyling one (or annotate overlay:button-style: <reason>):')
    for (const entry of overrides) console.error('- ' + entry.file + ':' + entry.line + ' ' + entry.kind)
    process.exit(1)
  }
  console.log('Raw control guardrail passed: 0 new controls; ' + current.length + ' current baseline controls; ' + stale + ' stale baseline entries from completed sweeps')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
