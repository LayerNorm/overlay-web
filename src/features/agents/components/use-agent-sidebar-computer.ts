'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { toast } from '@overlay/ui/primitives'
import type { useAgentComputer } from './use-agent-computer'

export function useAgentSidebarComputer({
  activeWorkspaceId,
  agentId,
  enabled,
  visible,
  currentUserId,
  state,
}: {
  activeWorkspaceId: string | null
  agentId: string
  enabled: boolean
  visible: boolean
  currentUserId: string | undefined
  state: ReturnType<typeof useAgentComputer>
}) {
  const {
    agentComputer: storedComputer,
    initialLoading: computerLoading,
    computerLoadError,
    retryComputerLoad,
    updateAgentComputerControl,
    startAgentComputer,
  } = state
  const computer = enabled && storedComputer?.workspaceId === activeWorkspaceId
    && storedComputer.ownerType === 'agent' && storedComputer.ownerId === agentId ? storedComputer : null
  const [controlBusy, setControlBusy] = useState(false)
  const controlPending = useRef(false)
  const [wakeError, setWakeError] = useState<string | null>(null)
  const [ticketUrl, setTicketUrl] = useState<string | null>(null)
  const [ticketError, setTicketError] = useState<string | null>(null)
  const [ticketLoading, setTicketLoading] = useState(false)
  const [ticketAttempt, setTicketAttempt] = useState(0)
  const waking = state.computerLifecycleBusy === 'start'
  const requestId = useRef(0)

  const loadComputer = useCallback(() => {
    setWakeError(null)
    retryComputerLoad()
  }, [retryComputerLoad])

  useEffect(() => {
    setWakeError(null)
  }, [activeWorkspaceId, agentId, enabled, computer?.status])

  const shouldPoll = Boolean(enabled && activeWorkspaceId && computer
    && (visible || computer.status === 'provisioning' || (computer.status as string) === 'starting'))
  useEffect(() => {
    if (!shouldPoll || !activeWorkspaceId) return
    const timer = window.setInterval(loadComputer, 5_000)
    return () => window.clearInterval(timer)
  }, [activeWorkspaceId, loadComputer, shouldPoll])

  useEffect(() => {
    if (!visible || !enabled || !activeWorkspaceId || computerLoading || computer?.status !== 'ready') {
      setTicketUrl(null)
      setTicketError(null)
      setTicketLoading(false)
      return
    }
    let cancelled = false
    const currentRequest = ++requestId.current
    setTicketUrl(null)
    setTicketError(null)
    setTicketLoading(true)
    void overlayAppClient.computers.openDesktop(activeWorkspaceId, computer.id, 'webrtc').then((ticket) => {
      if (!cancelled && requestId.current === currentRequest) setTicketUrl(ticket.url)
    }).catch(() => {
      if (!cancelled && requestId.current === currentRequest) setTicketError('Could not connect to the computer.')
    }).finally(() => {
      if (!cancelled && requestId.current === currentRequest) setTicketLoading(false)
    })
    return () => { cancelled = true }
  }, [activeWorkspaceId, computer?.id, computer?.status, computerLoading, enabled, ticketAttempt, visible])

  const wake = useCallback(async () => {
    if (!activeWorkspaceId || !computer || waking) return
    try {
      const result = await startAgentComputer()
      if (!result) return
      setWakeError(null)
    } catch {
      setWakeError('Could not wake the computer.')
    }
  }, [activeWorkspaceId, computer, startAgentComputer, waking])

  const retryTicket = useCallback(() => {
    setTicketUrl(null)
    setTicketAttempt((attempt) => attempt + 1)
  }, [])

  const changeControl = useCallback(async (action: 'take' | 'release') => {
    if (!computer || !currentUserId || controlPending.current) return false
    controlPending.current = true
    setControlBusy(true)
    try {
      const updated = await updateAgentComputerControl(action)
      if (!updated) return false
      setWakeError(null)
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not change computer control.')
      return false
    } finally {
      controlPending.current = false
      setControlBusy(false)
    }
  }, [computer, currentUserId, updateAgentComputerControl])

  return {
    computer,
    currentUserId,
    controlBusy: controlBusy || Boolean(state.computerLifecycleBusy),
    changeControl,
    computerLoading,
    computerError: computerLoadError ?? wakeError,
    ticketUrl,
    ticketError,
    ticketLoading,
    wake,
    waking,
    retryTicket,
    loadComputer,
  }
}
