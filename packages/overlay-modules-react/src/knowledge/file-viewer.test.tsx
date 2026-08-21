import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { FileViewer, FileViewerPanel, OutputViewer } from './file-viewer'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

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

test('markdown files render headings instead of raw markers', () => {
  const markup = renderToStaticMarkup(
    <FileViewer
      name="notes.md"
      content={`## The memory cost

Each cached token stores **K and V** tensors.`}
    />,
  )
  assert.match(markup, /overlay-file-viewer--markdown/)
  assert.match(markup, /<h2[^>]*>The memory cost<\/h2>/)
  assert.match(markup, /<strong>K and V<\/strong>/)
  assert.doesNotMatch(markup, /## The memory cost/)
})

test('indexed document text can use a preview classifier without changing its displayed name', () => {
  const markup = renderToStaticMarkup(
    <FileViewerPanel name="Research.pdf" previewName="Research.pdf.md" content="# Extracted text" />,
  )
  assert.match(markup, />Research\.pdf</)
  assert.match(markup, /Extracted text/)
  assert.doesNotMatch(markup, />Research\.pdf\.md</)
})

test('stored binaries keep the original preview when extracted text is also present', () => {
  const markup = renderToStaticMarkup(
    <FileViewerPanel
      name="Research.pdf"
      previewName="Research.pdf.md"
      content="# Extracted text"
      url="/api/v1/files/file_1/content"
    />,
  )
  assert.match(markup, /overlay-file-viewer--pdf/)
  assert.match(markup, /src="\/api\/v1\/files\/file_1\/content"/)
  assert.match(markup, /Show extracted text/)
})

test('PDFs without a preview URL render extracted text as the fallback', () => {
  const markup = renderToStaticMarkup(
    <FileViewer name="Research.pdf" content="Extracted PDF text" />,
  )
  assert.match(markup, /Extracted PDF text/)
  assert.match(markup, /Extracted text fallback for this PDF/)
})

test('PDFs without extracted text explain why a fallback is unavailable', () => {
  const markup = renderToStaticMarkup(
    <FileViewer name="Research.pdf" content="" url="/api/v1/files/file_1/content" />,
  )
  assert.match(markup, /No extracted text is available for this file/)
})
