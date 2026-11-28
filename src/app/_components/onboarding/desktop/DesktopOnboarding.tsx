'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Building2, Check, CircleCheck, Folder, FolderPlus, KeyRound, Laptop, Loader2, Lock, Monitor, MousePointerClick, User } from 'lucide-react'
import { Button, Checkbox, Input, Switch } from '@overlay/ui/primitives'
import { ProviderLogo } from '@overlay/ui/ai'
import type { LocalModelProvider, LocalSetupScan } from '@overlay/desktop-bridge'
import { OverlayMark } from '@/components/brand/OverlayMark'
import { useDesktopBridge } from '@/components/desktop/DesktopProvider'
import { LocalSetupList, useLocalSetupImport } from '@/components/desktop/LocalSetupList'
import { useLocalModelKeys } from '@/components/desktop/useLocalThreads'
import { useThisComputer } from '@/components/desktop/useThisComputer'
import { folderName } from '@/components/desktop/this-computer'
import { useLiveWorkspaceBilling } from '@/hooks/use-billing'
import { workspaceClient } from '@/features/workspaces/lib/workspace-client'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { currentLegalAcceptancePayload, LEGAL_DOCUMENTS } from '@/shared/legal/legal-documents'
import type { OnboardingPrefill, OnboardingSessionResponse } from '@/shared/onboarding/session'
import { requestOnboarding } from '../onboarding-client'
import { navigateToOnboardingCheckout } from '../checkout-navigation'
import { DESKTOP_ROLES, desktopSetupSteps, readDesktopSetup, writeDesktopSetup, type DesktopSetupState, type DesktopSetupStep } from './desktop-setup-state'

/**
 * A new account's first setup on Overlay Desktop (internal/plans/DESKTOP_ONBOARDING_PLAN.md): who the workspace is
 * for, about you, what other AI tools on this computer bring, model keys, this computer and a plan. It then starts
 * the Overlay conversation with those answers, which carries on with agents, apps, teammates and a first task.
 */
export function DesktopOnboarding({ userId, userName, personalWorkspaceId, onStarted }: {
  userId: string
  userName: string
  personalWorkspaceId: string
  onStarted(result: OnboardingSessionResponse): void
}) {
  const desktop = useDesktopBridge()
  const capabilities = desktop?.info.capabilities
  const steps = useMemo(() => desktopSetupSteps(capabilities ?? []), [capabilities])
  const [state, setState] = useState<DesktopSetupState>(() => readDesktopSetup(userId, userName, personalWorkspaceId))
  const update = useCallback((patch: Partial<DesktopSetupState>) => setState((current) => {
    const next = { ...current, ...patch }
    writeDesktopSetup(userId, next)
    return next
  }), [userId])
  const step: DesktopSetupStep = steps.includes(state.step) ? state.step : steps[0]!
  const index = steps.indexOf(step)
  const go = (offset: number) => update({ step: steps[Math.min(steps.length - 1, Math.max(0, index + offset))]! })
  // Until the app's bridge answers, which screens exist is unknown; don't fall back to the first one.
  if (!capabilities) return <div className="grid h-full place-items-center bg-background"><Loader2 size={18} className="animate-spin text-(--muted)" /></div>

  const finish = async (paid: boolean, billingInitialized: boolean) => {
    const prefill: OnboardingPrefill = {
      name: state.name.trim(), about: state.about.trim(),
      team: state.forTeam ? `A team: ${state.workspaceName.trim()}` : 'Just me',
    }
    const result = await requestOnboarding(state.workspaceId, { action: 'start', prefill })
    writeDesktopSetup(userId, null)
    if (paid) {
      if (!billingInitialized) await overlayAppClient.workspaces.initializeBilling(state.workspaceId)
      const { url } = await overlayAppClient.workspaces.createBillingCheckout(state.workspaceId, {
        planAmountCents: 800, topUpAmountCents: 800, autoTopUpEnabled: false, returnTo: 'onboarding',
        ...currentLegalAcceptancePayload(),
      })
      if (!url) throw new Error('Checkout could not be opened. You can subscribe from Settings.')
      navigateToOnboardingCheckout(url)
      return
    }
    // A new team workspace is already the active one; reload into it so the conversation continues there.
    if (state.workspaceId !== personalWorkspaceId) window.location.assign(new URL('/app', window.location.origin).href)
    else onStarted(result)
  }

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <div className="desktop-home-drag h-10 shrink-0" aria-hidden />
      <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-6">
        <div key={step} className={`desktop-home-enter my-auto w-full py-6 ${step === 'who' || step === 'about' ? 'max-w-[520px]' : 'max-w-[640px]'}`}>
          {step === 'who' ? <WhoStep state={state} update={update} personalWorkspaceId={personalWorkspaceId} onNext={() => go(1)} /> : null}
          {step === 'about' ? <AboutStep state={state} update={update} onBack={() => go(-1)} onNext={() => go(1)} /> : null}
          {step === 'setup' ? <SetupStep workspaceId={state.workspaceId} onBack={() => go(-1)} onNext={() => go(1)} /> : null}
          {step === 'models' ? <ModelsStep onBack={() => go(-1)} onNext={() => go(1)} /> : null}
          {step === 'computer' ? <ComputerStep workspaceId={state.workspaceId} onBack={() => go(-1)} onNext={() => go(1)} /> : null}
          {step === 'plan' ? <PlanStep state={state} onBack={() => go(-1)} onFinish={finish} /> : null}
        </div>
      </div>
      <div className="flex shrink-0 justify-center gap-1.5 pb-5 pt-3" aria-hidden>
        {steps.map((name) => <span key={name} className={`size-1.5 rounded-full ${name === step ? 'bg-(--muted)' : 'bg-(--border)'}`} />)}
      </div>
    </div>
  )
}

