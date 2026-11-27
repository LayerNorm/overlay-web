#!/bin/bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_INPUT="$PROJECT_ROOT/ParakeetServer"
BUNDLE_DIR="$PROJECT_ROOT/parakeet-bundle"
PUBLIC_SOURCE_ROOT="/usr/src/overlay/ParakeetServer"
FLUID_AUDIO_COMMIT="2d18c856aad09b509d07322ae2e811f06c98a2a9"

SOURCE_DIGEST="$(
  cd "$SOURCE_INPUT"
  find Package.swift Package.resolved Sources -type f -print0 |
    sort -z |
    xargs -0 shasum -a 256 |
    shasum -a 256 |
    awk '{print $1}'
)"
SOURCE_ROOT="/tmp/overlay-native/ParakeetServer-$SOURCE_DIGEST"

case "$SOURCE_ROOT" in
  /tmp/overlay-native/ParakeetServer-[0-9a-f]*) ;;
  *)
    echo "Refusing unsafe native staging path: $SOURCE_ROOT" >&2
    exit 1
    ;;
esac

mkdir -p "$SOURCE_ROOT"
rsync -a --delete --exclude '.build' "$SOURCE_INPUT/" "$SOURCE_ROOT/"

if ! grep -q "\"revision\" : \"$FLUID_AUDIO_COMMIT\"" "$SOURCE_ROOT/Package.resolved"; then
  echo "Package.resolved does not contain the reviewed FluidAudio revision" >&2
  exit 1
fi

swift package --package-path "$SOURCE_ROOT" clean
swift build \
  --package-path "$SOURCE_ROOT" \
  --configuration release \
  --product parakeet-cli \
  --disable-automatic-resolution \
  -Xswiftc -debug-prefix-map \
  -Xswiftc "$SOURCE_ROOT=$PUBLIC_SOURCE_ROOT" \
  -Xcc "-fdebug-prefix-map=$SOURCE_ROOT=$PUBLIC_SOURCE_ROOT" \
  -Xcc "-ffile-prefix-map=$SOURCE_ROOT=$PUBLIC_SOURCE_ROOT"

BINARY_PATH="$(swift build --package-path "$SOURCE_ROOT" --configuration release --show-bin-path)/parakeet-cli"
test -x "$BINARY_PATH"
mkdir -p "$BUNDLE_DIR"
cp "$BINARY_PATH" "$BUNDLE_DIR/parakeet-cli"
chmod 0755 "$BUNDLE_DIR/parakeet-cli"

file "$BUNDLE_DIR/parakeet-cli"
shasum -a 256 "$BUNDLE_DIR/parakeet-cli"
