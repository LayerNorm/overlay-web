import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import { highlightCode, loadHighlighter } from './highlighter'

test('the highlighter does not eagerly import a syntax engine', () => {
  const source = ts.createSourceFile('highlighter.tsx',
    readFileSync(new URL('./highlighter.tsx', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    if (!/^(shiki|@shikijs)\//.test(statement.moduleSpecifier.text)) continue
    assert.equal(statement.importClause?.isTypeOnly, true)
  }
})

test('unsupported languages keep the plain-text fallback', async () => {
  assert.equal(await loadHighlighter('not-a-supported-language'), null)
  assert.equal(await highlightCode('unchanged text', 'text'), null)
})

test('concurrent first use loads aliases and preserves code and streaming grammar state', async () => {
  const [javascript, typescript] = await Promise.all([loadHighlighter('js'), loadHighlighter('typescript')])
  assert.ok(javascript)
  assert.ok(typescript)
  const code = 'const value = 42\nconsole.log(value)'
  const result = typescript.highlight(code)
  assert.equal(result.lines.map(line => line.map(token => token.props.children).join('')).join('\n'), code)
  assert.ok(Object.keys(result.lines[0][0].props.style).includes('--shiki-light'))
  const first = javascript.highlight('/* open comment')
  const continued = javascript.highlight('still a comment */', first.state)
  assert.equal(continued.lines[0].map(token => token.props.children).join(''), 'still a comment */')
  assert.deepEqual(continued.lines[0][0].props.style, first.lines[0][0].props.style)
})
