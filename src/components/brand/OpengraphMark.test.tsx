import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ImageResponse } from 'next/og'
import { OpengraphMark } from './OpengraphMark'

test('OG mark uses the approved O and eye paths without a lowercase-letter tile', async () => {
  const svg = await readFile('internal/plans/mockups/overlay-brand/overlay-mark-white.svg', 'utf8')
  const html = renderToStaticMarkup(<OpengraphMark />)
  for (const [, path] of svg.matchAll(/ d="([^"]+)"/g)) assert.ok(html.includes(path!))
  assert.match(html, /viewBox="43 -815 860 860"/)
  assert.match(html, /aria-label="Overlay"/)
  assert.doesNotMatch(html, /<rect|<text/)
})

test('both public OG routes use the server-safe inline mark', async () => {
  for (const kind of ['c', 'f']) {
    const source = await readFile(`src/app/share/${kind}/[token]/opengraph-image.tsx`, 'utf8')
    assert.match(source, /<OpengraphMark \/>/)
    assert.doesNotMatch(source, /\n\s+o\n/)
  }
})

test('OG image renderer accepts the mark and emits a PNG', async () => {
  const response = new ImageResponse(<div style={{ display: 'flex', background: '#0a0a0a', width: '100%', height: '100%' }}><OpengraphMark /></div>, { width: 1200, height: 630 })
  const png = Buffer.from(await response.arrayBuffer())
  assert.equal(png.subarray(1, 4).toString(), 'PNG')
  assert.equal(png.readUInt32BE(16), 1200)
  assert.equal(png.readUInt32BE(20), 630)
})

test('existing brand raster URLs keep their dimensions and PNG format', async () => {
  for (const [path, width, height] of [
    ['docs/assets/favicon.png', 256, 256],
    ['public/assets/overlay-logo.png', 384, 384],
    ['public/assets/overlay-share-thumb.png', 512, 512],
    ['public/assets/overlay-share-x-thumb.png', 512, 512],
    ['public/assets/overlay-share-linkedin-thumb.png', 1200, 627],
    ['src/app/icon.png', 1024, 1024],
    ['src/assets/overlay-logo.png', 1024, 1024],
  ] as const) {
    const png = await readFile(path)
    assert.equal(png.subarray(1, 4).toString(), 'PNG', path)
    assert.equal(png.readUInt32BE(16), width, path)
    assert.equal(png.readUInt32BE(20), height, path)
  }
})
