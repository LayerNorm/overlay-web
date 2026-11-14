import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Plug, Settings, Unplug } from 'lucide-react'
import { ExtensionCatalogPage, ExtensionCatalogRow, type ExtensionCatalogEntry, type ExtensionCatalogPageProps } from './catalog-page'
import { Field, FieldSelect } from './shared'

const noop = () => {}
const entry = (id: string, overrides: Partial<ExtensionCatalogEntry> = {}): ExtensionCatalogEntry => ({ id, name: id[0]!.toUpperCase() + id.slice(1), description: `${id} description`, onOpen: noop, onAdd: noop, ...overrides })

function page(overrides: Partial<ExtensionCatalogPageProps> = {}) {
  return renderToStaticMarkup(<ExtensionCatalogPage
    title="Connectors" subtitle="Let Overlay work across your apps." noun="connectors" icon={Plug} yoursLabel="Yours"
    browse={[{ id: 'popular', title: 'Popular', items: ['gmail', 'slack', 'notion', 'linear', 'github', 'figma', 'zoom'].map(id => entry(id)) }]}
    yours={[{ id: 'connected', title: 'Connected', items: [] }]}
    yoursEmpty={{ title: 'No connectors yet', body: 'Connectors you connect will appear here.' }}
    addOptions={[{ id: 'mcp', label: 'Custom MCP server', icon: Plug, onSelect: noop }]}
    category={null} onCategoryChange={noop} noResults={{ body: 'Check the spelling.' }}
    {...overrides}
  />)
}

test('Browse shows the page header, tabs and a section preview of six rows with a section link', () => {
  const html = page()
  assert.match(html, /<h1[^>]*>Connectors<\/h1>/)
  assert.match(html, /Let Overlay work across your apps\./)
  assert.match(html, /aria-label="Search connectors"/)
  assert.match(html, /aria-label="Add connectors"/)
  assert.match(html, /role="tab"[^>]*aria-selected="true"[^>]*>Browse</)
  assert.match(html, />Yours</)
  assert.match(html, /<h2[^>]*>Popular<\/h2>/)
  assert.equal(html.match(/data-slot="extension-row"/g)?.length, 6)
  assert.doesNotMatch(html, /Zoom/)
})

test('An open category lists every entry with a back button instead of tabs', () => {
  const html = page({ category: 'popular' })
  assert.match(html, /aria-label="Back to Connectors"/)
  assert.match(html, /<h1[^>]*>Popular<\/h1>/)
  assert.match(html, /7 connectors/)
  assert.equal(html.match(/data-slot="extension-row"/g)?.length, 7)
  assert.doesNotMatch(html, /role="tab"/)
})

test('Rows offer + when available and an options menu when added, and fall back to an initial logo', () => {
  const available = renderToStaticMarkup(<ExtensionCatalogRow entry={entry('gmail')} />)
  assert.match(available, /aria-label="Add Gmail"/)
  assert.match(available, />G<\/span>/)
  const added = renderToStaticMarkup(<ExtensionCatalogRow entry={entry('gmail', {
    onAdd: undefined,
    status: { label: 'Connection error', tone: 'error' },
    logo: { kind: 'image', src: '/gmail.svg' },
    menu: [{ label: 'Settings', icon: Settings, onSelect: noop }, { label: 'Disconnect', icon: Unplug, onSelect: noop }],
  })} />)
  assert.match(added, /aria-label="Gmail options"/)
  assert.doesNotMatch(added, /aria-label="Add Gmail"/)
  assert.match(added, /Connection error/)
  assert.match(added, /src="\/gmail.svg"/)
  const busy = renderToStaticMarkup(<ExtensionCatalogRow entry={entry('gmail', { busy: true })} />)
  assert.match(busy, /disabled=""[^>]*aria-label="Working on Gmail"|aria-label="Working on Gmail"[^>]*disabled=""/)
})

test('Without a browse catalog the page shows the empty state', () => {
  const html = page({ browse: [], browseEmpty: { title: 'Apps are on the way', body: 'Apps will appear here.' }, addOptions: undefined })
  assert.match(html, /Apps are on the way/)
  assert.doesNotMatch(html, /aria-label="Add connectors"/)
})

test('Field labels point to the shared Select trigger', () => {
  const html = renderToStaticMarkup(<Field label="Authentication"><FieldSelect value="oauth" onChange={() => {}} options={[{ value: 'oauth', label: 'OAuth' }]} /></Field>)
  const id = html.match(/for="([^"]+)"/)?.[1]
  assert.ok(id)
  assert.ok(html.includes(`id="${id}"`))
  assert.match(html, /role="combobox"/)
})
