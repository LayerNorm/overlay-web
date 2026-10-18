/** Internal control flow: an unfinished call is never a tool error/result. */
export class McpDeferredCall extends Error {
  constructor(readonly reason: 'approval' | 'executing') {
    super(`MCP call is waiting for ${reason}`)
    this.name = 'McpDeferredCall'
  }
}
