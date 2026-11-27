import { useEffect, useState } from 'react'
import {
  getFunctionName,
  makeFunctionReference,
  type FunctionArgs,
  type FunctionReference,
  type FunctionReturnType,
} from 'convex/server'
import { subscribeConvex } from '../services/convexClient'

export function useLiveResource<Q extends FunctionReference<'query'>>(
  query: Q,
  args: FunctionArgs<Q> | null,
  scope?: string | null,
) {
  const name = getFunctionName(query)
  const serialized = args === null ? null : JSON.stringify(args)
  const [attempt, setAttempt] = useState(0)
  const key = JSON.stringify([name, serialized, scope, attempt])
  const [state, setState] = useState<{ key: string; data?: FunctionReturnType<Q>; error?: string }>(
    { key: '' },
  )
  useEffect(() => {
    if (serialized === null) return
    let active = true
    let stop: (() => void) | undefined
    const fail = (cause: unknown) => {
      if (active)
        setState({
          key,
          error: cause instanceof Error ? cause.message : 'Unable to load this resource.',
        })
    }
    try {
      stop = subscribeConvex(
        makeFunctionReference<'query'>(name) as Q,
        JSON.parse(serialized),
        (data) => {
          if (active) setState({ key, data })
        },
        fail,
      )
    } catch (cause) {
      fail(cause)
    }
    return () => {
      active = false
      stop?.()
    }
  }, [name, serialized, key])
  const current = state.key === key ? state : undefined
  return {
    data: current?.data,
    error: current?.error,
    loading: args !== null && current?.data === undefined && !current?.error,
    retry: () => setAttempt((value) => value + 1),
  }
}
