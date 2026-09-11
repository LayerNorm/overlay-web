function getArg(name: string): string | null {
  const exact = `--${name}`
  const prefix = `--${name}=`
  const index = process.argv.findIndex((arg) => arg === exact || arg.startsWith(prefix))
  if (index === -1) return null
  const value = process.argv[index]!
  if (value === exact) {
    return process.argv[index + 1] ?? null
  }
  return value.slice(prefix.length)
}

async function main() {
  const convexUrl = process.env.DEV_NEXT_PUBLIC_CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL
  const serverSecret = process.env.INTERNAL_API_SECRET
  const accessToken = getArg('access-token') || process.env.ACCESS_TOKEN || null
  const userId = getArg('user-id') || process.env.USER_ID || null

  if (!convexUrl) throw new Error('Missing DEV_NEXT_PUBLIC_CONVEX_URL or NEXT_PUBLIC_CONVEX_URL')
  if (!serverSecret) throw new Error('Missing INTERNAL_API_SECRET')
  if (!accessToken) throw new Error('Missing access token. Pass --access-token or ACCESS_TOKEN')

  const response = await fetch(`${convexUrl}/api/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      path: 'authDebug:inspectAccessToken',
      format: 'json',
      args: {
        serverSecret,
        accessToken,
        userId: userId || undefined,
      },
    }),
  })

  const text = await response.text()
  console.log(text)

  if (!response.ok) {
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
