export class OverlayFreeRouteBusyError extends Error {
  constructor() {
    super('overlay_free_route_busy')
    this.name = 'OverlayFreeRouteBusyError'
  }
}

export class OverlayFreeRouteUnavailableError extends Error {
  constructor() {
    super('overlay_free_no_eligible_route')
    this.name = 'OverlayFreeRouteUnavailableError'
  }
}

export class OverlayFreeRouteInterruptedError extends Error {
  constructor() {
    super('overlay_free_route_interrupted')
    this.name = 'OverlayFreeRouteInterruptedError'
  }
}
