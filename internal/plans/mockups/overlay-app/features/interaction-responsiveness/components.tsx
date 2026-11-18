import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { WorkItem, WorkPerson } from '@overlay/app-core'
import { Button } from '@overlay/ui/primitives'
import { AgentCreature } from '@/components/orb/Creature'
import { navigate } from '../../shims/router'

type AssignmentPhase = 'idle' | 'saving' | 'saved' | 'unknown' | 'checking' | 'no-start' | 'starting' | 'running'
type AssignmentCheckOutcome = 'running' | 'no-start'
type AgentPhase = 'idle' | 'saving' | 'create-failed' | 'saved' | 'computer-error' | 'computer-retrying' | 'computer-ready'

type ScenarioContextValue = {
  assignmentPhase: AssignmentPhase
  assignmentCheckOutcome: AssignmentCheckOutcome
  agentPhase: AgentPhase
  submittedAgentName: string
  setAgentDraftName(name: string): void
  setAssignmentCheckOutcome(outcome: AssignmentCheckOutcome): void
  submitAssignment(): void
  failAssignmentStart(): void
  checkAssignmentStatus(): void
  retryAssignmentStart(): void
  submitAgent(): void
  failAgentCreate(): void
  failComputerSetup(): void
  retryAgentCreate(): void
  retryComputerSetup(): void
  reset(): void
}

const ScenarioContext = createContext<ScenarioContextValue | null>(null)
const TARGET_TASK = 'Launch the new homepage'
const TARGET_TASK_ID = `k17work${'0'.repeat(24)}1`
const DELAY_MS = 1100

function useScenario() {
  const value = useContext(ScenarioContext)
  if (!value) throw new Error('Interaction scenario is not mounted')
  return value
}

function ScenarioControls({ scenario }: { scenario: ScenarioContextValue }) {
  return (
    <div className="fixed inset-x-0 top-0 z-[100] flex h-10 items-center gap-1 overflow-x-auto border-b border-(--border) bg-background px-2 text-xs">
      <span className="shrink-0 px-2 font-medium text-(--muted)">Mockup controls</span>
      <Button variant="ghost" size="xs" className="shrink-0" onClick={() => navigate(`/w/northwind/workspace/work?view=list&task=${TARGET_TASK_ID}`)}>Work task</Button>
      <Button variant="ghost" size="xs" className="shrink-0" onClick={() => navigate('/app/agents/new')}>Agent editor</Button>
      <Button variant="ghost" size="xs" className="shrink-0" onClick={() => navigate('/app/agents')}>Agent dialog</Button>
      <span className="mx-1 h-5 w-px shrink-0 bg-(--border)" />
      <Button variant="secondary" size="xs" className="shrink-0" onClick={scenario.submitAssignment}>Save assignment</Button>
      <Button variant="ghost" size="xs" className="shrink-0" onClick={scenario.failAssignmentStart}>Start error</Button>
      <span className="shrink-0 px-1 text-(--muted)">Check result</span>
      <Button variant={scenario.assignmentCheckOutcome === 'running' ? 'secondary' : 'ghost'} size="xs" className="shrink-0" onClick={() => scenario.setAssignmentCheckOutcome('running')}>Running turn</Button>
      <Button variant={scenario.assignmentCheckOutcome === 'no-start' ? 'secondary' : 'ghost'} size="xs" className="shrink-0" onClick={() => scenario.setAssignmentCheckOutcome('no-start')}>No turn started</Button>
      <Button variant="secondary" size="xs" className="shrink-0" onClick={scenario.submitAgent}>Submit agent</Button>
      <Button variant="ghost" size="xs" className="shrink-0" onClick={scenario.failAgentCreate}>Create error</Button>
      <Button variant="ghost" size="xs" className="shrink-0" onClick={scenario.failComputerSetup}>Computer error</Button>
      <Button variant="ghost" size="xs" className="shrink-0" onClick={scenario.reset}>Reset</Button>
    </div>
  )
}

