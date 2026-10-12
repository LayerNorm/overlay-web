import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { EditorLoadGate, useEditorLoad } from './EditorLoadGate'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

function Part({ loading, label }: { loading: boolean; label: string }) {
  useEditorLoad(loading)
  return <p>{label}</p>
}

test('the form is always mounted (so its parts can start fetching) inside the gate', () => {
  const html = renderToStaticMarkup(<EditorLoadGate><Part loading label="Machine" /></EditorLoadGate>)
  assert.match(html, /Machine/)
})

test('a part outside a gate loads as it always did', () => {
  const html = renderToStaticMarkup(<Part loading label="Alone" />)
  assert.equal(html, '<p>Alone</p>')
})
