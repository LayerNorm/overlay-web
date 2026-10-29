import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  SidebarAccountMenu,
  ShellAdapterProvider,
  WorkspaceSwitcherView,
  type ShellWorkspace,
} from '@overlay/shell-react'
import { desktopShellAdapter } from './DesktopShellAdapter'

describe('desktop sidebar account menu', () => {
  it('contains account, settings, and sign out actions', () => {
    const html = renderToStaticMarkup(
      <SidebarAccountMenu
        onAccountClick={vi.fn()}
        onSettingsClick={vi.fn()}
        onSignOut={vi.fn()}
      />
    )

    expect(html).toContain('Account')
    expect(html).toContain('Settings')
    expect(html).toContain('Sign out')
  })

  it('shows available workspaces and marks the current workspace', () => {
    const workspaces: ShellWorkspace[] = [
      { id: 'personal', name: 'Personal', memberLabel: 'Personal' },
      { id: 'studio', name: 'Studio', memberLabel: 'Organization' },
    ]
    const html = renderToStaticMarkup(
      <ShellAdapterProvider value={desktopShellAdapter}>
        <WorkspaceSwitcherView
          rootRef={createRef<HTMLDivElement>()}
          menuRef={createRef<HTMLDivElement>()}
          open
          compact={false}
          placement="footer"
          accountMenu={
            <SidebarAccountMenu
              onAccountClick={vi.fn()}
              onSettingsClick={vi.fn()}
              onSignOut={vi.fn()}
            />
          }
          renderAvatar={(workspace) => <span>{workspace.name.slice(0, 1)}</span>}
          status="ready"
          workspaces={workspaces}
          activeWorkspace={workspaces[1] ?? null}
          activeWorkspaceId="studio"
          switchingWorkspaceId={null}
          error={null}
          actionError={null}
          refresh={vi.fn()}
          onSelectWorkspace={vi.fn()}
          onCreateRequest={vi.fn()}
          onOpenChange={vi.fn()}
        />
      </ShellAdapterProvider>
    )

    expect(html).toContain('Studio')
  })
})
