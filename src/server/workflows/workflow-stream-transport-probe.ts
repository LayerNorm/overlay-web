import { FatalError, getWritable } from 'workflow'
import { previewOrigin } from '../../shared/web/preview-origin'

const chunks = Array.from({ length: 16 }, (_, index) => new TextEncoder().encode(
  `workflow-stream-probe:${String(index + 1).padStart(2, '0')}: café 東京 🧪\n`,
))

export async function writeWorkflowStreamProbeChunks(
  writer: WritableStreamDefaultWriter<Uint8Array>,
): Promise<void> {
  try {
    for (const chunk of chunks) await writer.write(chunk)
    await writer.close()
  } catch (_error) {
    throw new FatalError('Workflow stream probe write failed; the uncertain write will not be retried.')
  } finally {
    writer.releaseLock()
  }
}

async function writeWorkflowStreamProbe(): Promise<void> {
  'use step'

  if (process.env.VERCEL_ENV !== 'preview' || process.env.OVERLAY_DEPLOYMENT_ENV !== 'preview'
    || !previewOrigin(process.env)) {
    throw new FatalError('Workflow stream probe is restricted to an isolated Preview deployment.')
  }

  try {
    await writeWorkflowStreamProbeChunks(getWritable<Uint8Array>().getWriter())
  } catch (error) {
    if (FatalError.is(error)) throw error
    throw new FatalError('Workflow stream probe setup failed; the uncertain write will not be retried.')
  }
}
writeWorkflowStreamProbe.maxRetries = 0

export async function workflowStreamTransportProbe(): Promise<{ completed: true; chunkCount: 16 }> {
  'use workflow'

  await writeWorkflowStreamProbe()
  return { completed: true, chunkCount: 16 }
}
