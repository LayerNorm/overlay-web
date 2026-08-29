export function buildSandboxProcessGuardedCommand(input: {
  commandPath: string
  stderrPath: string
  stdoutPath: string
}) {
  return [
    'set +e',
    'if ! command -v setsid >/dev/null 2>&1; then',
    `  printf '%s\\n' 'Sandbox process guard is unavailable; execution refused.' > ${shellQuote(input.stderrPath)}`,
    '  exit 126',
    'fi',
    `setsid bash ${shellQuote(input.commandPath)} > ${shellQuote(input.stdoutPath)} 2> ${shellQuote(input.stderrPath)} &`,
    'COMMAND_PID=$!',
    'wait "$COMMAND_PID"',
    'EXIT_CODE=$?',
    // A command can daemonize descendants before its shell exits. Always tear
    // down the isolated process group so nothing can mutate bounded artifacts
    // while they are inspected.
    '/bin/kill -TERM -- "-$COMMAND_PID" 2>/dev/null || true',
    'sleep 0.05',
    '/bin/kill -KILL -- "-$COMMAND_PID" 2>/dev/null || true',
    `if [ -f ${shellQuote(input.stdoutPath)} ]; then cat ${shellQuote(input.stdoutPath)}; fi`,
    'exit "$EXIT_CODE"',
  ].join('\n')
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`
}
