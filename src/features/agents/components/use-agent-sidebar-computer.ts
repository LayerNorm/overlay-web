'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Computer } from '@overlay/workspace-contracts'
import { overlayAppClient } from '@/shared/app/overlay-app-client'

export function useAgentSidebarComputer({
  activeWorkspaceId,
  agentId,
  enabled,
  visible,
}: {
  activeWorkspaceId: string | null
  agentId: string
  enabled: boolean
  visible: boolean
}) {
  const [computer, setComputer] = useState<Computer | null>(null)
  const [computerLoading, setComputerLoading] = useState(true)
  const [computerError, setComputerError] = useState<string | null>(null)
  const [ticketUrl, setTicketUrl] = useState<string | null>(null)
  const [ticketError, setTicketError] = useState<string | null>(null)
  const [ticketLoading, setTicketLoading] = useState(false)
  const [ticketAttempt, setTicketAttempt] = useState(0)
  const [waking, setWaking] = useState(false)
  const requestId = useRef(0)

  const loadComputer = useCallback(async () => {
    if (!activeWorkspaceId || !enabled) {
      setComputerLoading(false)
      return
    }
    setComputerLoading(true)
    try {
      const result = await overlayAppClient.computers.list(activeWorkspaceId)
      setComputer(result.computers.find((item) => item.ownerType === 'agent' && item.ownerId === agentId) ?? null)
      setComputerError(null)
    } catch {
      setComputerError('Could not load the computer.')
    } finally {
      setComputerLoading(false)
    }
  }, [activeWorkspaceId, agentId, enabled])

  useEffect(() => {
    if (!enabled || !activeWorkspaceId) {
      setComputer(null)
      setComputerError(null)
      setComputerLoading(false)
      return
    }
    void loadComputer()
  }, [activeWorkspaceId, enabled, loadComputer])

  const shouldPoll = Boolean(enabled && activeWorkspaceId && computer
    && (computer.status === 'provisioning' || (computer.status as string) === 'starting'))
  useEffect(() => {
    if (!shouldPoll || !activeWorkspaceId) return
    const timer = window.setInterval(() => { void loadComputer() }, 10_000)
    return () => window.clearInterval(timer)
  }, [activeWorkspaceId, loadComputer, shouldPoll])

  useEffect(() => {
    if (!visible || !enabled || !activeWorkspaceId || computer?.status !== 'ready') {
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
  }, [activeWorkspaceId, computer?.id, computer?.status, enabled, ticketAttempt, visible])

  const wake = useCallback(async () => {
    if (!activeWorkspaceId || !computer || waking) return
    setWaking(true)
    try {
      const result = await overlayAppClient.computers.start(activeWorkspaceId, computer.id)
      setComputer(result.computer)
      setComputerError(null)
    } catch {
      setComputerError('Could not wake the computer.')
    } finally {
      setWaking(false)
    }
  }, [activeWorkspaceId, computer, waking])

  const retryTicket = useCallback(() => {
    setTicketUrl(null)
    setTicketAttempt((attempt) => attempt + 1)
  }, [])

  return {
    computer,
    computerLoading,
    computerError,
    ticketUrl,
    ticketError,
    ticketLoading,
    wake,
    waking,
    retryTicket,
    loadComputer,
  }
}
