import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = process.cwd()

test('every action the agent-asks route accepts is allowed by its API boundary schema', async () => {
  const [route, boundary] = await Promise.all([
    readFile(`${root}/src/server/app-api/v1/agent-asks/route.ts`, 'utf8'),
    readFile(`${root}/src/shared/schemas/api-boundary.ts`, 'utf8'),
  ])
  const actions = [...route.matchAll(/action: z\.literal\('([a-z_]+)'\)/g)].map((match) => match[1]!)
  assert.ok(actions.length >= 4, `found ${actions.join(', ')}`)
  const enumLine = boundary.split('\n').find((line) => line.includes("path: '/api/v1/agent-asks'") === false && line.includes("action: z.enum([") && line.includes("'ask'"))
  assert.ok(enumLine, 'the agent-asks boundary action list is missing')
  for (const action of actions) assert.ok(enumLine.includes(`'${action}'`), `${action} is accepted by the route but not by the boundary schema`)
})