function Heading({ title, detail, mark = false }: { title: string; detail: string; mark?: boolean }) {
  return <>
    {mark ? <OverlayMark className="mb-5 size-7 text-foreground" /> : null}
    <h1 className="text-[22px] font-semibold leading-7 tracking-[-0.01em]">{title}</h1>
    <p className="mt-1.5 text-sm text-(--muted)">{detail}</p>
  </>
}

function Actions({ onBack, onSkip, next, nextLabel = 'Continue', nextDisabled = false, busy = false }: {
  onBack?: () => void; onSkip?: () => void; next(): void; nextLabel?: string; nextDisabled?: boolean; busy?: boolean
}) {
  return <div className="mt-7 flex items-center gap-2">
    {onBack ? <Button variant="ghost" onClick={onBack} disabled={busy}><ArrowLeft size={16} strokeWidth={1.75} />Back</Button> : null}
    <span className="flex-1" />
    {onSkip ? <Button variant="ghost" onClick={onSkip} disabled={busy}>Skip</Button> : null}
    <Button variant="primary" onClick={next} disabled={nextDisabled || busy}>{busy ? <Loader2 size={16} className="animate-spin" /> : null}{nextLabel}</Button>
  </div>
}

function Choice({ pressed, icon, title, detail, onClick, disabled = false }: {
  pressed: boolean; icon: React.ReactNode; title: string; detail: string; onClick(): void; disabled?: boolean
}) {
  return (
    <Button variant="outline" aria-pressed={pressed} disabled={disabled} onClick={onClick}
      className={`h-auto flex-col items-stretch justify-start gap-3 rounded-[10px] bg-(--surface-elevated) p-3.5 text-left font-normal ${pressed ? 'border-(--muted-light)' : ''}`}>
      <span className="flex items-start justify-between">
        <span className="grid size-8 place-items-center rounded-lg bg-(--surface-subtle) text-(--muted)">{icon}</span>
        <span className={`grid size-4 place-items-center rounded-full border-[1.5px] ${pressed ? 'border-foreground' : 'border-(--muted-light)'}`}>
          {pressed ? <span className="size-2 rounded-full bg-foreground" /> : null}
        </span>
      </span>
      <span><span className="block text-sm font-medium">{title}</span><span className="mt-0.5 block text-[13px] leading-[18px] text-(--muted)">{detail}</span></span>
    </Button>
  )
}

