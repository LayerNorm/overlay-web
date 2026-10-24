/** Only the separate GitHub compilation lane can omit a duplicate check. Hosted builds always check types. */
export function skipDuplicateBuildTypecheck(env) {
  return env.GITHUB_ACTIONS === 'true' && env.VERCEL !== '1' && env.VERCEL_ENV === undefined
    && env.OVERLAY_SKIP_BUILD_TYPECHECK === '1'
}
