import React from 'react'
import assert from 'node:assert/strict'
import test from 'node:test'
import {renderToStaticMarkup} from 'react-dom/server'
import {TabsList,TabButton} from './Tabs'
import {TabsList as PublicTabsList,TabButton as PublicTabButton} from '../../primitives'

test('the public TabsList wrapper provides context for TabButton',()=>{
  assert.doesNotThrow(()=>renderToStaticMarkup(
    <PublicTabsList aria-label="Views">
      <PublicTabButton active>Work</PublicTabButton>
      <PublicTabButton>Files</PublicTabButton>
    </PublicTabsList>,
  ))
})

test('the legacy active prop drives the canonical selected tab on first render',()=>{
  const html=renderToStaticMarkup(<TabsList><TabButton>First</TabButton><TabButton active>Second</TabButton></TabsList>)
  assert.match(html,/aria-selected="true"[^>]*>Second<\/button>/)
  assert.equal((html.match(/aria-selected="true"/g)??[]).length,1)
})

test('a list with no active item does not select a different tab implicitly',()=>{
  const html=renderToStaticMarkup(<TabsList><TabButton>First</TabButton><TabButton disabled>Second</TabButton></TabsList>)
  assert.equal(html.includes('aria-selected="true"'),false)
})
