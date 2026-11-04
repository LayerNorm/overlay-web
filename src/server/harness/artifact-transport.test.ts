import { describe, expect, it } from 'vitest'
import { ConvexHttpClient } from 'convex/browser'
import { convexToJson, jsonToConvex } from 'convex/values'
import { api } from '../../../convex/_generated/api'

describe('Harness artifact Convex transport', () => {
  it('uses public action references and Convex byte serialization in the real HTTP client', async () => {
    const bytes = new Uint8Array([0, 255, 16, 128])
    const calls: Array<{ url: string; path: string; format: string; args: unknown[]; authorization?: string }> = []
    const client = new ConvexHttpClient('https://fixture.convex.cloud', {
      logger: false,
      skipConvexDeploymentUrlCheck: true,
      fetch: async (input, init) => {
        const body = JSON.parse(String(init?.body)) as { path: string; format: string; args: unknown[] }
        calls.push({
          ...body,
          url: String(input),
          authorization: new Headers(init?.headers).get('Authorization') ?? undefined,
        })
        return Response.json({ status: 'success', value: convexToJson(bytes.buffer) })
      },
    })
    const result = await client.action(api.harness.artifacts.readChunk, {
      actorUserId: 'actor', runId: 'run', workflowRunId: 'workflow', serverSecret: 'server-secret',
      artifactId: `ha_${'a'.repeat(64)}`, offset: 0, length: bytes.byteLength,
    })
    expect(calls[0]?.url).toBe('https://fixture.convex.cloud/api/action')
    expect(calls[0]?.authorization).toBeUndefined()
    expect(calls[0]?.path).toBe('harness/artifacts:readChunk')
    expect(calls[0]?.format).toBe('convex_encoded_json')
    expect(jsonToConvex(calls[0]?.args[0] as Parameters<typeof jsonToConvex>[0])).toMatchObject({
      serverSecret: 'server-secret',
      artifactId: `ha_${'a'.repeat(64)}`,
      offset: 0,
      length: bytes.byteLength,
    })
    expect(Array.from(new Uint8Array(result as ArrayBuffer))).toEqual(Array.from(bytes))
  })
})
