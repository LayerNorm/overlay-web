'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Computer } from '@overlay/workspace-contracts'
import { overlayAppClient } from '@/shared/app/overlay-app-client'
import { useAuth } from '@/contexts/AuthContext'
import { toast } from '@overlay/ui/primitives'
import { changeAgentComputerControl } from '../lib/agent-computer-control'

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
  const { user } = useAuth()
  const [storedComputer, setComputer] = useState<Computer | null>(null)
  const computer = enabled && storedComputer?.workspaceId === activeWorkspaceId
    && storedComputer.ownerType === 'agent' && storedComputer.ownerId === agentId ? storedComputer : null
  const [controlBusy, setControlBusy] = useState(false)
  const controlPending = useRef(false)
  const computerRequestId = useRef(0)
  const [computerLoading, setComputerLoading] = useState(true)
  const [computerError, setComputerError] = useState<string | null>(null)
  const [ticketUrl, setTicketUrl] = useState<string | null>(null)
  const [ticketError, setTicketError] = useState<string | null>(null)
  const [ticketLoading, setTicketLoading] = useState(false)
  const [ticketAttempt, setTicketAttempt] = useState(0)
  const [waking, setWaking] = useState(false)
  const requestId = useRef(0)

  const loadComputer = useCallback(async (showLoading = true) => {
    if (!activeWorkspaceId || !enabled) {
      setComputerLoading(false)
      return
    }
    if (controlPending.current) return
    const currentRequest = ++computerRequestId.current
    if (showLoading) setComputerLoading(true)
    try {
      const result = await overlayAppClient.computers.list(activeWorkspaceId)
      if (currentRequest !== computerRequestId.current) return
      setComputer(result.computers.find((item) => item.ownerType === 'agent' && item.ownerId === agentId) ?? null)
      setComputerError(null)
    } catch {
      if (currentRequest === computerRequestId.current) setComputerError('Could not load the computer.')
    } finally {
      if (currentRequest === computerRequestId.current) setComputerLoading(false)
    }
  }, [activeWorkspaceId, agentId, enabled])

  useEffect(() => {
    if (!enabled || !activeWorkspaceId) {
      ++computerRequestId.current
      setComputer(null)
      setComputerError(null)
      setComputerLoading(false)
      return
    }
    if (!controlBusy) void loadComputer(false)
    return () => { ++computerRequestId.current }
  }, [activeWorkspaceId, controlBusy, enabled, loadComputer])

  const shouldPoll = Boolean(enabled && activeWorkspaceId && computer
    && (visible || computer.status === 'provisioning' || (computer.status as string) === 'starting'))
  useEffect(() => {
    if (!shouldPoll || !activeWorkspaceId) return
    const timer = window.setInterval(() => { void loadComputer(false) }, 5_000)
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

  const changeControl = useCallback(async (action: 'take' | 'release') => {
    if (!computer || !user?.id || controlPending.current) return false
    controlPending.current = true
    ++computerRequestId.current
    setComputerLoading(false)
    setControlBusy(true)
    try {
      const updated = await changeAgentComputerControl({
        computer, userId: user.id, action,
        request: (workspaceId, computerId, nextAction) => overlayAppClient.computers.control(workspaceId, computerId, nextAction),
      })
      setComputer(updated)
      setComputerError(null)
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not change computer control.')
      return false
    } finally {
      controlPending.current = false
      setControlBusy(false)
    }
  }, [computer, user?.id])

  return {
    computer,
    currentUserId: user?.id,
    controlBusy,
    changeControl,
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
