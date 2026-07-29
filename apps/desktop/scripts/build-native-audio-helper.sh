#!/bin/bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE="$PROJECT_ROOT/native-audio-helper/native-audio-helper.swift"
OUTPUT="$PROJECT_ROOT/resources/native-audio-helper"

swiftc \
  -O \
  -whole-module-optimization \
  -debug-prefix-map "$PROJECT_ROOT=/usr/src/overlay" \
  "$SOURCE" \
  -framework AVFoundation \
  -framework AudioToolbox \
  -o "$OUTPUT"

chmod 0755 "$OUTPUT"
file "$OUTPUT"
shasum -a 256 "$OUTPUT"
