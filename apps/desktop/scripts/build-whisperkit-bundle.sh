#!/bin/bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WHISPERKIT_REPOSITORY="https://github.com/argmaxinc/WhisperKit.git"
WHISPERKIT_COMMIT="cb00a08d08d2dad37ca8aa488ee0695e97ab6045"
# Use a stable, non-user-specific path because SwiftPM embeds a resource-bundle
# path in the executable even when compiler debug-prefix mapping is enabled.
SOURCE_ROOT="/tmp/overlay-native/WhisperKit-$WHISPERKIT_COMMIT"
BUNDLE_DIR="$PROJECT_ROOT/whisperkit-bundle"
PUBLIC_SOURCE_ROOT="/usr/src/overlay/WhisperKit"

if [[ ! "$WHISPERKIT_COMMIT" =~ ^[0-9a-f]{40}$ ]]; then
  echo "WhisperKit source must be pinned to a full commit SHA" >&2
  exit 1
fi

if [ ! -d "$SOURCE_ROOT/.git" ]; then
  mkdir -p "$(dirname "$SOURCE_ROOT")"
  git init "$SOURCE_ROOT"
  git -C "$SOURCE_ROOT" remote add origin "$WHISPERKIT_REPOSITORY"
  git -C "$SOURCE_ROOT" fetch --depth 1 origin "$WHISPERKIT_COMMIT"
  git -C "$SOURCE_ROOT" checkout --detach FETCH_HEAD
fi

if [ "$(git -C "$SOURCE_ROOT" rev-parse HEAD)" != "$WHISPERKIT_COMMIT" ]; then
  echo "Cached WhisperKit source does not match the pinned commit" >&2
  exit 1
fi

git -C "$SOURCE_ROOT" diff --quiet
git -C "$SOURCE_ROOT" diff --cached --quiet

swift build \
  --package-path "$SOURCE_ROOT" \
  --configuration release \
  --product whisperkit-cli \
  --disable-automatic-resolution \
  -Xswiftc -debug-prefix-map \
  -Xswiftc "$SOURCE_ROOT=$PUBLIC_SOURCE_ROOT" \
  -Xcc "-fdebug-prefix-map=$SOURCE_ROOT=$PUBLIC_SOURCE_ROOT" \
  -Xcc "-ffile-prefix-map=$SOURCE_ROOT=$PUBLIC_SOURCE_ROOT"

BINARY_PATH="$(swift build --package-path "$SOURCE_ROOT" --configuration release --show-bin-path)/whisperkit-cli"
test -x "$BINARY_PATH"
mkdir -p "$BUNDLE_DIR"
cp "$BINARY_PATH" "$BUNDLE_DIR/whisperkit-cli"
chmod 0755 "$BUNDLE_DIR/whisperkit-cli"

file "$BUNDLE_DIR/whisperkit-cli"
shasum -a 256 "$BUNDLE_DIR/whisperkit-cli"
