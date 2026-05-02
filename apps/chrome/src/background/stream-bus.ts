import type { RuntimeStreamEvent } from '@overlay/extension-contracts'

const ports = new Set<chrome.runtime.Port>()

export function registerStreamPort(port: chrome.runtime.Port) {
  ports.add(port)
  port.onDisconnect.addListener(() => {
    ports.delete(port)
  })
}

export function emitRuntimeStreamEvent(event: RuntimeStreamEvent) {
  for (const port of [...ports]) {
    try {
      port.postMessage(event)
    } catch {
      ports.delete(port)
    }
  }
}
