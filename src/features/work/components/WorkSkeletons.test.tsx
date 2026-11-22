import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { WorkBodySkeleton } from './WorkSkeletons'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

test('every Work view loads in the composer column the loaded view uses', () => {
  const column = 'mx-auto w-full max-w-4xl'
  assert.ok(renderToStaticMarkup(<WorkBodySkeleton view="list" />).includes(`${column} px-3 sm:px-4`))
  assert.ok(renderToStaticMarkup(<WorkBodySkeleton view="board" />).includes('mx-auto min-h-0 w-full max-w-4xl'))
  assert.ok(renderToStaticMarkup(<WorkBodySkeleton view="timeline" />).includes('mx-auto min-h-0 w-full max-w-4xl flex-1 px-3 sm:px-4'))
})

test('list rows have no divider lines and match the loaded row height', () => {
  const markup = renderToStaticMarkup(<WorkBodySkeleton view="list" />)
  assert.equal(markup.includes('border-b'), false)
  assert.equal(markup.match(/flex h-10 items-center gap-3 px-6/g)?.length, 5)
})

test('the board shows five columns', () => {
  assert.equal(renderToStaticMarkup(<WorkBodySkeleton view="board" />).match(/sm:basis-59/g)?.length, 5)
})
