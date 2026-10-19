#!/usr/bin/env node
// Fails when code reintroduces chat renderers removed by the AI Elements migration.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const BANNED_MODULES = [
  { pattern: /^react-syntax-highlighter(\/.*)?$/, message: 'Use CodeBlock from @overlay/ui/ai (Shiki) instead of react-syntax-highlighter.' },
  { pattern: /(^|\/)LazySyntaxHighlighter$/, message: 'LazySyntaxHighlighter was removed; use CodeBlock from @overlay/ui/ai.' },
  { pattern: /(^|\/)TranscriptScroll$/, message: 'TranscriptScroll was removed; use MessageScroller from @overlay/ui/ai.' },
]
const BANNED_IDENTIFIERS = [
  { name: 'LazySyntaxHighlighter', message: 'LazySyntaxHighlighter was removed; use CodeBlock from @overlay/ui/ai.' },
  { name: 'useTranscriptScroll', message: 'useTranscriptScroll was removed; use MessageScroller from @overlay/ui/ai.' },
]

const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)(['"])([^'"]+)\1/gm

export function findLegacyChatImports(source) {
  const findings = []
  const lineOf = (index) => source.slice(0, index).split('\n').length
  for (const match of source.matchAll(SPECIFIER)) {
    const banned = BANNED_MODULES.find(({ pattern }) => pattern.test(match[2]))
    if (banned) findings.push({ line: lineOf(match.index), specifier: match[2], message: banned.message })
  }
  for (const { name, message } of BANNED_IDENTIFIERS) {
    for (const match of source.matchAll(new RegExp(`\\b${name}\\b`, 'g'))) {
      findings.push({ line: lineOf(match.index), specifier: name, message })
    }
  }
  return findings
}

function main() {
  const self = 'scripts/ci/check-chat-legacy-imports'
  const files = execFileSync('git', ['ls-files', '--', 'src', 'packages', 'apps'], { encoding: 'utf8' })
    .split('\n')
    .filter((file) => /\.(c|m)?[jt]sx?$/.test(file) && !file.includes('node_modules') && !file.startsWith(self))
  const failures = []
  for (const file of files) {
    let source
    try {
      source = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    for (const finding of findLegacyChatImports(source)) failures.push(`${file}:${finding.line} ${finding.specifier}: ${finding.message}`)
  }
  if (failures.length > 0) {
    console.error(`Removed chat renderers are referenced:\n${failures.join('\n')}`)
    process.exit(1)
  }
  console.log(`check-chat-legacy-imports: ${files.length} files clean`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
