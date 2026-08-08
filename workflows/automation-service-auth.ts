import { buildServiceAuthToken, getServiceAuthHeaderName } from '../src/server/auth/service-auth'

/**
 * Mint a narrowly scoped service credential inside the executing workflow
 * step. Tokens expire after 60 seconds and must never be serialized into a
 * scheduler input that may sleep for minutes or days.
 */
export async function freshAutomationServiceAuth(
  userId: string,
  method: string,
  path: string,
): Promise<{ header: string; token: string }> {
  "use step"

  return {
    header: getServiceAuthHeaderName(),
    token: await buildServiceAuthToken({ userId, method, path }),
  }
}
