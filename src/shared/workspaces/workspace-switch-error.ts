export class WorkspaceSwitchSupersededError extends Error {
  constructor() {
    super('Workspace switch was superseded')
    this.name = 'WorkspaceSwitchSupersededError'
  }
}

export function isWorkspaceSwitchSupersededError(error: unknown): error is WorkspaceSwitchSupersededError {
  return error instanceof WorkspaceSwitchSupersededError
}
