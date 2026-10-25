export function messageActionVisibilityClass(open = false): string {
  return `transition-opacity ${open ? 'opacity-100' : 'opacity-0'} group-hover/exchange:opacity-100 focus-within:opacity-100`
}
