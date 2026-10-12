'use client'

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'

const GATE_TIMEOUT_MS = 10_000

type Gate = { hold(): () => void }
const GateContext = createContext<Gate | null>(null)

/** What the agent settings show while anything in them is still loading. */
export function AgentEditorSkeleton() {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-4" aria-label="Loading agent" aria-busy="true">
      <div className="h-9 w-48 animate-pulse rounded-lg bg-[var(--surface-subtle)]" />
      <div className="h-28 animate-pulse rounded-xl bg-[var(--surface-subtle)]" />
      <div className="h-36 animate-pulse rounded-xl bg-[var(--surface-subtle)]" />
      <div className="h-20 animate-pulse rounded-xl bg-[var(--surface-subtle)]" />
    </div>
  )
}

/**
 * Shows one loading state until every part of the agent settings has loaded, then shows them all at once.
 *
 * The parts load on their own (the machine, its access and model, the memories, reachability, the computer), so left
 * alone they pop in one by one and the form reflows under the person's cursor. Each part calls `useEditorLoad(loading)`;
 * the gate keeps the content mounted but out of sight (so every part can start fetching) and reveals it when none is
 * still loading. Once revealed it stays revealed: a later refresh never hides the form again. A part that never
 * finishes cannot trap the person behind the skeleton: after 10 seconds the content shows regardless.
 */
export function EditorLoadGate({ children }: { children: ReactNode }) {
  // The count lives in state (what renders) and in a ref (what an effect can read live, past a stale render).
  const liveHolds = useRef(0)
  const [holds, setHolds] = useState(0)
  const [released, setReleased] = useState(false)

  const hold = useCallback(() => {
    liveHolds.current += 1
    setHolds((value) => value + 1)
    return () => {
      liveHolds.current -= 1
      setHolds((value) => value - 1)
    }
  }, [])
  const gate = useMemo<Gate>(() => ({ hold }), [hold])

  // A part that starts out loading registers in a layout effect, and the re-render that causes happens before the browser
  // paints, so the first paint already shows the skeleton even though the very first render saw no holds.
  const ready = released || holds === 0
  // Latch once everything has loaded. Checked a moment later and against the live count: a part that mounts as another
  // finishes (the machine panel once its connection is known) has registered by then, and must be waited for.
  useEffect(() => {
    if (released || holds !== 0) return
    const timer = window.setTimeout(() => {
      if (liveHolds.current === 0) setReleased(true)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [released, holds])
  useEffect(() => {
    if (released) return
    const timer = window.setTimeout(() => setReleased(true), GATE_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [released])

  return (
    <GateContext.Provider value={gate}>
      <div className="relative">
        {ready ? null : <AgentEditorSkeleton />}
        <div
          aria-hidden={!ready}
          className={ready ? undefined : 'pointer-events-none invisible absolute inset-x-0 top-0 h-0 overflow-hidden'}
        >
          {children}
        </div>
      </div>
    </GateContext.Provider>
  )
}

/** Tells the surrounding gate that this part is still loading. Does nothing outside a gate. */
export function useEditorLoad(loading: boolean): void {
  const gate = useContext(GateContext)
  useLayoutEffect(() => {
    if (!gate || !loading) return
    return gate.hold()
  }, [gate, loading])
}
