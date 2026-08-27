#!/usr/bin/env bash
set -euo pipefail

OVERLAY_HOME="${OVERLAY_HOME:-/opt/overlay}"
OVERLAY_VERSION="${OVERLAY_VERSION:-latest}"
OVERLAY_HTTP_PORT="${OVERLAY_HTTP_PORT:-3000}"
OVERLAY_INSTALLER_IMAGE="${OVERLAY_INSTALLER_IMAGE:-ghcr.io/layernorm/overlay-installer:${OVERLAY_VERSION}}"

log() {
  printf '%s\n' "$*"
}

die() {
  printf 'overlay install error: %s\n' "$*" >&2
  exit 1
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

ensure_docker() {
  command_exists docker || die "Docker is not installed. Install Docker Engine or Docker Desktop, then rerun this script."
  docker info >/dev/null 2>&1 || die "Docker is installed but the daemon is not running or is not reachable."
  docker compose version >/dev/null 2>&1 || die "Docker Compose v2 plugin is required. Install the Docker Compose plugin, then rerun this script."
}

ensure_overlay_home() {
  if mkdir -p "$OVERLAY_HOME" 2>/dev/null; then
    return
  fi

  command_exists sudo || die "Cannot create $OVERLAY_HOME and sudo is unavailable. Set OVERLAY_HOME to a writable path."
  sudo mkdir -p "$OVERLAY_HOME"
  sudo chown "$(id -u):$(id -g)" "$OVERLAY_HOME"
}

write_overlayctl_wrapper() {
  local target="$1"
  local quoted_home quoted_image quoted_port

  printf -v quoted_home '%q' "$OVERLAY_HOME"
  printf -v quoted_image '%q' "$OVERLAY_INSTALLER_IMAGE"
  printf -v quoted_port '%q' "$OVERLAY_HTTP_PORT"

  cat >"$target" <<EOF
#!/usr/bin/env bash
set -euo pipefail

DEFAULT_OVERLAY_HOME=${quoted_home}
DEFAULT_OVERLAY_INSTALLER_IMAGE=${quoted_image}
DEFAULT_OVERLAY_HTTP_PORT=${quoted_port}

OVERLAY_HOME="\${OVERLAY_HOME:-\$DEFAULT_OVERLAY_HOME}"
OVERLAY_INSTALLER_IMAGE="\${OVERLAY_INSTALLER_IMAGE:-\$DEFAULT_OVERLAY_INSTALLER_IMAGE}"
OVERLAY_HTTP_PORT="\${OVERLAY_HTTP_PORT:-\$DEFAULT_OVERLAY_HTTP_PORT}"
OVERLAY_VERSION="\${OVERLAY_VERSION:-}"

docker_tty_args=()
if [ -t 0 ] && [ -t 1 ]; then
  docker_tty_args=(-it)
else
  docker_tty_args=(-i)
fi

exec docker run --rm "\${docker_tty_args[@]}" \\
  -v /var/run/docker.sock:/var/run/docker.sock \\
  -v "\${OVERLAY_HOME}:/var/lib/overlay" \\
  -e OVERLAY_HOME=/var/lib/overlay \\
  -e OVERLAY_VERSION="\${OVERLAY_VERSION}" \\
  -e OVERLAY_HTTP_PORT="\${OVERLAY_HTTP_PORT}" \\
  -e OVERLAY_SKIP_START="\${OVERLAY_SKIP_START:-}" \\
  "\${OVERLAY_INSTALLER_IMAGE}" "\$@"
EOF
  chmod 0755 "$target"
}

install_overlayctl_wrapper() {
  local local_wrapper="${OVERLAY_HOME}/overlayctl"
  write_overlayctl_wrapper "$local_wrapper"

  if install -m 0755 "$local_wrapper" /usr/local/bin/overlayctl 2>/dev/null; then
    log "Installed overlayctl at /usr/local/bin/overlayctl"
    return
  fi

  if command_exists sudo && sudo install -m 0755 "$local_wrapper" /usr/local/bin/overlayctl; then
    log "Installed overlayctl at /usr/local/bin/overlayctl"
    return
  fi

  log "Could not install overlayctl into /usr/local/bin."
  log "Use ${local_wrapper} directly, or copy it into a directory on PATH."
}

run_installer() {
  local docker_tty_args=()
  if [ -t 0 ] && [ -t 1 ]; then
    docker_tty_args=(-it)
  else
    docker_tty_args=(-i)
  fi

  docker run --rm "${docker_tty_args[@]}" \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v "${OVERLAY_HOME}:/var/lib/overlay" \
    -e OVERLAY_HOME=/var/lib/overlay \
    -e OVERLAY_VERSION="${OVERLAY_VERSION}" \
    -e OVERLAY_HTTP_PORT="${OVERLAY_HTTP_PORT}" \
    -e OVERLAY_SKIP_START="${OVERLAY_SKIP_START:-}" \
    "${OVERLAY_INSTALLER_IMAGE}" init
}

main() {
  log "Installing Overlay self-hosted runtime"
  log "Home: ${OVERLAY_HOME}"
  log "Version: ${OVERLAY_VERSION}"
  log "HTTP port: ${OVERLAY_HTTP_PORT}"
  log "Security boundary: the short-lived installer receives Docker-socket access,"
  log "which is equivalent to host-root access. Inspect this script before continuing."
  log ""
  log "Inspectable install flow:"
  log "  curl -fsSLO https://getoverlay.io/install.sh && less install.sh && bash install.sh"
  log ""

  ensure_docker
  ensure_overlay_home
  run_installer
  install_overlayctl_wrapper

  log ""
  log "Overlay install files are in ${OVERLAY_HOME}"
  log "Edit ${OVERLAY_HOME}/overlay.config.json, then run: overlayctl apply"
  log "Check status with: overlayctl status"
}

main "$@"
