import { notFound } from 'next/navigation'
import { ChatParityHarness } from '@/features/chat/dev/ChatParityHarness'

type FixtureSearchParams = Record<string, string | string[] | undefined>

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export default async function ChatParityFixturePage({
  searchParams,
}: {
  searchParams: Promise<FixtureSearchParams>
}) {
  if (process.env.NODE_ENV === 'production' && process.env.CHAT_PARITY_FIXTURES !== '1') {
    notFound()
  }

  const params = await searchParams
  const requestedTheme = first(params.theme)
  const requestedWidth = Number(first(params.width))
  const theme = requestedTheme === 'dark' ? 'dark' : 'light'
  const width = requestedWidth === 390 || requestedWidth === 640 ? requestedWidth : 896
  const scenario = first(params.scenario)?.trim() || 'gallery'
  const perf = first(params.perf) === '1'

  return <ChatParityHarness theme={theme} scenario={scenario} width={width} perf={perf} />
}
