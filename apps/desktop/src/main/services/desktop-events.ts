import { BRIDGE_EVENT, type Events } from '../../../packages/overlay-desktop-bridge/src/index'
import { remoteWindows, sameOrigin } from './web-shell'
export function emitDesktopEvent<E extends keyof Events>(name: E, value: Events[E]): void {
  for (const contents of remoteWindows)
    if (!contents.isDestroyed() && sameOrigin(contents.getURL()))
      contents.send(BRIDGE_EVENT, name, value)
}
