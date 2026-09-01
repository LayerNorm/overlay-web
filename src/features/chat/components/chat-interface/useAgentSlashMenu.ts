'use client'

import { useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { RemoteAgentCommand } from '@/features/chat/components/collaboration/room-message-view'

/**
 * Slash-command state machine for connected agents. The menu is open while the
 * composer input is a bare `/token` and the agent advertised matching commands;
 * selecting one fills `/name ` into the input (ACP unstructured semantics: the
 * agent parses the command and its trailing input from the prompt text).
 */
export function useAgentSlashMenu(
  input: string,
  onInputChange: (text: string) => void,
  advertisedCommands: RemoteAgentCommand[] | undefined,
) {
  const token = input.startsWith('/') && !/\s/.test(input)
    ? input.slice(1).toLowerCase()
    : null
  const commands = useMemo(() => {
    if (token === null) return []
    const advertised = advertisedCommands ?? []
    const matched = advertised.filter((command) => command.name.toLowerCase().startsWith(token))
    if (matched.length > 0) return matched
    return token.length === 0 ? advertised : []
  }, [advertisedCommands, token])
  const [state, setState] = useState({ index: 0, dismissedFor: null as string | null })
  const index = Math.min(state.index, Math.max(commands.length - 1, 0))
  const open = token !== null && commands.length > 0 && state.dismissedFor !== input

  const select = (command: RemoteAgentCommand) => {
    onInputChange(`/${command.name} `)
    setState({ index: 0, dismissedFor: null })
  }

  /** Returns true when the key was consumed by the menu. */
  const handleKeyDown = (event: ReactKeyboardEvent): boolean => {
    if (!open) return false
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setState((current) => ({ ...current, index: Math.min(current.index + 1, commands.length - 1) }))
      return true
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setState((current) => ({ ...current, index: Math.max(current.index - 1, 0) }))
      return true
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      const command = commands[index]
      if (command) select(command)
      return true
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setState({ index: 0, dismissedFor: input })
      return true
    }
    return false
  }

  return { open, commands, index, select, handleKeyDown }
}
