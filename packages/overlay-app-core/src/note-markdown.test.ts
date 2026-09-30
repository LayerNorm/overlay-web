import assert from 'node:assert/strict'
import test from 'node:test'
import {
  editorHtmlToNoteMarkdown,
  isLegacyNoteHtml,
  noteMarkdownToEditorHtml,
  toCanonicalNoteMarkdown,
} from './note-markdown'
import {
  appendToNote,
  applyNoteEdits,
  NoteEditError,
  noteOutline,
  prependToNote,
  replaceNoteSection,
} from './note-edits'

// Shapes TipTap's getHTML() emits for the notebook editor's extensions.
const TIPTAP_HTML = [
  '<h1>Title</h1>',
  '<p>Some <strong>bold</strong>, <em>it</em>, <u>under <strong>b</strong></u>, ',
  '<mark data-color="#fef08a" style="background-color: #fef08a; color: inherit">hl</mark>, H<sub>2</sub>O, x<sup>2</sup>, ',
  '<s>gone</s>, <code>code</code>, <a target="_blank" rel="noopener noreferrer nofollow" href="https://x.com">link</a> ',
  'and <span data-type="inline-math" data-latex="a^2+b^2"></span> math. Price $5 and $6.</p>',
  '<p style="text-align: center">Centered</p>',
  '<ul><li><p>one</p><ul><li><p>nested</p></li></ul></li><li><p>two</p></li></ul>',
  '<ol><li><p>first</p></li><li><p>second</p></li></ol>',
  '<ul data-type="taskList"><li data-checked="true" data-type="taskItem"><label><input type="checkbox" checked="checked"><span></span></label><div><p>done</p></div></li>',
  '<li data-checked="false" data-type="taskItem"><label><input type="checkbox"><span></span></label><div><p>todo</p></div></li></ul>',
  '<div data-type="block-math" data-latex="\\sum_{i=1}^n x_i"></div>',
  '<pre><code class="language-ts">const a = 1 &lt; 2\n</code></pre>',
  '<blockquote><p>quote</p></blockquote><hr>',
  '<table style="min-width: 50px"><colgroup><col><col></colgroup><tbody>',
  '<tr><th colspan="1" rowspan="1"><p>A</p></th><th colspan="1" rowspan="1"><p>B</p></th></tr>',
  '<tr><td colspan="1" rowspan="1"><p>1</p></td><td colspan="1" rowspan="1"><p>2</p></td></tr></tbody></table>',
  '<table><tbody><tr><td colspan="2" rowspan="1"><p>merged</p></td></tr></tbody></table>',
  '<img src="https://example.com/a.png" alt="pic">',
  '<div data-youtube-video=""><iframe width="640" height="480" allowfullscreen="true" src="https://www.youtube-nocookie.com/embed/abc123?controls=1"></iframe></div>',
  '<p>line one<br>line two</p>',
].join('')

test('editor HTML converts to readable Markdown', () => {
  const markdown = editorHtmlToNoteMarkdown(TIPTAP_HTML)
  for (const expected of [
    '# Title',
    '<u>under **b**</u>',
    'H<sub>2</sub>O',
    '~~gone~~',
    '[link](https://x.com)',
    '$a^2+b^2$ math',
    'Price \\$5',
    '<p style="text-align: center">Centered</p>',
    '- one\n  - nested\n- two',
    '1. first\n2. second',
    '- [x] done\n- [ ] todo',
    '$$\n\\sum_{i=1}^n x_i\n$$',
    '```ts\nconst a = 1 < 2\n```',
    '> quote',
    '| A | B |',
    '<table><tbody><tr><td colspan="2"',
    '![pic](https://example.com/a.png)',
    'line one\\\nline two',
  ]) {
    assert.ok(markdown.includes(expected), `missing ${JSON.stringify(expected)} in:\n${markdown}`)
  }
})

test('Markdown → editor HTML → Markdown is stable', () => {
  const first = editorHtmlToNoteMarkdown(TIPTAP_HTML)
  const html = noteMarkdownToEditorHtml(first)
  assert.match(html, /<ul data-type="taskList"><li data-type="taskItem" data-checked="true">/)
  assert.match(html, /<span data-type="inline-math" data-latex="a\^2\+b\^2"><\/span>/)
  assert.match(html, /<div data-type="block-math"/)
  assert.equal(editorHtmlToNoteMarkdown(html), first)
})

test('agent-written Markdown renders for the editor', () => {
  const html = noteMarkdownToEditorHtml('## Plan\n\n- [ ] ship\n- step\n\n#### deep\n\n```\nx\n```\n')
  assert.match(html, /<h2>Plan<\/h2>/)
  assert.match(html, /data-type="taskList"/)
  assert.match(html, /<h4>deep<\/h4>/)
  assert.match(html, /<pre><code>x\n<\/code><\/pre>/)
})

