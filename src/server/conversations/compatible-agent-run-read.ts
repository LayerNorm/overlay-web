/** Web-first releases can briefly reach the previous strict Convex argument validator. */
export async function readCompatibleAgentRun<T extends {externalRunId?: string}>(
  remoteRunId: string | undefined, read: (remoteRunId?: string) => Promise<T | null>,
): Promise<T | null> {
  try { return await read(remoteRunId) }
  catch (error) {
    if (!remoteRunId || !(error instanceof Error)
      || !/ArgumentValidationError:[\s\S]*Object contains extra field [`'"]remoteRunId[`'"]/.test(error.message)) throw error
    const legacy = await read()
    return legacy?.externalRunId === remoteRunId ? legacy : null
  }
}
