const SAFE_ENVIRONMENT_KEYS = [
  'HOME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'PATH',
  'TMPDIR',
  'XDG_CACHE_HOME',
  '__CF_USER_TEXT_ENCODING'
] as const

export function createLocalHelperEnvironment(
  source: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {}
  for (const key of SAFE_ENVIRONMENT_KEYS) {
    const value = source[key]
    if (typeof value === 'string' && value.length > 0) {
      environment[key] = value
    }
  }
  return environment
}