export function InteractionScenarioProvider({ children }: { children: ReactNode }) {
  const [assignmentPhase, setAssignmentPhase] = useState<AssignmentPhase>('idle')
  const [assignmentCheckOutcome, setAssignmentCheckOutcome] = useState<AssignmentCheckOutcome>('running')
  const [agentPhase, setAgentPhase] = useState<AgentPhase>('idle')
  const [agentDraftName, setAgentDraftNameState] = useState('')
  const [submittedAgentName, setSubmittedAgentName] = useState('')
  const assignmentTimer = useRef<number | null>(null)
  const agentTimers = useRef<number[]>([])

  const clearAssignmentTimer = useCallback(() => {
    if (assignmentTimer.current !== null) window.clearTimeout(assignmentTimer.current)
    assignmentTimer.current = null
  }, [])
  const clearAgentTimers = useCallback(() => {
    agentTimers.current.forEach((timer) => window.clearTimeout(timer))
    agentTimers.current = []
  }, [])
  const scheduleAgent = useCallback((callback: () => void, delay = DELAY_MS) => {
    agentTimers.current.push(window.setTimeout(callback, delay))
  }, [])
  const setAgentDraftName = useCallback((name: string) => setAgentDraftNameState(name), [])

  const submitAssignment = useCallback(() => {
    clearAssignmentTimer()
    setAssignmentPhase('saving')
    assignmentTimer.current = window.setTimeout(() => setAssignmentPhase('saved'), DELAY_MS)
  }, [clearAssignmentTimer])
  const failAssignmentStart = useCallback(() => {
    clearAssignmentTimer()
    setAssignmentPhase('saving')
    assignmentTimer.current = window.setTimeout(() => setAssignmentPhase('unknown'), DELAY_MS)
  }, [clearAssignmentTimer])
  const checkAssignmentStatus = useCallback(() => {
    if (assignmentPhase !== 'unknown') return
    clearAssignmentTimer()
    setAssignmentPhase('checking')
    assignmentTimer.current = window.setTimeout(() => setAssignmentPhase(assignmentCheckOutcome), DELAY_MS)
  }, [assignmentCheckOutcome, assignmentPhase, clearAssignmentTimer])
  const setCheckOutcome = useCallback((outcome: AssignmentCheckOutcome) => setAssignmentCheckOutcome(outcome), [])
  const retryAssignmentStart = useCallback(() => {
    if (assignmentPhase !== 'no-start') return
    clearAssignmentTimer()
    setAssignmentPhase('starting')
    assignmentTimer.current = window.setTimeout(() => setAssignmentPhase('running'), DELAY_MS)
  }, [assignmentPhase, clearAssignmentTimer])

  const startAgentCreate = useCallback((fails: boolean) => {
    clearAgentTimers()
    const name = agentDraftName.trim() || 'New agent'
    setSubmittedAgentName(name)
    setAgentPhase('saving')
    scheduleAgent(() => setAgentPhase(fails ? 'create-failed' : 'saved'))
  }, [agentDraftName, clearAgentTimers, scheduleAgent])
  const submitAgent = useCallback(() => startAgentCreate(false), [startAgentCreate])
  const failAgentCreate = useCallback(() => startAgentCreate(true), [startAgentCreate])
  const failComputerSetup = useCallback(() => {
    clearAgentTimers()
    setSubmittedAgentName(agentDraftName.trim() || submittedAgentName || 'New agent')
    setAgentPhase('saving')
    scheduleAgent(() => {
      setAgentPhase('saved')
      scheduleAgent(() => setAgentPhase('computer-error'), 650)
    })
  }, [agentDraftName, clearAgentTimers, scheduleAgent, submittedAgentName])
  const retryComputerSetup = useCallback(() => {
    clearAgentTimers()
    setAgentPhase('computer-retrying')
    scheduleAgent(() => setAgentPhase('computer-ready'))
  }, [clearAgentTimers, scheduleAgent])
  const retryAgentCreate = useCallback(() => startAgentCreate(false), [startAgentCreate])
  const reset = useCallback(() => {
    clearAssignmentTimer()
    clearAgentTimers()
    setAssignmentPhase('idle')
    setAssignmentCheckOutcome('running')
    setAgentPhase('idle')
    setSubmittedAgentName('')
  }, [clearAgentTimers, clearAssignmentTimer])

  useEffect(() => {
    const style = document.createElement('style')
    style.textContent = 'html[data-mockup-interaction] [data-app-shell]{height:calc(100vh - 40px)!important;margin-top:40px}'
    document.documentElement.dataset.mockupInteraction = 'true'
    document.head.append(style)
    return () => {
      delete document.documentElement.dataset.mockupInteraction
      style.remove()
      clearAssignmentTimer()
      clearAgentTimers()
    }
  }, [clearAgentTimers, clearAssignmentTimer])

  const scenario: ScenarioContextValue = {
    assignmentPhase,
    assignmentCheckOutcome,
    agentPhase,
    submittedAgentName,
    setAgentDraftName,
    setAssignmentCheckOutcome: setCheckOutcome,
    submitAssignment,
    failAssignmentStart,
    checkAssignmentStatus,
    retryAssignmentStart,
    submitAgent,
    failAgentCreate,
    failComputerSetup,
    retryAgentCreate,
    retryComputerSetup,
    reset,
  }

  return (
    <ScenarioContext.Provider value={scenario}>
      {children}
      <ScenarioControls scenario={scenario} />
    </ScenarioContext.Provider>
  )
}

