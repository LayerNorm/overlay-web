'use client'

import { createContext, useContext, type AnchorHTMLAttributes, type ComponentType, type ReactNode } from 'react'
import type { PanelScope } from './types'

export interface ShellLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string
  prefetch?: boolean
}

export interface ShellAdapter {
  Link: ComponentType<ShellLinkProps>
  rememberScope: (scope: PanelScope) => void
}

function DefaultShellLink(props: ShellLinkProps) {
  const { href, prefetch, ...anchorProps } = props
  void prefetch
  return <a href={href} {...anchorProps} />
}

const defaultShellAdapter: ShellAdapter = {
  Link: DefaultShellLink,
  rememberScope: () => undefined,
}

const ShellAdapterContext = createContext<ShellAdapter>(defaultShellAdapter)

export function ShellAdapterProvider({
  value,
  children,
}: {
  value: ShellAdapter
  children: ReactNode
}) {
  return <ShellAdapterContext.Provider value={value}>{children}</ShellAdapterContext.Provider>
}

export function useShellAdapter(): ShellAdapter {
  return useContext(ShellAdapterContext)
}
