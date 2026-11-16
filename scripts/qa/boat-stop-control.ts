/**
 * Control for scripts/qa/fuse-mount-check.ts: how long does a Boat computer take to stop, with and without an
 * rclone FUSE mount? Prints every state Boat reports. Always deletes the computers.
 *   BOX_API_KEY=… npx tsx scripts/qa/boat-stop-control.ts [--with-mount] [--at=/overlay]
 */
import { BoxSandboxRuntime, boatApiKeyFromEnv } from '../../packages/overlay-sandbox-runtime/src/box'

const withMount = process.argv.includes('--with-mount')
// Where to mount: /tmp/mnt by default, or --at=/overlay to mount at the top of the disk.
const mountAt = process.argv.find((arg) => arg.startsWith('--at='))?.slice(5) ?? '/tmp/mnt'
// Optionally point a link at the mount, e.g. --link=/overlay, and resume after the stop.
const link = process.argv.find((arg) => arg.startsWith('--link='))?.slice(7)
const resume = process.argv.includes('--resume')
type Internal = { getBox(id: string): Promise<{ state: string; snapshotAvailable?: boolean }>; request(method: string, path: string, init?: unknown): Promise<unknown> }

async function main() {
  const runtime = new BoxSandboxRuntime({ apiKey: boatApiKeyFromEnv() })
  const box = await runtime.create({
    name: `overlay-stop-control-${Date.now()}`, persistent: true, networkPolicy: { mode: 'allow_all' },
    idleTimeoutMs: 0, hardTimeoutMs: 30 * 60_000, resources: { vcpus: 2, memoryGiB: 4 },
  })
  const id = (box as unknown as { reference: string }).reference
  const internal = runtime as unknown as Internal
  try {
    if (withMount) {
      const script = `set -e
cd /tmp && curl -fsSLO https://downloads.rclone.org/v1.68.2/rclone-v1.68.2-linux-amd64.zip && unzip -q -o rclone-v1.68.2-linux-amd64.zip
sudo -n install -m 755 rclone-v1.68.2-linux-amd64/rclone /usr/local/bin/rclone
mkdir -p /tmp/src && sudo -n mkdir -p ${mountAt} && sudo -n chown $(id -u) ${mountAt} && echo hi > /tmp/src/a.txt
nohup rclone mount :local:/tmp/src ${mountAt} --vfs-cache-mode full >/tmp/m.log 2>&1 &
for i in $(seq 1 40); do mountpoint -q ${mountAt} && break; sleep 0.5; done; mountpoint ${mountAt}${link ? `
sudo -n ln -sfn ${mountAt} ${link} && cat ${link}/a.txt` : ''}`
      const r = await (await box.runCommand({ command: 'bash', args: ['-c', script], timeoutMs: 120_000 })).wait()
      console.log('mount:', r.exitCode, r.stdout.trim())
    } else {
      const r = await (await box.runCommand({ command: 'echo', args: ['ready'], timeoutMs: 30_000 })).wait()
      console.log('command:', r.exitCode, r.stdout.trim())
    }
    const started = Date.now()
    await internal.request('POST', `/sandboxes/${id}/stop`, { body: {} })
    let last = ''
    while (Date.now() - started < 8 * 60_000) {
      const info = await internal.getBox(id)
      const line = `${info.state} snapshot=${info.snapshotAvailable}`
      if (line !== last) { console.log(`${((Date.now() - started) / 1000).toFixed(0)} s: ${line}`); last = line }
      if (info.state === 'archived' || info.state === 'error') break
      await new Promise((resolve) => setTimeout(resolve, 3000))
    }
    if (resume && last.startsWith('archived')) {
      const resumed = Date.now()
      await box.resume()
      console.log(`resumed in ${((Date.now() - resumed) / 1000).toFixed(0)} s`)
      const check = `mountpoint ${mountAt} || echo "mount gone"; ls -ld ${mountAt} ${link ?? ''} 2>&1; ls /tmp/src 2>&1 | head -3; pgrep -fa '^rclone' || echo "no rclone"`
      const r = await (await box.runCommand({ command: 'bash', args: ['-c', check], timeoutMs: 30_000 })).wait()
      console.log(r.stdout.trim(), r.stderr.trim())
    }
  } finally {
    await box.delete().then(() => console.log('deleted'), (error) => console.error('DELETE FAILED', error))
  }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1 })
