import 'server-only'

export class UnsupportedAppDataRepositoryError extends Error {
  constructor(readonly repositoryName: string) {
    super(`${repositoryName} is not implemented for the selected app-data provider`)
    this.name = 'UnsupportedAppDataRepositoryError'
  }
}

export function unsupportedRepository<T extends object>(repositoryName: string): T {
  return new Proxy({}, {
    get(_target, property) {
      if (property === 'then') return undefined
      return () => {
        throw new UnsupportedAppDataRepositoryError(repositoryName)
      }
    },
  }) as T
}

export function repositoryProxy<T extends object>(selectRepository: () => T): T {
  return new Proxy({}, {
    get(_target, property: string | symbol) {
      const repository = selectRepository()
      const value = repository[property as keyof T]
      return typeof value === 'function' ? value.bind(repository) : value
    },
  }) as T
}
