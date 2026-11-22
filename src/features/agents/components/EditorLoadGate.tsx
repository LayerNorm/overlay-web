'use client'

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@overlay/ui/primitives'
import { AppScreenBody, AppScreenHeader, AppScreenShell } from '@overlay/modules-react/shell'

const GATE_TIMEOUT_MS = 10_000

type Gate = { hold(): () => void }
const GateContext = createContext<Gate | null>(null)

function FieldSkeleton({ label, className = 'h-9 rounded-md' }: { label: string; className?: string }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-(--foreground)">{label}</p>
      <div className={`border border-(--border) bg-(--surface-elevated) px-3 py-2.5 ${className}`}>
        <div className="ui-skeleton-line h-2.5 w-1/3" />
      </div>
    </div>
  )
}

/** What the agent settings show while anything in them is still loading: the form's own layout with empty fields. */
export function AgentEditorSkeleton() {
  return (
    <div className="mx-auto w-full max-w-2xl" role="status" aria-label="Loading agent">
      <div className="mt-5 space-y-5" aria-hidden>
        <div className="space-y-3.5">
          {/* `.ui-skeleton-line` sets its radius outside Tailwind's layers, so the avatar's needs `!`. */}
          <div className="ui-skeleton-line mx-auto size-[72px] rounded-full" />
          <FieldSkeleton label="Name" />
          <FieldSkeleton label="Description" className="h-16 rounded-lg" />
        </div>
        <FieldSkeleton label="Agent instructions" className="h-36 rounded-lg" />
        <FieldSkeleton label="Model" className="h-9 rounded-lg" />
      </div>
    </div>
  )
}

/** The agent editor route before its code and data load: the page header, then the form skeleton. */
export function AgentEditorRouteSkeleton({ mode }: { mode: 'new' | 'edit' }) {
  return (
    <AppScreenShell
      header={(
        <AppScreenHeader
          title={mode === 'new' ? 'New agent' : 'Agent'}
          leading={<Button variant="ghost" size="sm" disabled aria-label="Back to agents"><ArrowLeft size={14} /> Agents</Button>}
        />
      )}
    >
      <AppScreenBody padding="lg" maxWidth="xl" className="min-h-full">
        <AgentEditorSkeleton />
      </AppScreenBody>
    </AppScreenShell>
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
