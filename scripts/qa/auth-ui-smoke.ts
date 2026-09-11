import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { chromium } from 'playwright'

const baseUrl = (process.env.AUTH_SMOKE_URL ?? 'http://localhost:3000').replace(/\/+$/, '')
const expectedLabel = process.env.AUTH_SMOKE_PROVIDER_LABEL ?? 'Continue with Google'

async function main() {
  const configuredExecutable = process.env.PLAYWRIGHT_EXECUTABLE_PATH
  const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  const executablePath = configuredExecutable
    || (existsSync(systemChrome) ? systemChrome : undefined)
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  })
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    await page.goto(`${baseUrl}/auth/sign-in?redirect=${encodeURIComponent('/app/chat')}`, {
      waitUntil: 'networkidle',
    })

    const button = page.getByRole('button', { name: expectedLabel, exact: true })
    await button.waitFor({ state: 'visible' })
    assert.equal(await button.count(), 1)
    assert.equal(await button.evaluate((element) => getComputedStyle(element).whiteSpace), 'nowrap')
    assert.equal(await button.evaluate((element) => element.scrollWidth <= element.clientWidth), true)

    console.log(JSON.stringify({
      ok: true,
      baseUrl,
      expectedLabel,
      viewport: { width: 390, height: 844 },
    }, null, 2))
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
