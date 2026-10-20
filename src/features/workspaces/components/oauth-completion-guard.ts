export function createOAuthCompletionGuard() {
  let consumed = false
  return () => {
    if (consumed) return false
    consumed = true
    return true
  }
}
