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
    && sameShallow(left.props as object, right.props as object, (key, a, b) => {
      const same = key === 'children' ? sameNode(a, b) : Object.is(a, b)
      if (!same) recordRender(`ChatComposer changed element prop: ${key}`)
      return same
    })
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

/**
 * The same object with every function except `renderFunctions` replaced by a handler that keeps its identity
 * and calls the latest committed function. Functions called while rendering must stay in `renderFunctions`.
 * While nothing else changes, the previous object is returned, so it can be passed on as a memoizable prop.
 */
export function useForwardedHandlers<T extends object>(value: T, renderFunctions: ReadonlySet<string> = RENDER_FUNCTIONS): T {
  const latest = useRef(value)
  useLayoutEffect(() => { latest.current = value })
  const handlers = useRef(new Map<string, Handler>()).current
  const previous = useRef<T | null>(null)
  const next = Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (typeof item !== 'function' || renderFunctions.has(key)) return [key, item]
    let forwarded = handlers.get(key)
    if (!forwarded) {
      forwarded = (...args) => ((latest.current as Record<string, unknown>)[key] as Handler | undefined)?.(...args)
      handlers.set(key, forwarded)
    }
    return [key, forwarded]
  })) as T
  if (previous.current && sameShallow(previous.current, next, (_key, a, b) => Object.is(a, b))) return previous.current
  previous.current = next
  return next
}

const NO_QUEUE = {}

/** Composer view props whose event handlers keep their identity and always call the latest committed handler. */
export function useComposerViewProps(props: ChatComposerProps): ComposerViewProps {
  const viewProps = useForwardedHandlers(toComposerViewProps(props))
  const queue = useForwardedHandlers(props.queue ?? NO_QUEUE)
  return props.queue ? { ...viewProps, queue: queue as ComposerViewProps['queue'] } : viewProps
}
