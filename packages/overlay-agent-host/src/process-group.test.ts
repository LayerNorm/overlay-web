import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {createInterface} from 'node:readline'
import test from 'node:test'
import {processGroupHasLiveMembers, signalProcessGroup} from './process-group.js'

const posix = {skip: process.platform === 'win32' ? 'POSIX process groups only' : false, timeout: 15_000}

test('group stop requires actual exit and never treats a live permission denial as termination', posix, async t => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {detached: true, stdio: 'ignore'})
  const exited = once(child, 'exit')
  await once(child, 'spawn')
  assert.ok(child.pid)
  const pid = child.pid
  try {
    assert.equal(await processGroupHasLiveMembers(pid), true)
    const denied = Object.assign(Error('permission denied'), {code: 'EPERM'})
    const mock = t.mock.method(process, 'kill', () => {throw denied})
    try {await assert.rejects(signalProcessGroup(pid, 'SIGTERM'), error => error === denied)}
    finally {mock.mock.restore()}
    await signalProcessGroup(pid, 'SIGTERM')
    await exited
    assert.equal(await processGroupHasLiveMembers(pid), false)
  } finally {child.kill('SIGKILL')}
})

test('a real unreaped zombie group is stopped even when Darwin refuses to signal it', posix, async () => {
  // The supervisor deliberately retains one exited child until stdin closes, then reaps it.
  const script = `import os,sys,time,subprocess
pid=os.fork()
if pid==0:
 os.setsid()
 os._exit(0)
for _ in range(500):
 state=subprocess.check_output(['ps','-o','stat=','-p',str(pid)],text=True).strip()
 if state.startswith('Z'):break
 time.sleep(.01)
else:raise Exception('Child did not exit')
print(pid,flush=True)
sys.stdin.read()
os.waitpid(pid,0)
`
  const supervisor = spawn('python3', ['-I', '-c', script], {stdio: ['pipe', 'pipe', 'inherit']})
  const closed = once(supervisor, 'close')
  const lines = createInterface({input: supervisor.stdout})
  try {
    const line = await Promise.race([
      once(lines, 'line').then(([line]) => line),
      closed.then(() => {throw Error('Zombie supervisor exited before reporting its child')}),
    ])
    const pid = Number(line)
    assert.ok(Number.isSafeInteger(pid) && pid > 1)
    if (process.platform === 'darwin') assert.throws(() => process.kill(-pid, 'SIGTERM'), {code: 'EPERM'})
    assert.equal(await processGroupHasLiveMembers(pid), false)
    await signalProcessGroup(pid, 'SIGTERM')
    await signalProcessGroup(pid, 'SIGKILL')
  } finally {
    lines.close()
    supervisor.stdin.end()
    await closed
  }
})

test('invalid group IDs are rejected before any process can be signalled', async () => {
  for (const group of [-1, 0, 1, NaN, 2.5]) {
    await assert.rejects(signalProcessGroup(group, 'SIGTERM'), /Invalid process group/)
    await assert.rejects(processGroupHasLiveMembers(group), /Invalid process group/)
  }
})
