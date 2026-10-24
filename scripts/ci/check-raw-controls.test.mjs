import assert from 'node:assert/strict'
import test from 'node:test'
import { findRawControls } from './check-raw-controls.mjs'

const findTags = (source) => findRawControls(source, 'fixture.tsx').map(({ tag }) => tag)

test('bare JSX ESLint suppressions do not exempt raw buttons', () => {
  assert.deepEqual(
    findTags('{/* eslint-disable-next-line no-restricted-syntax */}\n<button />'),
    ['button'],
  )
})

test('bare line suppressions do not exempt multiline raw buttons', () => {
  assert.deepEqual(
    findTags('// eslint-disable-next-line no-restricted-syntax\n<button\n  onClick={() => {}}\n>'),
    ['button'],
  )
})

test('an annotation without a reason does not exempt a raw control', () => {
  assert.deepEqual(
    findTags('{/* eslint-disable-next-line no-restricted-syntax -- overlay:raw-control: */}\n<button />'),
    ['button'],
  )
})

test('an annotation separated from a raw control by a blank or code line does not exempt it', () => {
  const annotation = '{/* overlay:raw-control: Native browser behavior is required. */}'
  assert.deepEqual(findTags(annotation + '\n\n<button />'), ['button'])
  assert.deepEqual(findTags(annotation + '\nconst separator = true\n<button />'), ['button'])
})

test('bare suppressions do not exempt file inputs', () => {
  assert.deepEqual(
    findTags('{/* eslint-disable-next-line no-restricted-syntax */}\n<input type="file" />'),
    ['input'],
  )
})

test('unannotated textareas and selects are reported', () => {
  assert.deepEqual(findTags('<textarea />\n<select />'), ['textarea', 'select'])
})

test('a reasoned native file picker annotation exempts the input', () => {
  assert.deepEqual(
    findTags('{/* eslint-disable-next-line no-restricted-syntax -- overlay:raw-control: Native file picker exposes the browser FileList. */}\n<input type="file" />'),
    [],
  )
})

test('a reasoned multiline block comment exempts the control', () => {
  assert.deepEqual(
    findTags('{/*\n * overlay:raw-control: Native browser behavior is required.\n * eslint-disable-next-line no-restricted-syntax\n */}\n<button />'),
    [],
  )
})

test('a reasoned comment on the tag line exempts the control', () => {
  assert.deepEqual(
    findTags('{/* eslint-disable-next-line no-restricted-syntax -- overlay:raw-control: Native behavior is required. */}<button />'),
    [],
  )
})

test('component names and tag-like names are not raw controls', () => {
  assert.deepEqual(findTags('<Button /><InputGroup /><buttonish />'), [])
})

test('unstyledButton strings that rebuild a variant are reported', async () => {
  const { findButtonStyleOverrides } = await import('./check-raw-controls.mjs')
  const kinds = (source) => findButtonStyleOverrides(source, 'fixture.tsx').map(({ kind }) => kind)
  assert.deepEqual(kinds('<Button className={unstyledButton("rounded-md bg-(--foreground) px-3 text-(--background)")} />'), ['rebuilt-primary'])
  assert.deepEqual(kinds('<Button className={unstyledButton("border border-(--border) bg-(--surface-subtle) px-3")} />'), ['rebuilt-secondary'])
  assert.deepEqual(kinds('<Button className={unstyledButton("border border-(--border) hover:bg-(--surface-subtle)")} />'), ['rebuilt-outline'])
  assert.deepEqual(kinds('<Button className={unstyledButton("rounded-sm p-1 text-(--muted) hover:bg-(--surface-subtle)")} />'), [])
})

test('color classes on a standard variant are reported, ghost and layout classes are not', async () => {
  const { findButtonStyleOverrides } = await import('./check-raw-controls.mjs')
  const kinds = (source) => findButtonStyleOverrides(source, 'fixture.tsx').map(({ kind }) => kind)
  assert.deepEqual(kinds('<Button variant="primary" className="bg-(--foreground) text-(--background)" />'), ['recolored-primary'])
  assert.deepEqual(kinds('<Button variant="secondary" className="mt-3 w-full" />'), [])
  assert.deepEqual(kinds('<Button variant="ghost" className="text-(--muted)" />'), [])
})

test('a reasoned button-style comment exempts the override', async () => {
  const { findButtonStyleOverrides } = await import('./check-raw-controls.mjs')
  assert.deepEqual(findButtonStyleOverrides('<Button\n  // overlay:button-style: Checkbox.\n  className={unstyledButton("bg-(--foreground) text-(--background)")}\n/>', 'fixture.tsx'), [])
})
