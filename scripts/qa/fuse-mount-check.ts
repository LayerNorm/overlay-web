/**
 * Phase 0 of internal/plans/FILES_ON_COMPUTERS_PLAN.md: can a Boat computer mount Overlay Files with rclone over
 * FUSE? Starts a short-lived Boat computer, serves a stand-in for the Overlay WebDAV endpoint on loopback
 * (`rclone serve webdav`), mounts it at /overlay with `--vfs-cache-mode full`, and measures listing, search, saves,
 * a large file, many small files, a crashed mount and a stop/resume. The computer is always deleted at the end.
 *
 * Uses the Preview Boat key without writing it anywhere (run from the main checkout, which is linked to Vercel):
 *   vercel env run -e preview -- npx tsx <worktree>/scripts/qa/fuse-mount-check.ts [--skip-resume]
 */
import { randomBytes } from 'node:crypto'
import { BoxSandboxRuntime, boatApiKeyFromEnv } from '../../packages/overlay-sandbox-runtime/src/box'
import type { SandboxInstance } from '../../packages/overlay-sandbox-runtime/src/contracts'

const RCLONE_VERSION = 'v1.68.2'
const skipResume = process.argv.includes('--skip-resume')

type Step = { name: string; ok: boolean; seconds: number; output: string }
const steps: Step[] = []

async function sh(box: SandboxInstance, name: string, script: string, timeoutMs = 5 * 60_000, allowFail = false) {
  const started = Date.now()
  const result = await (await box.runCommand({ command: 'bash', args: ['-c', `set -o pipefail\n${script}`], timeoutMs })).wait()
  const seconds = (Date.now() - started) / 1000
  const output = `${result.stdout}${result.stderr ? `\n[stderr]\n${result.stderr}` : ''}`.trim()
  const ok = result.exitCode === 0
  steps.push({ name, ok, seconds, output })
  console.log(`\n## ${ok ? 'ok  ' : 'FAIL'} ${name} (${seconds.toFixed(1)} s)\n${output.slice(0, 4000)}`)
  if (!ok && !allowFail) throw new Error(`${name} failed with exit code ${result.exitCode}`)
  return result
}

// The mount must come back after a crash, a remount and a resume, so it is one script.
const user = 'overlay'
const pass = randomBytes(12).toString('hex') // Throwaway loopback credential for this run only.
const MOUNT = `(
mkdir -p /tmp/rclone-cache /tmp/overlay-mnt-log
if mountpoint -q /overlay; then echo "already mounted"; exit 0; fi
fusermount3 -uz /overlay 2>/dev/null || fusermount -uz /overlay 2>/dev/null || true
export RCLONE_CONFIG_OVERLAY_TYPE=webdav RCLONE_CONFIG_OVERLAY_URL=http://127.0.0.1:8080 RCLONE_CONFIG_OVERLAY_VENDOR=other
export RCLONE_CONFIG_OVERLAY_USER=${user} RCLONE_CONFIG_OVERLAY_PASS="$(rclone obscure ${pass})"
# Not --daemon: its parent process holds the control port and the background copy then fails to bind it.
nohup rclone mount overlay: /overlay --vfs-cache-mode full --vfs-write-back 5s --dir-cache-time 5s \\
  --cache-dir /tmp/rclone-cache --rc --rc-addr 127.0.0.1:5572 --rc-no-auth --log-file /tmp/overlay-mnt-log/mount.log --log-level INFO >/dev/null 2>&1 &
echo $! > /tmp/mount.pid
for i in $(seq 1 60); do mountpoint -q /overlay && break; sleep 0.5; done
mountpoint /overlay && mount | grep ' /overlay ' || { tail -15 /tmp/overlay-mnt-log/mount.log; exit 32; }
)`
const SERVE = `(
# A PID file, because pgrep -f would match this script's own command line.
[ -f /tmp/serve.pid ] && kill -0 "$(cat /tmp/serve.pid)" 2>/dev/null && { echo "server already running"; exit 0; }
# The stand-in reads its disk fresh each time, as Overlay's endpoint reads Convex.
nohup rclone serve webdav /srv/overlay-src --dir-cache-time 0s --vfs-cache-mode off --addr 127.0.0.1:8080 --user ${user} --pass ${pass} >/tmp/serve.log 2>&1 &
echo $! > /tmp/serve.pid
for i in $(seq 1 30); do curl -s -o /dev/null -u ${user}:${pass} http://127.0.0.1:8080/ && { echo "server up"; exit 0; }; sleep 0.5; done
cat /tmp/serve.log; exit 1
)`

