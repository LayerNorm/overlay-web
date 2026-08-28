export const SANDBOX_EGRESS_LIMIT_EXIT_CODE = 173

export function buildSandboxEgressGuardedCommand(input: {
  commandPath: string
  counterRoot?: string
  markerPath: string
  maxEgressBytes: number
  stderrPath: string
  stdoutPath: string
}) {
  const counterRoot = input.counterRoot ?? '/sys/class/net'
  const maxEgressBytes = Math.max(0, Math.floor(input.maxEgressBytes))
  return [
    'set +e',
    `OVERLAY_EGRESS_COUNTER_ROOT=${shellQuote(counterRoot)}`,
    `OVERLAY_EGRESS_LIMIT=${maxEgressBytes}`,
    'OVERLAY_EGRESS_COUNTER_FOUND=0',
    'for INTERFACE_DIR in "$OVERLAY_EGRESS_COUNTER_ROOT"/*; do',
    '  [ -d "$INTERFACE_DIR" ] || continue',
    '  [ "${INTERFACE_DIR##*/}" = "lo" ] && continue',
    '  [ -r "$INTERFACE_DIR/statistics/tx_bytes" ] || continue',
    '  OVERLAY_EGRESS_COUNTER_FOUND=1',
    '  break',
    'done',
    'if [ "$OVERLAY_EGRESS_COUNTER_FOUND" -ne 1 ] || ! command -v setsid >/dev/null 2>&1; then',
    `  printf '%s\\n' 'Sandbox egress guard is unavailable; execution refused.' > ${shellQuote(input.stderrPath)}`,
    '  exit 126',
    'fi',
    'read_egress_bytes() {',
    '  TOTAL=0',
    '  for INTERFACE_DIR in "$OVERLAY_EGRESS_COUNTER_ROOT"/*; do',
    '    [ -d "$INTERFACE_DIR" ] || continue',
    '    [ "${INTERFACE_DIR##*/}" = "lo" ] && continue',
    '    COUNTER="$INTERFACE_DIR/statistics/tx_bytes"',
    '    [ -r "$COUNTER" ] || continue',
    '    IFS= read -r VALUE < "$COUNTER" || VALUE=0',
    '    case "$VALUE" in *[!0-9]*|\'\') VALUE=0 ;; esac',
    '    TOTAL=$((TOTAL + VALUE))',
    '  done',
    '  printf \'%s\\n\' "$TOTAL"',
    '}',
    `rm -f ${shellQuote(input.markerPath)}`,
    'EGRESS_START=$(read_egress_bytes)',
    `setsid bash ${shellQuote(input.commandPath)} > ${shellQuote(input.stdoutPath)} 2> ${shellQuote(input.stderrPath)} &`,
    'COMMAND_PID=$!',
    '(',
    '  while kill -0 "$COMMAND_PID" 2>/dev/null; do',
    '    EGRESS_CURRENT=$(read_egress_bytes)',
    '    EGRESS_USED=$((EGRESS_CURRENT - EGRESS_START))',
    '    if [ "$EGRESS_USED" -gt "$OVERLAY_EGRESS_LIMIT" ]; then',
    `      printf '%s\\n' "$EGRESS_USED" > ${shellQuote(input.markerPath)}`,
    '      /bin/kill -TERM -- "-$COMMAND_PID" 2>/dev/null || true',
    '      sleep 0.25',
    '      /bin/kill -KILL -- "-$COMMAND_PID" 2>/dev/null || true',
    '      exit 0',
    '    fi',
    '    sleep 0.05',
    '  done',
    ') &',
    'GUARD_PID=$!',
    'wait "$COMMAND_PID"',
    'EXIT_CODE=$?',
    'kill "$GUARD_PID" 2>/dev/null || true',
    'wait "$GUARD_PID" 2>/dev/null || true',
    // A command can daemonize descendants before its shell exits. Always tear
    // down the isolated process group so nothing can transfer or mutate files
    // while bounded artifacts are inspected.
    '/bin/kill -TERM -- "-$COMMAND_PID" 2>/dev/null || true',
    'sleep 0.05',
    '/bin/kill -KILL -- "-$COMMAND_PID" 2>/dev/null || true',
    `if [ -f ${shellQuote(input.markerPath)} ]; then`,
    `  printf '%s\\n' 'Sandbox network egress limit exceeded.' >> ${shellQuote(input.stderrPath)}`,
    `  EXIT_CODE=${SANDBOX_EGRESS_LIMIT_EXIT_CODE}`,
    'fi',
    `if [ -f ${shellQuote(input.stdoutPath)} ]; then cat ${shellQuote(input.stdoutPath)}; fi`,
    'exit "$EXIT_CODE"',
  ].join('\n')
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`
}
