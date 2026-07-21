import { notFound } from 'next/navigation'
import { FileParityHarness } from '@/features/files/dev/FileParityHarness'
import { SharedKnowledgeSurfaceHarness } from '@/features/files/dev/SharedKnowledgeSurfaceHarness'
import type { FileParityFixtureScenario } from '@overlay/modules-react/file-parity-fixture'

type FixtureSearchParams = Record<string, string | string[] | undefined>
const SCENARIOS = new Set<FileParityFixtureScenario>(['gallery', 'states', 'inventory', 'viewers', 'notebook', 'sync', 'surface'])

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export default async function FileParityFixturePage({ searchParams }: { searchParams: Promise<FixtureSearchParams> }) {
  if (process.env.NODE_ENV === 'production' && process.env.FILE_PARITY_FIXTURES !== '1') notFound()
  const params = await searchParams
  const theme = first(params.theme) === 'dark' ? 'dark' : 'light'
  const requestedWidth = Number(first(params.width))
  const width = [1024, 1280, 1440].includes(requestedWidth) ? requestedWidth : 1280
  const requestedScenario = first(params.scenario) as FileParityFixtureScenario | undefined
  if (first(params.scenario) === 'surface') {
    return <SharedKnowledgeSurfaceHarness theme={theme} width={width} />
  }
  const scenario = requestedScenario && SCENARIOS.has(requestedScenario) ? requestedScenario : 'gallery'
  return <FileParityHarness theme={theme} scenario={scenario} width={width} />
}
