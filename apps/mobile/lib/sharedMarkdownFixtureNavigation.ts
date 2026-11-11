type ActiveNavigatorState = {
  index: number
  routes: ReadonlyArray<{ name: string }>
}

export function isActiveSharedMarkdownFixtureRoute(
  state: ActiveNavigatorState | null | undefined,
): boolean {
  return state?.routes?.[state.index]?.name === 'dev/shared-markdown'
}