function Row({ icon, title, detail, end }: { icon: React.ReactNode; title: React.ReactNode; detail?: React.ReactNode; end?: React.ReactNode }) {
  return <div className="flex min-h-14 items-center gap-3 px-3.5 py-3">
    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-(--surface-subtle) text-(--muted)">{icon}</span>
    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{title}</span>{detail ? <span className="mt-px block text-xs leading-[17px] text-(--muted)">{detail}</span> : null}</span>
    {end}
  </div>
}

const List = ({ children, className = '' }: { children: React.ReactNode; className?: string }) =>
  <div className={`divide-y divide-(--border) overflow-hidden rounded-[10px] border border-(--border) bg-(--surface-elevated) ${className}`}>{children}</div>
const Label = ({ children, optional = false }: { children: React.ReactNode; optional?: boolean }) =>
  <p className="mb-2 mt-6 text-[13px] font-medium">{children}{optional ? <span className="font-normal text-(--muted-light)"> optional</span> : null}</p>
const Done = ({ children }: { children: React.ReactNode }) =>
  <span className="inline-flex items-center gap-1.5 text-xs text-(--muted)"><CircleCheck size={14} className="text-emerald-500" />{children}</span>
const ErrorLine = ({ error }: { error: string | null }) => error ? <p role="alert" className="mt-3 text-xs text-red-500">{error}</p> : null
const errorText = (value: unknown, fallback: string) => value instanceof Error ? value.message : fallback

