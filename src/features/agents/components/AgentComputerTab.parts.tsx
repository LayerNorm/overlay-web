'use client'

import { ArrowLeft, ExternalLink, MousePointer2 } from 'lucide-react'
import type { Computer, WorkspaceAgentCreatureShape } from '@overlay/workspace-contracts'
import { Button } from '@overlay/ui/primitives'
import { unstyledButton } from '@overlay/ui/control-reset'
import { AgentCreature } from '@/components/orb/Creature'

export function AgentComputerTabView({
  agentName,
  agentColor,
  agentShape,
  unavailable = false,
  computer,
  computerLoading,
  computerError,
  ticketUrl,
  ticketError,
  ticketLoading,
  controlled,
  currentUserId,
  controlBusy = false,
  waking,
  onWake,
  onRetry,
  onTakeControl,
  onReleaseControl,
}: {
  agentName: string
  agentColor?: string
  agentShape?: WorkspaceAgentCreatureShape
  unavailable?: boolean
  computer: Computer | null
  computerLoading: boolean
  computerError: string | null
  ticketUrl: string | null
  ticketError: string | null
  ticketLoading: boolean
  controlled: boolean
  currentUserId?: string
  controlBusy?: boolean
  waking: boolean
  onWake(): void
  onRetry(): void
  onTakeControl(ticketUrl: string, computerName: string): void
  onReleaseControl(): void
}) {
  if (unavailable) {
    return (
      <div className="space-y-2">
        <div className="relative flex aspect-[16/10] flex-col items-center justify-center gap-2 overflow-hidden rounded-xl bg-(--surface-subtle) text-center text-xs text-(--muted)">
          <AgentCreature
            agent={{ name: agentName, avatarColor: agentColor, avatarShape: agentShape }}
            size={44}
          />
          Computer unavailable
        </div>
      </div>
    )
  }
  if (computerLoading) {
    return (
      <div className="space-y-2">
        <ConnectingState />
        <p className="text-center text-xs text-(--muted)">Connecting</p>
      </div>
    )
  }
  if (computerError) {
    return (
      <div className="space-y-2 py-2">
        <p className="text-xs text-(--muted)">{computerError}</p>
        <Button variant="secondary" size="sm" onClick={onRetry}>Retry</Button>
      </div>
    )
  }
  if (!computer) return <p className="py-2 text-xs text-(--muted)">No computer</p>
  if (computer.status === 'stopped') {
    return (
      <div className="space-y-2">
        <div className="flex aspect-[16/10] flex-col items-center justify-center gap-2 rounded-xl bg-(--surface-subtle) text-xs text-(--muted)">
          <AgentCreature
            agent={{ name: agentName, avatarColor: agentColor, avatarShape: agentShape }}
            size={44}
          />
          <span>Computer is asleep</span>
          <Button variant="secondary" size="sm" disabled={waking} onClick={onWake}>
            {waking ? 'Waking...' : 'Wake'}
          </Button>
        </div>
        <p className="text-center text-xs text-(--muted)">{agentName}&apos;s computer</p>
      </div>
    )
  }
  if (computer.status === 'provisioning') {
    return (
      <div className="space-y-2">
        <ConnectingState />
        <p className="text-center text-xs text-(--muted)">Waking up</p>
      </div>
    )
  }
  if ((computer.status as string) === 'starting') {
    return (
      <div className="space-y-2">
        <ConnectingState />
        <p className="text-center text-xs text-(--muted)">Connecting</p>
      </div>
    )
  }
  if (computer.status !== 'ready') {
    return <p className="py-2 text-xs text-(--muted)">Computer is unavailable</p>
  }
  if (ticketError) {
    return (
      <div className="space-y-2 py-2">
        <p className="text-xs text-(--muted)">{ticketError}</p>
        <Button variant="secondary" size="sm" onClick={onRetry}>Retry</Button>
      </div>
    )
  }
  if (ticketLoading || !ticketUrl) {
    return (
      <div className="space-y-2">
        <ConnectingState />
        <p className="text-center text-xs text-(--muted)">Connecting</p>
      </div>
    )
  }

  return (
    <ReadyComputerPreview
      agentName={agentName}
      computer={computer}
      ticketUrl={ticketUrl}
      controlled={controlled}
      currentUserId={currentUserId}
      controlBusy={controlBusy}
      onTakeControl={onTakeControl}
      onReleaseControl={onReleaseControl}
      onRetry={onRetry}
    />
  )
}

