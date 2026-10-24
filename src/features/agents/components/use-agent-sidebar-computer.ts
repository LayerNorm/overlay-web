'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import type { useAgentComputer } from './use-agent-computer'

export function useAgentSidebarComputer({
  activeWorkspaceId,
  agentId,
  enabled,
  visible,
  state,
}: {
  activeWorkspaceId: string | null
  agentId: string
  enabled: boolean
  visible: boolean
  state: ReturnType<typeof useAgentComputer>
}) {
  const {
    agentComputer: computer,
    setAgentComputer: setComputer,
    initialLoading: computerLoading,
    computerLoadError,
    retryComputerLoad: loadComputer,
  } = state
  const [wakeError, setWakeError] = useState<string | null>(null)
  const [ticketUrl, setTicketUrl] = useState<string | null>(null)
  const [ticketError, setTicketError] = useState<string | null>(null)
  const [ticketLoading, setTicketLoading] = useState(false)
  const [ticketAttempt, setTicketAttempt] = useState(0)
  const [waking, setWaking] = useState(false)
  const requestId = useRef(0)

  useEffect(() => {
    setWakeError(null)
  }, [activeWorkspaceId, agentId, computer?.status])

  const shouldPoll = Boolean(enabled && activeWorkspaceId && computer
    && (computer.status === 'provisioning' || (computer.status as string) === 'starting'))
  useEffect(() => {
    if (!shouldPoll || !activeWorkspaceId) return
    const timer = window.setInterval(() => { void loadComputer() }, 10_000)
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
    setWaking(true)
    try {
      const result = await overlayAppClient.computers.start(activeWorkspaceId, computer.id)
      setComputer(result.computer)
      setWakeError(null)
    } catch {
      setWakeError('Could not wake the computer.')
    } finally {
      setWaking(false)
    }
  }, [activeWorkspaceId, computer, setComputer, waking])

  const retryTicket = useCallback(() => {
    setTicketUrl(null)
    setTicketAttempt((attempt) => attempt + 1)
  }, [])

  const refreshComputer = useCallback(() => {
    setWakeError(null)
    loadComputer()
  }, [loadComputer])

  return {
    computer,
    computerLoading,
    computerError: computerLoadError ?? wakeError,
    ticketUrl,
    ticketError,
    ticketLoading,
    wake,
    waking,
    retryTicket,
    loadComputer: refreshComputer,
  }
}