export function useProjectedAssignee(item: Pick<WorkItem, 'title'>, stored: WorkPerson | null, people: WorkPerson[]) {
  const { assignmentPhase } = useScenario()
  if (item.title !== TARGET_TASK || assignmentPhase === 'idle') return stored
  return people.find((person) => person.principalId === 'p_atlas') ?? stored
}

export function AssignmentStatus({ itemTitle, compact = false }: { itemTitle: string; compact?: boolean }) {
  const { assignmentPhase, checkAssignmentStatus, retryAssignmentStart } = useScenario()
  if (itemTitle !== TARGET_TASK || assignmentPhase === 'idle') return null

  const label = assignmentPhase === 'saving' ? 'Saving'
    : assignmentPhase === 'saved' ? 'Saved, waiting to start'
      : assignmentPhase === 'unknown' ? compact ? 'Start status unknown' : 'Assigned to Atlas. Start status unknown'
        : assignmentPhase === 'checking' ? compact ? 'Checking status' : 'Checking start status'
          : assignmentPhase === 'no-start' ? compact ? 'No turn started' : 'Assigned to Atlas. No turn started'
            : assignmentPhase === 'starting' ? 'Starting'
              : 'Running'

  const statusColor = assignmentPhase === 'unknown' || assignmentPhase === 'no-start'
    ? 'text-red-600 dark:text-red-400'
    : 'text-(--muted)'
  const action = assignmentPhase === 'unknown' ? (
    <Button type="button" variant="ghost" size="xs" className="h-6 shrink-0 px-1.5 text-(--foreground)" onClick={(event) => { event.stopPropagation(); checkAssignmentStatus() }}>Check status</Button>
  ) : assignmentPhase === 'checking' ? (
    <Button type="button" variant="ghost" size="xs" className="h-6 shrink-0 px-1.5 text-(--muted)" disabled>Checking</Button>
  ) : assignmentPhase === 'no-start' ? (
    <Button type="button" variant="ghost" size="xs" className="h-6 shrink-0 px-1.5 text-(--foreground)" onClick={(event) => { event.stopPropagation(); retryAssignmentStart() }}>Retry start</Button>
  ) : null
  const statusContent = (
    <>
      <span className={compact ? undefined : 'min-w-0 break-words'}>{label}</span>
      {action}
    </>
  )

  return compact ? (
    <span className={`inline-flex shrink-0 items-center gap-1.5 text-[11px] ${statusColor}`} aria-live="polite">{statusContent}</span>
  ) : (
    <div className={`flex w-full min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] ${statusColor}`} aria-live="polite">{statusContent}</div>
  )
}

