export class OverlayFreeRouteBusyError extends Error {
  constructor() {
    super('overlay_free_route_busy')
    this.name = 'OverlayFreeRouteBusyError'
  }
}

export class OverlayFreeRouteInterruptedError extends Error {
  constructor() {
    super('overlay_free_route_interrupted')
    this.name = 'OverlayFreeRouteInterruptedError'
  }
}
