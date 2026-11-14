'use client'

import { createContext, useContext, useMemo, type ReactNode } from 'react'

export type PlatformActions = {
  copyText: (text: string) => Promise<void>
  downloadText: (filename: string, text: string) => Promise<void>
}

type PlatformActionsOverrides = Partial<PlatformActions>

async function browserCopyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text)
}

async function browserDownloadText(filename: string, text: string): Promise<void> {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
  } finally {
    URL.revokeObjectURL(url)
  }
}

const browserActions: PlatformActions = {
  copyText: browserCopyText,
  downloadText: browserDownloadText,
}

const PlatformActionsContext = createContext<PlatformActions>(browserActions)

export function PlatformActionsProvider({
  children,
  copyText,
  downloadText,
}: PlatformActionsOverrides & { children: ReactNode }) {
  const parent = useContext(PlatformActionsContext)
  const actions = useMemo(
    () => ({
      copyText: copyText ?? parent.copyText,
      downloadText: downloadText ?? parent.downloadText,
    }),
    [copyText, downloadText, parent],
  )
  return <PlatformActionsContext.Provider value={actions}>{children}</PlatformActionsContext.Provider>
}

export function usePlatformActions(): PlatformActions {
  return useContext(PlatformActionsContext)
}