function WhoStep({ state, update, personalWorkspaceId, onNext }: {
  state: DesktopSetupState; update(patch: Partial<DesktopSetupState>): void; personalWorkspaceId: string; onNext(): void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const next = async () => {
    if (!state.forTeam) { update({ workspaceId: personalWorkspaceId }); onNext(); return }
    if (state.workspaceId !== personalWorkspaceId) { onNext(); return }
    setBusy(true); setError(null)
    try {
      const created = await workspaceClient.create({ name: state.workspaceName.trim() }, { idempotencyKey: `desktop-setup:${personalWorkspaceId}:team` })
      update({ workspaceId: created.workspace.id })
      onNext()
    } catch (failure) {
      setError(errorText(failure, 'Could not create the workspace. Try again.'))
    } finally { setBusy(false) }
  }
  return <>
    <Heading mark title="Who is this workspace for?" detail="You can invite people later either way" />
    <div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2">
      <Choice pressed={!state.forTeam} icon={<User size={16} strokeWidth={1.75} />} title="Just me" detail="Your agents, files and notes" onClick={() => update({ forTeam: false })} />
      <Choice pressed={state.forTeam} icon={<Building2 size={16} strokeWidth={1.75} />} title="My team" detail="Shared agents, channels and work" onClick={() => update({ forTeam: true })} />
    </div>
    {state.forTeam ? <>
      <Label>Workspace name</Label>
      <Input autoFocus value={state.workspaceName} placeholder="Northwind" maxLength={80} disabled={state.workspaceId !== personalWorkspaceId}
        onChange={(event) => update({ workspaceName: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter' && state.workspaceName.trim()) void next() }} />
      <p className="mt-2 text-xs text-(--muted)">Team workspaces are on the paid plan.</p>
    </> : null}
    <ErrorLine error={error} />
    <Actions next={() => void next()} busy={busy} nextDisabled={state.forTeam && !state.workspaceName.trim()} />
  </>
}

function AboutStep({ state, update, onBack, onNext }: { state: DesktopSetupState; update(patch: Partial<DesktopSetupState>): void; onBack(): void; onNext(): void }) {
  const custom = !DESKTOP_ROLES.includes(state.about as typeof DESKTOP_ROLES[number])
  const initials = state.name.trim().split(/\s+/).map((word) => word[0]).join('').slice(0, 2).toUpperCase() || '?'
  return <>
    <Heading title="About you" detail="Overlay uses this to suggest agents and a first task" />
    <div className="mt-6 flex items-end gap-3">
      <span className="grid size-11 shrink-0 place-items-center rounded-full bg-(--surface-subtle) font-medium text-(--muted)">{initials}</span>
      <label className="flex-1"><span className="mb-2 block text-[13px] font-medium">Your name</span>
        <Input value={state.name} maxLength={200} onChange={(event) => update({ name: event.target.value })} /></label>
    </div>
    <Label>What kind of work do you do?</Label>
    <div className="flex flex-wrap gap-1.5">
      {DESKTOP_ROLES.map((role) => (
        <Button key={role} variant="outline" size="sm" aria-pressed={state.about === role} onClick={() => update({ about: role })}
          className={`rounded-full font-normal ${state.about === role ? 'border-(--muted-light) bg-(--surface-subtle)' : ''}`}>{role}</Button>
      ))}
    </div>
    <Input className="mt-2.5" placeholder="Or describe it in your own words" maxLength={500} value={custom ? state.about : ''}
      onChange={(event) => update({ about: event.target.value })} />
    <Actions onBack={onBack} next={onNext} nextDisabled={!state.name.trim() || !state.about.trim()} />
  </>
}

function SetupStep({ workspaceId, onBack, onNext }: { workspaceId: string; onBack(): void; onNext(): void }) {
  const { available, scan, picked, toggle, busy, error, result, importPicked } = useLocalSetupImport(workspaceId)
  const next = async () => { if (!available || !picked.size || await importPicked()) onNext() }
  if (!scan) return <>
    <Heading title="Bring your setup" detail="Looking for Claude Code, Codex, Claude Desktop, Cursor and Gemini CLI on this computer" />
    <div className="mt-7 flex flex-col items-center gap-2.5 py-10 text-[13px] text-(--muted)"><Loader2 size={18} className="animate-spin" />Checking known settings files…</div>
    <Actions onBack={onBack} onSkip={onNext} next={onNext} nextDisabled />
  </>
  if (!scan.apps.length) return <>
    <Heading title="Bring your setup" detail="Overlay didn’t find Claude Code, Codex, Claude Desktop, Cursor or Gemini CLI settings on this computer." />
    <p className="mt-4 text-[13px] text-(--muted)">You can import them later from Settings → Import once you set one up.</p>
    <Actions onBack={onBack} next={onNext} />
  </>
  return <>
    <Heading title="Bring your setup" detail="We found AI tools on this computer. Choose what Overlay should bring in." />
    <LocalSetupList className="mt-5" scan={scan} picked={picked} busy={busy} onToggle={toggle} />
    <p className="mt-3.5 flex gap-2 text-xs leading-[18px] text-(--muted)"><Lock size={14} className="mt-px shrink-0" />
      Overlay read these settings on this computer and changed nothing. Only what you tick goes to your workspace; servers that run on this computer and tokens you leave unticked stay here.</p>
    {result?.failed.length ? <p role="alert" className="mt-3 text-xs text-red-500">
      Imported {result.imported.length}. {result.failed.map((item) => `${item.name}: ${item.error}`).join(' ')}</p> : null}
    <ErrorLine error={error} />
    <Actions onBack={onBack} onSkip={onNext} next={() => void next()} busy={busy}
      nextLabel={picked.size ? `${result?.failed.length ? 'Retry' : 'Import'} ${picked.size} ${picked.size === 1 ? 'item' : 'items'}` : 'Continue'} />
  </>
}

const PROVIDER_LABEL: Record<LocalModelProvider, string> = { anthropic: 'Anthropic', openai: 'OpenAI', google: 'Google', openrouter: 'OpenRouter' }

function ModelsStep({ onBack, onNext }: { onBack(): void; onNext(): void }) {
  const desktop = useDesktopBridge()
  const setupBridge = desktop?.info.capabilities.includes('localSetup') ? desktop.bridge : null
  const { keys, setKey } = useLocalModelKeys()
  const [scan, setScan] = useState<LocalSetupScan | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [adding, setAdding] = useState<LocalModelProvider | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState<Partial<Record<LocalModelProvider, boolean>>>({})
  useEffect(() => {
    if (!setupBridge) return
    let live = true
    void setupBridge.call('localSetup.scan', undefined).then((value) => { if (live) setScan(value) }).catch(() => undefined)
    return () => { live = false }
  }, [setupBridge])
  const has = (provider: LocalModelProvider) => Boolean(keys?.[provider] || added[provider])
  const attempt = async (provider: LocalModelProvider, work: () => Promise<unknown>) => {
    setBusy(provider); setError(null)
    try { await work(); setAdded((current) => ({ ...current, [provider]: true })); setAdding(null); setDraft('') }
    catch (failure) { setError(errorText(failure, 'That key didn’t work.')) }
    finally { setBusy(null) }
  }
  const found = scan?.shellKeys ?? []
  const others = (Object.keys(PROVIDER_LABEL) as LocalModelProvider[]).filter((provider) => !found.some((key) => key.provider === provider))
  return <>
    <Heading title="How private threads think" detail="Threads that stay on this computer call a model with your own key. Synced threads use Overlay’s models." />
    {found.length ? <>
      <Label>Found on this computer</Label>
      <List>{found.map((key) => <Row key={key.provider} icon={<ProviderLogo provider={key.provider} size={16} />} title={PROVIDER_LABEL[key.provider]}
        detail={has(key.provider) ? `Checked with ${PROVIDER_LABEL[key.provider]} · in your keychain` : <>Found <span className="font-mono">{key.variable}</span> in your shell · <span className="font-mono">…{key.hint}</span></>}
        end={has(key.provider) ? <Done>Added</Done> : <Button size="sm" disabled={busy !== null} onClick={() => void attempt(key.provider, () => setupBridge!.call('localSetup.useShellKey', { provider: key.provider }))}>
          {busy === key.provider ? <Loader2 size={14} className="animate-spin" /> : null}Use this key</Button>} />)}</List>
    </> : null}
    <Label optional={found.length > 0}>{found.length ? 'Add another key' : 'Add a key'}</Label>
    <List>{others.map((provider) => adding === provider
      ? <div key={provider} className="flex items-center gap-2 px-3.5 py-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-(--surface-subtle)"><ProviderLogo provider={provider} size={16} /></span>
          <Input autoFocus type="password" value={draft} placeholder={`${PROVIDER_LABEL[provider]} API key`} onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && draft.trim().length >= 8) void attempt(provider, () => setKey(provider, draft.trim())) }} />
          <Button size="sm" disabled={draft.trim().length < 8 || busy !== null} onClick={() => void attempt(provider, () => setKey(provider, draft.trim()))}>
            {busy === provider ? <Loader2 size={14} className="animate-spin" /> : null}Save</Button>
          <Button size="sm" variant="ghost" onClick={() => { setAdding(null); setDraft('') }}>Cancel</Button>
        </div>
      : <Row key={provider} icon={<ProviderLogo provider={provider} size={16} />} title={PROVIDER_LABEL[provider]}
          detail={has(provider) ? 'In your keychain' : provider === 'openrouter' ? 'Hundreds of models with one key' : undefined}
          end={has(provider) ? <Done>Added</Done> : <Button size="sm" variant="ghost" onClick={() => setAdding(provider)}><KeyRound size={14} />Add key</Button>} />)}
    </List>
    {scan && (scan.subscriptions.claude || scan.subscriptions.chatgpt) ? <>
      <Label>Use a plan you already pay for</Label>
      <List>
        {scan.subscriptions.claude ? <Row icon={<ProviderLogo provider="anthropic" size={16} />} title="Claude plan" detail="Signed in to Claude Code" end={<Soon />} /> : null}
        {scan.subscriptions.chatgpt ? <Row icon={<ProviderLogo provider="openai" size={16} />} title="ChatGPT plan" detail="Signed in to Codex" end={<Soon />} /> : null}
      </List>
    </> : null}
    <ErrorLine error={error} />
    <Actions onBack={onBack} onSkip={onNext} next={onNext} />
  </>
}
const Soon = () => <span className="whitespace-nowrap rounded-full border border-(--border) px-2 py-0.5 text-[11px] text-(--muted)">Coming soon</span>

function ComputerStep({ workspaceId, onBack, onNext }: { workspaceId: string; onBack(): void; onNext(): void }) {
  const computer = useThisComputer(workspaceId)
  const [error, setError] = useState<string | null>(null)
  const [keep, setKeep] = useState(true)
  const attempt = async (work: () => Promise<unknown>, fallback: string) => {
    setError(null)
    try { await work() } catch (failure) { setError(errorText(failure, fallback)) }
  }
  const status = computer.status
  const connected = Boolean(computer.environment)
  const allow = (permission: 'accessibility' | 'screen_recording') => attempt(async () => {
    await computer.bridge?.call('localComputer.requestPermission', { permission })
    await computer.refresh()
  }, 'Could not open System Settings.')
  const next = () => void attempt(async () => {
    if (connected && computer.bridge) await computer.bridge.call('localComputer.setKeepAvailable', { enabled: keep })
    onNext()
  }, 'Could not save that.')
  return <>
    <Heading title="This computer" detail="Agents can work here: read and write files in the folders you choose and run commands, asking first" />
    <List className="mt-5">
      <Row icon={<Laptop size={16} strokeWidth={1.75} />} title={computer.name ?? 'This computer'}
        detail={connected ? <><span className="mr-1.5 inline-block size-1.5 rounded-full bg-emerald-500 align-middle" />Connected to your workspace</> : 'Not connected yet'}
        end={connected ? <Done>Connected</Done> : <Button size="sm" disabled={computer.busy} onClick={() => void attempt(computer.connect, 'Couldn’t connect this computer.')}>
          {computer.busy ? <Loader2 size={14} className="animate-spin" /> : null}Connect</Button>} />
    </List>
    {connected ? <>
      <Label>Folders agents may use</Label>
      <List>
        <Row icon={<Folder size={16} strokeWidth={1.75} />} title={status?.workFolder ? folderName(status.workFolder) : 'Overlay Files'}
          detail={<span className="font-mono">{status?.workFolder?.replace(status.homeDirectory, '~')}</span>} end={<span className="text-xs text-(--muted)">Always</span>} />
        {computer.folders.map((path) => <Row key={path} icon={<Folder size={16} strokeWidth={1.75} />} title={folderName(path)}
          detail={<span className="font-mono">{status ? path.replace(status.homeDirectory, '~') : path}</span>}
          end={<Button size="sm" variant="ghost" onClick={() => void attempt(() => computer.removeFolder(path), 'Could not remove that folder.')}>Remove</Button>} />)}
        <Row icon={<FolderPlus size={16} strokeWidth={1.75} />} title="Choose a folder…" detail="Opens the system folder picker"
          end={<Button size="sm" variant="ghost" onClick={() => void attempt(computer.chooseFolder, 'Could not add that folder.')}>Choose</Button>} />
      </List>
      <Label optional>Screen tools</Label>
      <List>
        <Row icon={<Monitor size={16} strokeWidth={1.75} />} title="Screen Recording" detail="Lets agents take screenshots"
          end={status?.permissions.screenRecording ? <Done>Allowed</Done> : <Button size="sm" variant="ghost" onClick={() => void allow('screen_recording')}>Allow</Button>} />
        <Row icon={<MousePointerClick size={16} strokeWidth={1.75} />} title="Accessibility" detail="Lets agents click and type, always asking first"
          end={status?.permissions.accessibility ? <Done>Allowed</Done> : <Button size="sm" variant="ghost" onClick={() => void allow('accessibility')}>Allow</Button>} />
        <Row icon={<Laptop size={16} strokeWidth={1.75} />} title="Keep available when Overlay is closed" detail="Agents can still reach this computer while it’s awake"
          end={<Switch checked={keep} onCheckedChange={setKeep} aria-label="Keep available when Overlay is closed" />} />
      </List>
    </> : null}
    <ErrorLine error={error} />
    <Actions onBack={onBack} onSkip={onNext} next={next} />
  </>
}

function PlanStep({ state, onBack, onFinish }: { state: DesktopSetupState; onBack(): void; onFinish(paid: boolean, billingInitialized: boolean): Promise<void> }) {
  const team = state.forTeam
  const billing = useLiveWorkspaceBilling(state.workspaceId)
  const [plan, setPlan] = useState<'free' | 'paid'>(team ? 'paid' : 'free')
  const [accepted, setAccepted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const alreadyPaid = billing?.executionAccess?.canExecute === true
  const paid = plan === 'paid' && !alreadyPaid
  const go = async () => {
    setBusy(true); setError(null)
    try { await onFinish(paid && accepted, billing?.initialized === true) }
    catch (failure) { setError(errorText(failure, 'Something went wrong. Try again.')); setBusy(false) }
  }
  const feature = (text: string) => <li key={text} className="flex items-start gap-2"><Check size={14} className="mt-0.5 shrink-0 text-(--muted)" /><span>{text}</span></li>
  const card = (id: 'free' | 'paid', title: string, price: string, unit: string, items: string[]) => (
    <Button variant="outline" aria-pressed={plan === id} disabled={busy || (id === 'free' && team)} onClick={() => setPlan(id)}
      className={`h-auto flex-col items-stretch justify-start gap-3.5 whitespace-normal rounded-[10px] bg-(--surface-elevated) p-4 text-left font-normal ${plan === id ? 'border-(--muted-light)' : ''}`}>
      <span className="flex items-start justify-between"><span className="text-sm font-medium">{title}</span>
        <span className={`grid size-4 place-items-center rounded-full border-[1.5px] ${plan === id ? 'border-foreground' : 'border-(--muted-light)'}`}>{plan === id ? <span className="size-2 rounded-full bg-foreground" /> : null}</span></span>
      <span className="text-2xl font-semibold tracking-[-0.01em]">{price} <span className="text-[13px] font-normal text-(--muted)">{unit}</span></span>
      <ul className="flex flex-col gap-1.5 text-[13px]">{items.map(feature)}</ul>
    </Button>
  )
  return <>
    <Heading title="Pick a plan" detail={alreadyPaid ? 'This workspace already has a plan.' : team ? `${state.workspaceName.trim() || 'Your workspace'} is a team workspace, so it needs the paid plan` : 'Start free on this computer. Upgrade any time in Settings.'} />
    <div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2">
      {card('free', 'Free', '$0', 'forever', ['Private threads on this computer', 'Your own model keys', 'Memory, notes, tasks and files up to 100 MB', '50 web searches a month'])}
      {card('paid', 'Overlay', '$8', '/ month', ['Everything in Free', '$8 of usage credit every month', 'Overlay’s models, synced threads and Cloud computer', 'Gmail, Calendar, Slack, Notion and more', 'Invite your team'])}
    </div>
    {paid ? <label className="mt-4 flex items-start gap-2 text-xs text-(--muted)">
      <Checkbox checked={accepted} disabled={busy} onCheckedChange={(value) => setAccepted(value === true)} aria-label="Accept terms and privacy policy" />
      <span>I agree to the <a className="underline" href={LEGAL_DOCUMENTS.terms.href} target="_blank" rel="noreferrer">Terms of Service</a> and <a className="underline" href={LEGAL_DOCUMENTS.privacy.href} target="_blank" rel="noreferrer">Privacy Policy</a>.</span>
    </label> : null}
    <ErrorLine error={error} />
    <Actions onBack={onBack} next={() => void go()} busy={busy} nextDisabled={paid && !accepted} nextLabel={paid ? 'Subscribe' : plan === 'free' ? 'Continue free' : 'Continue'} />
  </>
}
