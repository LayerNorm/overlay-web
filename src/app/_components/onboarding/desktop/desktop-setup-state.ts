import type { Capability } from '@overlay/desktop-bridge'

/** The screens of Overlay Desktop's first-run setup, in order. */
export type DesktopSetupStep = 'who' | 'about' | 'setup' | 'models' | 'computer' | 'plan'

export const DESKTOP_ROLES = ['Founder', 'Operations', 'Sales', 'Marketing', 'Product', 'Research', 'Finance', 'Engineering', 'Recruiting'] as const

export type DesktopSetupState = {
  step: DesktopSetupStep
  forTeam: boolean
  workspaceName: string
  /** The personal workspace, or the team workspace made on the first screen. */
  workspaceId: string
  name: string
  about: string
}

/** Screens an older app can't support are left out: it lacks the bridge they call. */
export function desktopSetupSteps(capabilities: readonly Capability[]): DesktopSetupStep[] {
  return [
    'who', 'about',
    ...(capabilities.includes('localSetup') ? ['setup' as const] : []),
    ...(capabilities.includes('localThreads') ? ['models' as const] : []),
    ...(capabilities.includes('localComputer') && capabilities.includes('agentHost') ? ['computer' as const] : []),
    'plan',
  ]
}

const storageKey = (userId: string) => `overlay.desktopSetup.${userId}`

/** Progress is kept on this computer, so quitting resumes on the same screen. */
export function readDesktopSetup(userId: string, userName: string, personalWorkspaceId: string): DesktopSetupState {
  const fresh: DesktopSetupState = { step: 'who', forTeam: false, workspaceName: '', workspaceId: personalWorkspaceId, name: userName, about: '' }
  try {
    const saved = JSON.parse(window.localStorage.getItem(storageKey(userId)) ?? 'null') as Partial<DesktopSetupState> | null
    if (!saved || typeof saved !== 'object') return fresh
    return {
      step: typeof saved.step === 'string' ? saved.step as DesktopSetupStep : fresh.step,
      forTeam: saved.forTeam === true,
      workspaceName: typeof saved.workspaceName === 'string' ? saved.workspaceName : '',
      workspaceId: typeof saved.workspaceId === 'string' && saved.workspaceId ? saved.workspaceId : personalWorkspaceId,
      name: typeof saved.name === 'string' ? saved.name : userName,
      about: typeof saved.about === 'string' ? saved.about : '',
    }
  } catch {
    return fresh
  }
}

export function writeDesktopSetup(userId: string, state: DesktopSetupState | null): void {
  try {
    if (state) window.localStorage.setItem(storageKey(userId), JSON.stringify(state))
    else window.localStorage.removeItem(storageKey(userId))
  } catch {
    // Blocked storage only loses resuming; setup still works.
  }
}
