// Opt-in build-only telemetry. Never report arguments, paths, environment values or heap contents.
import { getHeapStatistics } from 'node:v8'
import { PerformanceObserver, performance } from 'node:perf_hooks'
import { threadId } from 'node:worker_threads'
let gcMs = 0
let gcCount = 0
const observer = new PerformanceObserver(list => {
  for (const entry of list.getEntries()) { gcMs += entry.duration; gcCount++ }
})
observer.observe({ entryTypes: ['gc'] })
const startedAt = performance.now()
function report(phase) {
  const memory = process.memoryUsage()
  const cpu = process.cpuUsage()
  const mb = bytes => Math.round(bytes / 1024 / 1024)
  console.error(JSON.stringify({ event: 'build-resource-usage', phase, pid: process.pid, threadId,
    node: process.version, elapsedMs: Math.round(performance.now() - startedAt),
    rssMiB: mb(memory.rss), heapUsedMiB: mb(memory.heapUsed), heapLimitMiB: mb(getHeapStatistics().heap_size_limit),
    cpuUserMs: Math.round(cpu.user / 1000), cpuSystemMs: Math.round(cpu.system / 1000), gcMs: Math.round(gcMs), gcCount }))
}
report('start')
setInterval(() => report('sample'), 60000).unref()
process.once('exit', () => { observer.disconnect(); report('exit') })
