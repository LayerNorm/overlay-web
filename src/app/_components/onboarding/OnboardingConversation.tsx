'use client'

import { useRef, useState } from 'react'
import { Button, DialogFrame, QuestionnaireSuggestions } from '@overlay/ui/primitives'
import { ArrowLeft } from 'lucide-react'
import { DirectMessageExperience } from '@/features/chat/components/DirectMessageExperience'
import { useAuth } from '@/contexts/AuthContext'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { FREE_TIER_AUTO_MODEL_ID } from '@/shared/ai/gateway/model-types'
import { AGENT_TOOL_PRESETS, toolIdsForEnabledGroups } from '@/shared/agents/tool-groups'
import { dispatchAgentDirectoryChanged } from '@/shared/workspace/sidebar-events'
import type { OnboardingAction, OnboardingEmployee, OnboardingSession, OnboardingSessionResponse } from '@/shared/onboarding/session'
import { onboardingChoices, onboardingProfileSteps } from '@/shared/onboarding/session'
import { onboardingRequestInit, requestOnboarding } from './onboarding-client'
import { OnboardingEmployees, OnboardingExternalAgents } from './OnboardingEmployees'
import { readOnboardingDraft, writeOnboardingDraft } from './onboarding-drafts'
import { OnboardingConnections } from './OnboardingConnections'
import { OnboardingContext, OnboardingInvites } from './OnboardingContext'
import styles from './onboarding.module.css'

export function OnboardingDots() {
  return <div className={styles.dots} role="status" aria-label="Overlay is preparing a response"><span /><span /><span /></div>
}

function canGoBackFromProfile(session: OnboardingSession) {
  return onboardingProfileSteps(session).indexOf(session.step) > 0 && session.createdAgentIds.length === 0
}

