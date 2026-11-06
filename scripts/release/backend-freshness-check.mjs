#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { checkBackendFreshness } from './backend-freshness.mjs'
import { apiClient, CONFIG } from './preview-control.mjs'

const REPOSITORY_PATH = `/repos/${CONFIG.repository}`
const BACKEND_CONTEXT = 'Backend Freshness'
const PREVIEW_CONTEXT = 'PR Preview'
const SHA_PATTERN = /^[a-f0-9]{40}$/i
const STATE_DESCRIPTIONS = {
  current: 'Backend-affecting main changes are synchronized.',
  stale: 'Main has backend changes; sync main and retest before merging.',
  unknown: 'Backend freshness could not be verified; retry or inspect this check.',
}
const PREVIEW_FAILURE_DESCRIPTION = 'Backend freshness failed; sync main and retest Preview.'
const RACE_DESCRIPTION = 'PR changed during freshness check; rerun on the current head.'
const UNKNOWN = (reason, mainSha = null) => ({ state: 'unknown', reason, mainSha, description: STATE_DESCRIPTIONS.unknown })

const normalizedSha = value => typeof value === 'string' && SHA_PATTERN.test(value) ? value.toLowerCase() : null
const isInternalPull = pr => pr.head?.repo?.full_name === CONFIG.repository
  && Number(pr.head?.repo?.id) === CONFIG.repositoryId
const isMainPull = pr => pr?.state === 'open'
  && pr.base?.ref === 'main'
  && pr.base?.repo?.full_name === CONFIG.repository
  && Number(pr.base?.repo?.id) === CONFIG.repositoryId
  && Number.isSafeInteger(pr.number) && pr.number > 0
  && normalizedSha(pr.head?.sha) !== null

async function publishStatus(api, repoPath, sha, state, context, description) {
  await api(`${repoPath}/statuses/${sha}`, {
    method: 'POST',
    body: { state, context, description },
  })
}

async function currentPull(api, repoPath, number) {
  return api(`${repoPath}/pulls/${number}`)
}

async function listOpenMainPulls(api, repoPath, errors) {
  const pulls = []
  for (let page = 1; ; page++) {
    let response
    try {
      response = await api(`${repoPath}/pulls`, {
        query: { state: 'open', base: 'main', per_page: 100, page },
      })
    } catch {
      errors.push(`Could not list open main PRs (page ${page}).`)
      break
    }
    if (!Array.isArray(response)) {
      errors.push(`Open main PR list was invalid (page ${page}).`)
      break
    }
    pulls.push(...response.filter(isMainPull))
    if (response.length < 100) break
  }
  return pulls
}

async function assessRevision(api, repoPath, headSha) {
  let result
  try {
    result = await checkBackendFreshness({ api, repoPath, headSha })
  } catch {
    result = UNKNOWN('comparison-error')
  }
  if (!result || !['current', 'stale', 'unknown'].includes(result.state)) {
    result = UNKNOWN('invalid-assessment')
  }
  if (result.state !== 'current') return result

  try {
    const liveMainSha = normalizedSha((await api(`${repoPath}/commits/main`))?.sha)
    if (!liveMainSha) return UNKNOWN('invalid-main-sha', result.mainSha)
    if (liveMainSha !== normalizedSha(result.mainSha)) return UNKNOWN('main-moved-after-assessment', liveMainSha)
  } catch {
    return UNKNOWN('main-api-error', result.mainSha)
  }
  return result
}

async function finishPull(api, repoPath, pr, result, errors) {
  const headSha = normalizedSha(pr.head.sha)
  if (!headSha) {
    errors.push(`PR #${pr.number} has an invalid head SHA.`)
    return
  }

  let latest
  try {
    latest = await currentPull(api, repoPath, pr.number)
  } catch (error) {
    if (error?.status === 404) return
    result = UNKNOWN('pull-read-error', result.mainSha)
    latest = null
  }
  if (latest && !isMainPull(latest)) return
  if (latest && normalizedSha(latest.head.sha) !== headSha) {
    try {
      await publishStatus(api, repoPath, headSha, 'error', BACKEND_CONTEXT, RACE_DESCRIPTION)
    } catch {
      errors.push(`Could not finish the superseded status for PR #${pr.number}.`)
    }
    errors.push(`PR #${pr.number} changed during its freshness check.`)
    return
  }

  if (result.state !== 'current' && isInternalPull(pr)) {
    try {
      await publishStatus(api, repoPath, headSha, 'failure', PREVIEW_CONTEXT, PREVIEW_FAILURE_DESCRIPTION)
    } catch {
      errors.push(`Could not invalidate the Preview status for PR #${pr.number}.`)
    }
  }

  const state = result.state === 'current' ? 'success' : result.state === 'stale' ? 'failure' : 'error'
  try {
    await publishStatus(api, repoPath, headSha, state, BACKEND_CONTEXT, result.description ?? STATE_DESCRIPTIONS[result.state])
  } catch {
    errors.push(`Could not publish Backend Freshness for PR #${pr.number}.`)
  }
  if (result.state !== 'current') errors.push(`PR #${pr.number} backend freshness is ${result.state}.`)
}

async function assessPull(api, repoPath, pr, errors) {
  if (!isMainPull(pr)) return
  const headSha = normalizedSha(pr.head.sha)
  try {
    await publishStatus(api, repoPath, headSha, 'pending', BACKEND_CONTEXT, 'Checking backend freshness against main.')
  } catch {
    errors.push(`Could not publish pending Backend Freshness for PR #${pr.number}.`)
  }

  const result = await assessRevision(api, repoPath, headSha)
  await finishPull(api, repoPath, pr, result, errors)
}

