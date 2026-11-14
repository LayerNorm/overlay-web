let destination: string | null = null

/** Fence asynchronous redirects before the router commits a newer user selection. */
export function beginNavigationIntent(href: string) {
  destination = href
}

export function captureNavigationIntent(currentHref?: string): () => boolean {
  const captured = destination
  return () => destination === captured || destination === currentHref
}