test('raw HTML in a note is sanitized', () => {
  const html = noteMarkdownToEditorHtml([
    '<img src=x onerror=alert(1)>',
    '<script>alert(1)</script>',
    '[a](javascript:alert(1)) <iframe src="https://evil.example/embed"></iframe>',
    '<p style="position:fixed;background-color:red">x</p>',
  ].join('\n\n'))
  assert.doesNotMatch(html, /onerror|<script|javascript:|evil\.example|position/)
  assert.match(html, /style="background-color:red"/)
})

test('legacy HTML detection', () => {
  assert.equal(isLegacyNoteHtml('<p>a</p><p>b</p>'), true)
  assert.equal(isLegacyNoteHtml(''), false)
  assert.equal(isLegacyNoteHtml('# hi'), false)
  assert.equal(isLegacyNoteHtml('Text with <u>inline</u> html'), false)
  // Markdown whose first block is raw HTML is still Markdown.
  assert.equal(isLegacyNoteHtml('<p style="text-align: center">x</p>\n\n# H\n'), false)
  // A note that is one raw HTML block converts to itself.
  const single = '<p style="text-align: center">x</p>\n'
  assert.equal(toCanonicalNoteMarkdown(single), single)
  assert.equal(toCanonicalNoteMarkdown('<h2>Hi</h2><p>there</p>'), '## Hi\n\nthere\n')
  assert.equal(toCanonicalNoteMarkdown('plain'), 'plain')
})

test('empty content stays empty', () => {
  assert.equal(editorHtmlToNoteMarkdown(''), '')
  assert.equal(editorHtmlToNoteMarkdown('<p></p>'), '')
  assert.equal(noteMarkdownToEditorHtml('  \n'), '')
})

const NOTE = '# Doc\n\nIntro.\n\n## Tasks\n\n- a\n- b\n\n### Sub\n\nsub body\n\n## Notes\n\nlast\n'

test('appendToNote and prependToNote separate blocks', () => {
  assert.equal(appendToNote('# A\n', 'more'), '# A\n\nmore\n')
  assert.equal(appendToNote('', 'first'), 'first\n')
  assert.equal(prependToNote('# A\n', 'top'), 'top\n\n# A\n')
  assert.throws(() => appendToNote('x', '  '), NoteEditError)
})

test('replaceNoteSection replaces through nested headings only', () => {
  const next = replaceNoteSection(NOTE, 'Tasks', '- c')
  assert.equal(next, '# Doc\n\nIntro.\n\n## Tasks\n\n- c\n\n## Notes\n\nlast\n')
  assert.equal(replaceNoteSection(NOTE, '### sub', 'new'), '# Doc\n\nIntro.\n\n## Tasks\n\n- a\n- b\n\n### Sub\n\nnew\n\n## Notes\n\nlast\n')
  assert.equal(replaceNoteSection(NOTE, 'Notes', ''), '# Doc\n\nIntro.\n\n## Tasks\n\n- a\n- b\n\n### Sub\n\nsub body\n\n## Notes\n')
  assert.throws(() => replaceNoteSection(NOTE, 'Missing', 'x'), /Headings: # Doc \| ## Tasks \| ### Sub \| ## Notes/)
  assert.equal(replaceNoteSection('# A\n', 'Log', 'entry', { appendIfMissing: true }), '# A\n\n## Log\n\nentry\n')
  assert.throws(() => replaceNoteSection('## X\n\n## X\n', 'X', 'y'), /appears 2 times/)
})

test('applyNoteEdits requires unique matches unless replaceAll', () => {
  assert.equal(applyNoteEdits(NOTE, [{ find: 'Intro.', replace: 'Hello.' }]).includes('Hello.'), true)
  assert.throws(() => applyNoteEdits(NOTE, [{ find: 'nope', replace: 'x' }]), /was not in the note/)
  assert.throws(() => applyNoteEdits('a a', [{ find: 'a', replace: 'b' }]), /appears 2 times/)
  assert.equal(applyNoteEdits('a a', [{ find: 'a', replace: '$&b', replaceAll: true }]), '$&b $&b')
  assert.equal(applyNoteEdits('a', [{ find: 'a', replace: '$&' }]), '$&')
  assert.throws(() => applyNoteEdits('a', []), NoteEditError)
})

test('noteOutline lists headings', () => {
  assert.deepEqual(noteOutline(NOTE), [
    { level: 1, text: 'Doc' },
    { level: 2, text: 'Tasks' },
    { level: 3, text: 'Sub' },
    { level: 2, text: 'Notes' },
  ])
})
