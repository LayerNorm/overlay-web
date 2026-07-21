import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { FileViewer, FileViewerPanel, OutputViewer } from './file-viewer'

test('HTML preview remains sandboxed away from the host application', () => {
  const markup = renderToStaticMarkup(
    <FileViewer name="demo.html" content="<script>window.bridge?.openExternal('https://evil.test')</script>" />,
  )
  assert.match(markup, /sandbox="allow-scripts allow-forms allow-modals"/)
  assert.doesNotMatch(markup, /allow-same-origin/)
  assert.doesNotMatch(markup, /allow-top-navigation/)
})

test('unsafe media schemes never reach rendered elements', () => {
  const markup = renderToStaticMarkup(
    <FileViewer name="attack.png" content="javascript:alert(1)" />,
  )
  assert.doesNotMatch(markup, /<img/)
  assert.match(markup, /Could not safely preview/)
})

test('generated outputs use the canonical file renderer', () => {
  const markup = renderToStaticMarkup(
    <OutputViewer
      name="result.png"
      url="data:image/png;base64,iVBORw0KGgo="
      outputType="image"
      modelId="overlay/image"
      prompt="A safe fixture"
    />,
  )
  assert.match(markup, /overlay-output-viewer/)
  assert.match(markup, /overlay-file-viewer--image/)
  assert.match(markup, /A safe fixture/)
})

test('indexed document text can use a preview classifier without changing its displayed name', () => {
  const markup = renderToStaticMarkup(
    <FileViewerPanel name="Research.pdf" previewName="Research.pdf.md" content="# Extracted text" />,
  )
  assert.match(markup, />Research\.pdf</)
  assert.match(markup, /Extracted text/)
  assert.doesNotMatch(markup, />Research\.pdf\.md</)
})