async function assessMergeGroup(api, repoPath, headSha, errors, pendingPublished = false) {
  if (!pendingPublished) {
    try {
      await publishStatus(api, repoPath, headSha, 'pending', BACKEND_CONTEXT, 'Checking merge-group backend freshness.')
    } catch {
      errors.push('Could not publish pending Backend Freshness for the merge group.')
    }
  }
  const result = await assessRevision(api, repoPath, headSha)
  const state = result.state === 'current' ? 'success' : result.state === 'stale' ? 'failure' : 'error'
  try {
    await publishStatus(api, repoPath, headSha, state, BACKEND_CONTEXT, result.description ?? STATE_DESCRIPTIONS[result.state])
  } catch {
    errors.push('Could not publish Backend Freshness for the merge group.')
  }
  if (result.state !== 'current') errors.push(`Merge-group backend freshness is ${result.state}.`)
}

function validateRun({ eventName, payload, repository, ref }) {
  if (repository !== CONFIG.repository || payload?.repository?.full_name !== CONFIG.repository) {
    throw new Error('Unexpected workflow repository')
  }
  if (eventName === 'pull_request_target') {
    if (!Number.isSafeInteger(payload?.pull_request?.number) || payload.pull_request.number <= 0) {
      throw new Error('Invalid pull request event')
    }
    return { pullNumber: payload.pull_request.number }
  }
  if (eventName === 'merge_group') {
    const mergeGroup = payload.merge_group
    const headSha = normalizedSha(mergeGroup?.head_sha)
    if (mergeGroup?.base_ref !== 'refs/heads/main' || !headSha) {
      throw new Error('Invalid main merge-group event')
    }
    return { mergeHeadSha: headSha }
  }
  if (!['push', 'schedule', 'workflow_dispatch'].includes(eventName)) {
    throw new Error('Unsupported backend freshness event')
  }
  if (ref !== 'refs/heads/main') throw new Error('Backend freshness sweep must run from main')
  return {}
}

export async function runBackendFreshness({ api, eventName, payload, repository, ref, report = () => {} }) {
  if (typeof api !== 'function') throw new Error('A GitHub API client is required')
  const event = validateRun({ eventName, payload, repository, ref })
  const errors = []
  const pulls = new Map()
  let assessed = 0

  if (event.mergeHeadSha) {
    try {
      await publishStatus(api, REPOSITORY_PATH, event.mergeHeadSha, 'pending', BACKEND_CONTEXT,
        'Checking merge-group backend freshness.')
    } catch {
      errors.push('Could not publish pending Backend Freshness for the merge group.')
    }
  }

  if (event.pullNumber) {
    try {
      const pr = await currentPull(api, REPOSITORY_PATH, event.pullNumber)
      if (isMainPull(pr)) pulls.set(pr.number, pr)
    } catch (error) {
      if (error?.status !== 404) errors.push(`Could not read current PR #${event.pullNumber}.`)
    }
  }

  const listErrorCount = errors.length
  const openPulls = await listOpenMainPulls(api, REPOSITORY_PATH, errors)
  for (const pr of openPulls) pulls.set(pr.number, pr)
  if (event.pullNumber && errors.length === listErrorCount
    && !openPulls.some(pr => pr.number === event.pullNumber)) {
    pulls.delete(event.pullNumber)
  }

  for (const pr of pulls.values()) {
    assessed++
    try {
      await assessPull(api, REPOSITORY_PATH, pr, errors)
    } catch {
      errors.push(`Unexpected freshness-check failure for PR #${pr.number}.`)
      const headSha = normalizedSha(pr.head?.sha)
      if (headSha) {
        try {
          await publishStatus(api, REPOSITORY_PATH, headSha, 'error', BACKEND_CONTEXT, STATE_DESCRIPTIONS.unknown)
        } catch {
          errors.push(`Could not publish an error status for PR #${pr.number}.`)
        }
      }
    }
  }

  if (event.mergeHeadSha) {
    assessed++
    try {
      await assessMergeGroup(api, REPOSITORY_PATH, event.mergeHeadSha, errors, true)
    } catch {
      errors.push('Unexpected merge-group freshness-check failure.')
      try {
        await publishStatus(api, REPOSITORY_PATH, event.mergeHeadSha, 'error', BACKEND_CONTEXT, STATE_DESCRIPTIONS.unknown)
      } catch {
        errors.push('Could not publish an error status for the merge group.')
      }
    }
  }

  const summary = { assessed, errors }
  report(`Backend Freshness assessed ${assessed} revision(s); ${errors.length} issue(s).`)
  return summary
}

export async function main(env = process.env, fetchImpl = fetch) {
  if (env.GITHUB_REPOSITORY !== CONFIG.repository) throw new Error('Unexpected workflow repository')
  let payload
  try {
    payload = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'))
  } catch {
    throw new Error('Could not read workflow event')
  }
  const api = apiClient({
    token: env.GITHUB_TOKEN,
    service: 'GitHub',
    base: 'https://api.github.com',
    fetchImpl,
  })
  const result = await runBackendFreshness({
    api,
    eventName: env.GITHUB_EVENT_NAME,
    payload,
    repository: env.GITHUB_REPOSITORY,
    ref: env.GITHUB_REF,
    report: console.log,
  })
  if (result.errors.length) {
    for (const error of result.errors) console.error(error)
    process.exitCode = 1
  }
  return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
