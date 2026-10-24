import 'server-only'
import { randomUUID } from 'node:crypto'
import { z } from 'zod/v3'

const candidates = z.array(z.object({ id: z.string().min(1), key: z.string().min(1) }).strict()).max(32)
type Candidate = z.infer<typeof candidates>[number]

export async function cleanupDriveVersions(dependencies: {
  claim(claim: string): Promise<unknown>
  deleteObject(key: string): Promise<void>
  absent(key: string): Promise<boolean>
  acknowledge(input: Candidate & { claim: string }): Promise<boolean>
}) {
  const claim = randomUUID()
  const { objects, convexDeleted } = z.object({ objects: candidates, convexDeleted: z.number().int().nonnegative().max(32) }).strict().parse(await dependencies.claim(claim))
  let deleted = 0
  for (const object of objects) {
    try {
      await dependencies.deleteObject(object.key)
      if (await dependencies.absent(object.key)
        && await dependencies.acknowledge({ ...object, claim })) deleted++
    } catch (_error) { /* The durable claim remains charged and becomes retryable. */ }
  }
  return { deleted: deleted + convexDeleted, deferred: objects.length - deleted }
}
