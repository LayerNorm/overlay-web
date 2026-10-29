import type { MouseEvent } from 'react'
import type { ShellAdapter, ShellLinkProps } from '@overlay/shell-react'
import {
  readDesktopShellNav,
  writeDesktopShellNav,
} from './navigation'
import { getActiveWorkspaceId } from '../services/workspace-store'

function DesktopLink({
  href,
  prefetch: _prefetch,
  onClick,
  ...props
}: ShellLinkProps): React.ReactElement<any> {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    onClick?.(event)
    if (
      event.defaultPrevented ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return
    }
    event.preventDefault()
    if (href.startsWith('/app/workspaces')) {
      window.bridge.openExternal(`https://www.getoverlay.io${href}`)
    }
  }
  return <a {...props} href={href} onClick={handleClick} />
}

export const desktopShellAdapter: ShellAdapter = {
  Link: DesktopLink,
  rememberScope(scope) {
    const workspaceId = getActiveWorkspaceId()
    const current = readDesktopShellNav(localStorage, workspaceId)
    writeDesktopShellNav(localStorage, workspaceId, { ...current, scope })
  },
}
