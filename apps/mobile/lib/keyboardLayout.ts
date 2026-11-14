export type KeyboardVisibilityAction = 'show' | 'hide'

export function keyboardVisibilityReducer(
  _visible: boolean,
  action: KeyboardVisibilityAction,
): boolean {
  return action === 'show'
}

export function getComposerBottomInset(
  keyboardVisible: boolean,
  safeAreaInset: number,
  closedMinimum: number,
  openInset: number,
  closedExtraInset = 0,
): number {
  return keyboardVisible ? openInset : Math.max(safeAreaInset, closedMinimum) + closedExtraInset
}
