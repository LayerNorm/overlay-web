/** The mode (Workspace or Personal) things are created in, for services outside React. ModeProvider keeps it current. */
let currentMode: 'personal' | 'workspace' = 'workspace'

export function setCurrentMode(mode: 'personal' | 'workspace'): void {
  currentMode = mode
}

export function getCurrentMode(): 'personal' | 'workspace' {
  return currentMode
}
