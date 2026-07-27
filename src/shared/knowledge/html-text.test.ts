import assert from 'node:assert/strict'
import test from 'node:test'
import { extractReadableText } from './html-text'

test('reads the page title and body text', () => {
  const result = extractReadableText(`
    <html><head><title>Refund Policy</title></head>
    <body><h1>Refunds</h1><p>Refunds take 30 days.</p></body></html>
  `)
  assert.equal(result.title, 'Refund Policy')
  assert.match(result.text, /Refunds/)
  assert.match(result.text, /Refunds take 30 days\./)
})

test('drops scripts, styles and navigation chrome', () => {
  const result = extractReadableText(`
    <body>
      <nav>Home About</nav>
      <script>var secret = 'do not index'</script>
      <style>.a { color: red }</style>
      <p>Real content.</p>
      <footer>Copyright</footer>
    </body>
  `)
  assert.equal(result.text, 'Real content.')
})

test('a commented-out script cannot leak into the text', () => {
  const result = extractReadableText('<body><!-- <script>leak</script> --><p>Kept.</p></body>')
  assert.equal(result.text, 'Kept.')
})

test('block elements become line breaks so sentences stay separate', () => {
  const result = extractReadableText('<body><p>One.</p><p>Two.</p><li>Three.</li></body>')
  assert.deepEqual(
    result.text.split('\n').filter((line) => line.trim()),
    ['One.', 'Two.', 'Three.'],
  )
  assert.doesNotMatch(result.text, /One\.Two\./, 'sentences must not run together')
})

test('decodes named and numeric entities', () => {
  const result = extractReadableText('<body><p>Terms &amp; conditions &#8212; see &#x41;nnex&nbsp;1.</p></body>')
  assert.match(result.text, /Terms & conditions — see Annex 1\./)
})

test('leaves unknown entities untouched rather than corrupting text', () => {
  const result = extractReadableText('<body><p>&notarealentity; stays</p></body>')
  assert.match(result.text, /&notarealentity; stays/)
})

test('collapses runaway whitespace', () => {
  const result = extractReadableText('<body><p>a     b</p>\n\n\n\n<p>c</p></body>')
  assert.equal(result.text, 'a b\n\nc')
})

test('empty or tag-only html yields empty text', () => {
  assert.equal(extractReadableText('').text, '')
  assert.equal(extractReadableText('<html><body></body></html>').text, '')
})

test('plain text without a title still extracts', () => {
  const result = extractReadableText('<body><p>No title here.</p></body>')
  assert.equal(result.title, undefined)
  assert.equal(result.text, 'No title here.')
})