export function OnboardingConversation({ session, initialName, onChange, onShowWork }: { session: OnboardingSession; initialName: string; onChange(result: OnboardingSessionResponse): void; onShowWork(): void }) {
  const { user } = useAuth()
  const [input, setInput] = useState(() => readOnboardingDraft(session, initialName))
  const [inputRevision, setInputRevision] = useState(0)
  const [focusRevision, setFocusRevision] = useState(0)
  const [previousStep, setPreviousStep] = useState(session.step)
  const [taskDraft, setTaskDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const working = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [privacyOpen, setPrivacyOpen] = useState(false)
  const [pendingAnswer, setPendingAnswer] = useState<{ text: string; clientNonce: string } | null>(null)
  if (previousStep !== session.step) {
    setPreviousStep(session.step); setInput(readOnboardingDraft(session, initialName)); setInputRevision((current) => current + 1); setTaskDraft(null); setPendingAnswer(null)
  }
  const changeInput = (value: string) => {
    const bounded = value.slice(0, 3000)
    setInput(bounded)
    if (user) writeOnboardingDraft(session, bounded)
  }
  const chooseDraft = (value: string) => {
    changeInput(value)
    setInputRevision((current) => current + 1)
    setFocusRevision((current) => current + 1)
  }
  const perform = async (operation: () => Promise<void>) => {
    if (working.current) return
    working.current = true; setBusy(true); setError(null)
    try {
      await Promise.all([operation(), new Promise((resolve) => window.setTimeout(resolve, 500))])
    } catch (value) {
      setError(value instanceof Error ? value.message : 'Something went wrong. Your progress is saved. Try again.')
      // A lost response or another device may already have advanced the session.
      try { onChange(await requestOnboarding(session.workspaceId)) } catch { /* Keep the last durable state available for retry. */ }
    } finally { working.current = false; setBusy(false) }
  }
  const act = async (action: OnboardingAction) => {
    const [next] = await Promise.all([
      requestOnboarding(session.workspaceId, action),
      new Promise((resolve) => window.setTimeout(resolve, 500)),
    ])
    onChange(next)
  }
  const advance = (values: { agentIds?: string[]; memoryIds?: string[]; invitationIds?: string[] } = {}) => act({ action: 'advance', runId: session.runId, revision: session.revision, ...values })
  const skip = () => { void perform(() => advance()) }
  const answer = () => {
    const value = input.trim()
    if (!value || working.current || !user) return
    if (session.step === 'task') { setTaskDraft(value); return }
    setInput(''); setInputRevision((current) => current + 1)
    setPendingAnswer({ text: value, clientNonce: `onboarding:${user.id}:${session.runId}:${session.revision + 1}:user` })
    void perform(async () => {
      try { await act({ action: 'answer', runId: session.runId, revision: session.revision, value }) }
      catch (failure) {
        setPendingAnswer(null); setInput(value); setInputRevision((current) => current + 1)
        throw failure
      }
    })
  }
  const createEmployees = (indices: number[], externalIds: string[], employees: OnboardingEmployee[]) => {
    void perform(async () => {
      const agentIds = [...externalIds]
      for (const index of indices) {
        const employee = employees[index]
        if (!employee) continue
        const result = await overlayAppClient.agents.create(session.workspaceId, {
          name: employee.name, description: employee.role, instructions: employee.role,
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
  const openEnded = [...onboardingProfileSteps(session), 'task'].includes(session.step) && !taskDraft
  const choices = onboardingChoices(session)
  const canGoBack = canGoBackFromProfile(session)
  const footer = (
    <div className={styles.panel}>
      {busy ? <OnboardingDots /> : null}
      {error ? <p role="alert" className="mb-4 text-sm text-destructive">{error}</p> : null}
      <div aria-busy={busy} className={busy ? 'pointer-events-none opacity-60' : undefined}>
        {session.step === 'employees' ? <OnboardingEmployees session={session} disabled={busy} onConfirm={createEmployees} /> : null}
        {session.step === 'connections' ? <OnboardingConnections session={session} disabled={busy} onContinue={skip} /> : null}
        {session.step === 'external' ? <OnboardingExternalAgents session={session} disabled={busy} onContinue={(agentIds) => { void perform(() => advance({ agentIds })) }} /> : null}
        {session.step === 'memories' ? <OnboardingContext disabled={busy} onSave={saveMemories} onSkip={skip} /> : null}
        {session.step === 'teammates' ? <OnboardingInvites disabled={busy} onInvite={invite} onSkip={skip} /> : null}
        {openEnded && choices.length ? <QuestionnaireSuggestions questionId={session.step} choices={choices} multiple={session.step === 'about' || session.step === 'daily'} value={input} onDraftChange={chooseDraft} disabled={busy} /> : null}
        {canGoBack ? <Button variant="ghost" size="sm" className="mt-4 -ml-3 text-muted-foreground" disabled={busy} onClick={() => { void perform(() => act({ action: 'back', runId: session.runId, revision: session.revision })) }}><ArrowLeft className="size-3" />Back</Button> : null}
        {session.step === 'task' && taskDraft ? <div className="space-y-4 rounded-xl border p-4"><p className="text-sm font-medium break-words">{taskDraft}</p><p className="text-xs leading-5 text-muted-foreground">A Personal task in Work, linked to this conversation. Creating it does not start execution or incur model usage. Choose an assignee and start it from Work.</p><div className="flex justify-end gap-2"><Button variant="ghost" disabled={busy} onClick={() => setTaskDraft(null)}>Edit</Button><Button disabled={busy} onClick={createTask}>Create task</Button></div></div> : null}
        {session.step === 'complete' ? <Button onClick={onShowWork}>See your first task</Button> : null}
      </div>
    </div>
  )
  return <>
    <DirectMessageExperience conversationId={session.conversationId} draftTitle="Overlay" guided={session.step === 'complete' ? { footer, composer: null, revision: session.revision } : {
      revision: session.revision, footer, pendingMessage: pendingAnswer,
      headerActions: <Button variant="ghost" size="sm" disabled={busy} onClick={() => setPrivacyOpen(true)}>{session.aiEnabled ? 'Personalization on' : 'Personalize with AI'}</Button>,
      composer: openEnded ? { value: input, onChange: changeInput, onSubmit: answer, placeholder: session.step === 'name' ? 'Your name' : session.step === 'task' ? 'What is one task we can get started with?' : 'Choose a suggestion, or tell me in your own words...', disabled: busy, revision: inputRevision, focusRevision } : null,
    }} />
    <DialogFrame open={privacyOpen} onOpenChange={setPrivacyOpen} title="Personalize your onboarding" className="w-[min(460px,94vw)]">
      <p className="text-sm leading-6 text-muted-foreground">Use Overlay Free through Vercel AI Gateway or OpenRouter to personalize replies, employee suggestions, and starter tasks using your name, work description, and daily tasks. Imported memories and teammate emails are never included.</p>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">Only used while pricing is verified free and your account policy permits it. Provider retention and training settings vary. Prepared responses are always available.</p>
      <div className="mt-5 flex justify-end gap-2"><Button variant="ghost" onClick={() => { setPrivacyOpen(false); void perform(() => act({ action: 'consent', runId: session.runId, revision: session.revision, enabled: false })) }}>Use prepared replies</Button><Button onClick={() => { setPrivacyOpen(false); void perform(() => act({ action: 'consent', runId: session.runId, revision: session.revision, enabled: true })) }}>Enable personalization</Button></div>
    </DialogFrame>
  </>
}
