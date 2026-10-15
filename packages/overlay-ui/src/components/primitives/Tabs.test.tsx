import React from 'react'
import assert from 'node:assert/strict'
import test from 'node:test'
import {renderToStaticMarkup} from 'react-dom/server'
import {TabsList,TabButton} from './Tabs'

test('the legacy active prop drives the canonical selected tab on first render',()=>{
  const html=renderToStaticMarkup(<TabsList><TabButton>First</TabButton><TabButton active>Second</TabButton></TabsList>)
  assert.match(html,/aria-selected="true"[^>]*>Second<\/button>/)
  assert.equal((html.match(/aria-selected="true"/g)??[]).length,1)
})

test('a list with no active item does not select a different tab implicitly',()=>{
  const html=renderToStaticMarkup(<TabsList><TabButton>First</TabButton><TabButton disabled>Second</TabButton></TabsList>)
  assert.equal(html.includes('aria-selected="true"'),false)
})
