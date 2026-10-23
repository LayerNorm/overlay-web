export class CloudAgentMachineError extends Error {
  constructor(message: string, readonly statusCode: number, readonly code: string) {
    super(message)
    this.name = 'CloudAgentMachineError'
  }
}