async function main() {
  const apiKey = boatApiKeyFromEnv()
  if (!apiKey) throw new Error('BOAT_API_KEY is not set. Run through `vercel env run -e preview -- …`.')
  const runtime = new BoxSandboxRuntime({ apiKey })
  const started = Date.now()
  const box = await runtime.create({
    name: `overlay-fuse-check-${Date.now()}`,
    persistent: true,
    networkPolicy: { mode: 'allow_all' },
    idleTimeoutMs: 0,
    hardTimeoutMs: 45 * 60_000,
    resources: { vcpus: 2, memoryGiB: 4 },
    metadata: { purpose: 'files-on-computers-phase-0' },
  })
  console.log(`Computer ready in ${((Date.now() - started) / 1000).toFixed(0)} s`)
  try {
    await sh(box, 'Environment', `
uname -srm; . /etc/os-release && echo "$PRETTY_NAME"; id
sudo -n true && echo "sudo: passwordless" || echo "sudo: unavailable"
ls -l /dev/fuse || echo "no /dev/fuse"
grep -E 'fuse' /proc/filesystems || echo "fuse not in /proc/filesystems"
grep CapEff /proc/self/status
command -v fusermount3 fusermount || true
`, 60_000, true)

    await sh(box, 'Install fuse3 and rclone', `
export DEBIAN_FRONTEND=noninteractive
command -v fusermount3 >/dev/null || (sudo -n apt-get update -qq && sudo -n apt-get install -y -qq fuse3 unzip curl >/dev/null)
command -v unzip >/dev/null || sudo -n apt-get install -y -qq unzip >/dev/null
arch=$(uname -m); case "$arch" in x86_64) a=amd64;; aarch64|arm64) a=arm64;; *) echo "unknown arch $arch"; exit 1;; esac
cd /tmp && curl -fsSLO https://downloads.rclone.org/${RCLONE_VERSION}/rclone-${RCLONE_VERSION}-linux-$a.zip
unzip -q -o rclone-${RCLONE_VERSION}-linux-$a.zip && sudo -n install -m 755 rclone-${RCLONE_VERSION}-linux-$a/rclone /usr/local/bin/rclone
rclone version | head -1; fusermount3 -V
ls -l /dev/fuse; stat -c '%a %U' "$(command -v fusermount3)"
`)

    await sh(box, 'Seed a stand-in for workspace files', `
sudo -n mkdir -p /srv/overlay-src /overlay && sudo -n chown "$(id -u):$(id -g)" /srv/overlay-src /overlay
cd /srv/overlay-src && mkdir -p workspace/Launch workspace/Research
printf '# Launch FAQ\\n\\nAnswers for the December 2 launch.\\n' > 'workspace/Launch/Launch FAQ.md'
printf '# Pricing benchmark\\n\\nAnnual billing saves two months.\\n' > 'workspace/Research/Pricing benchmark.md'
for i in $(seq 1 200); do printf 'Interview %s: customers asked about seats.\\n' $i > "workspace/Research/interview-$i.md"; done
head -c 52428800 /dev/urandom > workspace/Research/recording.bin
find . -type f | wc -l
`)
    await sh(box, 'Start the stand-in WebDAV endpoint', SERVE, 60_000)
    await sh(box, 'Mount /overlay', MOUNT, 60_000)

    await sh(box, 'List the tree', `time (ls -R /overlay/workspace | wc -l)`)
    await sh(box, 'Search with grep', `time (grep -ril annual /overlay/workspace/Research --include='*.md')`)
    await sh(box, 'Read a note twice (second from cache)', `time cat '/overlay/workspace/Launch/Launch FAQ.md' >/dev/null; time cat '/overlay/workspace/Launch/Launch FAQ.md'`)
    await sh(box, 'Read a 50 MB file twice', `time md5sum /overlay/workspace/Research/recording.bin; time md5sum /overlay/workspace/Research/recording.bin; md5sum /srv/overlay-src/workspace/Research/recording.bin`)

    await sh(box, 'Save, create, rename and delete', `
echo 'Agent edit.' >> '/overlay/workspace/Launch/Launch FAQ.md'
printf '# New note\\n' > '/overlay/workspace/Launch/New note.md'
mv /overlay/workspace/Research/interview-1.md /overlay/workspace/Research/interview-one.md
rm /overlay/workspace/Research/interview-2.md
mkdir /overlay/workspace/Drafts
for s in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 20 30; do
  if grep -q 'Agent edit.' '/srv/overlay-src/workspace/Launch/Launch FAQ.md' 2>/dev/null && [ -f '/srv/overlay-src/workspace/Launch/New note.md' ]; then
    echo "saves reached the server after about $s s"; break
  fi; sleep 1
done
ls /srv/overlay-src/workspace/Launch /srv/overlay-src/workspace/Research | grep -E 'New note|interview-(one|2)\\.md' || true
test -d /srv/overlay-src/workspace/Drafts && echo "folder created on server"
test ! -e /srv/overlay-src/workspace/Research/interview-2.md && echo "delete reached server"
`)
    await sh(box, 'A change on the server shows up on the mount', `
echo 'Edited in the app.' >> '/srv/overlay-src/workspace/Research/Pricing benchmark.md'
f='/overlay/workspace/Research/Pricing benchmark.md'
for s in $(seq 1 15); do grep -q 'Edited in the app' "$f" && { echo "visible after about $s s on its own"; exit 0; }; sleep 1; done
echo "not visible after 15 s on its own; size on server $(stat -c %s "/srv/overlay-src/workspace/Research/Pricing benchmark.md"), on mount $(stat -c %s "$f")"
rclone rc vfs/forget 'file=workspace/Research/Pricing benchmark.md' >/dev/null && echo "sent vfs/forget"
grep -q 'Edited in the app' "$f" && { echo "visible right after vfs/forget"; exit 0; }
rclone rc vfs/refresh dir=workspace/Research >/dev/null && echo "sent vfs/refresh"
grep -q 'Edited in the app' "$f" && { echo "visible after vfs/refresh"; exit 0; }
echo "still stale"; exit 1
`, 60_000, true)
    await sh(box, 'A change to a file never opened on the mount', `
echo 'Edited in the app.' >> /srv/overlay-src/workspace/Research/interview-50.md
for s in $(seq 1 15); do grep -q 'Edited in the app' /overlay/workspace/Research/interview-50.md && { echo "visible after about $s s on its own"; exit 0; }; sleep 1; done
echo "not visible after 15 s"; exit 1
`, 60_000, true)

    await sh(box, '2,000 small files: mount vs local disk', `
mkdir -p /overlay/workspace/bench /tmp/bench
echo "write on mount:"; time (for i in $(seq 1 2000); do echo "export const v$i = $i" > /overlay/workspace/bench/f$i.ts; done)
echo "write on local disk:"; time (for i in $(seq 1 2000); do echo "export const v$i = $i" > /tmp/bench/f$i.ts; done)
echo "read all on mount:"; time (cat /overlay/workspace/bench/*.ts | wc -l)
echo "read all on local disk:"; time (cat /tmp/bench/*.ts | wc -l)
for s in $(seq 1 120); do n=$(ls /srv/overlay-src/workspace/bench | wc -l); [ "$n" -ge 2000 ] && { echo "all 2000 uploaded after about $s s"; break; }; sleep 1; done
echo "on server: $(ls /srv/overlay-src/workspace/bench | wc -l)"
`, 10 * 60_000, true)

    await sh(box, 'Clean unmount and remount', `
fusermount3 -u /overlay && echo unmounted
${MOUNT}
grep -c 'Agent edit' '/overlay/workspace/Launch/Launch FAQ.md'
`, 2 * 60_000)

    await sh(box, 'Crash rclone, then recover', `
kill -9 "$(cat /tmp/mount.pid)" && echo 'killed rclone mount'; sleep 1
ls /overlay 2>&1 | head -2 || true
${MOUNT}
ls /overlay/workspace
`, 2 * 60_000)

    if (!skipResume) {
      await sh(box, 'Before stop: save a file', `echo 'Saved before stop.' > /overlay/workspace/Launch/before-stop.md; sleep 8; ls /srv/overlay-src/workspace/Launch`)
      const stopStart = Date.now()
      // The runtime waits 120 s for a stop; keep waiting so we learn how long it really takes.
      await box.stop().catch(async (error) => {
        console.log(`\n${error instanceof Error ? error.message : error}; waiting up to 10 more minutes`)
        await (box as unknown as { waitUntil(targets: string[], timeoutMs: number): Promise<unknown> }).waitUntil(['archived'], 10 * 60_000)
      })
      console.log(`\nStopped after ${((Date.now() - stopStart) / 1000).toFixed(0)} s`)
      await box.resume()
      console.log(`\nStop and resume took ${((Date.now() - stopStart) / 1000).toFixed(0)} s`)
      await sh(box, 'After resume: state of the mount', `mountpoint /overlay || echo "not mounted"; pgrep -fa '^rclone' || echo "no rclone running"; ls /srv/overlay-src/workspace/Launch`, 60_000, true)
      await sh(box, 'After resume: start the server and mount again', `${SERVE}\n${MOUNT}\ncat /overlay/workspace/Launch/before-stop.md`, 2 * 60_000, true)
    }

    await sh(box, 'Mount log warnings', `grep -E 'ERROR|WARN|NOTICE' /tmp/overlay-mnt-log/mount.log | tail -20 || echo "none"`, 60_000, true)
  } finally {
    await box.delete().then(() => console.log('\nComputer deleted.'), (error) => console.error('\nDELETE FAILED, remove it by hand:', error))
  }

  console.log('\n# Summary')
  for (const step of steps) console.log(`- ${step.ok ? 'ok  ' : 'FAIL'} ${step.name} (${step.seconds.toFixed(1)} s)`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  console.log('\n# Summary')
  for (const step of steps) console.log(`- ${step.ok ? 'ok  ' : 'FAIL'} ${step.name} (${step.seconds.toFixed(1)} s)`)
  process.exitCode = 1
})
