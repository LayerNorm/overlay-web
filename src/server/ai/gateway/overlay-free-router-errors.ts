export class OverlayFreeRouteBusyError extends Error {
  constructor() {
    super('overlay_free_route_busy')
    this.name = 'OverlayFreeRouteBusyError'
  }
}
