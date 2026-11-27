export type ShellPanel = 'agents' | 'chat'

export function shellPanelForPathname(pathname: string): ShellPanel | null {
  const section = pathname.split('/').filter(Boolean)[0]
  if (section === 'chat' || section === 'channel' || section === 'thread') return 'chat'
  if (section === 'agents' || section === 'agent' || section === 'dm') return 'agents'
  return null
}

export function transitionShellPanelSelection(
  selection: { pathname: string; panel: ShellPanel },
  pathname: string,
): { pathname: string; panel: ShellPanel } {
  if (selection.pathname === pathname) return selection
  return { pathname, panel: shellPanelForPathname(pathname) ?? selection.panel }
}

export function showShellExtensions(
  registry: ReadonlyArray<{ id: string; enabled: boolean }> | null | undefined,
  permitted: boolean,
): boolean {
  return permitted && registry?.some((flag) => flag.id === 'extensions' && flag.enabled) === true
}
