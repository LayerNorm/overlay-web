const SHA_PATTERN = /^[a-f0-9]{40}$/i
const BACKEND_PREFIXES = [
  'convex/',
  'src/server/',
  'src/shared/',
  'src/app/api/',
  'packages/',
  'config/',
  'scripts/convex/',
  'scripts/release/',
]
const BACKEND_ROOT_FILES = new Set([
  'package.json',
  'package-lock.json',
  'convex.json',
  'vercel.json',
  'bun.lock',
  'bun.lockb',
  '.github/workflows/pr-preview.yml',
])
const DESCRIPTIONS = {
  current: 'Backend-affecting changes in main are synchronized.',
  stale: 'Main has backend changes; sync main and retest before merging.',
  unknown: 'Backend freshness could not be verified; retry or inspect this check.',
}
const UNKNOWN = (reason, mainSha = null) => ({ state: 'unknown', reason, mainSha, description: DESCRIPTIONS.unknown })

const normalizedSha = value => typeof value === 'string' && SHA_PATTERN.test(value) ? value.toLowerCase() : null
const sameSha = (left, right) => normalizedSha(left) !== null && normalizedSha(left) === normalizedSha(right)

function validRepoPath(repoPath) {
  return typeof repoPath === 'string' && /^\/repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repoPath)
}

function backendPath(path) {
  return BACKEND_ROOT_FILES.has(path)
    || /^tsconfig[^/]*\.json$/.test(path)
    || BACKEND_PREFIXES.some(prefix => path.startsWith(prefix))
}

function validFilePath(path) {
  return typeof path === 'string' && path.length > 0 && !path.startsWith('/') && !path.includes('\\')
    && path.split('/').every(part => part && part !== '.' && part !== '..')
}

function classify(compare, headSha, mainSha) {
  if (!compare || typeof compare !== 'object'
    || !sameSha(compare.base_commit?.sha, headSha)
    || !normalizedSha(compare.merge_base_commit?.sha)) {
    return UNKNOWN('invalid-compare', mainSha)
  }

  if (sameSha(compare.merge_base_commit.sha, mainSha)) {
    return { state: 'current', reason: 'main-included', mainSha, description: DESCRIPTIONS.current }
  }

  if (!Array.isArray(compare.files)) return UNKNOWN('invalid-file-metadata', mainSha)
  if (compare.files.length >= 300) return UNKNOWN('file-cap', mainSha)

  for (const file of compare.files) {
    if (!file || typeof file !== 'object' || !validFilePath(file.filename)
      || ('previous_filename' in file
        && !validFilePath(file.previous_filename))) {
      return UNKNOWN('invalid-file-metadata', mainSha)
    }
  }

  const backendChanged = compare.files.some(file => backendPath(file.filename)
    || (file.previous_filename !== undefined && backendPath(file.previous_filename)))
  return backendChanged
    ? { state: 'stale', reason: 'main-backend-changes', mainSha, description: DESCRIPTIONS.stale }
    : { state: 'current', reason: 'main-ui-only-changes', mainSha, description: DESCRIPTIONS.current }
}

export async function checkBackendFreshness({ api, repoPath, headSha, maxAttempts = 3 }) {
  const normalizedHeadSha = normalizedSha(headSha)
  if (!normalizedHeadSha) return UNKNOWN('invalid-head-sha')
  if (!validRepoPath(repoPath) || typeof api !== 'function') return UNKNOWN('invalid-api-or-repository')

  const attempts = Number.isSafeInteger(maxAttempts) ? Math.max(1, Math.min(maxAttempts, 3)) : 3
  for (let attempt = 0; attempt < attempts; attempt++) {
    let mainSha
    try {
      mainSha = normalizedSha((await api(`${repoPath}/commits/main`))?.sha)
    } catch {
      return UNKNOWN('main-api-error')
    }
    if (!mainSha) return UNKNOWN('invalid-main-sha')

    let comparison
    let comparisonFailed = false
    try {
      comparison = await api(`${repoPath}/compare/${normalizedHeadSha}...${mainSha}`, {
        query: { per_page: 1, page: 1 },
      })
    } catch {
      comparisonFailed = true
    }

    let latestMainSha
    try {
      latestMainSha = normalizedSha((await api(`${repoPath}/commits/main`))?.sha)
    } catch {
      return UNKNOWN('main-api-error', mainSha)
    }
    if (!latestMainSha) return UNKNOWN('invalid-main-sha', mainSha)
    if (latestMainSha !== mainSha) {
      if (attempt + 1 < attempts) continue
      return UNKNOWN('main-moving', latestMainSha)
    }
    if (comparisonFailed) return UNKNOWN('compare-api-error', mainSha)
    return classify(comparison, normalizedHeadSha, mainSha)
  }
  return UNKNOWN('main-moving')
}
