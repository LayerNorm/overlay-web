'use client'

import { useCallback, useRef, useState, type ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import { Button } from '@overlay/ui/primitives'
import { DirectMessageExperience } from '@/features/chat/components/DirectMessageExperience'
import { useAuth } from '@/contexts/AuthContext'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { FREE_TIER_AUTO_MODEL_ID } from '@/shared/ai/gateway/model-types'
import { AGENT_TOOL_PRESETS, toolIdsForEnabledGroups } from '@/shared/agents/tool-groups'
import { dispatchAgentDirectoryChanged } from '@/shared/workspace/sidebar-events'
import type { OnboardingAction, OnboardingEmployee, OnboardingSession, OnboardingSessionResponse } from '@/shared/onboarding/session'
import { onboardingChoices, onboardingProfileSteps } from '@/shared/onboarding/session'
import { onboardingRequestInit, requestOnboarding } from './onboarding-client'
import { readOnboardingDraft, writeOnboardingDraft } from './onboarding-drafts'
import { MultiChoices, SingleChoices } from './OnboardingChoices'
import { OnboardingContext, OnboardingInvites, OnboardingTaskPreview } from './OnboardingContext'
import { OnboardingEmployees } from './OnboardingEmployees'
import { OnboardingTools } from './OnboardingTools'
import styles from './onboarding.module.css'

export function OnboardingDots() {
  return <div className={styles.dots} role="status" aria-label="Overlay is typing"><span /><span /><span /></div>
}

const PLACEHOLDERS: Partial<Record<OnboardingSession['step'], string>> = {
  name: 'Your name',
  about: 'Or describe it in your own words',
  team: 'Or tell me about your team',
  website: 'Or type a link',
  daily: 'Or describe what takes up your time',
  task: 'Or describe a task',
}

type Props = { session: OnboardingSession; onChange(result: OnboardingSessionResponse): void; onShowWork(): void; onSkip(): void }

export function OnboardingConversation({ session, onChange, onShowWork, onSkip }: Props) {
  const { user } = useAuth()
  const [input, setInput] = useState(() => readOnboardingDraft(session))
  const [inputRevision, setInputRevision] = useState(0)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [previousStep, setPreviousStep] = useState(session.step)
  const [taskDraft, setTaskDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const working = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingAnswer, setPendingAnswer] = useState<{ text: string; clientNonce: string } | null>(null)
  // Controls can grow after they mount (availability checks, inline edits); keep them in view.
  const replyRef = useCallback((node: HTMLDivElement | null) => {
    if (!node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => node.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  if (previousStep !== session.step) {
    setPreviousStep(session.step); setInput(readOnboardingDraft(session)); setInputRevision((current) => current + 1)
    setPicked(new Set()); setTaskDraft(null); setPendingAnswer(null)
  }
  const replaceInput = (value: string) => { setInput(value); setInputRevision((current) => current + 1) }
  const changeInput = (value: string) => {
    const bounded = value.slice(0, 3000)
    setInput(bounded)
    if (user) writeOnboardingDraft(session, bounded)
  }
  const perform = async (operation: () => Promise<void>) => {
    if (working.current) return
    working.current = true; setBusy(true); setError(null)
    try {
      await operation()
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Something went wrong. Your progress is saved. Try again.')
      // A lost response or another device may already have advanced the session.
      try { onChange(await requestOnboarding(session.workspaceId)) } catch { /* Keep the last durable state available for retry. */ }
    } finally { working.current = false; setBusy(false) }
  }
  const act = async (action: OnboardingAction) => {
    // A short beat so Overlay's reply reads as a reply, not a page swap.
    const [next] = await Promise.all([requestOnboarding(session.workspaceId, action), new Promise((resolve) => window.setTimeout(resolve, 450))])
    onChange(next)
  }
  const advance = (values: Omit<Extract<OnboardingAction, { action: 'advance' }>, 'action' | 'runId' | 'revision'> = {}) => act({ action: 'advance', runId: session.runId, revision: session.revision, ...values })
  const skip = () => { void perform(() => advance()) }

  const answer = (value: string) => {
    const text = value.trim()
    if (!text || working.current || !user) return
    if (session.step === 'task') { setTaskDraft(text); replaceInput(''); return }
    replaceInput('')
    setPendingAnswer({ text, clientNonce: `onboarding:${user.id}:${session.runId}:${session.revision + 1}:user` })
    void perform(async () => {
      try { await act({ action: 'answer', runId: session.runId, revision: session.revision, value: text }) }
      catch (failure) { setPendingAnswer(null); replaceInput(text); throw failure }
    })
  }
  const answerPicked = () => answer([...picked, input.trim()].filter(Boolean).join(', '))
  const createEmployees = (employees: OnboardingEmployee[]) => {
    void perform(async () => {
      const agentIds: string[] = []
      for (const [index, employee] of employees.entries()) {
        const result = await overlayAppClient.agents.create(session.workspaceId, {
          name: employee.name.trim(), description: employee.role.trim(), instructions: employee.role.trim(),
          harness: 'overlay', modelId: FREE_TIER_AUTO_MODEL_ID, visibility: 'creator',
          allowedToolIds: toolIdsForEnabledGroups(new Set(AGENT_TOOL_PRESETS.everything.filter((group) => group !== 'computer'))),
        }, onboardingRequestInit(session, `employee-${index}`))
        agentIds.push(result.agent.id)
      }
      dispatchAgentDirectoryChanged(session.workspaceId)
      await advance({ agentIds })
    })
  }
  const saveMemories = (content: string) => {
    void perform(async () => {
      const result = await overlayAppClient.memory.create({ content, source: 'manual', clientId: `onboarding:${session.runId}`, actor: 'user', tags: ['onboarding-import'] }, onboardingRequestInit(session, 'memories'))
      if (!result.ids?.length) throw new Error('No memories were saved. Review your context and try again.')
      await advance({ memoryIds: result.ids })
    })
  }
  const invite = (emails: string[]) => {
    void perform(async () => {
      const invitationIds: string[] = []
      for (const [index, email] of emails.entries()) {
        const result = await overlayAppClient.workspaces.invite(session.workspaceId, { email, role: 'member' }, onboardingRequestInit(session, `invitation-${index}`))
        invitationIds.push(result.invitation.id)
      }
      await advance({ invitationIds })
    })
  }
  const createTask = () => {
    if (!taskDraft) return
    void perform(async () => {
      const result = await overlayAppClient.work.create({ title: taskDraft.slice(0, 200), description: taskDraft, scope: 'personal', context: [{ type: 'chat', id: session.conversationId, label: 'Getting started with Overlay' }] }, onboardingRequestInit(session, 'first-task'))
      if (!result.item?.id) throw new Error('Task creation could not be confirmed. Please retry.')
      await act({ action: 'finish', runId: session.runId, revision: session.revision, taskId: result.item.id })
    })
  }

  const typing = [...onboardingProfileSteps(session), 'task'].includes(session.step) && !taskDraft
  const labels = onboardingChoices(session).map((choice) => choice.label)
  const firstName = user?.firstName?.trim()
  const controls = (): ReactNode => {
    switch (session.step) {
      case 'name': return firstName ? <SingleChoices choices={[firstName]} disabled={busy} onPick={answer} /> : null
      case 'about': case 'team': case 'website': return <SingleChoices choices={labels} disabled={busy} onPick={answer} />
      case 'daily': return <MultiChoices choices={labels} selected={picked} disabled={busy} onContinue={answerPicked}
        onToggle={(label) => setPicked((current) => { const next = new Set(current); if (!next.delete(label)) next.add(label); return next })} />
      case 'employees': return <OnboardingEmployees suggested={session.employees} disabled={busy} onConfirm={createEmployees} onSkip={() => { void perform(() => advance()) }} />
      case 'connections': return <OnboardingTools session={session} disabled={busy} onContinue={({ tools, agentIds }) => { void perform(() => advance({ connectedTools: tools, agentIds })) }} />
      case 'external': return <OnboardingTools session={session} disabled={busy} onContinue={({ agentIds }) => { void perform(() => advance({ agentIds })) }} />
      case 'memories': return <OnboardingContext disabled={busy} onSave={saveMemories} onSkip={skip} />
      case 'teammates': return <OnboardingInvites disabled={busy} onInvite={invite} onSkip={skip} />
      case 'task': return taskDraft
        ? <OnboardingTaskPreview title={taskDraft} disabled={busy} onCreate={createTask} onChange={() => { replaceInput(taskDraft); setTaskDraft(null) }} />
        : <SingleChoices choices={labels} disabled={busy} onPick={answer} />
      case 'complete': return <Button variant="primary" size="sm" onClick={onShowWork}>Open Work<ArrowRight className="size-3.5" /></Button>
      default: return null
    }
  }
  // Controls sit in the message text column, directly under Overlay's question.
  const footer = (
    <div ref={replyRef} className={styles.reply}>
      {busy ? <OnboardingDots /> : <div key={`${session.step}:${session.revision}`} className={styles.appear}>{controls()}</div>}
      {error && !busy ? <p role="alert" className="mt-3 text-xs text-destructive">{error}</p> : null}
    </div>
  )
  return (
    <DirectMessageExperience conversationId={session.conversationId} draftTitle="Overlay" guided={session.step === 'complete' ? { footer, composer: null, revision: session.revision } : {
      revision: session.revision, footer, pendingMessage: pendingAnswer,
      headerActions: <Button variant="ghost" size="sm" disabled={busy} onClick={onSkip}>Skip setup</Button>,
      composer: {
        value: typing ? input : '',
        onChange: typing ? changeInput : () => {},
        onSubmit: () => { if (session.step === 'daily') answerPicked(); else answer(input) },
        placeholder: typing ? PLACEHOLDERS[session.step] ?? 'Type your answer' : 'Choose above to continue',
        disabled: busy || !typing,
        locked: !typing,
        revision: inputRevision,
        focusRevision: typing ? session.revision : 0,
      },
    }} />
  )
}
