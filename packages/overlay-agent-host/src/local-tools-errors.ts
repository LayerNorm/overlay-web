/** A tool failure reported to Overlay with a stable code and a message the model can act on. */
export class LocalToolFailure extends Error {
  constructor(readonly code: string, message: string, readonly missing: string[] = [], readonly detail?: Record<string, unknown>) {
    super(message)
    this.name = 'LocalToolFailure'
  }
}
