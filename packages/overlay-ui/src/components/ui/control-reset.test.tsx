import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { unstyledButton, unstyledInput, unstyledTextarea } from '../../control-reset'
import { Button } from './button'
import { Input } from './input'
import { Textarea } from './textarea'

function renderedClasses(element: React.ReactElement) {
  const match = renderToStaticMarkup(element).match(/\bclass="([^"]*)"/)
  assert.ok(match)
  return new Set(match[1].split(/\s+/))
}

test('unstyled buttons reset shared layout and typography classes', () => {
  const classes = renderedClasses(
    <Button variant="ghost" className={unstyledButton('flex w-full')}>
      Menu
    </Button>,
  )

  for (const leaked of ['justify-center', 'items-center', 'gap-2', 'shrink-0', 'text-sm']) {
    assert.equal(classes.has(leaked), false, `${leaked} should be reset`)
  }
  for (const reset of ['justify-normal', 'items-stretch', 'gap-0', 'shrink', 'text-[length:inherit]']) {
    assert.equal(classes.has(reset), true, `${reset} should be present`)
  }
})

test('unstyled button consumer layout and typography classes take precedence', () => {
  const classes = renderedClasses(
    <Button
      variant="ghost"
      className={unstyledButton('flex items-center justify-between gap-3 text-xs')}
    >
      Menu
    </Button>,
  )

  for (const consumer of ['items-center', 'justify-between', 'gap-3', 'text-xs']) {
    assert.equal(classes.has(consumer), true, `${consumer} should be preserved`)
  }
})

test('compact picker layout overrides the reset and keeps its icon centered', () => {
  const classes = renderedClasses(
    <Button variant="ghost" className={unstyledButton('flex h-6 w-6 shrink-0 items-center justify-center')}>
      <svg width="16" height="16" />
    </Button>,
  )
  for (const centered of ['flex', 'h-6', 'w-6', 'shrink-0', 'items-center', 'justify-center']) {
    assert.ok(classes.has(centered))
  }
  assert.equal(classes.has('items-stretch'), false)
})

test('unstyled inputs reset base typography while preserving consumer classes', () => {
  const resetClasses = renderedClasses(<Input className={unstyledInput('w-full')} />)
  assert.equal(resetClasses.has('border-(--border)'), false)
  assert.equal(resetClasses.has('border-current'), true)
  assert.equal(resetClasses.has('text-sm'), false)
  assert.equal(resetClasses.has('text-[length:inherit]'), true)
  assert.equal(resetClasses.has('leading-[inherit]'), true)

  const consumerClasses = renderedClasses(<Input className={unstyledInput('text-xs')} />)
  assert.equal(consumerClasses.has('text-xs'), true)
  assert.equal(consumerClasses.has('text-[length:inherit]'), false)
  assert.equal(resetClasses.has('focus-visible:ring-0'), true)
})

test('unstyled textareas reset base layout and typography while preserving consumer classes', () => {
  const resetClasses = renderedClasses(<Textarea className={unstyledTextarea('w-full')} />)
  assert.equal(resetClasses.has('border-(--border)'), false)
  assert.equal(resetClasses.has('border-current'), true)
  assert.equal(resetClasses.has('min-h-24'), false)
  assert.equal(resetClasses.has('resize-none'), false)
  assert.equal(resetClasses.has('resize-y'), true)
  assert.equal(resetClasses.has('text-sm'), false)
  assert.equal(resetClasses.has('leading-6'), false)
  assert.equal(resetClasses.has('min-h-auto'), true)
  assert.equal(resetClasses.has('text-[length:inherit]'), true)
  assert.equal(resetClasses.has('leading-[inherit]'), true)
  assert.equal(resetClasses.has('focus-visible:ring-0'), true)

  const consumerClasses = renderedClasses(
    <Textarea className={unstyledTextarea('resize-none text-xs leading-relaxed')} />,
  )
  assert.equal(consumerClasses.has('resize-none'), true)
  assert.equal(consumerClasses.has('resize-y'), false)
  assert.equal(consumerClasses.has('text-xs'), true)
  assert.equal(consumerClasses.has('leading-relaxed'), true)
})

test('shared text controls use the shadcn focus-visible treatment', () => {
  const inputClasses = renderedClasses(<Input />)
  const textareaClasses = renderedClasses(<Textarea />)
  const focusClasses = [
    'transition-[color,box-shadow]',
    'focus-visible:border-(--foreground)/30',
    'focus-visible:ring-3',
    'focus-visible:ring-(--foreground)/15',
  ]

  for (const className of focusClasses) {
    assert.equal(inputClasses.has(className), true, `${className} should be present on Input`)
    assert.equal(textareaClasses.has(className), true, `${className} should be present on Textarea`)
  }
  assert.equal(inputClasses.has('rounded-md'), true)
})