function ReadyComputerPreview({
  agentName,
  computer,
  ticketUrl,
  controlled,
  currentUserId,
  controlBusy,
  onTakeControl,
  onReleaseControl,
  onRetry,
}: {
  agentName: string
  computer: Computer
  ticketUrl: string
  controlled: boolean
  currentUserId?: string
  controlBusy: boolean
  onTakeControl(ticketUrl: string, computerName: string): void
  onReleaseControl(): void
  onRetry(): void
}) {
  const computerName = computer.name ?? agentName
  const controlledByCurrentUser = Boolean(currentUserId && computer.controlledByUserId === currentUserId)
  const controlledByAnotherUser = Boolean(computer.controlledByUserId && !controlledByCurrentUser)
  const status = controlledByCurrentUser
    ? `You have control. ${agentName} is paused.`
    : controlledByAnotherUser
      ? `${agentName} is paused. Another member has control.`
      : `${agentName} is working`
  if (controlled && controlledByCurrentUser) {
    return (
      <div className="space-y-2">
        <div className="flex aspect-[16/10] items-center justify-center rounded-xl bg-(--surface-subtle) text-xs text-(--muted)">
          You have control
        </div>
        <ComputerControlStatus status={status} releaseBusy={controlBusy} onReleaseControl={onReleaseControl} />
      </div>
    )
  }
  return (
    <div className="space-y-2">
      <div className="group/preview relative aspect-[16/10] overflow-hidden rounded-xl bg-(--surface-subtle)">
        <iframe
          src={ticketUrl}
          title={`${computerName} computer preview`}
          tabIndex={-1}
          onError={onRetry}
          className="pointer-events-none h-full w-full border-0"
        />
        {!controlledByAnotherUser ? (
          <Button
            variant="ghost"
            type="button"
            aria-label={controlledByCurrentUser ? 'Resume control' : 'Take control'}
            disabled={controlBusy}
            onClick={() => onTakeControl(ticketUrl, computerName)}
            className={unstyledButton('absolute inset-0 flex items-center justify-center rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring)')}
          >
            <span className="absolute inset-0 bg-black/40 opacity-0 transition-opacity group-hover/preview:opacity-100 group-focus-within/preview:opacity-100" />
            <span className="relative inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-medium text-gray-900 opacity-0 shadow transition-opacity group-hover/preview:opacity-100 group-focus-within/preview:opacity-100">
              <MousePointer2 size={14} />
              {controlBusy
                ? controlledByCurrentUser ? 'Releasing control...' : 'Taking control...'
                : controlledByCurrentUser ? 'Resume control' : 'Take control'}
            </span>
          </Button>
        ) : null}
      </div>
      {controlledByCurrentUser
        ? <ComputerControlStatus status={status} releaseBusy={controlBusy} onReleaseControl={onReleaseControl} />
        : <p className="flex items-center gap-2 text-xs text-(--muted)">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            {status}
          </p>}
    </div>
  )
}

function ComputerControlStatus({
  status,
  releaseBusy,
  onReleaseControl,
}: {
  status: string
  releaseBusy: boolean
  onReleaseControl(): void
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="flex items-center gap-2 text-xs text-(--muted)">
        <span className="size-1.5 rounded-full bg-emerald-500" />
        {status}
      </p>
      <Button variant="secondary" size="sm" disabled={releaseBusy} onClick={onReleaseControl}>
        {releaseBusy ? 'Releasing control...' : 'Release control'}
      </Button>
    </div>
  )
}

function ConnectingState() {
  return (
    <div className="flex aspect-[16/10] flex-col items-center justify-center gap-3 rounded-xl bg-(--surface-subtle) text-xs text-(--muted)" role="status">
      <span className="flex items-center gap-1" aria-hidden="true">
        <span className="size-1.5 animate-pulse rounded-full bg-current motion-reduce:animate-none" />
        <span className="size-1.5 animate-pulse rounded-full bg-current [animation-delay:150ms] motion-reduce:animate-none" />
        <span className="size-1.5 animate-pulse rounded-full bg-current [animation-delay:300ms] motion-reduce:animate-none" />
      </span>
      Connecting
    </div>
  )
}

export function AgentComputerControlOverlay({
  computerName,
  ticketUrl,
  onClose,
  controlBusy = false,
}: {
  computerName: string
  ticketUrl: string
  onClose(): void
  controlBusy?: boolean
}) {
  const openInNewTab = () => {
    window.open(ticketUrl, '_blank', 'noopener,noreferrer')
  }
  return (
    <section className="flex h-full min-h-0 flex-col bg-(--background)" aria-label="Computer control">
      <header className="flex min-h-12 items-center justify-between gap-3 border-b border-(--border) px-3">
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="ghost" size="icon-sm" aria-label="Back to conversation" disabled={controlBusy} onClick={onClose}>
            <ArrowLeft size={16} />
          </Button>
          <span className="text-sm font-medium text-(--foreground)">Computer</span>
          <span className="hidden items-center gap-1.5 text-xs text-(--muted) sm:inline-flex">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            You have control
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="ghost" size="icon-sm" aria-label="Open in new tab" title="Open in new tab" onClick={openInNewTab}>
            <ExternalLink size={15} />
          </Button>
          <Button variant="secondary" size="sm" disabled={controlBusy} onClick={onClose}>
            {controlBusy ? 'Releasing control...' : 'Release control'}
          </Button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
        <div className="aspect-[16/10] w-full max-w-[1100px] overflow-hidden rounded-xl bg-(--surface-subtle)">
          <iframe
            src={ticketUrl}
            title={`${computerName} computer control`}
            allow="clipboard-read; clipboard-write; fullscreen; autoplay"
            className="h-full w-full border-0"
          />
        </div>
      </div>
    </section>
  )
}
