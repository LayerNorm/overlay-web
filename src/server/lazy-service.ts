import 'server-only'

/** A handle to a service built with the server context, resolved on each use so importing a module never boots it. */
export function lazyService<T extends object>(resolve: () => T): T {
  return new Proxy({}, {
    get(_target, property) {
      const service = resolve()
      const value = service[property as keyof T]
      return typeof value === 'function' ? value.bind(service) : value
    },
  }) as T
}
