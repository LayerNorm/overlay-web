'use client'

/* eslint-disable react-hooks/refs -- handlers are created once per key and read the latest committed props when called */

import { isValidElement, useLayoutEffect, useRef } from 'react'
import { recordRender } from '@overlay/chat-react/lib/perf-debug'
import { toComposerViewProps, type ChatComposerProps, type ComposerViewProps } from './ChatComposerTypes'

type Handler = (...args: unknown[]) => unknown

/** Functions the composer calls while rendering; a new one must re-render it. Every other function is an event handler. */
const RENDER_FUNCTIONS = new Set<string>(['attachMenuExtra'])

function forwards(key: string, value: unknown): value is Handler {
  return typeof value === 'function' && !RENDER_FUNCTIONS.has(key)
}

function sameShallow(left: object, right: object, same: (key: string, a: unknown, b: unknown) => boolean): boolean {
  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const keys = new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)])
  return [...keys].every((key) => same(key, leftRecord[key], rightRecord[key]))
}

/** Rendered content is equal when it is the same element tree with identical props. */
function sameNode(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((node, index) => sameNode(node, right[index]))
  }
  return isValidElement(left) && isValidElement(right) && left.type === right.type && left.key === right.key
    && sameShallow(left.props as object, right.props as object, (key, a, b) => key === 'children' ? sameNode(a, b) : Object.is(a, b))
}

function sameComposerValue(key: string, left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (forwards(key, left) && forwards(key, right)) return true
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
  if (isValidElement(left) || isValidElement(right)) return sameNode(left, right)
  if (Array.isArray(left) !== Array.isArray(right)) return false
  return sameShallow(left, right, key === 'queue' ? sameComposerValue : (_key, a, b) => Object.is(a, b))
}

/**
 * The chat surface rebuilds composer props on every streamed update. They are equal when the same data, the same
 * rendered content and some event handler are passed; the composer calls handlers through the latest props, so a
 * replaced handler alone never needs a render.
 */
export function sameChatComposerProps(prev: ChatComposerProps, next: ChatComposerProps): boolean {
  return sameShallow(toComposerViewProps(prev), toComposerViewProps(next), (key, left, right) => {
    const same = sameComposerValue(key, left, right)
    if (!same) recordRender(`ChatComposer changed: ${key}`)
    return same
  })
}

/** Composer view props whose event handlers keep their identity and always call the latest committed handler. */
export function useComposerViewProps(props: ChatComposerProps): ComposerViewProps {
  const viewProps = toComposerViewProps(props)
  const latest = useRef(viewProps)
  useLayoutEffect(() => { latest.current = viewProps })
  const handlers = useRef(new Map<string, Handler>()).current
  const handler = (path: string, read: (props: ComposerViewProps) => unknown) => {
    const existing = handlers.get(path)
    if (existing) return existing
    const created: Handler = (...args) => (read(latest.current) as Handler | undefined)?.(...args)
    handlers.set(path, created)
    return created
  }
  const stable = Object.fromEntries(Object.entries(viewProps).map(([key, value]) => [
    key,
    forwards(key, value) ? handler(key, (current) => current[key as keyof ComposerViewProps]) : value,
  ])) as ComposerViewProps
  if (!viewProps.queue) return stable
  const queue = viewProps.queue
  return {
    ...stable,
    queue: Object.fromEntries(Object.entries(queue).map(([key, value]) => [
      key,
      forwards(key, value)
        ? handler(`queue.${key}`, (current) => current.queue?.[key as keyof typeof queue])
        : value,
    ])) as typeof queue,
  }
}
