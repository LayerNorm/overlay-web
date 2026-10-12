#!/usr/bin/env bash
# Builds the Overlay layer of the agent image on top of a provider base
# (Boat's system layer, or an E2B base image). Run on the machine being
# prepared, with the inputs staged in $OVERLAY_IMAGE_SOURCE:
#   versions.json            image version and pinned adapter versions
#   *.tgz                    the Agent Host and bridge protocol, packed from this repo
#
# Installs into /opt/overlay, links `overlay-agent-host` onto PATH, writes the
# image manifest to /opt/overlay/image.json and /etc/overlay/image.json, and
# finishes with `overlay-agent-host image-check` (pinned adapters installed, no
# credentials on disk). It never starts the host: an image must not contain an
# enrolled identity.
set -euo pipefail

src="${OVERLAY_IMAGE_SOURCE:-/tmp/overlay-image}"
prefix=/opt/overlay

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$node_major" -lt 24 ]; then
  echo "Node 24+ is required (found $(node -v))" >&2
  exit 1
fi

sudo_if_needed() { if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo -n "$@"; fi }

image_version="$(node -p "require('$src/versions.json').imageVersion")"
pinned="$(node -p "Object.entries(require('$src/versions.json').packages).map(([name, version]) => name + '@' + version).join(' ')")"

sudo_if_needed mkdir -p "$prefix" /etc/overlay
sudo_if_needed chown "$(id -u):$(id -g)" "$prefix"
cd "$prefix"
[ -f package.json ] || printf '{ "name": "overlay-agent-image", "private": true }\n' > package.json
# shellcheck disable=SC2086
npm install --no-audit --no-fund --omit=dev --save-exact "$src"/*.tgz $pinned
sudo_if_needed ln -sf "$prefix/node_modules/.bin/overlay-agent-host" /usr/local/bin/overlay-agent-host

node - "$prefix" "$image_version" > "$prefix/image.json" <<'JS'
const [prefix, imageVersion] = process.argv.slice(2)
const version = (name) => require(`${prefix}/node_modules/${name}/package.json`).version
const packages = Object.fromEntries([
  '@layernorm/overlay-agent-host',
  '@layernorm/overlay-agent-bridge-protocol',
  'acpx',
  '@agentclientprotocol/claude-agent-acp',
  '@agentclientprotocol/codex-acp',
].map((name) => [name, version(name)]))
process.stdout.write(JSON.stringify({
  imageVersion: Number(imageVersion),
  hostVersion: packages['@layernorm/overlay-agent-host'],
  packages,
  builtAt: new Date().toISOString(),
}, null, 2) + '\n')
JS
sudo_if_needed cp "$prefix/image.json" /etc/overlay/image.json
sudo_if_needed chmod 0644 /etc/overlay/image.json

rm -rf "$src"
overlay-agent-host image-check
