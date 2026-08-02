import 'server-only'

import { metrics } from '@opentelemetry/api'
import { getOverlayRuntimeConfigSync } from '@/server/config'
import type { LifecycleEvent, LifecycleEventSink } from '@/server/lifecycle-events'
import { getObservabilityContext } from './context'
import { logger } from './logger'

let telemetryStarted = false
let lifecycleCounter: ReturnType<ReturnType<typeof metrics.getMeter>['createCounter']> | null = null

export function createOpenTelemetryLifecycleSink(): LifecycleEventSink {
  return {
    destination: 'metrics',
    async deliver(event) {
      recordLifecycleMetric(event)
    },
  }
}

export async function startOnPremOpenTelemetry(): Promise<void> {
  const configuration = openTelemetryConfiguration()
  if (telemetryStarted || !configuration) return
  telemetryStarted = true

  try {
    const [{ NodeSDK }, { OTLPMetricExporter }, { PeriodicExportingMetricReader }, { resourceFromAttributes }] =
      await Promise.all([
        import('@opentelemetry/sdk-node'),
        import('@opentelemetry/exporter-metrics-otlp-http'),
        import('@opentelemetry/sdk-metrics'),
        import('@opentelemetry/resources'),
      ])
    const context = getObservabilityContext()
    const sdk = new NodeSDK({
      autoDetectResources: false,
      metricReaders: [new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: configuration.endpoint }),
      })],
      resource: resourceFromAttributes({
        'deployment.environment.name': context.environment,
        'service.name': 'overlay',
        'service.version': context.release,
      }),
    })
    sdk.start()
    logger.info('OpenTelemetry metrics exporter enabled', {
      provider: 'otlp',
    })
  } catch (_error) {
    telemetryStarted = false
    logger.warn('OpenTelemetry metrics exporter failed to start', { provider: 'otlp' })
  }
}

function recordLifecycleMetric(event: LifecycleEvent): void {
  if (!openTelemetryConfiguration()) return
  lifecycleCounter ??= metrics.getMeter('overlay').createCounter('overlay.lifecycle.events', {
    description: 'Overlay lifecycle events by event and provider classification',
  })
  lifecycleCounter.add(1, {
    'overlay.event.name': event.name,
    'overlay.provider': lifecycleProvider(event),
    'overlay.schema.version': event.schemaVersion,
  })
}

function lifecycleProvider(event: LifecycleEvent): string {
  if ('provider' in event.attributes) return event.attributes.provider
  if (event.name === 'user.created') return event.attributes.authProvider
  return 'automation'
}

function openTelemetryConfiguration(): { endpoint: string } | null {
  const endpoint = parseMetricEndpoint(process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT)
  if (!endpoint) return null
  try {
    const config = getOverlayRuntimeConfigSync()
    return config.app.deploymentEnvironment === 'onprem' && config.features.openTelemetry === true
      ? { endpoint }
      : null
  } catch (_error) {
    return null
  }
}

function parseMetricEndpoint(value: string | undefined): string | null {
  const endpoint = value?.trim()
  if (!endpoint) return null
  try {
    const url = new URL(endpoint)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch (_error) {
    return null
  }
}