export function AgentLifecyclePanel({ name, computerEnabled }: { name: string; computerEnabled: boolean }) {
  const {
    agentPhase,
    submittedAgentName,
    setAgentDraftName,
    submitAgent,
    failAgentCreate,
    failComputerSetup,
    retryAgentCreate,
    retryComputerSetup,
  } = useScenario()

  useEffect(() => setAgentDraftName(name), [name, setAgentDraftName])

  const displayedName = submittedAgentName || name.trim() || 'New agent'
  const computerVisible = computerEnabled || ['computer-error', 'computer-retrying', 'computer-ready'].includes(agentPhase)
  const agentSaved = ['saved', 'computer-error', 'computer-retrying', 'computer-ready'].includes(agentPhase)

  return (
    <>
      <div className="mt-3 flex flex-wrap items-center gap-1.5" data-mockup-agent-controls>
        <span className="mr-1 text-[10px] font-medium text-(--muted)">Mockup controls</span>
        <Button type="button" variant="secondary" size="xs" onClick={submitAgent}>Submit agent</Button>
        <Button type="button" variant="ghost" size="xs" onClick={failAgentCreate}>Create error</Button>
        <Button type="button" variant="ghost" size="xs" onClick={failComputerSetup}>Computer error</Button>
      </div>
      {agentPhase === 'idle' ? null : (
        <section className="mt-4 rounded-xl border border-(--border) bg-(--surface-elevated) p-3" aria-live="polite" data-mockup-agent-lifecycle>
          <div className="flex items-center gap-3">
            <AgentCreature agent={{ name: displayedName, avatarShape: 'hexagon', avatarColor: '#14b8a6' }} size={36} animated={false} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-(--foreground)">{displayedName}</p>
              <p className="text-xs text-(--muted)">{agentSaved ? 'Agent saved' : agentPhase === 'create-failed' ? 'Agent not saved' : 'Saving agent'}</p>
            </div>
            <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] ${agentPhase === 'create-failed' || agentPhase === 'computer-error' ? 'bg-red-500/10 text-red-700 dark:text-red-300' : 'bg-(--surface-subtle) text-(--muted)'}`}>
              {agentPhase === 'saving' ? 'Saving' : agentPhase === 'create-failed' ? 'Draft retained' : agentSaved ? 'Saved' : ''}
            </span>
          </div>
          {agentPhase === 'create-failed' ? (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-red-500/5 px-3 py-2">
              <p className="text-xs text-(--muted)">The editor draft is still available. No agent was saved.</p>
              <Button type="button" variant="secondary" size="xs" onClick={retryAgentCreate}>Retry create</Button>
            </div>
          ) : null}
          {computerVisible && agentSaved ? (
            <div className="mt-3 flex items-center justify-between gap-3 border-t border-(--border) pt-3">
              <div>
                <p className="text-xs font-medium text-(--foreground)">Computer setup</p>
                <p className={`mt-0.5 text-xs ${agentPhase === 'computer-error' ? 'text-red-600 dark:text-red-400' : 'text-(--muted)'}`}>
                  {agentPhase === 'computer-error' ? 'Could not provision the computer' : agentPhase === 'computer-retrying' ? 'Retrying setup' : agentPhase === 'computer-ready' ? 'Computer ready' : 'Setting up separately'}
                </p>
              </div>
              {agentPhase === 'computer-error' ? <Button type="button" variant="secondary" size="xs" onClick={retryComputerSetup}>Retry setup</Button> : null}
            </div>
          ) : null}
        </section>
      )}
    </>
  )
}
