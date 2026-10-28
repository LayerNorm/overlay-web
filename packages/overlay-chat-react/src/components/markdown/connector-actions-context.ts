import { createContext, useContext } from 'react'
import type { GeneratedUiConnectorActions } from '../GeneratedUiCard'

/** Lets markdown "Connect <app>" cards read live connection state and logos. */
export const MarkdownConnectorActionsContext = createContext<GeneratedUiConnectorActions | undefined>(undefined)

export function useMarkdownConnectorActions(): GeneratedUiConnectorActions | undefined {
  return useContext(MarkdownConnectorActionsContext)
}
